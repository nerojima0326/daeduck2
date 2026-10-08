"""공유 전시, 작가 이야기, 검수, 관심 작품, 관람 성과. 기존 DB를 보존하며 확장합니다."""
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse


def initialize(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS exhibitions (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, curator TEXT NOT NULL,
            description TEXT NOT NULL, artwork_ids TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0,
            created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artist_profiles (
            name TEXT PRIMARY KEY, story TEXT NOT NULL DEFAULT '', interview TEXT NOT NULL DEFAULT '',
            published INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artwork_bookmarks (
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            artwork_id TEXT REFERENCES artworks(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL, PRIMARY KEY(user_id, artwork_id)
        );
        CREATE TABLE IF NOT EXISTS ai_proposals (
            id TEXT PRIMARY KEY, artwork_id TEXT REFERENCES artworks(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE SET NULL, content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
            reviewed_at INTEGER, reviewed_by TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS experience_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, artwork_id TEXT REFERENCES artworks(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN ('view','listen','qr')), at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS experience_event_period ON experience_events(at, kind);
        CREATE TABLE IF NOT EXISTS public_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, at INTEGER NOT NULL
        );
    """)
    for table, columns in {
        "artworks": {"visual_description": "TEXT NOT NULL DEFAULT ''", "ai_reviewed_by": "TEXT NOT NULL DEFAULT ''", "ai_reviewed_at": "INTEGER"},
        "placement_requests": {"installed_at": "INTEGER", "installed_by": "TEXT NOT NULL DEFAULT ''", "installation_image": "TEXT NOT NULL DEFAULT ''"},
    }.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, spec in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {spec}")
    # 이전 버전의 승인 건은 이미 이동이 완료됐으므로 설치 완료로 이관합니다.
    if not conn.execute("SELECT 1 FROM meta WHERE key='experience_migrated'").fetchone():
        conn.execute("UPDATE placement_requests SET installed_at=handled_at, installed_by=handled_by WHERE status='approved'")
        conn.execute("INSERT INTO meta(key,value) VALUES('experience_migrated','1')")


def activity(conn, text, at):
    conn.execute("INSERT INTO public_activity(text,at) VALUES(?,?)", (text, at))


def seed_exhibitions(conn, s):
    if conn.execute("SELECT 1 FROM meta WHERE key='exhibitions_seeded'").fetchone():
        return
    for id_, title, curator, desc, ids, featured in [
        ("EX-nature", "자연이 건네는 위안", "ESG추진팀", "꽃과 산, 계절의 풍경을 담은 작품들을 만나보세요.", ['W069','W112','W061','W091','W082','W051'], 1),
        ("EX-stories", "우리들의 이야기", "경영지원팀", "일상과 가족, 사람 사이의 따뜻한 이야기입니다.", ['W003','W143','W120','W045','W037','W012'], 0),
    ]:
        conn.execute("INSERT INTO exhibitions VALUES(?,?,?,?,?,?,NULL,?,?)", (id_, title, curator, desc, json.dumps(ids), featured, s.now_ms(), s.now_ms()))
    conn.execute("INSERT INTO meta(key,value) VALUES('exhibitions_seeded','1')")


def seed_visual_descriptions(conn, s):
    source = s.SEED_DIR / 'visual_descriptions.json'
    if not source.exists():
        return
    for id_, description in json.loads(source.read_text(encoding='utf-8')).items():
        # 직접 확인한 원본 사진에만 적용. 교체된 이미지나 기존 묘사를 덮어쓰지 않습니다.
        conn.execute("UPDATE artworks SET visual_description=? WHERE id=? AND image=? AND visual_description=''", (description,id_,id_+'.png'))


def public_exhibition(r, available):
    return {"id": r['id'], "title": r['title'], "curator": r['curator'], "desc": r['description'],
            "artworkIds": [i for i in json.loads(r['artwork_ids']) if i in available], "featured": bool(r['featured']),
            "createdBy": r['created_by'], "createdAt": r['created_at']}


def validate_ai(d, s):
    if not isinstance(d, dict) or any(not isinstance(d.get(k, ''), str) or len(d.get(k, '')) > 3000 for k in ('full','easy','caption')):
        raise s.ApiError(400, "설명은 각 항목 3,000자 이내로 입력해 주세요.")
    if not any(d.get(k, '').strip() for k in ('full','easy','caption')):
        raise s.ApiError(400, "설명을 입력해 주세요.")
    return {k: d.get(k, '').strip() for k in ('full','easy','caption')}


def dispatch(h, method, path, s):
    """일치한 경로는 응답 후 True, 기존 API는 False."""
    qr_match = re.fullmatch(r'/api/artworks/([\w-]+)/qr', path)
    if qr_match and method == 'GET':
        from qrcodegen import QrCode
        with s.db() as conn:
            h.get_artwork_row(conn, qr_match[1])
        target = parse_qs(urlparse(h.path).query).get('url',[''])[0]
        parsed = urlparse(target)
        if len(target)>2000 or parsed.scheme not in ('http','https') or not parsed.netloc or parsed.fragment != 'art/'+qr_match[1]+'?source=qr':
            raise s.ApiError(400, '공유할 작품 주소를 확인해 주세요.')
        code = QrCode.encode_text(target, QrCode.Ecc.MEDIUM)
        size = code.get_size()
        modules = ' '.join(f'M{x+4},{y+4}h1v1h-1z' for y in range(size) for x in range(size) if code.get_module(x,y))
        data = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size+8} {size+8}" role="img" aria-label="작품 해설 QR"><rect width="100%" height="100%" fill="white"/><path d="{modules}" fill="black"/></svg>'.encode()
        h.send_response(200)
        h.send_header('Content-Type','image/svg+xml; charset=utf-8')
        h.send_header('Content-Length',str(len(data)))
        h.send_header('Cache-Control','no-store')
        h.end_headers()
        h.wfile.write(data)
        return True
    matched = re.fullmatch(r"/api/(experience|exhibitions|impact|artists|ai-proposals)(?:/([^/]+))?(?:/(approve|reject|feature))?", path)
    art_match = re.fullmatch(r"/api/artworks/([\w-]+)/(bookmark|events|ai-proposals)", path)
    install_match = re.fullmatch(r"/api/requests/([\w-]+)/install", path)
    if not any((matched, art_match, install_match)):
        return False
    d = h.read_json(s.MAX_UPLOAD_BODY) if method in ('POST','PATCH') and int(h.headers.get('Content-Length') or 0) else {}
    result, status = {}, 200
    with s.db() as conn:
        user = h.current_user(conn)
        def member():
            if not user:
                raise s.ApiError(401, "로그인 후 참여할 수 있어요.")
            return user
        def admin():
            member()
            if user['role'] != 'admin':
                raise s.ApiError(403, "담당 관리자만 처리할 수 있어요.")
        if matched:
            resource, id_, action = matched.groups()
            available = {r[0] for r in conn.execute('SELECT id FROM artworks')}
            if resource == 'experience' and method == 'GET' and not id_:
                seed_exhibitions(conn, s)
                profiles = {r['name']: dict(r) for r in conn.execute('SELECT * FROM artist_profiles')}
                artists = []
                for r in conn.execute("SELECT artist, MAX(artist_bio) AS bio, COUNT(*) AS count FROM artworks GROUP BY artist ORDER BY artist"):
                    p = profiles.get(r['artist'], {})
                    artists.append({"name": r['artist'], "bio": r['bio'], "count": r['count'],
                                    "story": p.get('story','') if p.get('published') else '',
                                    "interview": p.get('interview','') if p.get('published') else ''})
                result = {"exhibitions": [public_exhibition(r, available) for r in conn.execute('SELECT * FROM exhibitions ORDER BY featured DESC, created_at DESC')],
                          "artists": artists, "artistDrafts": profiles if user and user['role']=='admin' else {},
                          "bookmarks": [r[0] for r in conn.execute('SELECT artwork_id FROM artwork_bookmarks WHERE user_id=?', (user['id'],))] if user else [],
                          "activity": [dict(r) for r in conn.execute('SELECT text,at FROM public_activity ORDER BY id DESC LIMIT 20')]}
            elif resource == 'exhibitions':
                seed_exhibitions(conn, s)
                row = conn.execute('SELECT * FROM exhibitions WHERE id=?', (id_,)).fetchone() if id_ else None
                if id_ and not row:
                    raise s.ApiError(404, "전시를 찾을 수 없습니다.")
                if method == 'POST' and not id_:
                    member()
                    title = s.clean_text(d.get('title'), 60, 'title', '전시 제목', True)
                    curator = s.clean_text(d.get('curator') or user['name'], 40, 'curator', '큐레이터', True)
                    desc = s.clean_text(d.get('desc'), 2000, 'desc', '전시 소개')
                    ids = d.get('artworkIds')
                    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i,str) or i not in available for i in ids):
                        raise s.ApiError(400, "전시할 작품을 1~100점 선택해 주세요.")
                    id_ = 'EX-' + secrets.token_hex(6)
                    conn.execute('INSERT INTO exhibitions VALUES(?,?,?,?,?,0,?,?,?)', (id_, title, curator, desc, json.dumps(list(dict.fromkeys(ids))), user['id'], s.now_ms(), s.now_ms()))
                    activity(conn, f'새 전시 「{title}」이 열렸습니다.', s.now_ms())
                    status = 201
                    result = {"exhibition": public_exhibition(conn.execute('SELECT * FROM exhibitions WHERE id=?', (id_,)).fetchone(), available)}
                elif method == 'POST' and action == 'feature':
                    admin()
                    conn.execute('UPDATE exhibitions SET featured=0')
                    conn.execute('UPDATE exhibitions SET featured=1 WHERE id=?', (id_,))
                    activity(conn, f'이달의 전시 「{row["title"]}」이 선정되었습니다.', s.now_ms())
                    result = {"ok": True}
                elif method == 'DELETE' and id_ and not action:
                    admin()
                    conn.execute('DELETE FROM exhibitions WHERE id=?', (id_,))
                    result = {"ok": True}
                else:
                    raise s.ApiError(405, "지원하지 않는 전시 요청입니다.")
            elif resource == 'artists' and method == 'PATCH' and id_:
                admin()
                name = s.unquote(id_)
                if not conn.execute('SELECT 1 FROM artworks WHERE artist=?', (name,)).fetchone():
                    raise s.ApiError(404, "작가를 찾을 수 없습니다.")
                story = s.clean_text(d.get('story'), 3000, 'story', '작가 이야기')
                interview = s.clean_text(d.get('interview'), 3000, 'interview', '인터뷰')
                published = d.get('published') is True
                if published and d.get('consentConfirmed') is not True:
                    raise s.ApiError(400, "작가가 공개에 동의한 내용인지 확인해 주세요.")
                conn.execute('INSERT INTO artist_profiles VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET story=excluded.story, interview=excluded.interview, published=excluded.published, updated_at=excluded.updated_at', (name, story, interview, int(published), s.now_ms()))
                result = {"ok": True}
            elif resource == 'ai-proposals':
                if method == 'GET' and not id_:
                    member()
                    condition, args = ('', ()) if user['role']=='admin' else (' WHERE p.user_id=?', (user['id'],))
                    rows = conn.execute('SELECT p.*, a.title, u.name AS author FROM ai_proposals p JOIN artworks a ON a.id=p.artwork_id LEFT JOIN users u ON u.id=p.user_id' + condition + ' ORDER BY p.created_at DESC LIMIT 100', args).fetchall()
                    result = {"proposals": [{**dict(r), "content": json.loads(r['content'])} for r in rows]}
                elif method == 'POST' and action in ('approve','reject'):
                    admin()
                    row = conn.execute('SELECT * FROM ai_proposals WHERE id=?', (id_,)).fetchone()
                    if not row: raise s.ApiError(404, "제안을 찾을 수 없습니다.")
                    if row['status'] != 'pending': raise s.ApiError(409, "이미 검수된 제안입니다.")
                    new_status = 'approved' if action == 'approve' else 'rejected'
                    conn.execute('UPDATE ai_proposals SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?', (new_status,s.now_ms(),user['name'],id_))
                    if action == 'approve':
                        conn.execute('UPDATE artworks SET ai=?,ai_reviewed_by=?,ai_reviewed_at=?,updated_at=? WHERE id=?', (row['content'],user['name'],s.now_ms(),s.now_ms(),row['artwork_id']))
                        activity(conn, '작품 해설이 담당자 검수를 거쳐 공개되었습니다.', s.now_ms())
                    result = {"ok": True}
                else: raise s.ApiError(405, "지원하지 않는 검수 요청입니다.")
            elif resource == 'impact' and method == 'GET' and not id_:
                params = parse_qs(urlparse(h.path).query)
                days = params.get('days',['30'])[0]
                if days not in ('7','30','90','all'): raise s.ApiError(400, "기간을 확인해 주세요.")
                start = 0 if days == 'all' else s.now_ms() - int(days)*86400000
                metrics = {r['kind']: r['n'] for r in conn.execute('SELECT kind,COUNT(*) n FROM experience_events WHERE at>=? GROUP BY kind', (start,))}
                metrics.update({
                    "artists": conn.execute('SELECT COUNT(DISTINCT artist) FROM artworks').fetchone()[0],
                    "participants": conn.execute('SELECT COUNT(DISTINCT user_id) FROM artwork_reactions WHERE updated_at>=?', (start,)).fetchone()[0],
                    "installations": conn.execute("SELECT COUNT(*) FROM placement_requests WHERE installed_at>=? AND installation_image!=''", (max(start,1),)).fetchone()[0],
                    "fromStorage": conn.execute("SELECT COUNT(*) FROM placement_requests WHERE installed_at>=? AND installation_image!='' AND from_location IN ('STORE','NONE')", (max(start,1),)).fetchone()[0],
                    "proposals": conn.execute('SELECT COUNT(*) FROM placement_requests WHERE created_at>=?', (start,)).fetchone()[0],
                    "exhibitions": conn.execute('SELECT COUNT(*) FROM exhibitions WHERE created_at>=?', (start,)).fetchone()[0],
                    "photos": conn.execute("SELECT COUNT(*) FROM artworks WHERE image!=''").fetchone()[0],
                    "total": conn.execute('SELECT COUNT(*) FROM artworks').fetchone()[0],
                })
                monthly = [dict(r) for r in conn.execute("SELECT strftime('%Y-%m', at/1000, 'unixepoch', '+9 hours') month,COUNT(*) views FROM experience_events WHERE kind='view' AND at>=? GROUP BY month ORDER BY month", (start,))]
                result = {"metrics": metrics, "monthly": monthly, "period": days,
                          "note": "관람·듣기·QR은 이용 횟수이며 중복 이용을 포함합니다. 기간별 관람 기록은 기능 도입 이후부터 집계됩니다. 참여자는 감상 반응을 남긴 회원 수입니다."}
            else: raise s.ApiError(405, "지원하지 않는 요청입니다.")
        elif art_match:
            art_id, action = art_match.groups()
            h.get_artwork_row(conn, art_id)
            if action == 'bookmark' and method == 'POST':
                member()
                exists = conn.execute('SELECT 1 FROM artwork_bookmarks WHERE user_id=? AND artwork_id=?', (user['id'],art_id)).fetchone()
                if exists: conn.execute('DELETE FROM artwork_bookmarks WHERE user_id=? AND artwork_id=?', (user['id'],art_id))
                else: conn.execute('INSERT INTO artwork_bookmarks VALUES(?,?,?)', (user['id'],art_id,s.now_ms()))
                result = {"bookmarked": not bool(exists)}
            elif action == 'events' and method == 'POST':
                kind = d.get('kind')
                if kind not in ('listen','qr'): raise s.ApiError(400, "지원하지 않는 관람 기록입니다.")
                conn.execute('INSERT INTO experience_events(artwork_id,kind,at) VALUES(?,?,?)', (art_id,kind,s.now_ms()))
                result = {"ok": True}
            elif action == 'ai-proposals' and method == 'POST':
                member()
                ai = validate_ai(d.get('ai'), s)
                if conn.execute("SELECT 1 FROM ai_proposals WHERE artwork_id=? AND user_id=? AND status='pending'", (art_id,user['id'])).fetchone():
                    raise s.ApiError(409, "이미 검수 대기 중인 설명 제안이 있습니다.")
                conn.execute('INSERT INTO ai_proposals(id,artwork_id,user_id,content,created_at) VALUES(?,?,?,?,?)', ('P-'+secrets.token_hex(6), art_id,user['id'],json.dumps(ai,ensure_ascii=False),s.now_ms()))
                result, status = {"ok": True}, 201
            else: raise s.ApiError(405, "지원하지 않는 작품 요청입니다.")
        elif install_match and method == 'POST':
            admin()
            row = conn.execute(s.REQUEST_SELECT + ' WHERE r.id=?', (install_match[1],)).fetchone()
            if not row: raise s.ApiError(404, "신청을 찾을 수 없습니다.")
            if row['status']!='approved' or row['installed_at']: raise s.ApiError(409, "설치 대기 중인 승인 건만 확인할 수 있어요.")
            if row['current_loc'] != row['from_location']: raise s.ApiError(409, "승인 후 작품 위치가 변경되었습니다. 신청을 다시 검토해 주세요.")
            if not d.get('image'): raise s.ApiError(400, "실제 설치 사진을 첨부해 주세요.")
            image = s.save_image(d['image'])
            art = conn.execute('SELECT * FROM artworks WHERE id=?', (row['artwork_id'],)).fetchone()
            s.record_move(conn, art, row['location'], '배치 제안 설치 확인', user['name'])
            conn.execute('UPDATE artworks SET location=?,updated_at=? WHERE id=?', (row['location'],s.now_ms(),row['artwork_id']))
            conn.execute('UPDATE placement_requests SET installed_at=?,installed_by=?,installation_image=? WHERE id=?', (s.now_ms(),user['name'],image,row['id']))
            activity(conn, f'「{row["title"]}」 작품이 {next(l["name"] for l in s.LOCATIONS if l["id"]==row["location"])}에 전시되었습니다.', s.now_ms())
            result = {"request": s.public_request(conn.execute(s.REQUEST_SELECT+' WHERE r.id=?',(row['id'],)).fetchone())}
        else: raise s.ApiError(405, "지원하지 않는 요청입니다.")
    h.send_json(status, result)
    return True
