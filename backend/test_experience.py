"""기존 DB 복사본에서 공유·검수·설치 워크플로를 검증합니다. 원본에는 쓰지 않습니다."""
import base64
import json
import io
import pathlib
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
import server as s
import experience


class Request(s.Handler):
    def __init__(self, user=None, body=None, path='/api/experience'):
        self.user, self.body, self.path = user, body or {}, path
        payload = json.dumps(body).encode() if body is not None else b''
        self.rfile = io.BytesIO(payload)
        self.wfile = io.BytesIO()
        self.headers = {'Content-Length': str(len(payload)), 'Content-Type': 'application/json' if payload else ''}
        self.response_headers = {}
        self.output, self.code = None, None
    def current_user(self, conn): return self.user
    def read_json(self, limit=s.MAX_BODY): return super().read_json(limit)
    def send_json(self, code, data): self.code, self.output = code, data
    def send_response(self, code): self.code=code
    def send_header(self, key, value): self.response_headers[key]=value
    def end_headers(self): pass


class ExperienceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_db, cls.original_media = s.DB_PATH, s.MEDIA_DIR
        cls.tmp = tempfile.TemporaryDirectory(prefix='.artbridge-test-', dir=s.WEB_DIR)
        cls.root = pathlib.Path(cls.tmp.name).resolve()
        assert cls.root.is_relative_to(s.WEB_DIR.resolve())
        s.DB_PATH, s.MEDIA_DIR = cls.root/'test.db', cls.root/'media'
        source = sqlite3.connect(cls.original_db)
        target = sqlite3.connect(s.DB_PATH)
        source.backup(target); target.close(); source.close()
        shutil.copytree(cls.original_media, s.MEDIA_DIR)
        s.init_db()
        with s.db() as conn:
            cls.admin = conn.execute("SELECT * FROM users WHERE role='admin' LIMIT 1").fetchone()
            cls.member = conn.execute("SELECT * FROM users WHERE role='member' LIMIT 1").fetchone()
            cls.art = conn.execute("SELECT id FROM artworks WHERE location IN ('STORE','NONE') AND id NOT IN (SELECT artwork_id FROM placement_requests WHERE status IN ('pending','approved')) LIMIT 1").fetchone()[0]
    @classmethod
    def tearDownClass(cls):
        s.DB_PATH, s.MEDIA_DIR = cls.original_db, cls.original_media
        assert cls.root.is_relative_to(s.WEB_DIR.resolve())
        cls.tmp.cleanup()
    def call(self, method, path, user=None, body=None):
        req=Request(user,body,path)
        self.assertTrue(experience.dispatch(req,method,path.split('?')[0],s))
        return req.output

    def test_shared_exhibition_and_bookmark(self):
        out=self.call('POST','/api/exhibitions',self.member,{'title':'공유 검증','curator':'담당자','desc':'두 기기에서 같은 전시','artworkIds':[self.art]})
        ex=out['exhibition']
        public=self.call('GET','/api/experience')
        self.assertIn(ex['id'],[x['id'] for x in public['exhibitions']])
        self.assertEqual(public['bookmarks'],[])
        self.assertTrue(self.call('POST',f'/api/artworks/{self.art}/bookmark',self.member)['bookmarked'])
        self.assertIn(self.art,self.call('GET','/api/experience',self.member)['bookmarks'])
        self.assertFalse(self.call('POST',f'/api/artworks/{self.art}/bookmark',self.member)['bookmarked'])
        with self.assertRaises(s.ApiError): self.call('POST',f'/api/artworks/{self.art}/bookmark')
        with self.assertRaises(s.ApiError): self.call('POST',f'/api/exhibitions/{ex["id"]}/feature',self.member)
        self.call('POST',f'/api/exhibitions/{ex["id"]}/feature',self.admin)
        self.assertEqual(self.call('GET','/api/experience')['exhibitions'][0]['id'],ex['id'])

    def test_ai_proposal_requires_review(self):
        ai={'full':'검수할 실제 설명','easy':'쉬운 실제 설명','caption':'작품 정보'}
        direct=Request(self.member,{'ai':ai})
        with self.assertRaises(s.ApiError): direct.update_artwork(self.art)
        with s.db() as conn: before=conn.execute('SELECT ai FROM artworks WHERE id=?',(self.art,)).fetchone()[0]
        self.call('POST',f'/api/artworks/{self.art}/ai-proposals',self.member,{'ai':ai})
        with s.db() as conn: self.assertEqual(conn.execute('SELECT ai FROM artworks WHERE id=?',(self.art,)).fetchone()[0],before)
        proposal=next(x for x in self.call('GET','/api/ai-proposals',self.admin)['proposals'] if x['artwork_id']==self.art and x['status']=='pending')
        with self.assertRaises(s.ApiError): self.call('POST',f'/api/ai-proposals/{proposal["id"]}/approve',self.member)
        self.call('POST',f'/api/ai-proposals/{proposal["id"]}/approve',self.admin)
        with s.db() as conn:
            row=conn.execute('SELECT * FROM artworks WHERE id=?',(self.art,)).fetchone()
            self.assertEqual(json.loads(row['ai']),ai);self.assertTrue(row['ai_reviewed_at'])
        with self.assertRaises(s.ApiError): self.call('POST',f'/api/ai-proposals/{proposal["id"]}/approve',self.admin)

    def test_artist_publication_consent(self):
        with s.db() as conn: name=conn.execute('SELECT artist FROM artworks WHERE id=?',(self.art,)).fetchone()[0]
        path='/api/artists/'+quote(name)
        body={'story':'검증용 동의 받은 이야기','interview':'공개 인터뷰','published':True}
        with self.assertRaises(s.ApiError):self.call('PATCH',path,self.admin,body)
        self.call('PATCH',path,self.admin,{**body,'consentConfirmed':True})
        profile=next(a for a in self.call('GET','/api/experience')['artists'] if a['name']==name)
        self.assertEqual(profile['story'],body['story'])
        self.call('PATCH',path,self.admin,{**body,'published':False})
        profile=next(a for a in self.call('GET','/api/experience')['artists'] if a['name']==name)
        self.assertEqual(profile['story'],'')
        self.assertEqual(self.call('GET','/api/experience')['artistDrafts'],{})

    def test_installation_only_changes_location_after_photo(self):
        today=datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d')
        target=next(iter(s.DISPLAY_LOCATIONS))
        req=Request(self.member,{'artworkId':self.art,'locationId':target,'from':today,'to':today,'note':'사내 공간 전시 제안'})
        req.create_request();id_=req.output['request']['id']
        with s.db() as conn:before=conn.execute('SELECT location FROM artworks WHERE id=?',(self.art,)).fetchone()[0]
        approval=Request(self.admin,{'adminNote':'설치 대기'});approval.handle_request(id_,'approve')
        with s.db() as conn:self.assertEqual(conn.execute('SELECT location FROM artworks WHERE id=?',(self.art,)).fetchone()[0],before)
        with self.assertRaises(s.ApiError):self.call('POST',f'/api/requests/{id_}/install',self.admin,{})
        image=next(s.MEDIA_DIR.glob('*.png')).read_bytes()
        photo='data:image/png;base64,'+base64.b64encode(image).decode()
        with self.assertRaises(s.ApiError):self.call('POST',f'/api/requests/{id_}/install',self.member,{'image':photo})
        result=self.call('POST',f'/api/requests/{id_}/install',self.admin,{'image':photo})
        self.assertTrue(result['request']['installedAt']);self.assertTrue(result['request']['installationImage'])
        with s.db() as conn:self.assertEqual(conn.execute('SELECT location FROM artworks WHERE id=?',(self.art,)).fetchone()[0],target)
        with self.assertRaises(s.ApiError):self.call('POST',f'/api/requests/{id_}/install',self.admin,{'image':photo})

    def test_period_metrics_and_migration_idempotence(self):
        for kind in ['listen','qr']:self.call('POST',f'/api/artworks/{self.art}/events',None,{'kind':kind})
        view=Request();view.add_view(self.art)
        metrics=self.call('GET','/api/impact?days=7')['metrics']
        self.assertGreaterEqual(metrics['view'],1);self.assertGreaterEqual(metrics['listen'],1);self.assertGreaterEqual(metrics['qr'],1)
        with s.db() as conn:before=conn.execute('SELECT COUNT(*) FROM exhibitions').fetchone()[0]
        s.init_db()
        with s.db() as conn:self.assertEqual(conn.execute('SELECT COUNT(*) FROM exhibitions').fetchone()[0],before)
        with self.assertRaises(s.ApiError):self.call('GET','/api/impact?days=bad')

    def test_photo_change_invalidates_old_description_and_review(self):
        with s.db() as conn:
            id_=conn.execute("SELECT id FROM artworks WHERE image != '' AND id != ? LIMIT 1",(self.art,)).fetchone()[0]
        ai={'full':'이전 사진의 설명','easy':'이전 설명','caption':'이전 캡션'}
        req=Request(self.admin,{'visualDescription':'이전 사진의 모습','ai':ai});req.update_artwork(id_)
        photo='data:image/png;base64,'+base64.b64encode(next(s.MEDIA_DIR.glob('*.png')).read_bytes()).decode()
        req=Request(self.admin,{'image':photo});req.update_artwork(id_)
        self.assertEqual(req.output['artwork']['visualDescription'],'')
        self.assertIsNone(req.output['artwork']['aiReviewedAt'])
        self.assertIsNone(req.output['artwork']['ai'])
        s.init_db()
        with s.db() as conn:
            self.assertEqual(conn.execute('SELECT visual_description FROM artworks WHERE id=?',(id_,)).fetchone()[0],'')

    def test_approved_plan_can_be_cancelled_before_installation(self):
        with s.db() as conn:
            art=conn.execute("SELECT id FROM artworks WHERE location IN ('STORE','NONE') AND id != ? AND id NOT IN (SELECT artwork_id FROM placement_requests WHERE status IN ('pending','approved')) LIMIT 1",(self.art,)).fetchone()[0]
            before=conn.execute('SELECT location FROM artworks WHERE id=?',(art,)).fetchone()[0]
        today=datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d')
        body={'artworkId':art,'locationId':next(iter(s.DISPLAY_LOCATIONS)),'from':today,'to':today}
        with self.assertRaises(s.ApiError):Request(self.member,{**body,'to':'2026-02-30'}).create_request()
        req=Request(self.member,body);req.create_request();id_=req.output['request']['id']
        Request(self.admin,{}).handle_request(id_,'approve')
        with self.assertRaises(s.ApiError):Request(self.member,body).create_request()
        cancel=Request(self.member,{});cancel.handle_request(id_,'cancel')
        self.assertEqual(cancel.output['request']['status'],'cancelled')
        with s.db() as conn:self.assertEqual(conn.execute('SELECT location FROM artworks WHERE id=?',(art,)).fetchone()[0],before)

    def test_qr_svg_encodes_only_a_valid_artwork_address(self):
        path=f'/api/artworks/{self.art}/qr?url='+quote(f'http://localhost:8000/#art/{self.art}?source=qr',safe='')
        req=Request(path=path)
        self.assertTrue(experience.dispatch(req,'GET',path.split('?')[0],s))
        self.assertEqual(req.code,200)
        self.assertIn('image/svg+xml',req.response_headers['Content-Type'])
        self.assertIn(b'<svg',req.wfile.getvalue())
        with self.assertRaises(s.ApiError):
            path=f'/api/artworks/{self.art}/qr?url='+quote('javascript:alert(1)',safe='')
            experience.dispatch(Request(path=path),'GET',path.split('?')[0],s)


if __name__=='__main__':unittest.main()
