"""
대덕전자 아트브릿지 - 백엔드 서버 (1단계: 회원가입 / 로그인 / 부서별 관리자 키)

- Python 3.10+ 표준 라이브러리만 사용합니다. (pip 설치 필요 없음)
- 회원 정보는 SQLite 파일(backend/artbridge.db)에 저장되어 브라우저를 꺼도 유지됩니다.
- 비밀번호는 PBKDF2-SHA256(+사용자별 salt)으로 해시해서 저장하고, 원문은 저장하지 않습니다.
- 로그인 상태는 HttpOnly 세션 쿠키로 유지합니다. (로그인 유지 체크 시 30일)
- 관리자 가입은 '부서별 관리자 키'가 있어야 합니다. 키도 해시로만 저장하며,
  관리자 화면에서 부서 추가 / 키 재발급을 할 수 있습니다. (새 키는 발급 순간에만 한 번 표시)

실행:  py backend/server.py          → http://localhost:8000
       py backend/server.py --open   → 서버 시작 후 브라우저 자동 열기

환경변수(선택):
  ARTBRIDGE_PORT          포트 (기본 8000)
  ARTBRIDGE_DEMO_LOGIN    시연용 원클릭 로그인 허용 여부 (기본 1, 실서비스는 0)
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import threading
import time
import webbrowser
from contextlib import contextmanager
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from datetime import date, datetime, timezone, timedelta
from urllib.parse import unquote, urlparse
import experience

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent  # index.html, style.css, script.js 가 있는 폴더
DB_PATH = Path(os.environ.get("ARTBRIDGE_DB", BASE_DIR / "artbridge.db"))
MEDIA_DIR = Path(os.environ.get("ARTBRIDGE_MEDIA", BASE_DIR / "media"))  # 작품 이미지 저장 폴더 (/media/로 제공)
SEED_DIR = BASE_DIR / "seed"                                               # 엑셀/PDF에서 정리한 초기 작품 데이터
HOST = os.environ.get("ARTBRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ARTBRIDGE_PORT", "8000"))
DEMO_LOGIN = os.environ.get("ARTBRIDGE_DEMO_LOGIN", "1") == "1"

SESSION_COOKIE = "ab_session"
REMEMBER_SECONDS = 30 * 24 * 3600   # 로그인 유지: 30일
SHORT_SESSION_SECONDS = 12 * 3600   # 로그인 유지 안 함: 브라우저 종료 시 또는 12시간
PBKDF2_ITERATIONS = 200_000
MAX_BODY = 64 * 1024
MAX_UPLOAD_BODY = 8 * 1024 * 1024   # 작품 등록·수정 요청 (이미지 포함)
MAX_IMAGE_BYTES = 5 * 1024 * 1024   # 이미지 파일 1장 최대 5MB
LOGIN_FAIL_LIMIT = 5                # 5회 실패 시
LOGIN_LOCK_SECONDS = 5 * 60         # 5분간 로그인 제한

# 시연용 계정 (최초 실행 시 DB에 자동 생성)
DEMO_USERS = [
    {"id": "U-admin", "name": "박관리", "dept": "경영지원팀", "email": "admin@artbridge.kr", "password": "admin1234", "role": "admin"},
    {"id": "U-member", "name": "김민지", "dept": "디자인팀", "email": "member@artbridge.kr", "password": "member1234", "role": "member"},
]

# 부서별 관리자 키 초기값 (DB가 처음 만들어질 때 한 번만 등록, 이후에는 관리자 화면에서 재발급)
# 시연이 끝나면 관리자 화면에서 모두 재발급해 기본 키를 무효화하세요.
DEFAULT_DEPT_KEYS = {
    "경영지원팀": "DD-MGMT-7K2Q",
    "인사팀": "DD-HR-4P9W",
    "ESG추진팀": "DD-ESG-3M8T",
    "홍보팀": "DD-PR-6X1L",
    "연구소": "DD-RND-9C5V",
}
KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 제외

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# 작품 설치 위치 (대덕전자 작품 리스트의 '설치위치' 기준). area는 위치 관리 화면의 구역 묶음
LOCATIONS = [
    {"id": "HQ-CAFE", "name": "HQ 식당", "area": "HQ"},
    {"id": "HQ-3F", "name": "HQ 3F 복도", "area": "HQ"},
    {"id": "HQ-LAB", "name": "HQ 연구소", "area": "HQ"},
    {"id": "HQ-VIPF", "name": "HQ VIP 앞", "area": "HQ"},
    {"id": "HQ-VIP", "name": "HQ VIP", "area": "HQ"},
    {"id": "B1-HALL", "name": "B1 해동기념관 복도", "area": "B1"},
    {"id": "B1-VIP", "name": "B1 VIP", "area": "B1"},
    {"id": "M1-CAFE", "name": "M1 식당", "area": "M1"},
    {"id": "STORE", "name": "창고 보관", "area": "보관"},
    {"id": "NONE", "name": "위치 미정", "area": "보관"},
]
LOCATION_IDS = {l["id"] for l in LOCATIONS}
LOCATION_NAME = {l["id"]: l["name"] for l in LOCATIONS}
THEMES = ["자연", "이야기", "가족", "감정"]
IMAGE_TYPES = {"jpeg": (b"\xff\xd8\xff", "jpg"), "png": (b"\x89PNG", "png"), "webp": (b"RIFF", "webp")}


# ---------------------------------------------------------------- DB
@contextmanager
def db():
    """요청마다 연결을 열고, 성공하면 commit / 오류면 rollback 후 항상 닫습니다."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                email         TEXT NOT NULL UNIQUE,
                name          TEXT NOT NULL,
                dept          TEXT NOT NULL,
                role          TEXT NOT NULL CHECK (role IN ('admin', 'member')),
                pw_hash       TEXT NOT NULL,
                created_at    INTEGER NOT NULL,   -- ms (프론트엔드 Date와 동일 단위)
                last_login_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,        -- 쿠키 토큰 원문이 아닌 SHA-256 해시만 저장
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL         -- 초 단위 unix time
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS dept_keys (
                dept       TEXT PRIMARY KEY,        -- 부서명
                key_hash   TEXT NOT NULL,           -- 관리자 키 (원문 저장 안 함)
                created_at INTEGER NOT NULL,        -- ms
                updated_at INTEGER NOT NULL,        -- ms (마지막 재발급 시각)
                updated_by TEXT                     -- 재발급한 관리자 이름
            );
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS artworks (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                artist      TEXT NOT NULL,
                year        TEXT NOT NULL DEFAULT '',
                medium      TEXT NOT NULL DEFAULT '',
                size        TEXT NOT NULL DEFAULT '',
                theme       TEXT NOT NULL DEFAULT '',
                tags        TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
                description TEXT NOT NULL DEFAULT '',    -- 작가의 작품 설명
                artist_bio  TEXT NOT NULL DEFAULT '',
                location    TEXT NOT NULL DEFAULT 'NONE',
                acquired    TEXT NOT NULL DEFAULT '',    -- 인수일자
                note        TEXT NOT NULL DEFAULT '',    -- 액자 여부 등 비고
                image       TEXT NOT NULL DEFAULT '',    -- media 폴더의 파일명
                ai          TEXT,                        -- AI 설명 JSON {full, easy, caption}
                views       INTEGER NOT NULL DEFAULT 0,
                source      TEXT NOT NULL DEFAULT 'user', -- import: 엑셀 자료 / user: 회원 등록
                created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS artwork_likes (
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, artwork_id)
            );
            CREATE TABLE IF NOT EXISTS artwork_moves (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                artwork_id TEXT NOT NULL,
                title      TEXT NOT NULL,             -- 작품이 삭제돼도 이력에 이름이 남도록 저장
                from_loc   TEXT,
                to_loc     TEXT NOT NULL,
                reason     TEXT NOT NULL DEFAULT '',
                by_name    TEXT NOT NULL DEFAULT '',
                at         INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS placement_requests (
                id             TEXT PRIMARY KEY,
                artwork_id     TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
                user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
                requester_name TEXT NOT NULL,          -- 회원이 삭제돼도 신청자 이름은 남김
                from_location  TEXT NOT NULL DEFAULT '', -- 신청 당시 위치 (처리 후에도 '어디서 → 어디로' 표시)
                location       TEXT NOT NULL,          -- 희망 위치
                date_from      TEXT NOT NULL,          -- YYYY-MM-DD
                date_to        TEXT NOT NULL,
                note           TEXT NOT NULL DEFAULT '',
                status         TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
                admin_note     TEXT NOT NULL DEFAULT '',
                handled_by     TEXT NOT NULL DEFAULT '',
                handled_at     INTEGER,
                created_at     INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_requests_artwork ON placement_requests(artwork_id, status);
            CREATE TABLE IF NOT EXISTS artwork_reactions (
                id         TEXT PRIMARY KEY,
                artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
                user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
                user_name  TEXT NOT NULL,
                rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                feelings   TEXT NOT NULL DEFAULT '[]',   -- JSON 배열
                comment    TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE (artwork_id, user_id)             -- 회원 1명당 작품별 반응 1개 (다시 남기면 수정)
            );
            CREATE INDEX IF NOT EXISTS idx_reactions_artwork ON artwork_reactions(artwork_id, created_at);
            """
        )
        experience.initialize(conn)
        seed_artworks(conn)
        experience.seed_exhibitions(conn, sys.modules[__name__])
        experience.seed_visual_descriptions(conn, sys.modules[__name__])
        # 기존 DB 업그레이드: 임시 비밀번호 사용 여부 컬럼 추가
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        if "must_change_pw" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0")
        req_cols = {r["name"] for r in conn.execute("PRAGMA table_info(placement_requests)")}
        if "from_location" not in req_cols:
            conn.execute("ALTER TABLE placement_requests ADD COLUMN from_location TEXT NOT NULL DEFAULT ''")
        if not conn.execute("SELECT 1 FROM dept_keys LIMIT 1").fetchone():
            for dept, key in DEFAULT_DEPT_KEYS.items():
                conn.execute(
                    "INSERT INTO dept_keys (dept, key_hash, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)",
                    (dept, hash_password(key), now_ms(), now_ms(), "초기 설정"),
                )
        for d in DEMO_USERS:
            exists = conn.execute("SELECT 1 FROM users WHERE id = ? OR email = ?", (d["id"], d["email"])).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO users (id, email, name, dept, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (d["id"], d["email"], d["name"], d["dept"], d["role"], hash_password(d["password"]), now_ms()),
                )
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))


def now_ms():
    return int(time.time() * 1000)


def public_user(row):
    """화면에 보내는 회원 정보 (비밀번호 해시는 절대 포함하지 않음)"""
    keys = row.keys()
    data = {
        "id": row["id"], "name": row["name"], "dept": row["dept"], "email": row["email"],
        "role": row["role"], "createdAt": row["created_at"], "lastLoginAt": row["last_login_at"],
        "mustChangePw": bool(row["must_change_pw"]) if "must_change_pw" in keys else False,
    }
    if "active_sessions" in keys:
        data["online"] = row["active_sessions"] > 0
    return data


# ---------------------------------------------------------------- 작품
def parse_acquired(text):
    """'23.11.07' / '2026.08.28' → ms (등록순 정렬용). 해석 못 하면 None"""
    m = re.match(r"^(\d{2,4})\.(\d{1,2})\.(\d{1,2})", text or "")
    if not m:
        return None
    y = int(m.group(1))
    y = y + 2000 if y < 100 else y
    try:
        return int(time.mktime((y, int(m.group(2)), int(m.group(3)), 12, 0, 0, 0, 0, -1)) * 1000)
    except (OverflowError, ValueError):
        return None


def seed_artworks(conn):
    """최초 1회: backend/seed/artworks.json(엑셀·PDF 정리본)의 작품과 이미지를 DB·media 폴더에 등록.
    한 번 등록한 뒤에는 관리자가 작품을 지워도 다시 채우지 않습니다."""
    if conn.execute("SELECT 1 FROM meta WHERE key = 'artworks_seeded'").fetchone():
        return
    seed_file = SEED_DIR / "artworks.json"
    if not seed_file.exists():
        return
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    works = json.loads(seed_file.read_text(encoding="utf-8"))["works"]
    for w in works:
        image = ""
        if w.get("image") and (SEED_DIR / "images" / w["image"]).exists():
            image = w["image"]
            shutil.copy(SEED_DIR / "images" / image, MEDIA_DIR / image)
        created = parse_acquired(w.get("acquired")) or now_ms()
        conn.execute(
            """INSERT OR IGNORE INTO artworks (id, title, artist, year, medium, size, theme, tags, description,
                   artist_bio, location, acquired, note, image, source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?)""",
            (w["id"], w["title"], w["artist"], w.get("year", ""), w.get("medium", ""), w.get("size", ""),
             w.get("theme", ""), json.dumps(w.get("tags", []), ensure_ascii=False), w.get("description", ""),
             w.get("artistBio", ""), w["location"] if w.get("location") in LOCATION_IDS else "NONE",
             w.get("acquired", ""), w.get("note", ""), image, created, created),
        )
    conn.execute("INSERT INTO meta (key, value) VALUES ('artworks_seeded', ?)", (str(now_ms()),))
    print(f" 초기 작품 {len(works)}점을 등록했습니다.")


ARTWORK_SELECT = """
    SELECT a.*, u.name AS creator_name,
           (SELECT COUNT(*) FROM artwork_likes l WHERE l.artwork_id = a.id) AS likes,
           (SELECT r.id FROM placement_requests r WHERE r.artwork_id = a.id AND (r.status = 'pending' OR (r.status='approved' AND r.installed_at IS NULL)) LIMIT 1) AS pending_id,
           (SELECT r.location FROM placement_requests r WHERE r.artwork_id = a.id AND (r.status = 'pending' OR (r.status='approved' AND r.installed_at IS NULL)) LIMIT 1) AS pending_loc,
           (SELECT COUNT(*) FROM artwork_reactions x WHERE x.artwork_id = a.id) AS reaction_count,
           (SELECT ROUND(AVG(x.rating), 1) FROM artwork_reactions x WHERE x.artwork_id = a.id) AS avg_rating
    FROM artworks a LEFT JOIN users u ON u.id = a.created_by
"""
FEELINGS = ["따뜻해요", "평온해요", "힘이 나요", "신기해요", "그리워요", "설레요"]


def public_reaction(r, user=None):
    return {
        "id": r["id"], "artworkId": r["artwork_id"], "userId": r["user_id"], "name": r["user_name"],
        "rating": r["rating"], "feelings": json.loads(r["feelings"] or "[]"), "comment": r["comment"],
        "at": r["created_at"], "updatedAt": r["updated_at"],
        "title": r["title"] if "title" in r.keys() else None,
        "mine": bool(user) and r["user_id"] == user["id"],
        "canDelete": bool(user) and (r["user_id"] == user["id"] or user["role"] == "admin"),
    }
DISPLAY_LOCATIONS = LOCATION_IDS - {"STORE", "NONE"}  # 배치 신청 가능한 실제 전시 공간
REQUEST_STATUS = {"pending": "대기", "approved": "승인", "rejected": "반려", "cancelled": "취소"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

REQUEST_SELECT = """
    SELECT r.*, a.title, a.artist, a.image, a.location AS current_loc, a.created_by AS owner_id,
           u.email AS requester_email
    FROM placement_requests r
    JOIN artworks a ON a.id = r.artwork_id
    LEFT JOIN users u ON u.id = r.user_id
"""


def public_request(r):
    return {
        "id": r["id"], "artworkId": r["artwork_id"], "title": r["title"], "artist": r["artist"],
        "image": f"/media/{r['image']}" if r["image"] else "", "currentLocationId": r["current_loc"],
        "fromLocationId": r["from_location"] or r["current_loc"],
        "userId": r["user_id"], "name": r["requester_name"], "email": r["requester_email"] or "",
        "locationId": r["location"], "from": r["date_from"], "to": r["date_to"], "note": r["note"],
        "status": r["status"], "statusText": ('설치 완료' if r['installation_image'] else '이전 승인 기록' if r['installed_at'] else '승인 · 설치 대기') if r['status']=='approved' else REQUEST_STATUS[r["status"]], "adminNote": r["admin_note"],
        "installedAt": r['installed_at'], "installedBy": r['installed_by'],
        "installationImage": f"/media/{r['installation_image']}" if r['installation_image'] else '',
        "handledBy": r["handled_by"], "handledAt": r["handled_at"], "at": r["created_at"],
    }


def public_artwork(row, user=None, liked=frozenset()):
    """화면용 작품 정보. 프론트엔드 필드명(intent, locationId)에 맞춤"""
    is_admin = bool(user) and user["role"] == "admin"
    is_owner = bool(user) and row["created_by"] == user["id"]
    return {
        "id": row["id"], "title": row["title"], "artist": row["artist"], "year": row["year"],
        "medium": row["medium"], "size": row["size"], "theme": row["theme"],
        "tags": json.loads(row["tags"] or "[]"), "intent": row["description"], "artistBio": row["artist_bio"],
        "locationId": row["location"], "acquired": row["acquired"], "note": row["note"],
        "image": f"/media/{row['image']}" if row["image"] else "",
        "ai": json.loads(row["ai"]) if row["ai"] else None,
        "visualDescription": row['visual_description'], "aiReviewedBy": row['ai_reviewed_by'], "aiReviewedAt": row['ai_reviewed_at'],
        "views": row["views"], "likes": row["likes"], "likedByMe": row["id"] in liked,
        "source": row["source"], "createdBy": row["created_by"], "createdByName": row["creator_name"] or "",
        "createdAt": row["created_at"],
        "canDelete": is_admin or is_owner,   # 관리자: 모든 작품 / 회원: 본인이 올린 작품만
        "canEdit": is_admin,
        "canRequest": bool(user),            # 모든 회원이 우리 공간 전시를 제안할 수 있음
        "pendingRequest": {"id": row["pending_id"], "locationId": row["pending_loc"]} if row["pending_id"] else None,
        "reactionCount": row["reaction_count"], "avgRating": row["avg_rating"],
    }


def liked_set(conn, user):
    if not user:
        return frozenset()
    return frozenset(r[0] for r in conn.execute("SELECT artwork_id FROM artwork_likes WHERE user_id = ?", (user["id"],)))


def save_image(data_url):
    """data:image/...;base64,... → media 폴더에 저장하고 파일명 반환 (형식·크기·파일 서명 검사)"""
    m = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)", data_url or "", re.S)
    if not m:
        raise ApiError(400, "이미지는 JPG, PNG, WEBP 형식만 올릴 수 있어요.", "image")
    try:
        raw = base64.b64decode(m.group(2))
    except ValueError:
        raise ApiError(400, "이미지 파일을 읽을 수 없어요.", "image")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ApiError(413, "이미지는 5MB 이하만 올릴 수 있어요.", "image")
    magic, ext = IMAGE_TYPES[m.group(1)]
    if not raw.startswith(magic) or (ext == "webp" and raw[8:12] != b"WEBP"):
        raise ApiError(400, "올바른 이미지 파일이 아니에요.", "image")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    name = f"u-{secrets.token_hex(8)}.{ext}"
    (MEDIA_DIR / name).write_bytes(raw)
    return name


def remove_image(name):
    if name and re.fullmatch(r"[\w.-]+", name):
        try:
            (MEDIA_DIR / name).unlink()
        except FileNotFoundError:
            pass


def record_move(conn, artwork, to_loc, reason, by_name):
    conn.execute(
        "INSERT INTO artwork_moves (artwork_id, title, from_loc, to_loc, reason, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (artwork["id"], artwork["title"], artwork["location"] if "location" in artwork.keys() else None,
         to_loc, reason, by_name, now_ms()),
    )


def clean_text(value, limit, field, label, required=False):
    text = str(value or "").strip()
    if required and not text:
        raise ApiError(400, f"{label}을(를) 입력해 주세요.", field)
    if len(text) > limit:
        raise ApiError(400, f"{label}은(는) {limit}자 이하로 입력해 주세요.", field)
    return text


# ---------------------------------------------------------------- 비밀번호 / 세션
def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# 존재하지 않는 이메일로 로그인할 때도 같은 시간이 걸리도록 비교용 더미 해시
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_temp_password():
    """임시 비밀번호: 영문+숫자 규칙을 항상 만족 (예: TMP-KQMX-4829)"""
    letters = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
    digits = "".join(secrets.choice("23456789") for _ in range(4))
    return f"TMP-{letters}-{digits}"


def new_dept_key():
    """DD-XXXX-XXXX-XXXX 형식의 새 관리자 키 (약 60비트)"""
    block = lambda: "".join(secrets.choice(KEY_ALPHABET) for _ in range(4))
    return f"DD-{block()}-{block()}-{block()}"


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn, user_id, remember):
    token = secrets.token_urlsafe(32)
    ttl = REMEMBER_SECONDS if remember else SHORT_SESSION_SECONDS
    now = int(time.time())
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token_hash(token), user_id, now, now + ttl),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_ms(), user_id))
    # 쿠키: JS에서 읽을 수 없고(HttpOnly), 다른 사이트의 요청에는 붙지 않음(SameSite=Lax)
    cookie = f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax"
    if remember:
        cookie += f"; Max-Age={REMEMBER_SECONDS}"
    return cookie


def clear_cookie():
    return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"


# 로그인 실패 횟수 제한 (메모리 보관)
_fail_lock = threading.Lock()
_fails = {}


def is_locked(email):
    with _fail_lock:
        recent = [t for t in _fails.get(email, []) if time.time() - t < LOGIN_LOCK_SECONDS]
        _fails[email] = recent
        return len(recent) >= LOGIN_FAIL_LIMIT


def record_fail(email):
    with _fail_lock:
        _fails.setdefault(email, []).append(time.time())


def clear_fails(email):
    with _fail_lock:
        _fails.pop(email, None)


# ---------------------------------------------------------------- 요청 처리
class ApiError(Exception):
    def __init__(self, status, message, field=None):
        super().__init__(message)
        self.status, self.message, self.field = status, message, field


class Handler(BaseHTTPRequestHandler):
    server_version = "ArtBridge/1.0"

    # ---- 공통
    def log_message(self, fmt, *args):
        sys.stdout.write(f"[{time.strftime('%H:%M:%S')}] {self.command} {self.path} → {args[1] if len(args) > 1 else ''}\n")

    def send_json(self, status, data, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=MAX_BODY):
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise ApiError(415, "JSON 형식으로 요청해 주세요.")
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ApiError(413, "요청이 너무 큽니다. (이미지는 5MB 이하)")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "잘못된 요청 형식입니다.")
        if not isinstance(data, dict):
            raise ApiError(400, "잘못된 요청 형식입니다.")
        return data

    def session_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw)
        except cookies.CookieError:
            return None
        morsel = jar.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def current_user(self, conn):
        token = self.session_token()
        if not token:
            return None
        return conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            (token_hash(token), int(time.time())),
        ).fetchone()

    def require_admin(self, conn):
        user = self.current_user(conn)
        if not user:
            raise ApiError(401, "로그인이 필요합니다.")
        if user["role"] != "admin":
            raise ApiError(403, "관리자만 이용할 수 있습니다.")
        return user

    def dispatch(self, method):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            if method == "GET" and path.startswith("/media/"):
                return self.serve_media(path)
            if method == "GET":
                return self.serve_static(path)
            return self.send_json(404, {"error": "찾을 수 없습니다."})
        try:
            if experience.dispatch(self, method, path, sys.modules[__name__]):
                return
            route = ROUTES.get((method, path))
            if route:
                return route(self)
            m = re.fullmatch(r"/api/users/([\w-]+)/role", path)
            if m and method == "PATCH":
                return self.change_role(m.group(1))
            m = re.fullmatch(r"/api/users/([\w-]+)/reset-password", path)
            if m and method == "POST":
                return self.reset_password(m.group(1))
            m = re.fullmatch(r"/api/users/([\w-]+)", path)
            if m and method == "DELETE":
                return self.delete_user(m.group(1))
            m = re.fullmatch(r"/api/requests/([\w-]+)/(approve|reject|cancel)", path)
            if m and method == "POST":
                return self.handle_request(m.group(1), m.group(2))
            m = re.fullmatch(r"/api/reactions/([\w-]+)", path)
            if m and method == "DELETE":
                return self.delete_reaction(m.group(1))
            m = re.fullmatch(r"/api/artworks/([\w-]+)(?:/(like|view|reactions))?", path)
            if m:
                art_id, action = m.groups()
                handler = {
                    ("PATCH", None): self.update_artwork, ("DELETE", None): self.delete_artwork,
                    ("POST", "like"): self.toggle_like, ("POST", "view"): self.add_view,
                    ("GET", "reactions"): self.list_reactions, ("POST", "reactions"): self.save_reaction,
                }.get((method, action))
                if handler:
                    return handler(art_id)
            raise ApiError(404, "존재하지 않는 API입니다.")
        except ApiError as e:
            self.send_json(e.status, {"error": e.message, "field": e.field})
        except Exception as e:  # 예상하지 못한 오류
            sys.stderr.write(f"서버 오류: {e!r}\n")
            self.send_json(500, {"error": "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."})

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def do_DELETE(self):
        self.dispatch("DELETE")

    # ---- 정적 파일 (backend 폴더, DB, 숨김 파일은 절대 내보내지 않음)
    def serve_media(self, path):
        """작품 이미지: /media/<파일명> (하위 폴더·경로 이동 불가)"""
        name = unquote(path[len("/media/"):])
        ctype = STATIC_TYPES.get(Path(name).suffix.lower())
        target = MEDIA_DIR / name
        if not re.fullmatch(r"[\w.-]+", name) or not ctype or not target.is_file():
            return self.send_json(404, {"error": "이미지를 찾을 수 없습니다."})
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    # ---- 작품 API
    def meta(self):
        self.send_json(200, {"locations": LOCATIONS, "themes": THEMES})

    def get_artwork_row(self, conn, art_id):
        row = conn.execute(ARTWORK_SELECT + " WHERE a.id = ?", (art_id,)).fetchone()
        if not row:
            raise ApiError(404, "작품을 찾을 수 없습니다.")
        return row

    def list_artworks(self):
        with db() as conn:
            user = self.current_user(conn)
            liked = liked_set(conn, user)
            rows = conn.execute(ARTWORK_SELECT + " ORDER BY a.created_at DESC").fetchall()
        self.send_json(200, {"artworks": [public_artwork(r, user, liked) for r in rows]})

    def artwork_fields(self, d, partial=False):
        """등록/수정 입력값 검사 (partial=True면 보낸 항목만)"""
        out = {}
        spec = [("title", 60, "작품명", True), ("artist", 30, "작가명", True), ("year", 10, "제작연도", False),
                ("medium", 60, "재료/기법", False), ("size", 30, "크기", False),
                ("intent", 2000, "작품 설명", False), ("artistBio", 500, "작가 소개", False),
                ("visualDescription", 2000, "작품의 시각 묘사", False)]
        for key, limit, label, required in spec:
            if partial and key not in d:
                continue
            out[key] = clean_text(d.get(key), limit, key, label, required)
        if not partial or "theme" in d:
            theme = str(d.get("theme") or "").strip()
            out["theme"] = theme if theme in THEMES else ""
        if not partial or "tags" in d:
            tags = d.get("tags") or []
            if not isinstance(tags, list):
                raise ApiError(400, "태그 형식이 올바르지 않습니다.", "tags")
            out["tags"] = [str(t).strip()[:15] for t in tags if str(t).strip()][:6]
        return out

    def create_artwork(self):
        d = self.read_json(MAX_UPLOAD_BODY)
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "작품 등록은 로그인 후 이용할 수 있어요.")
            f = self.artwork_fields(d)
            # 위치 지정은 관리자만. 일반 회원이 등록한 작품은 창고 보관으로 시작
            location = d.get("locationId") if user["role"] == "admin" else "STORE"
            if location not in LOCATION_IDS:
                location = "STORE"
            image = save_image(d["image"]) if d.get("image") else ""
            art_id = "A-" + secrets.token_hex(5)
            now = now_ms()
            conn.execute(
                """INSERT INTO artworks (id, title, artist, year, medium, size, theme, tags, description, artist_bio,
                       location, image, source, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?)""",
                (art_id, f["title"], f["artist"], f["year"], f["medium"], f["size"], f["theme"],
                 json.dumps(f["tags"], ensure_ascii=False), f["intent"], f["artistBio"], location, image,
                 user["id"], now, now),
            )
            record_move(conn, {"id": art_id, "title": f["title"]}, location, "신규 등록", user["name"])
            conn.execute('UPDATE artworks SET visual_description=? WHERE id=?', (f['visualDescription'],art_id))
            experience.activity(conn, f'새 작품 「{f["title"]}」이 등록되었습니다.', now)
            row = self.get_artwork_row(conn, art_id)
            result = public_artwork(row, user, liked_set(conn, user))
        self.send_json(201, {"artwork": result})

    def update_artwork(self, art_id):
        d = self.read_json(MAX_UPLOAD_BODY)
        old_image = None
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            row = self.get_artwork_row(conn, art_id)
            admin = user["role"] == "admin"
            sets, params = [], []

            # 공용 해설의 직접 공개는 검수 담당 관리자만. 회원은 수정 제안 API 이용.
            if "ai" in d:
                if not admin:
                    raise ApiError(403, "공용 해설은 담당자 검수 후 공개됩니다. 수정 제안을 보내 주세요.")
                ai = d["ai"]
                if ai is not None and (not isinstance(ai, dict) or any(len(str(ai.get(k, ""))) > 3000 for k in ("full", "easy", "caption"))):
                    raise ApiError(400, "AI 설명 형식이 올바르지 않습니다.")
                sets.append("ai = ?")
                params.append(json.dumps({k: str(ai.get(k, "")) for k in ("full", "easy", "caption")}, ensure_ascii=False) if ai else None)
                sets.extend(['ai_reviewed_by = ?', 'ai_reviewed_at = ?'])
                params.extend([user['name'] if ai else '', now_ms() if ai else None])

            # 위치 이동: 관리자만 (이동 이력 기록)
            if "locationId" in d:
                if not admin:
                    raise ApiError(403, "작품 위치 이동은 관리자만 할 수 있어요.")
                to = d["locationId"]
                if to not in LOCATION_IDS:
                    raise ApiError(400, "존재하지 않는 위치입니다.")
                if to != row["location"]:
                    record_move(conn, row, to, clean_text(d.get("reason"), 60, "reason", "사유") or "관리자 이동", user["name"])
                    sets.append("location = ?")
                    params.append(to)

            # 작품 정보·이미지 수정: 관리자만
            info = self.artwork_fields(d, partial=True)
            if info or "image" in d:
                if not admin:
                    raise ApiError(403, "작품 정보 수정은 관리자만 할 수 있어요.")
                if 'ai' not in d:
                    sets.extend(['ai = NULL', "ai_reviewed_by = ''", 'ai_reviewed_at = NULL'])
                column = {"intent": "description", "artistBio": "artist_bio", "visualDescription": "visual_description"}
                for key, value in info.items():
                    sets.append(f"{column.get(key, key)} = ?")
                    params.append(json.dumps(value, ensure_ascii=False) if key == "tags" else value)
                if d.get("image"):
                    sets.append("image = ?")
                    params.append(save_image(d["image"]))
                    old_image = row["image"]
                    if 'visualDescription' not in d:
                        sets.append("visual_description = ''")

            if sets:
                sets.append("updated_at = ?")
                params.append(now_ms())
                conn.execute(f"UPDATE artworks SET {', '.join(sets)} WHERE id = ?", (*params, art_id))
            result = public_artwork(self.get_artwork_row(conn, art_id), user, liked_set(conn, user))
        if old_image:
            remove_image(old_image)
        self.send_json(200, {"artwork": result})

    def delete_artwork(self, art_id):
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            row = self.get_artwork_row(conn, art_id)
            # 관리자는 모든 작품, 일반 회원은 본인이 등록한 작품만 삭제 가능
            if user["role"] != "admin" and row["created_by"] != user["id"]:
                raise ApiError(403, "작품은 등록한 회원 본인 또는 관리자만 삭제할 수 있어요.")
            conn.execute("DELETE FROM artworks WHERE id = ?", (art_id,))
        remove_image(row["image"])
        self.send_json(200, {"deleted": {"id": art_id, "title": row["title"]}})

    def toggle_like(self, art_id):
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "공감하려면 로그인해 주세요.")
            self.get_artwork_row(conn, art_id)
            cur = conn.execute("DELETE FROM artwork_likes WHERE user_id = ? AND artwork_id = ?", (user["id"], art_id))
            liked = cur.rowcount == 0
            if liked:
                conn.execute("INSERT INTO artwork_likes (user_id, artwork_id, created_at) VALUES (?, ?, ?)",
                             (user["id"], art_id, now_ms()))
            likes = conn.execute("SELECT COUNT(*) FROM artwork_likes WHERE artwork_id = ?", (art_id,)).fetchone()[0]
        self.send_json(200, {"liked": liked, "likes": likes})

    def add_view(self, art_id):
        with db() as conn:
            cur = conn.execute("UPDATE artworks SET views = views + 1 WHERE id = ?", (art_id,))
            if cur.rowcount == 0:
                raise ApiError(404, "작품을 찾을 수 없습니다.")
            views = conn.execute("SELECT views FROM artworks WHERE id = ?", (art_id,)).fetchone()[0]
            conn.execute('INSERT INTO experience_events(artwork_id,kind,at) VALUES(?,?,?)', (art_id,'view',now_ms()))
        self.send_json(200, {"views": views})

    # ---- 감상 반응 (별점 + 감정 + 댓글)
    def list_reactions(self, art_id):
        """작품별 반응 목록 (누구나 볼 수 있음)"""
        with db() as conn:
            user = self.current_user(conn)
            self.get_artwork_row(conn, art_id)
            rows = conn.execute("SELECT * FROM artwork_reactions WHERE artwork_id = ? ORDER BY updated_at DESC",
                                (art_id,)).fetchall()
        items = [public_reaction(r, user) for r in rows]
        avg = round(sum(r["rating"] for r in items) / len(items), 1) if items else None
        self.send_json(200, {"reactions": items, "count": len(items), "avg": avg,
                             "mine": next((r for r in items if r["mine"]), None)})

    def save_reaction(self, art_id):
        """로그인 회원만. 같은 작품에 다시 남기면 기존 반응을 수정"""
        d = self.read_json()
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "반응은 로그인한 회원만 남길 수 있어요.")
            self.get_artwork_row(conn, art_id)
            try:
                rating = int(d.get("rating"))
            except (TypeError, ValueError):
                rating = 0
            if not 1 <= rating <= 5:
                raise ApiError(400, "별점을 1~5개 중에서 골라 주세요.", "rating")
            feelings = [f for f in (d.get("feelings") or []) if f in FEELINGS][:6]
            comment = clean_text(d.get("comment"), 300, "comment", "댓글")
            now = now_ms()
            existing = conn.execute("SELECT id FROM artwork_reactions WHERE artwork_id = ? AND user_id = ?",
                                    (art_id, user["id"])).fetchone()
            if existing:
                conn.execute("UPDATE artwork_reactions SET rating = ?, feelings = ?, comment = ?, user_name = ?, updated_at = ? WHERE id = ?",
                             (rating, json.dumps(feelings, ensure_ascii=False), comment, user["name"], now, existing["id"]))
                rid = existing["id"]
            else:
                rid = "X-" + secrets.token_hex(5)
                conn.execute(
                    """INSERT INTO artwork_reactions (id, artwork_id, user_id, user_name, rating, feelings, comment, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (rid, art_id, user["id"], user["name"], rating, json.dumps(feelings, ensure_ascii=False), comment, now, now),
                )
            row = conn.execute("SELECT * FROM artwork_reactions WHERE id = ?", (rid,)).fetchone()
        self.send_json(200 if existing else 201, {"reaction": public_reaction(row, user), "updated": bool(existing)})

    def delete_reaction(self, rid):
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            row = conn.execute("SELECT * FROM artwork_reactions WHERE id = ?", (rid,)).fetchone()
            if not row:
                raise ApiError(404, "반응을 찾을 수 없습니다.")
            if row["user_id"] != user["id"] and user["role"] != "admin":
                raise ApiError(403, "본인이 남긴 반응만 삭제할 수 있어요.")
            conn.execute("DELETE FROM artwork_reactions WHERE id = ?", (rid,))
        self.send_json(200, {"deleted": rid})

    def reaction_summary(self):
        """통계 화면용: 전체 반응 수·평균 별점·감정 분포·최근 댓글"""
        with db() as conn:
            user = self.current_user(conn)
            total, avg = conn.execute("SELECT COUNT(*), ROUND(AVG(rating), 1) FROM artwork_reactions").fetchone()
            feelings = {}
            for (fj,) in conn.execute("SELECT feelings FROM artwork_reactions"):
                for f in json.loads(fj or "[]"):
                    feelings[f] = feelings.get(f, 0) + 1
            recent = conn.execute(
                """SELECT x.*, a.title FROM artwork_reactions x JOIN artworks a ON a.id = x.artwork_id
                   WHERE x.comment != '' ORDER BY x.updated_at DESC LIMIT 30""").fetchall()
        self.send_json(200, {"count": total, "avg": avg, "feelings": feelings,
                             "recent": [public_reaction(r, user) for r in recent]})

    # ---- 배치 신청
    def list_requests(self):
        """관리자: 전체 신청 / 일반 회원: 내 신청만"""
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            if user["role"] == "admin":
                rows = conn.execute(REQUEST_SELECT + " ORDER BY r.created_at DESC").fetchall()
            else:
                rows = conn.execute(REQUEST_SELECT + " WHERE r.user_id = ? ORDER BY r.created_at DESC", (user["id"],)).fetchall()
        self.send_json(200, {"requests": [public_request(r) for r in rows]})

    def create_request(self):
        d = self.read_json()
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "배치 신청은 로그인 후 이용할 수 있어요.")
            art = self.get_artwork_row(conn, str(d.get("artworkId", "")))
            # 모든 로그인 회원이 사내 공간 전시를 제안할 수 있습니다.
            if art["pending_id"]:
                raise ApiError(409, "이미 배치 신청중인 작품이에요. 관리자 처리 후 다시 신청할 수 있어요.")
            loc = d.get("locationId")
            if loc not in DISPLAY_LOCATIONS:
                raise ApiError(400, "희망 위치를 전시 공간 중에서 선택해 주세요.", "locationId")
            if loc == art["location"]:
                raise ApiError(400, "이미 그 위치에 걸려 있는 작품이에요.", "locationId")
            date_from, date_to = str(d.get("from", "")), str(d.get("to", ""))
            if not DATE_RE.match(date_from) or not DATE_RE.match(date_to):
                raise ApiError(400, "전시 기간을 입력해 주세요.", "from")
            try:
                date.fromisoformat(date_from)
                date.fromisoformat(date_to)
            except ValueError:
                raise ApiError(400, '실제 날짜를 입력해 주세요.', 'from')
            if date_from < datetime.now(timezone(timedelta(hours=9))).date().isoformat():
                raise ApiError(400, "시작일은 오늘 이후여야 해요.", "from")
            if date_to < date_from:
                raise ApiError(400, "종료일이 시작일보다 빠를 수 없어요.", "to")
            note = clean_text(d.get("note"), 300, "note", "신청 사유")
            req_id = "R-" + secrets.token_hex(5)
            conn.execute(
                """INSERT INTO placement_requests (id, artwork_id, user_id, requester_name, from_location, location,
                       date_from, date_to, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (req_id, art["id"], user["id"], user["name"], art["location"], loc, date_from, date_to, note, now_ms()),
            )
            row = conn.execute(REQUEST_SELECT + " WHERE r.id = ?", (req_id,)).fetchone()
            experience.activity(conn, f'「{art["title"]}」 작품의 사내 전시가 제안되었습니다.', now_ms())
        self.send_json(201, {"request": public_request(row)})

    def handle_request(self, req_id, action):
        """approve / reject: 관리자, cancel: 신청한 본인 (모두 '대기' 상태에서만)"""
        d = self.read_json() if int(self.headers.get("Content-Length") or 0) else {}
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            row = conn.execute(REQUEST_SELECT + " WHERE r.id = ?", (req_id,)).fetchone()
            if not row:
                raise ApiError(404, "배치 신청을 찾을 수 없습니다.")
            if row["status"] != "pending" and not (action=='cancel' and row['status']=='approved' and not row['installed_at']):
                raise ApiError(409, f"이미 {REQUEST_STATUS[row['status']]} 처리된 신청이에요.")
            if action == "cancel":
                if row["user_id"] != user["id"] and user['role']!='admin':
                    raise ApiError(403, "본인이 한 신청만 취소할 수 있어요.")
            elif user["role"] != "admin":
                raise ApiError(403, "배치 신청 승인·반려는 관리자만 할 수 있어요.")
            status = {"approve": "approved", "reject": "rejected", "cancel": "cancelled"}[action]
            conn.execute(
                "UPDATE placement_requests SET status = ?, admin_note = ?, handled_by = ?, handled_at = ? WHERE id = ?",
                (status, clean_text(d.get("adminNote"), 200, "adminNote", "처리 메모"), user["name"], now_ms(), req_id),
            )
            # 승인은 설치 대기로 전환합니다. 실제 위치는 설치 사진 확인 API에서 변경합니다.
            row = conn.execute(REQUEST_SELECT + " WHERE r.id = ?", (req_id,)).fetchone()
        self.send_json(200, {"request": public_request(row)})

    def list_moves(self):
        with db() as conn:
            self.require_admin(conn)
            rows = conn.execute("SELECT * FROM artwork_moves ORDER BY at DESC, id DESC LIMIT 50").fetchall()
        self.send_json(200, {"moves": [
            {"artworkId": r["artwork_id"], "title": r["title"], "from": r["from_loc"], "to": r["to_loc"],
             "reason": r["reason"], "by": r["by_name"], "at": r["at"]} for r in rows
        ]})

    def serve_static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        target = (WEB_DIR / rel).resolve()
        try:
            parts = target.relative_to(WEB_DIR).parts
        except ValueError:
            return self.send_json(404, {"error": "찾을 수 없습니다."})
        ctype = STATIC_TYPES.get(target.suffix.lower())
        if (not parts or parts[0].lower() == "backend" or any(p.startswith(".") for p in parts)
                or not ctype or not target.is_file()):
            return self.send_json(404, {"error": "찾을 수 없습니다."})
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---- API
    def health(self):
        self.send_json(200, {"ok": True, "demoLogin": DEMO_LOGIN})

    def me(self):
        with db() as conn:
            user = self.current_user(conn)
        self.send_json(200, {"user": public_user(user) if user else None, "demoLogin": DEMO_LOGIN})

    def departments(self):
        """관리자 가입 화면의 부서 선택 목록 (부서명만 공개, 키는 공개하지 않음)"""
        with db() as conn:
            rows = conn.execute("SELECT dept FROM dept_keys ORDER BY dept").fetchall()
        self.send_json(200, {"departments": [r["dept"] for r in rows]})

    def signup(self):
        d = self.read_json()
        account_type = d.get("type", "member")
        name = str(d.get("name", "")).strip()
        dept = str(d.get("dept", "")).strip()
        email = str(d.get("email", "")).strip().lower()
        password = str(d.get("password", ""))
        admin_key = str(d.get("adminKey", "")).strip().upper()

        if account_type not in ("member", "admin"):
            raise ApiError(400, "가입 유형을 선택해 주세요.")
        if not 1 <= len(name) <= 20:
            raise ApiError(400, "이름을 1~20자로 입력해 주세요.", "name")
        # 부서는 관리자만 가짐 (일반 회원은 부서 없이 가입)
        if account_type == "member":
            dept = ""
        elif not dept:
            raise ApiError(400, "관리자로 가입할 부서를 목록에서 선택해 주세요.", "dept")
        if len(email) > 100 or not EMAIL_RE.match(email):
            raise ApiError(400, "올바른 이메일 형식이 아닙니다.", "email")
        if not (6 <= len(password) <= 128) or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
            raise ApiError(400, "비밀번호는 영문과 숫자를 포함해 6자 이상이어야 합니다.", "password")
        if d.get("agree") is not True:
            raise ApiError(400, "필수 약관에 동의해 주세요.")

        user_id = "U-" + secrets.token_hex(6)
        role = account_type
        with db() as conn:
            if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                raise ApiError(409, "이미 가입된 이메일입니다.", "email")
            if role == "admin":
                # 관리자: 선택한 부서의 관리자 키가 맞아야 가입 가능 (IP별 5회 실패 시 5분 제한)
                lock_id = f"adminkey:{self.client_address[0]}"
                if is_locked(lock_id):
                    raise ApiError(429, f"관리자 키 입력 실패가 많습니다. {LOGIN_LOCK_SECONDS // 60}분 후 다시 시도해 주세요.", "adminKey")
                row = conn.execute("SELECT key_hash FROM dept_keys WHERE dept = ?", (dept,)).fetchone()
                if not row:
                    raise ApiError(400, "관리자로 가입할 부서를 목록에서 선택해 주세요.", "dept")
                if not admin_key:
                    raise ApiError(400, "부서 관리자 키를 입력해 주세요.", "adminKey")
                if not verify_password(admin_key, row["key_hash"]):
                    record_fail(lock_id)
                    raise ApiError(400, f"{dept}의 관리자 키가 올바르지 않습니다.", "adminKey")
                clear_fails(lock_id)
            conn.execute(
                "INSERT INTO users (id, email, name, dept, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, email, name, dept, role, hash_password(password), now_ms()),
            )
            cookie = create_session(conn, user_id, remember=True)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.send_json(201, {"user": public_user(user)}, cookie)

    def login(self):
        d = self.read_json()
        email = str(d.get("email", "")).strip().lower()
        password = str(d.get("password", ""))
        remember = bool(d.get("remember", True))
        if not email or not password:
            raise ApiError(400, "이메일과 비밀번호를 입력해 주세요.")
        if is_locked(email):
            raise ApiError(429, f"로그인 시도가 너무 많습니다. {LOGIN_LOCK_SECONDS // 60}분 후 다시 시도해 주세요.")
        with db() as conn:
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            ok = verify_password(password, user["pw_hash"] if user else DUMMY_HASH) and user is not None
            if not ok:
                record_fail(email)
                raise ApiError(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
            clear_fails(email)
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
            cookie = create_session(conn, user["id"], remember)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        self.send_json(200, {"user": public_user(user)}, cookie)

    def demo_login(self):
        if not DEMO_LOGIN:
            raise ApiError(403, "시연용 로그인이 꺼져 있습니다.")
        d = self.read_json()
        user_id = {"admin": "U-admin", "member": "U-member"}.get(d.get("type"))
        if not user_id:
            raise ApiError(400, "잘못된 시연 계정입니다.")
        with db() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "시연 계정을 찾을 수 없습니다.")
            cookie = create_session(conn, user_id, remember=False)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.send_json(200, {"user": public_user(user)}, cookie)

    def logout(self):
        token = self.session_token()
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
        self.send_json(200, {"ok": True}, clear_cookie())

    def list_users(self):
        with db() as conn:
            self.require_admin(conn)
            rows = conn.execute(
                """SELECT u.*, (SELECT COUNT(*) FROM sessions s
                                WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
                   FROM users u ORDER BY u.created_at""",
                (int(time.time()),),
            ).fetchall()
        self.send_json(200, {"users": [public_user(r) for r in rows]})

    def reset_password(self, user_id):
        """관리자가 회원 비밀번호를 임시 비밀번호로 초기화 (원래 비밀번호는 알 수 없으므로 '보기' 대신 초기화)"""
        with db() as conn:
            admin = self.require_admin(conn)
            if admin["id"] == user_id:
                raise ApiError(400, "본인 비밀번호는 마이페이지의 '비밀번호 변경'을 이용해 주세요.")
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "회원을 찾을 수 없습니다.")
            temp = new_temp_password()
            conn.execute("UPDATE users SET pw_hash = ?, must_change_pw = 1 WHERE id = ?", (hash_password(temp), user_id))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # 기존 로그인 모두 해제
        clear_fails(user["email"])
        # 임시 비밀번호 원문은 이 응답에서만 한 번 전달됩니다.
        self.send_json(200, {"name": user["name"], "email": user["email"], "tempPassword": temp})

    def delete_user(self, user_id):
        """관리자가 회원 계정 삭제 (로그인 세션도 함께 삭제됨: ON DELETE CASCADE)"""
        with db() as conn:
            admin = self.require_admin(conn)
            if admin["id"] == user_id:
                raise ApiError(400, "본인 계정은 삭제할 수 없습니다.")
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "회원을 찾을 수 없습니다.")
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        clear_fails(user["email"])
        self.send_json(200, {"deleted": public_user(user)})

    def change_password(self):
        d = self.read_json()
        current = str(d.get("currentPassword", ""))
        new = str(d.get("newPassword", ""))
        if not (6 <= len(new) <= 128) or not re.search(r"[A-Za-z]", new) or not re.search(r"\d", new):
            raise ApiError(400, "새 비밀번호는 영문과 숫자를 포함해 6자 이상이어야 합니다.", "next")
        if current == new:
            raise ApiError(400, "현재 비밀번호와 다른 비밀번호를 입력해 주세요.", "next")
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                raise ApiError(401, "로그인이 필요합니다.")
            if not verify_password(current, user["pw_hash"]):
                raise ApiError(400, "현재 비밀번호가 올바르지 않습니다.", "current")
            conn.execute("UPDATE users SET pw_hash = ?, must_change_pw = 0 WHERE id = ?", (hash_password(new), user["id"]))
            # 지금 사용 중인 로그인만 남기고 다른 기기의 로그인은 해제
            conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                         (user["id"], token_hash(self.session_token())))
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        self.send_json(200, {"user": public_user(user)})

    def change_role(self, user_id):
        d = self.read_json()
        role = d.get("role")
        if role not in ("admin", "member"):
            raise ApiError(400, "등급은 admin 또는 member만 가능합니다.")
        with db() as conn:
            admin = self.require_admin(conn)
            if admin["id"] == user_id:
                raise ApiError(400, "본인의 등급은 변경할 수 없습니다.")
            if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                raise ApiError(404, "회원을 찾을 수 없습니다.")
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.send_json(200, {"user": public_user(user)})

    # ---- 부서별 관리자 키 관리 (관리자 전용)
    def list_dept_keys(self):
        with db() as conn:
            self.require_admin(conn)
            rows = conn.execute(
                """SELECT k.dept, k.created_at, k.updated_at, k.updated_by,
                          (SELECT COUNT(*) FROM users u WHERE u.dept = k.dept AND u.role = 'admin') AS admins
                   FROM dept_keys k ORDER BY k.dept"""
            ).fetchall()
        self.send_json(200, {"departments": [
            {"dept": r["dept"], "createdAt": r["created_at"], "updatedAt": r["updated_at"],
             "updatedBy": r["updated_by"], "admins": r["admins"]} for r in rows
        ]})

    def add_dept(self):
        d = self.read_json()
        dept = str(d.get("dept", "")).strip()
        if not 1 <= len(dept) <= 20:
            raise ApiError(400, "부서명을 1~20자로 입력해 주세요.", "dept")
        key = new_dept_key()
        with db() as conn:
            admin = self.require_admin(conn)
            if conn.execute("SELECT 1 FROM dept_keys WHERE dept = ?", (dept,)).fetchone():
                raise ApiError(409, "이미 등록된 부서입니다.", "dept")
            conn.execute(
                "INSERT INTO dept_keys (dept, key_hash, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)",
                (dept, hash_password(key), now_ms(), now_ms(), admin["name"]),
            )
        # 키 원문은 지금 이 응답에서만 한 번 전달됩니다.
        self.send_json(201, {"dept": dept, "key": key})

    def rotate_dept_key(self):
        d = self.read_json()
        dept = str(d.get("dept", "")).strip()
        key = new_dept_key()
        with db() as conn:
            admin = self.require_admin(conn)
            cur = conn.execute(
                "UPDATE dept_keys SET key_hash = ?, updated_at = ?, updated_by = ? WHERE dept = ?",
                (hash_password(key), now_ms(), admin["name"], dept),
            )
            if cur.rowcount == 0:
                raise ApiError(404, "등록되지 않은 부서입니다.")
        self.send_json(200, {"dept": dept, "key": key})


ROUTES = {
    ("GET", "/api/health"): Handler.health,
    ("GET", "/api/auth/me"): Handler.me,
    ("POST", "/api/auth/signup"): Handler.signup,
    ("POST", "/api/auth/login"): Handler.login,
    ("POST", "/api/auth/demo"): Handler.demo_login,
    ("POST", "/api/auth/logout"): Handler.logout,
    ("POST", "/api/auth/change-password"): Handler.change_password,
    ("GET", "/api/users"): Handler.list_users,
    ("GET", "/api/departments"): Handler.departments,
    ("GET", "/api/admin/dept-keys"): Handler.list_dept_keys,
    ("POST", "/api/admin/dept-keys"): Handler.add_dept,
    ("POST", "/api/admin/dept-keys/rotate"): Handler.rotate_dept_key,
    ("GET", "/api/meta"): Handler.meta,
    ("GET", "/api/artworks"): Handler.list_artworks,
    ("POST", "/api/artworks"): Handler.create_artwork,
    ("GET", "/api/moves"): Handler.list_moves,
    ("GET", "/api/requests"): Handler.list_requests,
    ("POST", "/api/requests"): Handler.create_request,
    ("GET", "/api/reactions/summary"): Handler.reaction_summary,
}


def main():
    init_db()
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"[오류] {PORT}번 포트를 사용할 수 없습니다. 이미 서버가 켜져 있는지 확인해 주세요.")
        sys.exit(1)
    url = f"http://localhost:{PORT}"
    print("=" * 56)
    print(" 대덕전자 아트브릿지 서버가 시작되었습니다.")
    print(f" 주소: {url}")
    print(f" DB  : {DB_PATH}")
    print(" 종료: 이 창에서 Ctrl + C")
    print("=" * 56)
    if "--open" in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
        server.server_close()


if __name__ == "__main__":
    main()
