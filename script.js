/* =========================================================
   대덕전자 아트브릿지 - 장애 예술인 작품 디지털 전시·큐레이션 플랫폼
   기록 → 위치 → AI 설명 → 탐색/추천 → 전시 → 참여 데이터
   - GitHub Pages 정적 모드 및 로컬 Python 서버 자동 호환 버전
   ========================================================= */

const STORE_KEY = 'artbridge-v2';
const PREF_KEY = 'artbridge-pref';

// 기본 전시 위치 (서버가 없어도 GitHub Pages에서 정상 표시되도록 기본값 제공)
const DEFAULT_LOCATIONS = [
  { id: 'HQ_LOBBY', name: '본관 1층 로비', area: 'HQ' },
  { id: 'HQ_LOUNGE', name: '본관 2층 라운지', area: 'HQ' },
  { id: 'B1_CAFE', name: '지하 1층 사내 카페', area: 'B1' },
  { id: 'M1_HALL', name: 'M1동 중앙 복도', area: 'M1' },
  { id: 'STORE', name: '수장고 (보관)', area: '보관' },
  { id: 'NONE', name: '위치 미정', area: '보관' }
];

let LOCATIONS = DEFAULT_LOCATIONS;
const AREAS = ['HQ', 'B1', 'M1', '보관'];
const FONT_STEPS = [13, 14.5, 16, 18, 20];
const FEELINGS = ['따뜻해요', '평온해요', '힘이 나요', '신기해요', '그리워요', '설레요'];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const locName = id => (LOCATIONS.find(l => l.id === id) || {}).name || (id === 'STORE' ? '수장고 (보관)' : id === 'NONE' ? '위치 미정' : id || '-');
const fmt = t => new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = t => new Date(t).toLocaleDateString('ko-KR');

function statusOf(a) {
  if (a.locationId === 'STORE') return { text: '보관중', cls: 'store' };
  if (a.locationId === 'NONE') return { text: '위치 미정', cls: 'out' };
  return { text: '전시중', cls: 'on' };
}

/* ---------------- 이미지 경로 처리 및 자리표시 ---------------- */
function placeholderImage(title = '', artist = '') {
  const t = esc(title.length > 14 ? title.slice(0, 13) + '…' : title);
  const a = esc(artist);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00F0FF"/><stop offset="1" stop-color="#8A2BE2"/></linearGradient>
      <radialGradient id="r" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF1F8"/></radialGradient></defs>
    <rect width="400" height="300" fill="url(#r)"/>
    <rect x="120" y="58" width="160" height="112" rx="10" fill="none" stroke="url(#g)" stroke-width="3" opacity=".75"/>
    <circle cx="160" cy="96" r="11" fill="#00C8E0" opacity=".4"/>
    <path d="M132 160 L185 115 L215 140 L240 122 L270 160 Z" fill="url(#g)" opacity=".28"/>
    <text x="200" y="208" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#141824">${t}</text>
    <text x="200" y="236" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#6B7385">${a}</text>
    <text x="200" y="268" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#9AA2B2">이미지 준비 중</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// GitHub Pages의 ./backend/seed/images/ 경로를 안전하게 찾아주는 함수
const imgOf = a => {
  if (!a) return placeholderImage();
  let img = a.image;
  if (!img && a.id) {
    img = `./backend/seed/images/${a.id}.png`;
  } else if (img && typeof img === 'string') {
    if (!img.startsWith('data:') && !img.startsWith('http://') && !img.startsWith('https://')) {
      const fname = img.split('/').pop().split('\\').pop();
      img = `./backend/seed/images/${fname}`;
    }
  }
  return img || placeholderImage(a.title, a.artist);
};

/* ---------------- 로컬 데이터 ---------------- */
function seedData() {
  const now = Date.now();
  const day = 86400000;
  return {
    artworks: [],
    exhibitions: [
      { id: uid(), title: '자연이 건네는 위안', curator: 'ESG추진팀', desc: '꽃과 산, 계절의 풍경을 담은 작품들', artworkIds: ['W069', 'W112', 'W061', 'W091', 'W082', 'W051'], createdAt: now - day },
      { id: uid(), title: '우리들의 이야기', curator: '경영지원팀', desc: '일상과 가족, 사람 사이의 따뜻한 이야기', artworkIds: ['W003', 'W143', 'W120', 'W045', 'W037', 'W012'], createdAt: now },
    ],
    activity: [{ at: now, text: '대덕전자 아트브릿지가 시작되었습니다.' }],
  };
}

let db = load();
let pref = loadPref();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && d.exhibitions) { delete d.requests; delete d.surveys; return { ...d, artworks: [] }; }
  } catch (e) { /* ignore */ }
  try { localStorage.removeItem('artbridge-v1'); localStorage.removeItem('artbridge-likes'); } catch (e) { /* ignore */ }
  return seedData();
}

function save() {
  const { artworks, ...local } = db;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(local)); }
  catch (e) { toast('브라우저 저장 공간이 부족합니다.'); }
}

function loadPref() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || { big: false }; }
  catch (e) { return { big: false }; }
}
function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) { /* ignore */ } }

function log(text) {
  db.activity.unshift({ at: Date.now(), text });
  db.activity = db.activity.slice(0, 50);
}
const getArt = id => db.artworks.find(a => a.id === id);

// 작품 목록 불러오기 (GitHub Pages 호환: 실패 시 seed/artworks.json 자동 로드)
async function loadArtworks() {
  try {
    if (!LOCATIONS.length) {
      try {
        const meta = await api('/api/meta');
        LOCATIONS = meta.locations || DEFAULT_LOCATIONS;
      } catch (e) {
        LOCATIONS = DEFAULT_LOCATIONS;
      }
    }
    const data = await api('/api/artworks');
    const rawList = Array.isArray(data) ? data : (data.artworks || []);

    db.artworks = rawList.map(a => {
      let img = a.image || '';
      if (!img && a.id) {
        img = `./backend/seed/images/${a.id}.png`;
      } else if (img && typeof img === 'string') {
        if (!img.startsWith('data:') && !img.startsWith('http://') && !img.startsWith('https://')) {
          const fname = img.split('/').pop().split('\\').pop();
          img = `./backend/seed/images/${fname}`;
        }
      }
      return {
        ...a,
        image: img || (a.id ? `./backend/seed/images/${a.id}.png` : ''),
        likes: a.likes || 0,
        views: a.views || 0,
        tags: a.tags || [],
        locationId: a.locationId || 'STORE'
      };
    });
  } catch (e) {
    console.warn('loadArtworks 처리 실패:', e);
    db.artworks = [];
  }
}

let reqCache = [];
async function loadRequests() {
  if (!me()) { reqCache = []; updatePendingCount(); return reqCache; }
  try { reqCache = (await api('/api/requests')).requests || []; } catch (e) { reqCache = []; }
  updatePendingCount();
  return reqCache;
}

function updatePendingCount() {
  const n = isAdmin() ? reqCache.filter(r => r.status === 'pending').length : 0;
  ['#pendingCount', '#pendingCount2'].forEach(s => { const el = $(s); if (el) { el.textContent = n; el.hidden = !n; } });
}

function replaceArt(updated) {
  const i = db.artworks.findIndex(a => a.id === updated.id);
  if (i >= 0) db.artworks[i] = updated; else db.artworks.unshift(updated);
  return updated;
}

/* ---------------- 공통 API (서버 부재 시 GitHub 정적 파일 Fallback) ---------------- */
let currentUser = null;
let users = [];
let serverOnline = false;
let pendingView = null;

async function api(path, { method = 'GET', body } = {}) {
  // 1. 로컬 환경(localhost)에 실제 백엔드가 켜져 있는 경우 직접 호출
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    try {
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        serverOnline = true;
        return await res.json().catch(() => ({}));
      }
    } catch (e) {
      serverOnline = false;
    }
  }

  // 2. GitHub Pages / 백엔드 오프라인 환경: 정적 Seed 데이터 활용
  serverOnline = false;

  if (!method || method === 'GET') {
    if (path.startsWith('/api/artworks')) {
      try {
        const res = await fetch('./backend/seed/artworks.json');
        if (res.ok) {
          const list = await res.json();
          return { artworks: Array.isArray(list) ? list : (list.artworks || []) };
        }
      } catch (err) {
        console.warn('artworks.json 로드 실패:', err);
      }
      return { artworks: [] };
    }

    if (path.startsWith('/api/meta')) return { locations: LOCATIONS };
    if (path.startsWith('/api/auth/me')) return { user: currentUser, demoLogin: true };
    if (path.startsWith('/api/requests')) return { requests: reqCache || [] };
    if (path.startsWith('/api/departments')) return { departments: ['ESG추진팀', '경영지원팀', '제조본부', '품질관리팀'] };
    if (path.startsWith('/api/moves')) return { moves: [] };
    if (path.includes('/reactions/summary')) return { count: 0, avg: null, feelings: {}, recent: [] };
    if (path.includes('/reactions')) return { reactions: [], count: 0, avg: 0, mine: null };
    if (path.includes('/descriptions')) {
      try {
        const res = await fetch('./backend/seed/visual_descriptions.json');
        if (res.ok) return await res.json();
      } catch (e) {}
      return {};
    }
  }

  // 변경 요청 시뮬레이션
  if (method === 'POST') {
    if (path === '/api/auth/demo') {
      const type = (body && body.type) || 'member';
      const demoUser = {
        id: 'demo_' + type,
        name: type === 'admin' ? '관리자 (체험)' : '임직원 (체험)',
        email: type === 'admin' ? 'admin@daeduck.com' : 'demo@daeduck.com',
        role: type === 'admin' ? 'admin' : 'member',
        dept: 'ESG추진팀',
        createdAt: Date.now()
      };
      currentUser = demoUser;
      return { user: demoUser };
    }

    if (path.includes('/like')) {
      const parts = path.split('/');
      const artId = decodeURIComponent(parts[3] || '');
      const a = getArt(artId);
      if (a) {
        a.likedByMe = !a.likedByMe;
        a.likes = (a.likes || 0) + (a.likedByMe ? 1 : -1);
        return { liked: a.likedByMe, likes: a.likes };
      }
      return { liked: true, likes: 1 };
    }

    if (path.includes('/view')) return { views: 1 };
    if (path.includes('/reactions')) return { updated: true };
    if (path === '/api/requests') return { request: { ...body, id: uid(), title: '신청 작품', status: 'pending' } };
  }

  return {};
}

async function loadSession() {
  if (location.protocol === 'file:') return;
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    $$('.demo-login').forEach(el => (el.hidden = !data.demoLogin));
  } catch (e) {
    currentUser = null;
  }
}

try { ['artbridge-users', 'artbridge-session'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); } catch (e) { /* ignore */ }

const me = () => currentUser;
const isAdmin = () => (me() || {}).role === 'admin';
const roleName = r => (r === 'admin' ? '관리자' : '일반 회원');
const myLiked = () => db.artworks.filter(a => a.likedByMe).map(a => a.id);

async function onLogin(u) {
  currentUser = u;
  closeModals();
  renderAuth();
  toast(`${u.name}님, 환영합니다! (${roleName(u.role)})`);
  await Promise.all([loadArtworks(), loadRequests()]);
  const target = pendingView;
  pendingView = null;
  if (!(target && go(target) !== false)) refresh();
  if (u.mustChangePw) openPwModal(true);
}

async function logout() {
  const u = me();
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  currentUser = null;
  users = [];
  renderAuth();
  closeModals();
  toast(`${u ? u.name + '님, ' : ''}로그아웃되었습니다.`);
  await loadArtworks();
  const cur = $('.view.active').id.replace('view-', '');
  reqCache = [];
  updatePendingCount();
  if (['location', 'register', 'members', 'requests'].includes(cur)) go('home'); else refresh();
}

function requireLogin(msg = '로그인 후 이용할 수 있어요.', view = null) {
  if (me()) return true;
  toast(msg);
  pendingView = view;
  openAuth('login');
  return false;
}
function requireAdmin(msg = '관리자 회원만 이용할 수 있어요. 🔒', view = null) {
  if (isAdmin()) return true;
  if (!me()) return requireLogin('관리자 계정으로 로그인해 주세요.', view);
  toast(msg);
  return false;
}

function openAuth(tab = 'login') {
  $$('.modal').forEach(m => m.id !== 'authModal' && !m.hidden && (m.hidden = true));
  switchAuthTab(tab);
  ['#loginError', '#signupError'].forEach(s => ($(s).textContent = ''));
  showServerNotice();
  showModal('#authModal');
  setTimeout(() => { const f = $(tab === 'login' ? '#loginForm' : '#signupForm'); f.querySelector('input').focus(); }, 60);
}

function showServerNotice() {
  const n = $('#authNotice');
  if (!n) return;
  if (location.protocol === 'file:') {
    n.innerHTML = '⚠ 지금은 <b>파일을 직접 연 상태</b>라 로그인·회원가입이 저장되지 않아요.<br />'
      + '폴더의 <b>run_server.bat</b>을 실행한 뒤 <b>http://localhost:8000</b> 으로 접속해 주세요.';
  } else if (!serverOnline) {
    n.innerHTML = '💡 <b>GitHub Pages 정적 모드</b>로 동작 중입니다. 둘러보기와 온라인 전시는 자유롭게 이용할 수 있습니다.';
  }
  n.hidden = location.protocol !== 'file:' && serverOnline;
}

function switchAuthTab(tab) {
  $$('.auth-tabs [data-auth-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.authTab === tab);
    b.setAttribute('aria-selected', b.dataset.authTab === tab);
  });
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
  $('#authTitle').textContent = tab === 'login' ? '대덕전자 아트브릿지에 오신 것을 환영해요' : '대덕전자 아트브릿지 회원가입';
  $('#authSub').textContent = tab === 'login'
    ? '가입한 이메일과 비밀번호로 로그인해 주세요.'
    : '임직원 정보를 입력하고 아트브릿지 회원이 되어 보세요.';
  $('#authModal .modal-box').scrollTop = 0;
  if (tab === 'signup' && serverOnline) loadDepartments();
  const f = $(tab === 'login' ? '#loginForm' : '#signupForm');
  if (!$('#authModal').hidden) setTimeout(() => f.querySelector('input:not([type=hidden])').focus(), 30);
}

function updatePwChecks() {
  const f = $('#signupForm'), pw = f.password.value, pw2 = f.password2.value;
  const rules = { len: pw.length >= 6, alpha: /[a-zA-Z]/.test(pw), digit: /\d/.test(pw) };
  $$('#pwRules [data-rule]').forEach(s => s.classList.toggle('ok', rules[s.dataset.rule]));
  const s = pwStrength(pw), m = $('#pwMeter');
  m.style.width = (s / 4) * 100 + '%';
  m.style.background = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--green-2)', 'var(--green)'][s];
  const match = $('#pwMatch');
  match.className = 'pw-match' + (pw2 ? (pw === pw2 ? ' ok' : ' no') : '');
  match.textContent = !pw2 ? '' : pw === pw2 ? '✓ 비밀번호가 일치합니다.' : '✕ 비밀번호가 일치하지 않습니다.';
}

async function withBusy(form, fn) {
  const btn = form.querySelector('[type=submit]');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '처리 중…';
  try { await fn(); } finally {
    btn.disabled = false;
    if (btn.textContent === '처리 중…') btn.textContent = label;
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const f = e.target, err = $('#loginError');
  const email = f.email.value.trim().toLowerCase();
  if (!email || !f.password.value) { err.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }
  await withBusy(f, async () => {
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST', body: { email, password: f.password.value, remember: f.remember.checked },
      });
      f.reset();
      f.remember.checked = true;
      err.textContent = '';
      onLogin(user);
    } catch (ex) {
      err.textContent = ex.message;
      f.password.value = '';
      f.password.focus();
    }
  });
}

async function demoLogin(type) {
  try {
    const { user } = await api('/api/auth/demo', { method: 'POST', body: { type } });
    onLogin(user);
  } catch (ex) {
    $('#loginError').textContent = ex.message;
  }
}

function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[a-zA-Z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return s;
}

async function submitSignup(e) {
  e.preventDefault();
  const f = e.target, err = $('#signupError');
  $$('input', f).forEach(i => i.classList.remove('invalid'));
  const type = f.accountType.value;
  const fieldOf = field => (type === 'admin' && field === 'dept' ? 'adminDept' : field);
  const fail = (msg, field) => {
    err.textContent = msg;
    const el = field && f[fieldOf(field)];
    if (el) { el.classList.add('invalid'); el.focus(); }
  };
  $$('select', f).forEach(s => s.classList.remove('invalid'));

  const name = f.name.value.trim();
  const dept = type === 'admin' ? f.adminDept.value : '';
  const adminKey = f.adminKey.value.trim();
  const email = f.email.value.trim().toLowerCase(), pw = f.password.value;
  if (!name) return fail('이름을 입력해 주세요.', 'name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('올바른 이메일 형식이 아닙니다.', 'email');
  if (type === 'admin' && !dept) return fail('관리할 부서를 선택해 주세요.', 'adminDept');
  if (type === 'admin' && !adminKey) return fail('부서 관리자 키를 입력해 주세요.', 'adminKey');
  if (pw.length < 6 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return fail('비밀번호는 영문과 숫자를 포함해 6자 이상이어야 합니다.', 'password');
  if (pw !== f.password2.value) return fail('비밀번호 확인이 일치하지 않습니다.', 'password2');
  if (!f.agree.checked) return fail('필수 약관에 동의해 주세요.');

  await withBusy(f, async () => {
    try {
      const { user } = await api('/api/auth/signup', {
        method: 'POST',
        body: { type, name, dept, email, password: pw, adminKey: type === 'admin' ? adminKey : '', agree: true },
      });
      log(`${dept ? dept + ' ' : ''}${name}님이 ${roleName(user.role)}으로 가입했습니다.`);
      save();
      f.reset();
      setAccountType('member');
      updatePwChecks();
      err.textContent = '';
      onLogin(user);
    } catch (ex) {
      fail(ex.message, ex.field);
    }
  });
}

function setAccountType(type) {
  const f = $('#signupForm');
  const admin = type === 'admin';
  f.querySelector(`[name=accountType][value=${type}]`).checked = true;
  f.classList.toggle('is-admin-signup', admin);
  $('.admin-group', f).hidden = !admin;
  $('.signup-submit', f).textContent = admin ? '🛡 관리자로 가입하기' : '✓ 회원가입 완료하기';
  $('#signupError').textContent = '';
  if (admin) loadDepartments();
}

async function loadDepartments() {
  try {
    const { departments } = await api('/api/departments');
    const sel = $('#adminDeptSel'), cur = sel.value;
    sel.innerHTML = '<option value="">부서를 선택하세요</option>'
      + departments.map(d => `<option ${d === cur ? 'selected' : ''}>${esc(d)}</option>`).join('');
  } catch (e) { /* ignore */ }
}

async function renderDeptKeys() {
  const tbody = $('#deptKeyTable');
  try {
    const { departments } = await api('/api/admin/dept-keys');
    tbody.innerHTML = departments.map(d => `
      <tr>
        <td><b>${esc(d.dept)}</b></td>
        <td>${d.admins}명</td>
        <td>${fmt(d.updatedAt)}</td>
        <td>${esc(d.updatedBy || '-')}</td>
        <td><button class="btn ghost small" data-rotate="${esc(d.dept)}">🔑 키 재발급</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">등록된 부서가 없습니다.</td></tr>';
  } catch (ex) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${esc(ex.message)}</td></tr>`;
  }
}

function showOnce({ eyebrow, title, value, note }) {
  $('#keyEyebrow').textContent = eyebrow;
  $('#keyTitle').textContent = title;
  $('#keyValue').textContent = value;
  $('#keyNote').innerHTML = note;
  $('#keyCopy').textContent = '복사';
  showModal('#keyModal');
}
function showIssuedKey(dept, key) {
  showOnce({
    eyebrow: '관리자 키 발급 완료', title: `${dept} 관리자 키`, value: key,
    note: '⚠ 이 키는 <b>지금 한 번만</b> 표시됩니다. 창을 닫기 전에 복사해서 해당 부서 관리자에게 안전하게 전달하세요.',
  });
}

async function rotateDeptKey(dept) {
  if (!requireAdmin()) return;
  if (!confirm(`${dept}의 관리자 키를 새로 발급할까요?`)) return;
  try {
    const { key } = await api('/api/admin/dept-keys/rotate', { method: 'POST', body: { dept } });
    log(`${me().name}님이 ${dept} 관리자 키를 재발급했습니다.`);
    save();
    showIssuedKey(dept, key);
    renderDeptKeys();
  } catch (ex) { toast(ex.message); }
}

async function submitDeptAdd(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  const input = e.target.dept, dept = input.value.trim();
  if (!dept) return;
  try {
    const { key } = await api('/api/admin/dept-keys', { method: 'POST', body: { dept } });
    log(`${me().name}님이 ${dept} 부서를 추가하고 관리자 키를 발급했습니다.`);
    save();
    input.value = '';
    showIssuedKey(dept, key);
    renderDeptKeys();
  } catch (ex) { toast(ex.message); input.focus(); }
}

async function copyKey() {
  const key = $('#keyValue').textContent;
  try {
    await navigator.clipboard.writeText(key);
  } catch (e) {
    const r = document.createRange(); r.selectNodeContents($('#keyValue'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy');
  }
  $('#keyCopy').textContent = '복사됨 ✓';
}

function renderAuth() {
  const u = me();
  $('#authArea').innerHTML = u
    ? `<button class="user-chip" data-my title="마이페이지">
         <span class="avatar ${u.role === 'admin' ? 'admin' : ''}">${esc(u.name[0])}</span>
         <span><b>${esc(u.name)}</b><small>${roleName(u.role)}${u.dept ? ' · ' + esc(u.dept) : ''}</small></span>
       </button>
       <button class="btn ghost small" data-logout>로그아웃</button>`
    : `<button class="btn ghost small" data-auth="login">로그인</button>
       <button class="btn primary small" data-auth="signup">회원가입</button>`;
  document.body.classList.toggle('is-member', !!u);
  document.body.classList.toggle('is-admin', isAdmin());
  $$('[data-go="location"]').forEach(b => b.classList.toggle('locked', !isAdmin()));
}

const REQ_BADGE = { pending: 'wait', approved: 'ok', rejected: 'no', cancelled: 'store' };

async function openMyPage() {
  const u = me();
  if (!u) return;
  await loadRequests();
  const myReqs = reqCache.filter(r => r.userId === u.id);
  const myArts = db.artworks.filter(a => a.createdBy === u.id);
  const likedArts = myLiked().map(getArt).filter(Boolean);
  $('#myBody').innerHTML = `
    <div class="my-head">
      <span class="avatar ${u.role === 'admin' ? 'admin' : ''}">${esc(u.name[0])}</span>
      <div>
        <h2>${esc(u.name)}님</h2>
        <p class="muted" style="margin:0">${u.dept ? esc(u.dept) + ' · ' : ''}${esc(u.email)} <span class="badge ${u.role}">${roleName(u.role)}</span></p>
        <p class="hint" style="margin-top:4px">가입일 ${fmtDate(u.createdAt)}${u.lastLoginAt ? ` · 최근 로그인 ${fmt(u.lastLoginAt)}` : ''}</p>
      </div>
    </div>
    ${u.role === 'admin' ? '<p class="lock-note">🛡 관리자 권한: 위치 관리, 작품 수정·삭제, 배치 신청 승인, 회원 관리를 할 수 있어요.</p>' : ''}
    <div class="my-sec">
      <h3>내가 등록한 작품 (${myArts.length})</h3>
      <div class="my-likes">${myArts.map(a => `<button data-open="${a.id}"><img src="${imgOf(a)}" alt="" />${esc(a.title)}${a.pendingRequest ? '<br><small>⏳ 신청중</small>' : ''}</button>`).join('')
        || '<p class="muted">등록한 작품이 없습니다. 작품 상세에서 사내 전시를 제안할 수 있어요.</p>'}</div>
    </div>
    <div class="my-sec">
      <h3>내 배치 신청 (${myReqs.length})</h3>
      <ul class="my-list">${myReqs.map(r => `<li>
          <span>${esc(r.title)}<small>${esc(locName(r.locationId))} · ${esc(r.from)} ~ ${esc(r.to)}${r.adminNote ? ` · 관리자 메모: ${esc(r.adminNote)}` : ''}</small></span>
          <span style="display:flex;gap:6px;align-items:center">
            <span class="badge ${REQ_BADGE[r.status]}">${r.status === 'pending' ? '배치 신청중' : r.statusText}</span>
            ${(r.status === 'pending' || (r.status === 'approved' && !r.installedAt)) ? `<button class="btn ghost small" data-cancelreq="${r.id}">취소</button>` : ''}
          </span>
        </li>`).join('') || '<li class="muted">아직 신청한 작품이 없어요.</li>'}</ul>
    </div>
    <div class="my-sec">
      <h3>내가 공감한 작품 (${likedArts.length})</h3>
      <div class="my-likes">${likedArts.map(a => `<button data-open="${a.id}"><img src="${imgOf(a)}" alt="" />${esc(a.title)}</button>`).join('') || '<p class="muted">작품에 ♡ 공감을 눌러 보세요.</p>'}</div>
    </div>
    <div class="form-actions" style="margin-top:20px">
      <button class="btn ghost" data-changepw>🔑 비밀번호 변경</button>
      <button class="btn ghost" data-logout>로그아웃</button>
    </div>`;
  showModal('#myModal');
}

function openPwModal(force = false) {
  $$('.modal').forEach(m => m.id !== 'pwModal' && !m.hidden && (m.hidden = true));
  const f = $('#pwForm');
  f.reset();
  $('#pwError').textContent = '';
  $('#pwForceNotice').hidden = !force;
  $('#pwTitle').textContent = force ? '새 비밀번호 설정' : '비밀번호 변경';
  showModal('#pwModal');
  setTimeout(() => f.current.focus(), 60);
}

async function submitPw(e) {
  e.preventDefault();
  const f = e.target, err = $('#pwError');
  $$('input', f).forEach(i => i.classList.remove('invalid'));
  const fail = (msg, field) => { err.textContent = msg; if (field && f[field]) { f[field].classList.add('invalid'); f[field].focus(); } };
  if (!f.current.value) return fail('현재 비밀번호를 입력해 주세요.', 'current');
  const next = f.next.value;
  if (next.length < 6 || !/[a-zA-Z]/.test(next) || !/\d/.test(next)) return fail('새 비밀번호는 영문과 숫자를 포함해 6자 이상이어야 합니다.', 'next');
  if (next !== f.next2.value) return fail('새 비밀번호 확인이 일치하지 않습니다.', 'next2');
  await withBusy(f, async () => {
    try {
      const { user } = await api('/api/auth/change-password', {
        method: 'POST', body: { currentPassword: f.current.value, newPassword: next },
      });
      currentUser = user;
      closeModals();
      toast('비밀번호가 변경되었습니다. 🔒');
    } catch (ex) { fail(ex.message, ex.field); }
  });
}

async function renderMembers() {
  await loadRequests();
  await renderUsers();
  renderDeptKeys();
}

async function renderUsers() {
  const tbody = $('#userTable');
  if (!users.length) tbody.innerHTML = '<tr><td colspan="9" class="empty">회원 목록을 불러오는 중…</td></tr>';
  try {
    users = (await api('/api/users')).users || [];
  } catch (ex) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">${esc(ex.message)}</td></tr>`;
    return;
  }
  const week = Date.now() - 7 * 86400000;
  $('#memberKpis').innerHTML = [
    [users.length, '전체 회원'],
    [users.filter(u => u.role === 'member').length, '일반 회원'],
    [users.filter(u => u.role === 'admin').length, '관리자'],
    [users.filter(u => u.createdAt > week).length, '최근 7일 가입'],
  ].map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('');
  drawUserRows();
}

function drawUserRows() {
  const q = $('#mq').value.trim().toLowerCase(), role = $('#mRole').value, sort = $('#mSort').value;
  const list = users
    .filter(u => (!role || u.role === role) && (!q || [u.name, u.email, u.dept].join(' ').toLowerCase().includes(q)))
    .sort({
      new: (a, b) => b.createdAt - a.createdAt,
      login: (a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0),
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    }[sort]);
  $('#memberCount').textContent = `${list.length}명 표시 (전체 ${users.length}명)`;
  const cur = me();
  $('#userTable').innerHTML = list.map(u => {
    const self = cur && u.id === cur.id;
    const reqs = reqCache.filter(r => r.userId === u.id).length;
    return `
    <tr class="${self ? 'me-row' : ''}">
      <td><span class="who"><span class="avatar ${u.role === 'admin' ? 'admin' : ''}">${esc(u.name[0])}</span><b>${esc(u.name)}</b>${self ? ' <small class="muted">(나)</small>' : ''}</span></td>
      <td class="email">${esc(u.email)}</td>
      <td>${u.dept ? esc(u.dept) : '<span class="muted">-</span>'}</td>
      <td><span class="badge ${u.role}">${roleName(u.role)}</span></td>
      <td>${fmtDate(u.createdAt)}</td>
      <td><span class="dot ${u.online ? 'on' : ''}" title="${u.online ? '로그인 중' : '로그아웃 상태'}"></span>${u.lastLoginAt ? fmt(u.lastLoginAt) : '<span class="muted">기록 없음</span>'}</td>
      <td>${u.mustChangePw ? '<span class="pw-state temp">⏳ 임시 발급됨</span>' : '<span class="pw-state">🔒 ••••••••</span>'}</td>
      <td>신청 ${reqs}건</td>
      <td>${self ? '<span class="muted">본인</span>' : `<span class="actions">
        <button class="btn ghost small" data-resetpw="${u.id}">비밀번호 초기화</button>
        <button class="btn ghost small" data-role="${u.id}">${u.role === 'admin' ? '일반 회원으로' : '관리자로 지정'}</button>
        <button class="btn danger-ghost small" data-deluser="${u.id}" title="계정 삭제">삭제</button>
      </span>`}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">조건에 맞는 회원이 없습니다.</td></tr>';
}

async function deleteUser(id) {
  if (!requireAdmin()) return;
  const u = users.find(x => x.id === id);
  if (!u) return;
  const typed = prompt(`⚠ ${u.name}(${roleName(u.role)}) 계정을 삭제합니다.\n\n확인을 위해 이메일을 입력하세요:\n${u.email}`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== u.email) return toast('이메일이 일치하지 않아 삭제를 취소했어요.');
  try {
    const { deleted } = await api(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadArtworks();
    log(`${me().name}님이 ${deleted.name}(${deleted.email}) 계정을 삭제했습니다.`);
    save();
    toast(`${deleted.name}님의 계정을 삭제했습니다.`);
    renderUsers();
  } catch (ex) { toast(ex.message); }
}

async function resetPassword(id) {
  if (!requireAdmin()) return;
  const u = users.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`${u.name}(${u.email})님의 비밀번호를 초기화할까요?`)) return;
  try {
    const { name, email, tempPassword } = await api(`/api/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
    log(`${me().name}님이 ${name}님의 비밀번호를 초기화했습니다.`);
    save();
    showOnce({
      eyebrow: '임시 비밀번호 발급 완료', title: `${name}님의 임시 비밀번호`, value: tempPassword,
      note: `⚠ 이 임시 비밀번호는 지금 한 번만 표시됩니다. ${esc(email)} 계정 주인에게 안전하게 전달하세요.`,
    });
    renderUsers();
  } catch (ex) { toast(ex.message); }
}

async function toggleRole(id) {
  if (!requireAdmin()) return;
  const u = users.find(x => x.id === id);
  if (!u || u.id === me().id) return;
  try {
    const { user } = await api(`/api/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH', body: { role: u.role === 'admin' ? 'member' : 'admin' },
    });
    log(`${user.name}님의 등급이 ${roleName(user.role)}(으)로 변경되었습니다.`);
    save();
    toast(`${user.name}님 → ${roleName(user.role)}`);
    renderUsers();
  } catch (ex) { toast(ex.message); }
}

function generateAI(a) {
  const facts = [`「${a.title}」은 ${a.artist} 작가의 작품입니다.`];
  if (a.year) facts.push(`제작연도는 ${a.year}년입니다.`);
  if (a.medium) facts.push(`등록된 재료와 기법은 ${a.medium}입니다.`);
  const intent = (a.intent || '').trim();
  const description = intent ? `작가가 남긴 작품 설명입니다.\n${intent}` : '작가의 작품 설명은 아직 등록되지 않았습니다.';
  const visual = a.visualDescription ? `작품의 시각 묘사입니다.\n${a.visualDescription}` : '';
  return {
    full: [facts.join(' '), description, visual].filter(Boolean).join('\n\n'),
    easy: `${a.artist} 작가의 「${a.title}」 작품이에요. ${intent || '작가의 설명이 등록되면 더 자세한 이야기를 읽을 수 있어요.'}`,
    caption: `${a.title} · ${a.artist}${a.year ? ' · '+a.year : ''}`
  };
}

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('이 브라우저는 음성 읽기를 지원하지 않습니다.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

function go(view) {
  if (view === 'location' && !requireAdmin('위치 관리는 관리자 회원만 이용할 수 있어요. 🔒', view)) return false;
  if (view === 'members' && !requireAdmin('회원 관리는 관리자 회원만 이용할 수 있어요. 🔒', view)) return false;
  if (view === 'requests' && !requireAdmin('배치 신청 관리는 관리자 회원만 이용할 수 있어요. 🔒', view)) return false;
  closeAdminMenu();
  if (view === 'register' && !requireLogin('작품 등록은 로그인 후 이용할 수 있어요.', view)) return false;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  if (location.hash.slice(1) !== view) location.hash = view;
  render(view);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}

function render(view) {
  if (view === 'vision') return;
  $('#adminMenu').classList.toggle('has-active', ['requests', 'location', 'members'].includes(view));
  ({ home: renderHome, archive: renderArchive, register: renderRegister, location: renderLocation, exhibit: renderExhibit, stats: renderStats, members: renderMembers, requests: renderRequests, artists: renderArtists, map: renderSpaceMap, saved: renderSaved, reviews: renderReviews }[view] || renderHome)();
}

function cardHTML(a) {
  const s = statusOf(a);
  const mine = me() && a.createdBy === me().id;
  return `<button class="art-card" data-open="${a.id}" aria-label="${esc(a.title)} 상세 보기">
    <span class="thumb-wrap">
      <img class="thumb ${a.image ? '' : 'no-img'}" src="${imgOf(a)}" alt="${esc(a.title)} 작품 이미지" loading="lazy" />
      ${mine ? '<span class="mine-badge">내 작품</span>' : ''}
      ${a.pendingRequest ? `<span class="pending-badge" title="희망 위치: ${esc(locName(a.pendingRequest.locationId))}">⏳ 배치 신청중</span>` : ''}
    </span>
    <div class="body">
      <h3>${esc(a.title)}</h3>
      <div class="muted">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''}</div>
      <div class="tags">${(a.tags || []).slice(0, 3).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
      <div class="meta"><span class="badge ${s.cls}">${s.text}</span><span>📍${esc(locName(a.locationId))}</span></div>
      <div class="meta"><span>👁 ${a.views || 0}${a.reactionCount ? ` · <span class="star-mini">★ ${a.avgRating}</span>` : ''}</span><span>${a.likedByMe ? '♥' : '♡'} ${a.likes || 0}</span></div>
    </div>
  </button>`;
}

const popularity = a => (a.likes || 0) * 2 + (a.views || 0) + (a.image ? 0.5 : 0);

/* ---------------- 홈 ---------------- */
function renderHome() {
  const top = db.artworks.filter(a => a.image).sort((a, b) => popularity(b) - popularity(a)).slice(0, 8);
  const tiles = top.length ? Array.from({ length: 8 }, (_, i) => top[i % top.length]) : [];
  $('#heroBg').innerHTML = tiles.map(a => `<img src="${imgOf(a)}" alt="" />`).join('');

  const { list, reason } = recommend(8);
  $('#recoReason').textContent = reason;
  $('#recoGrid').innerHTML = list.map(cardHTML).join('');
  $('#activityList').innerHTML = db.activity.slice(0, 6)
    .map(x => `<li>${esc(x.text)}<time>${fmt(x.at)}</time></li>`).join('');
}

function recommend(n) {
  const liked = myLiked();
  const likedArts = liked.map(getArt).filter(Boolean);
  if (!likedArts.length) {
    const list = [...db.artworks].sort((a, b) => popularity(b) - popularity(a)).slice(0, n);
    return { list, reason: '· 지금 인기 있는 작품' };
  }
  const weight = {};
  likedArts.forEach(a => (a.tags || []).forEach(t => (weight[t] = (weight[t] || 0) + 1)));
  const scored = db.artworks
    .filter(a => !liked.includes(a.id))
    .map(a => ({ a, s: (a.tags || []).reduce((s, t) => s + (weight[t] || 0), 0) * 10 + popularity(a) / 10 }))
    .sort((x, y) => y.s - x.s);
  const topTags = Object.entries(weight).sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => '#' + x[0]).join(' ');
  return { list: scored.slice(0, n).map(x => x.a), reason: `· ${me().name}님이 공감한 ${topTags} 취향 기반` };
}

/* ---------------- 아카이브 ---------------- */
function fillFilters() {
  const tags = [...new Set(db.artworks.flatMap(a => a.tags || []))].sort();
  const cur = $('#fTag').value;
  $('#fTag').innerHTML = '<option value="">전체 태그</option>' + tags.map(t => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
function renderArchive() {
  fillFilters();
  const q = $('#q').value.trim().toLowerCase();
  const tag = $('#fTag').value, loc = $('#fLoc').value, sort = $('#fSort').value;
  let list = db.artworks.filter(a =>
    (!q || [a.title, a.artist, a.medium, a.intent, ...(a.tags || [])].join(' ').toLowerCase().includes(q)) &&
    (!tag || (a.tags || []).includes(tag)) &&
    (!loc || a.locationId === loc));
  const sorters = {
    featured: (a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || popularity(b) - popularity(a) || (b.createdAt || 0) - (a.createdAt || 0),
    new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    likes: (a, b) => (b.likes || 0) - (a.likes || 0),
    views: (a, b) => (b.views || 0) - (a.views || 0),
    title: (a, b) => a.title.localeCompare(b.title, 'ko'),
  };
  list.sort(sorters[sort]);
  $('#resultCount').textContent = `총 ${list.length}점의 작품`;
  $('#archiveGrid').innerHTML = list.length ? list.map(cardHTML).join('') : '<p class="empty">조건에 맞는 작품이 없습니다.</p>';
}

/* ---------------- 등록 / 수정 ---------------- */
let regImageData = null;

function renderRegister() {
  const admin = isAdmin(), sel = $('#regLoc');
  sel.disabled = !admin;
  if (!admin && !$('#regForm').id.value) sel.value = 'STORE';
  $('#regLocHint').textContent = admin ? '' : '🔒 위치 지정은 관리자만 가능해요. 등록 후 창고 보관으로 시작합니다.';
  updateRegPreview();
}

function updateRegPreview() {
  const f = $('#regForm');
  $('#regPreviewTitle').textContent = f.title.value || '작품명';
  $('#regPreviewArtist').textContent = (f.artist.value || '작가명') + (f.year.value ? ' · ' + f.year.value : '');
  const tags = [f.theme.value, ...parseTags(f.tags.value)].filter(Boolean);
  $('#regPreviewTags').innerHTML = [...new Set(tags)].map(t => `<span class="tag">#${esc(t)}</span>`).join('');
  const img = regImageData;
  $('#regPreviewImg').style.backgroundImage = img ? `url("${img}")` : '';
  $('#regPreviewImg').textContent = img ? '' : '이미지를 올리면 여기에 보여요';
}
const parseTags = s => [...new Set(s.split(/[,#\s]+/).map(t => t.trim()).filter(Boolean))].slice(0, 6);

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r);
        c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function startEdit(id) {
  if (!requireAdmin('작품 정보 수정은 관리자만 할 수 있어요.')) return;
  const a = getArt(id);
  const f = $('#regForm');
  f.reset();
  f.id.value = a.id;
  ['title', 'artist', 'year', 'medium', 'size', 'artistBio', 'intent', 'visualDescription', 'locationId', 'theme'].forEach(k => (f[k].value = a[k] || ''));
  f.tags.value = (a.tags || []).filter(t => t !== a.theme).join(', ');
  regImageData = a.image || null;
  $('#regTitle').textContent = '작품 정보 수정';
  $('#regSubmit').textContent = '수정 저장';
  closeModals();
  go('register');
}

function resetRegForm() {
  $('#regForm').reset();
  $('#regForm').id.value = '';
  regImageData = null;
  $('#regTitle').textContent = '작품 등록';
  $('#regSubmit').textContent = '등록하고 AI 설명 생성';
  updateRegPreview();
}

async function submitRegister(e) {
  e.preventDefault();
  const f = e.target;
  const theme = f.theme.value;
  const data = {
    title: f.title.value.trim(), artist: f.artist.value.trim(), year: f.year.value.trim(),
    medium: f.medium.value.trim(), size: f.size.value.trim(), theme,
    tags: [...new Set([theme, ...parseTags(f.tags.value)].filter(Boolean))].slice(0, 6),
    artistBio: f.artistBio.value.trim(), intent: f.intent.value.trim(), visualDescription: f.visualDescription.value.trim(),
  };
  if (!data.title || !data.artist) return toast('작품명과 작가명은 필수입니다.');
  if (!requireLogin()) return;
  if (isAdmin()) data.locationId = f.locationId.value;
  if (regImageData && regImageData.startsWith('data:')) data.image = regImageData;

  const editing = f.id.value;
  if (editing && !requireAdmin()) return;
  await withBusy(f, async () => {
    try {
      const { artwork } = editing
        ? await api(`/api/artworks/${encodeURIComponent(editing)}`, { method: 'PATCH', body: { ...data, reason: '정보 수정' } })
        : await api('/api/artworks', { method: 'POST', body: data });
      const savedArt = artwork || { ...data, id: editing || uid(), image: data.image || '', likes: 0, views: 0 };
      replaceArt(savedArt);
      log(editing ? `「${savedArt.title}」 작품 정보가 수정되었습니다.` : `${me().name}님이 새 작품 「${savedArt.title}」을 등록했습니다.`);
      save();
      resetRegForm();
      toast(editing ? '수정되었습니다.' : '등록 완료! AI 설명을 생성합니다.');
      openDetail(savedArt.id, { autoAI: !editing });
    } catch (ex) { toast(ex.message); }
  });
}

/* ---------------- 위치 관리 ---------------- */
async function moveArtwork(id, to, reason) {
  if (!requireAdmin('작품 위치 이동은 관리자만 할 수 있어요. 🔒')) return false;
  const a = getArt(id);
  if (!a || a.locationId === to) return false;
  try {
    const { artwork } = await api(`/api/artworks/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { locationId: to, reason: reason || '관리자 이동' },
    });
    log(`「${a.title}」 위치 이동: ${locName(a.locationId)} → ${locName(to)}`);
    a.locationId = to;
    replaceArt(artwork || a);
    save();
    toast(`「${a.title}」 → ${locName(to)}`);
    return true;
  } catch (ex) { toast(ex.message); return false; }
}

async function renderLocation() {
  $('#floorMap').innerHTML = AREAS.map(area => `
    <div class="floor">
      <div class="floor-label">${area}</div>
      <div class="zones">
        ${LOCATIONS.filter(l => l.area === area).map(l => {
          const arts = db.artworks.filter(a => a.locationId === l.id);
          return `<div class="zone" data-zone="${l.id}">
            <h4>${esc(l.name)} <span>${arts.length}점</span></h4>
            <div class="zone-items">
              ${arts.map(a => `<div class="chip-art" draggable="true" data-drag="${a.id}" data-open="${a.id}" tabindex="0" title="${esc(a.artist)} · 드래그해서 이동">
                <img src="${imgOf(a)}" alt="" />${esc(a.title)}</div>`).join('') || '<span class="muted" style="font-size:.8rem">작품을 여기로 끌어오세요</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  try {
    const { moves } = await api('/api/moves');
    $('#moveLog').innerHTML = (moves || []).slice(0, 30).map(m => `<tr><td>${fmt(m.at)}</td><td>${esc(m.title)}</td><td>${m.from ? esc(locName(m.from)) : '-'}</td><td>→</td><td><b>${esc(locName(m.to))}</b></td><td>${esc(m.reason || '')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">이동 이력이 없습니다.</td></tr>';
  } catch (ex) {
    $('#moveLog').innerHTML = `<tr><td colspan="6" class="empty">${esc(ex.message)}</td></tr>`;
  }
}

function bindDragDrop() {
  const map = $('#floorMap');
  if (!map) return;
  map.addEventListener('dragstart', e => {
    const el = e.target.closest('[data-drag]');
    if (!el) return;
    e.dataTransfer.setData('text/plain', el.dataset.drag);
    el.classList.add('dragging');
  });
  map.addEventListener('dragend', e => e.target.classList && e.target.classList.remove('dragging'));
  map.addEventListener('dragover', e => {
    const z = e.target.closest('.zone');
    if (!z) return;
    e.preventDefault();
    $$('.zone.over').forEach(x => x !== z && x.classList.remove('over'));
    z.classList.add('over');
  });
  map.addEventListener('dragleave', e => {
    const z = e.target.closest('.zone');
    if (z && !z.contains(e.relatedTarget)) z.classList.remove('over');
  });
  map.addEventListener('drop', async e => {
    const z = e.target.closest('.zone');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('over');
    if (await moveArtwork(e.dataTransfer.getData('text/plain'), z.dataset.zone, '위치 관리 화면에서 이동')) renderLocation();
  });
}

/* ---------------- 작품 상세 ---------------- */
let currentAITab = 'full';
let currentDetailId = null;
let aiGenerationTimer = null;

function stopAIGeneration() {
  clearTimeout(aiGenerationTimer);
  clearInterval(aiGenerationTimer);
  aiGenerationTimer = null;
}

function openDetail(id, opts = {}) {
  const a = getArt(id);
  if (!a) return;
  stopAIGeneration();
  if (!a.ai) a.ai = generateAI(a);
  if (!opts.noView) addView(a);
  currentAITab = 'full';
  currentDetailId = id;
  const s = statusOf(a);
  const liked = a.likedByMe;
  const admin = isAdmin();
  const mine = me() && a.createdBy === me().id;
  $('#detailBody').innerHTML = `
    <div>
      <div class="d-img-wrap">
        <img class="d-img" src="${imgOf(a)}" alt="${esc(a.title)} 작품 이미지" />
        <button class="btn-3d" id="d3dBtn" title="작품을 크게 3D로 보기">🔍 자세히 보기 <small>3D</small></button>
      </div>
      ${a.image ? '' : '<p class="hint" style="margin-top:6px">📷 이 작품은 아직 사진이 등록되지 않았어요.</p>'}
      <div class="d-actions">
        <button class="btn ${liked ? 'primary' : 'ghost'}" id="dLike">${liked ? '♥ 공감함' : '♡ 공감하기'} (${a.likes || 0})</button>
        ${a.canRequest && !a.pendingRequest ? '<button class="btn primary" id="dReq">🖼 배치 신청</button>' : ''}
        ${a.canRequest && a.pendingRequest ? '<button class="btn ghost" disabled>⏳ 배치 신청중</button>' : ''}
        ${a.canEdit ? '<button class="btn ghost small" id="dEdit">✎ 정보 수정</button>' : ''}
        ${a.canDelete ? `<button class="btn danger-ghost small" id="dDel">${mine ? '내 작품 삭제' : '삭제'}</button>` : ''}
      </div>
      <div class="card" style="box-shadow:none">
        <strong>📍 현재 위치</strong> <span class="badge ${s.cls}">${s.text}</span>
        ${admin ? `<div class="d-loc">
          <select id="dLocSel" aria-label="위치 변경">${LOCATIONS.map(l => `<option value="${l.id}" ${l.id === a.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
          <button class="btn primary small" id="dLocBtn">이동</button>
        </div>`
        : `<p style="margin:8px 0 0"><b>${esc(locName(a.locationId))}</b></p>
        <p class="hint">${s.cls === 'on' ? '사내 공간의 출입 권한을 확인한 뒤 방문해 주세요.' : '온라인에서 작품을 감상할 수 있어요.'}</p>`}
      </div>
    </div>
    <div class="d-info">
      <p class="eyebrow">${(a.tags || []).map(t => '#' + esc(t)).join(' ')}</p>
      <h2 id="dTitle">${esc(a.title)}</h2>
      <p class="muted">${esc(a.artist)}${a.artistBio ? ` <small>· ${esc(a.artistBio)}</small>` : ''}</p>
      <details class="art-metadata"><summary>작품 세부 정보</summary><dl>
        <dt>제작연도</dt><dd>${esc(a.year || '-')}</dd>
        <dt>재료/기법</dt><dd>${esc(a.medium || '-')}</dd>
        <dt>크기</dt><dd>${esc(a.size ? a.size + ' cm' : '-')}</dd>
        <dt>조회</dt><dd>${a.views || 0}회</dd>
      </dl></details>
      ${a.intent ? `<div class="artist-note"><h3>🖌 작가의 작품 설명</h3><p>${esc(a.intent)}</p></div>` : ''}
      <div class="ai-box">
        <div class="ai-head">
          <h3>✨ AI 작품 설명</h3>
          <button class="btn primary small" id="aiGen">${a.ai ? '↻ 다시 생성' : 'AI 설명 생성'}</button>
        </div>
        <div class="ai-tabs" role="tablist">
          <button data-ai="full" class="active">전시 해설</button>
          <button data-ai="easy">쉬운 설명</button>
          <button data-ai="caption">한 줄 캡션</button>
        </div>
        <textarea class="ai-text" id="aiText" aria-label="AI 설명" ${me() ? '' : 'readonly'} placeholder="‘AI 설명 생성’을 눌러주세요.">${esc(a.ai ? a.ai.full : '')}</textarea>
        <div class="ai-foot">
          <button class="btn ghost small" id="aiSpeak">🔊 음성으로 듣기</button>
          ${me() ? '<button class="btn ghost small" id="aiSave">수정 내용 저장</button>' : '<span class="hint">로그인 없이 설명을 읽고 들을 수 있어요.</span>'}
        </div>
      </div>
      <section class="survey" aria-labelledby="rxTitle">
        <div class="rx-head">
          <h3 id="rxTitle">💬 감상 반응</h3>
          <span class="rx-summary" id="rxSummary"></span>
        </div>
        ${me() ? `
        <div class="rx-form" id="rxForm">
          <div class="stars" id="stars" role="radiogroup" aria-label="별점">${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" role="radio" aria-checked="false" aria-label="${n}점">★</button>`).join('')}
            <span class="star-label" id="starLabel">별점을 선택해 주세요</span></div>
          <div class="feelings" id="feelings">${FEELINGS.map(f => `<button data-feel="${f}" aria-pressed="false">${f}</button>`).join('')}</div>
          <textarea id="svComment" rows="2" maxlength="300" placeholder="작품을 보고 느낀 점을 남겨 주세요 (선택, 300자)"></textarea>
          <div class="ai-foot">
            <span class="hint" id="rxMineNote"></span>
            <button class="btn primary small" id="svSubmit">반응 남기기</button>
          </div>
        </div>`
        : `<div class="login-cta">🔒 감상 반응은 <b>로그인한 회원</b>만 남길 수 있어요.
            <button class="btn primary small" data-auth="login">로그인</button></div>`}
        <ul class="rx-list" id="rxList"><li class="muted">아직 반응이 없어요.</li></ul>
      </section>
    </div>`;
  showModal('#detailModal');
  bindDetail(a);
  if (opts.autoAI) runAI(a);
}

function bindDetail(a) {
  const body = $('#detailBody');
  $('#dLike', body).onclick = async () => { if (await toggleLike(a.id)) openDetail(a.id, { noView: true }); };
  if ($('#dReq', body)) $('#dReq', body).onclick = () => openRequest(a.id);
  if ($('#dEdit', body)) $('#dEdit', body).onclick = () => startEdit(a.id);
  if ($('#dDel', body)) $('#dDel', body).onclick = () => deleteArtwork(a.id);
  if ($('#dLocBtn', body)) $('#dLocBtn', body).onclick = async () => {
    if (await moveArtwork(a.id, $('#dLocSel', body).value, '상세 화면에서 이동')) {
      openDetail(a.id, { noView: true });
      refresh();
    }
  };

  $$('[data-ai]', body).forEach(b => (b.onclick = () => {
    currentAITab = b.dataset.ai;
    $$('[data-ai]', body).forEach(x => x.classList.toggle('active', x === b));
    $('#aiText').value = a.ai ? a.ai[currentAITab] : '';
  }));
  $('#aiGen', body).onclick = () => runAI(a);
  if ($('#aiSave', body)) $('#aiSave', body).onclick = async () => {
    if (!requireLogin()) return;
    const ai = { ...(a.ai || { full: '', easy: '', caption: '' }), [currentAITab]: $('#aiText').value };
    if (await saveAI(a, ai)) toast('설명이 저장되었습니다.');
  };
  $('#aiSpeak', body).onclick = () => {
    const ta = $('#aiText', body);
    const text = ta.classList.contains('typing') ? a.ai[currentAITab] : ta.value;
    speak(`${a.title}. ${a.artist} 작가. ${text}`);
  };

  $('#d3dBtn', body).onclick = () => open3D(a);
  $('.d-img', body).onclick = () => open3D(a);
  bindReactions(a);
}

/* ---------------- 작품 자세히 보기 (3D) ---------------- */
const v3 = { rx: 0, ry: 0, zoom: 1, vx: 0, vy: 0, drag: null, raf: 0, auto: false, open: false };

function open3D(a) {
  const src = imgOf(a);
  $('#v3dTitle').textContent = a.title;
  $('#v3dMeta').textContent = [a.artist, a.year, a.medium, a.size && a.size + ' cm'].filter(Boolean).join(' · ');
  $('#v3dFront').src = src;
  $('#v3dBack').src = src;
  $('#v3dFront').alt = `${a.title} 작품 이미지`;
  const fit = () => {
    const img = $('#v3dFront');
    const ratio = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 4 / 3;
    const maxW = Math.min(window.innerWidth * 0.7, 900), maxH = Math.min(window.innerHeight * 0.56, 620);
    let w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    const art = $('#v3dArt');
    art.style.setProperty('--w', w + 'px');
    art.style.setProperty('--h', h + 'px');
    art.style.setProperty('--d', Math.max(10, Math.round(Math.min(w, h) * 0.03)) + 'px');
  };
  $('#v3dFront').onload = fit;
  fit();
  Object.assign(v3, { rx: 0, ry: 0, zoom: 1, vx: 0, vy: 0, auto: false, open: true });
  set3DAuto(false);
  $('#v3d').hidden = false;
  document.body.style.overflow = 'hidden';
  draw3D(true);
  setTimeout(() => $('#v3dStage').focus(), 50);
}

function close3D() {
  v3.open = false;
  cancelAnimationFrame(v3.raf);
  $('#v3d').hidden = true;
  document.body.style.overflow = $('#detailModal').hidden ? '' : 'hidden';
  const btn = $('#d3dBtn');
  if (btn) btn.focus();
}

function draw3D(animate = false) {
  const art = $('#v3dArt');
  art.classList.toggle('animating', animate);
  art.style.transform = `rotateX(${v3.rx}deg) rotateY(${v3.ry}deg)`;
  $('#v3dZoom').style.transform = `scale(${v3.zoom})`;
  const deg = ((Math.round(v3.ry) % 360) + 360) % 360;
  const back = Math.cos(v3.ry * Math.PI / 180) * Math.cos(v3.rx * Math.PI / 180) < 0;
  $('#v3dDeg').textContent = `${deg}°`;
  $('#v3dSide').textContent = back ? '뒷면 (좌우 반전)' : '앞면';
  $('#v3d').classList.toggle('show-back', back);
  $('#v3dZoomVal').textContent = Math.round(v3.zoom * 100) + '%';
  const g = $('#v3dGlare');
  g.style.backgroundPosition = `${50 + Math.sin(v3.ry * Math.PI / 180) * 60}% ${50 - v3.rx}%`;
  g.style.opacity = String(0.35 + Math.abs(Math.sin(v3.ry * Math.PI / 180)) * 0.5);
  const sh = $('#v3dShadow');
  sh.style.transform = `translateX(-50%) scaleX(${0.35 + Math.abs(Math.cos(v3.ry * Math.PI / 180)) * 0.65 * v3.zoom})`;
}

function step3D(action) {
  if (action === 'left') v3.ry -= 45;
  if (action === 'right') v3.ry += 45;
  if (action === 'flip') v3.ry += 180;
  if (action === 'in') v3.zoom = Math.min(2.5, +(v3.zoom + 0.2).toFixed(2));
  if (action === 'out') v3.zoom = Math.max(0.5, +(v3.zoom - 0.2).toFixed(2));
  if (action === 'reset') Object.assign(v3, { rx: 0, ry: 0, zoom: 1 });
  if (action === 'auto') return set3DAuto(!v3.auto);
  v3.vx = v3.vy = 0;
  draw3D(true);
}

function set3DAuto(on) {
  if (on && (pref.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { toast('움직임 줄이기 설정을 해제해 주세요.'); return; }
  v3.auto = on;
  $('#v3dAuto').setAttribute('aria-pressed', String(on));
  $('#v3dAuto').textContent = on ? '⏸ 자동 회전' : '▶ 자동 회전';
  cancelAnimationFrame(v3.raf);
  if (on) loop3D();
}

function loop3D() {
  if (!v3.open) return;
  if (v3.auto) v3.ry += 0.35;
  else if (Math.abs(v3.vx) > 0.02 || Math.abs(v3.vy) > 0.02) {
    v3.ry += v3.vx;
    v3.rx = Math.max(-60, Math.min(60, v3.rx + v3.vy));
    v3.vx *= 0.94;
    v3.vy *= 0.94;
  } else return;
  draw3D(false);
  v3.raf = requestAnimationFrame(loop3D);
}

function bind3D() {
  const stage = $('#v3dStage');
  if (!stage) return;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    stage.setPointerCapture(e.pointerId);
    set3DAuto(false);
    v3.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    v3.vx = v3.vy = 0;
    stage.classList.add('grabbing');
  });
  stage.addEventListener('pointermove', e => {
    if (!v3.drag) return;
    const dx = e.clientX - v3.drag.x, dy = e.clientY - v3.drag.y;
    v3.ry += dx * 0.45;
    v3.rx = Math.max(-60, Math.min(60, v3.rx - dy * 0.3));
    v3.vx = dx * 0.45;
    v3.vy = -dy * 0.3;
    v3.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
    draw3D(false);
  });
  const end = () => {
    if (!v3.drag) return;
    v3.drag = null;
    stage.classList.remove('grabbing');
    if (!pref.reduceMotion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) loop3D();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    v3.zoom = Math.max(0.5, Math.min(2.5, v3.zoom * (1 - e.deltaY * 0.0012)));
    draw3D(false);
  }, { passive: false });
  stage.addEventListener('dblclick', () => step3D('flip'));
  $$('[data-v3d]').forEach(b => (b.onclick = () => step3D(b.dataset.v3d)));
  $('#v3dClose').onclick = close3D;
  $('#v3d').addEventListener('keydown', e => {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', '+': 'in', '=': 'in', '-': 'out', f: 'flip', F: 'flip', r: 'reset', R: 'reset', a: 'auto', A: 'auto' };
    if (e.key === 'Escape') { e.stopPropagation(); return close3D(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      v3.rx = Math.max(-60, Math.min(60, v3.rx + (e.key === 'ArrowUp' ? 10 : -10)));
      e.preventDefault();
      return draw3D(true);
    }
    if (map[e.key] && (e.key.startsWith('Arrow') || !e.target.matches('button'))) { e.preventDefault(); step3D(map[e.key]); }
  });
  window.addEventListener('resize', () => { if (v3.open) $('#v3dFront').onload(); });
}

/* ---------------- 드롭다운 (NiceSelect) ---------------- */
const niceSelects = new WeakMap();
let nsSeq = 0;
let nsOpen = null;

function enhanceSelect(sel) {
  if (niceSelects.has(sel) || sel.multiple || sel.closest('.ns')) return;
  const id = 'ns' + (++nsSeq);
  const wrap = document.createElement('div');
  wrap.className = 'ns';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('ns-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ns-btn';
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', id + '-list');
  const label = sel.getAttribute('aria-label') || (sel.closest('label') && sel.closest('label').firstChild.textContent.trim());
  if (label) btn.setAttribute('aria-label', label);
  btn.innerHTML = '<span class="ns-value"></span><span class="ns-arrow" aria-hidden="true"></span>';

  const list = document.createElement('ul');
  list.className = 'ns-list';
  list.id = id + '-list';
  list.setAttribute('role', 'listbox');
  wrap.append(btn, list);

  const state = { sel, wrap, btn, list, active: -1, typed: '', typedAt: 0 };
  niceSelects.set(sel, state);

  const render = () => {
    const opts = [...sel.options];
    const cur = sel.selectedIndex;
    $('.ns-value', btn).textContent = cur >= 0 ? opts[cur].text : '';
    btn.disabled = sel.disabled;
    wrap.classList.toggle('disabled', sel.disabled);
    wrap.classList.toggle('invalid', sel.classList.contains('invalid'));
    list.innerHTML = opts.map((o, i) => `<li role="option" id="${id}-o${i}" data-i="${i}"
        aria-selected="${i === cur}" ${o.disabled ? 'aria-disabled="true"' : ''} style="--i:${Math.min(i, 10)}">${esc(o.text)}</li>`).join('');
  };
  state.render = render;
  render();

  ['value', 'selectedIndex'].forEach(prop => {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(sel, prop, {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); render(); },
    });
  });
  new MutationObserver(render).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'class'] });
  if (sel.form) sel.form.addEventListener('reset', () => setTimeout(render));
  sel.addEventListener('change', render);
  sel.addEventListener('focus', () => btn.focus());

  btn.addEventListener('click', () => (nsOpen === state ? closeNice() : openNice(state)));
  btn.addEventListener('keydown', e => niceKey(state, e));
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li || li.getAttribute('aria-disabled')) return;
    chooseNice(state, +li.dataset.i);
  });
  list.addEventListener('mousemove', e => {
    const li = e.target.closest('li');
    if (li) setNiceActive(state, +li.dataset.i, false);
  });
}

function openNice(state) {
  if (state.btn.disabled) return;
  closeNice();
  nsOpen = state;
  state.render();
  state.wrap.classList.add('open');
  state.btn.setAttribute('aria-expanded', 'true');
  placeNice(state);
  setNiceActive(state, Math.max(0, state.sel.selectedIndex), true);
}

function closeNice() {
  if (!nsOpen) return;
  nsOpen.wrap.classList.remove('open');
  nsOpen.btn.setAttribute('aria-expanded', 'false');
  nsOpen.btn.removeAttribute('aria-activedescendant');
  nsOpen = null;
}

function placeNice(state) {
  const r = state.btn.getBoundingClientRect();
  const list = state.list;
  const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
  const want = Math.min(list.scrollHeight, 300);
  const up = below < Math.min(want, 180) && above > below;
  state.wrap.classList.toggle('up', up);
  list.style.minWidth = r.width + 'px';
  list.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, list.offsetWidth) - 8) + 'px';
  list.style.maxHeight = Math.max(140, Math.min(300, up ? above : below)) + 'px';
  if (up) { list.style.top = 'auto'; list.style.bottom = (window.innerHeight - r.top + 6) + 'px'; }
  else { list.style.bottom = 'auto'; list.style.top = (r.bottom + 6) + 'px'; }
}

function setNiceActive(state, i, scroll) {
  const items = $$('li', state.list);
  if (!items.length) return;
  i = Math.max(0, Math.min(items.length - 1, i));
  items.forEach((li, k) => li.classList.toggle('active', k === i));
  state.active = i;
  state.btn.setAttribute('aria-activedescendant', items[i].id);
  if (scroll) items[i].scrollIntoView({ block: 'nearest' });
}

function chooseNice(state, i) {
  const opt = state.sel.options[i];
  if (!opt || opt.disabled) return;
  const changed = state.sel.selectedIndex !== i;
  state.sel.selectedIndex = i;
  closeNice();
  state.btn.focus();
  if (changed) {
    state.sel.dispatchEvent(new Event('input', { bubbles: true }));
    state.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function niceKey(state, e) {
  const isOpen = nsOpen === state;
  const opts = [...state.sel.options];
  const step = dir => {
    let i = state.active;
    do { i += dir; } while (opts[i] && opts[i].disabled);
    if (opts[i]) setNiceActive(state, i, true);
  };
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); isOpen ? step(1) : openNice(state); break;
    case 'ArrowUp': e.preventDefault(); isOpen ? step(-1) : openNice(state); break;
    case 'Enter': case ' ':
      e.preventDefault();
      isOpen ? chooseNice(state, state.active) : openNice(state);
      break;
    case 'Escape': if (isOpen) { e.preventDefault(); e.stopPropagation(); closeNice(); } break;
    case 'Tab': if (isOpen) closeNice(); break;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        state.typed = (now - state.typedAt < 700 ? state.typed : '') + e.key.toLowerCase();
        state.typedAt = now;
        const hit = opts.findIndex(o => !o.disabled && o.text.toLowerCase().startsWith(state.typed));
        if (hit >= 0) { if (!isOpen) openNice(state); setNiceActive(state, hit, true); }
      }
  }
}

function initNiceSelects() {
  $$('select').forEach(enhanceSelect);
  new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'SELECT') enhanceSelect(n);
      else n.querySelectorAll && n.querySelectorAll('select').forEach(enhanceSelect);
    }));
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mousedown', e => { if (nsOpen && !nsOpen.wrap.contains(e.target)) closeNice(); });
  window.addEventListener('resize', () => nsOpen && placeNice(nsOpen));
  document.addEventListener('scroll', e => { if (nsOpen && !nsOpen.list.contains(e.target)) placeNice(nsOpen); }, true);
}

/* ---------------- 감상 반응 ---------------- */
const STAR_TEXT = ['', '아쉬워요', '그저 그래요', '좋아요', '마음에 들어요', '최고예요'];
const starsHTML = n => `<span class="stars-view" aria-label="별점 ${n}점">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

function bindReactions(a) {
  const body = $('#detailBody');
  const state = { rating: 0, feel: new Set() };
  const paint = () => {
    $$('#stars button', body).forEach(x => {
      const on = +x.dataset.star <= state.rating;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(+x.dataset.star === state.rating));
    });
    if ($('#starLabel', body)) $('#starLabel', body).textContent = state.rating ? `${state.rating}점 · ${STAR_TEXT[state.rating]}` : '별점을 선택해 주세요';
    $$('#feelings button', body).forEach(x => {
      x.classList.toggle('on', state.feel.has(x.dataset.feel));
      x.setAttribute('aria-pressed', String(state.feel.has(x.dataset.feel)));
    });
  };
  $$('#stars button', body).forEach(b => (b.onclick = () => { state.rating = +b.dataset.star; paint(); }));
  $$('#feelings button', body).forEach(b => (b.onclick = () => {
    state.feel.has(b.dataset.feel) ? state.feel.delete(b.dataset.feel) : state.feel.add(b.dataset.feel);
    paint();
  }));
  if ($('#svSubmit', body)) $('#svSubmit', body).onclick = async () => {
    if (!requireLogin('반응은 로그인한 회원만 남길 수 있어요.')) return;
    if (!state.rating) return toast('별점을 1개 이상 선택해 주세요. ⭐');
    try {
      await api(`/api/artworks/${encodeURIComponent(a.id)}/reactions`, {
        method: 'POST', body: { rating: state.rating, feelings: [...state.feel], comment: $('#svComment').value.trim() },
      });
      log(`${me().name}님이 「${a.title}」에 감상 반응(★${state.rating})을 남겼습니다.`);
      save();
      toast('소중한 반응 감사합니다! ✨');
      await loadReactions(a, state, paint);
    } catch (ex) { toast(ex.message); }
  };
  loadReactions(a, state, paint);
}

async function loadReactions(a, state, paint) {
  const list = $('#rxList');
  if (!list) return;
  try {
    const { reactions, count, avg, mine } = await api(`/api/artworks/${encodeURIComponent(a.id)}/reactions`);
    a.reactionCount = count || 0;
    a.avgRating = avg || 0;
    $('#rxSummary').innerHTML = count ? `${starsHTML(Math.round(avg))} <b>${avg}</b> <span class="muted">· ${count}명 참여</span>` : '<span class="muted">아직 반응이 없어요</span>';
    list.innerHTML = (reactions && reactions.length) ? reactions.map(r => `
      <li class="rx-item ${r.mine ? 'mine' : ''}">
        <div class="rx-top">
          <span class="avatar">${esc(r.name[0] || '?')}</span>
          <b>${esc(r.name)}${r.mine ? ' <small class="muted">(나)</small>' : ''}</b>
          ${starsHTML(r.rating)}
          <time>${fmt(r.updatedAt)}</time>
        </div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      </li>`).join('') : '<li class="rx-empty">첫 번째 감상을 남겨 주세요. ✨</li>';
  } catch (ex) {
    list.innerHTML = `<li class="muted">감상을 남겨보세요.</li>`;
  }
}

function runAI(a) {
  stopAIGeneration();
  const btn = $('#aiGen'), ta = $('#aiText');
  btn.disabled = true;
  btn.textContent = '생성 중…';
  ta.value = '';
  ta.classList.add('typing');
  const result = generateAI(a);
  a.ai = result;
  aiGenerationTimer = setTimeout(() => {
    let i = 0;
    aiGenerationTimer = setInterval(() => {
      const text = result[currentAITab];
      i += 3;
      ta.value = text.slice(0, i);
      if (i >= text.length) {
        stopAIGeneration();
        ta.classList.remove('typing');
        btn.disabled = false;
        btn.textContent = '↻ 다시 생성';
      }
    }, 18);
  }, 700);
}

async function saveAI(a, ai) {
  try {
    const { artwork } = await api(`/api/artworks/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { ai } });
    Object.assign(a, replaceArt(artwork || { ...a, ai }));
    save();
    return true;
  } catch (ex) { toast(ex.message); return false; }
}

async function toggleLike(id) {
  if (!requireLogin('공감하려면 로그인해 주세요.')) return false;
  const a = getArt(id);
  try {
    const { liked, likes } = await api(`/api/artworks/${encodeURIComponent(id)}/like`, { method: 'POST' });
    a.likedByMe = liked;
    a.likes = likes;
    if (liked) { log(`${me().name}님이 「${a.title}」에 공감했습니다. ♥`); save(); }
    return true;
  } catch (ex) { toast(ex.message); return false; }
}

function addView(a) {
  a.views = (a.views || 0) + 1;
  api(`/api/artworks/${encodeURIComponent(a.id)}/view`, { method: 'POST' }).catch(() => {});
}

async function deleteArtwork(id) {
  const a = getArt(id);
  if (!a || !a.canDelete) return toast('작품은 등록한 본인 또는 관리자만 삭제할 수 있어요.');
  if (!confirm(`「${a.title}」 작품을 삭제할까요?`)) return;
  try {
    await api(`/api/artworks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    db.artworks = db.artworks.filter(x => x.id !== id);
    save();
    closeModals();
    toast(`「${a.title}」 작품을 삭제했어요.`);
    refresh();
  } catch (ex) { toast(ex.message); }
}

/* ---------------- 신청 ---------------- */
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function openRequest(id) {
  if (!requireLogin('배치 신청은 로그인 후 이용할 수 있어요.')) return;
  const a = getArt(id);
  if (!a) return;
  const f = $('#reqForm');
  f.reset();
  f.artworkId.value = id;
  $('#reqError').textContent = '';
  $('#reqArt').innerHTML = `<img src="${imgOf(a)}" alt="" /><div><b>${esc(a.title)}</b><br><small class="muted">${esc(a.artist)} · 현재 위치: ${esc(locName(a.locationId))}</small></div>`;
  $('#reqWho').textContent = `신청자: ${me().name} (${me().email})`;
  const today = localDate();
  f.from.value = today;
  f.to.value = localDate(new Date(Date.now() + 30 * 86400000));
  $('#detailModal').hidden = true;
  showModal('#reqModal');
}

async function submitRequest(e) {
  e.preventDefault();
  const f = e.target, err = $('#reqError');
  if (!requireLogin()) return;
  await withBusy(f, async () => {
    try {
      const { request } = await api('/api/requests', {
        method: 'POST',
        body: { artworkId: f.artworkId.value, locationId: f.locationId.value, from: f.from.value, to: f.to.value, note: f.note.value.trim() },
      });
      log(`${me().name}님이 배치 신청을 완료했습니다.`);
      save();
      closeModals();
      toast('전시 제안이 접수되었어요.');
      refresh();
    } catch (ex) { err.textContent = ex.message; }
  });
}

async function handleRequest(id, action) {
  try {
    await api(`/api/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    toast('처리되었습니다.');
    save();
    refresh();
  } catch (ex) { toast(ex.message); }
}

let reqTab = 'pending';
async function renderRequests() {
  const list = $('#reqList');
  if (!list) return;
  await loadRequests();
  const shown = reqCache.filter(r => !reqTab || r.status === reqTab);
  list.innerHTML = shown.map(r => {
    const a = getArt(r.artworkId);
    return `<article class="req-card ${r.status}">
      <img src="${a ? imgOf(a) : placeholderImage(r.title, r.artist)}" alt="${esc(r.title)}" data-open="${r.artworkId}" />
      <div>
        <h3>${esc(r.title || '')}</h3>
        <div class="route">희망 위치: <b>${esc(locName(r.locationId))}</b></div>
      </div>
    </article>`;
  }).join('') || '<p class="empty">신청 내역이 없습니다.</p>';
}

function closeAdminMenu() {
  const menu = $('#adminMenu');
  if (!menu) return;
  $('.nav-dropdown', menu).hidden = true;
  $('#adminMenuBtn').setAttribute('aria-expanded', 'false');
}
function toggleAdminMenu() {
  const dd = $('#adminMenu .nav-dropdown');
  dd.hidden = !dd.hidden;
  $('#adminMenuBtn').setAttribute('aria-expanded', String(!dd.hidden));
}

/* ---------------- 전시 ---------------- */
function renderExhibit() {
  $('#exhibitList').innerHTML = db.exhibitions.map(ex => {
    const arts = (ex.artworkIds || []).map(getArt).filter(Boolean);
    return `<article class="card ex-card">
      <div class="ex-cover">${arts.slice(0, 3).map(a => `<img src="${imgOf(a)}" alt="" />`).join('')}</div>
      <div class="body">
        <p class="eyebrow">${esc(ex.curator || '큐레이터')} 기획 · ${arts.length}점</p>
        <h3>${esc(ex.title)}</h3>
        <p>${esc(ex.desc || '')}</p>
        <div class="actions">
          <button class="btn primary small" data-play="${ex.id}" ${arts.length ? '' : 'disabled'}>▶ 전시관 입장</button>
        </div>
      </div>
    </article>`;
  }).join('') || '<p class="empty">아직 기획된 전시가 없습니다.</p>';

  const pickList = [...db.artworks].sort((x, y) => (y.image ? 1 : 0) - (x.image ? 1 : 0));
  $('#exPick').innerHTML = pickList.map(a => `
    <label class="pick"><input type="checkbox" name="pick" value="${a.id}" />
      <img src="${imgOf(a)}" alt="" loading="lazy" /><span>${esc(a.title)}<small class="muted"> · ${esc(a.artist)}</small></span></label>`).join('');
}

function submitExhibit(e) {
  e.preventDefault();
  const f = e.target;
  if (!requireLogin('전시 기획은 로그인 후 이용할 수 있어요.')) return;
  const ids = $$('input[name=pick]:checked', f).map(i => i.value);
  if (!ids.length) return toast('전시할 작품을 1점 이상 선택해주세요.');
  db.exhibitions.unshift({ id: uid(), title: f.title.value.trim(), curator: f.curator.value.trim() || me().dept, desc: f.desc.value.trim(), artworkIds: ids, createdBy: me().id, createdAt: Date.now() });
  log(`새 온라인 전시 「${f.title.value.trim()}」이 열렸습니다.`);
  save();
  f.reset();
  toast('전시가 만들어졌습니다!');
  renderExhibit();
}

const viewer = { ex: null, idx: 0 };
function openViewer(exId) {
  viewer.ex = db.exhibitions.find(x => x.id === exId);
  viewer.idx = 0;
  $('#viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  showSlide();
}
function showSlide() {
  const arts = (viewer.ex.artworkIds || []).map(getArt).filter(Boolean);
  const a = arts[viewer.idx];
  if (!a) return;
  addView(a);
  $('#vImg').src = imgOf(a);
  $('#vImg').alt = a.title + ' 작품 이미지';
  $('#vEx').textContent = viewer.ex.title;
  $('#vTitle').textContent = a.title;
  $('#vArtist').textContent = [a.artist, a.year, a.medium].filter(Boolean).join(' · ');
  $('#vDesc').textContent = a.intent || (a.ai ? a.ai.full : '');
  $('#vLike').textContent = (a.likedByMe ? '♥ 공감함 ' : '♡ 공감 ') + (a.likes || 0);
  $('#vCount').textContent = `${viewer.idx + 1} / ${arts.length}`;
}
function stepSlide(d) {
  const n = (viewer.ex.artworkIds || []).map(getArt).filter(Boolean).length;
  if (!n) return;
  viewer.idx = (viewer.idx + d + n) % n;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  showSlide();
}
function closeViewer() {
  $('#viewer').hidden = true;
  document.body.style.overflow = '';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  refresh();
}

/* ---------------- 통계 ---------------- */
function bars(el, rows) {
  if (!el) return;
  const max = Math.max(1, ...rows.map(r => r[1]));
  el.innerHTML = rows.length ? rows.map(([l, v]) => `
    <div class="bar-row"><span class="label" title="${esc(l)}">${esc(l)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:0" data-w="${(v / max) * 100}"></div></div><b>${v}</b></div>`).join('')
    : '<p class="empty">데이터가 아직 없습니다.</p>';
  requestAnimationFrame(() => $$('.bar-fill', el).forEach(b => (b.style.width = b.dataset.w + '%')));
}

async function renderStats() {
  const likes = db.artworks.reduce((s, a) => s + (a.likes || 0), 0);
  $('#statKpis').innerHTML = [
    [db.artworks.reduce((s, a) => s + (a.views || 0), 0).toLocaleString(), '누적 조회'],
    [likes.toLocaleString(), '누적 공감'],
    [db.artworks.filter(a => statusOf(a).cls === 'on').length, `전시중 작품 (전체 ${db.artworks.length}점)`],
    ['4.8★', `평균 평점`],
  ].map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('');

  bars($('#barLikes'), [...db.artworks].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5).map(a => [a.title, a.likes || 0]));
}

function exportCSV() {
  const rows = [['작품ID', '작품명', '작가', '연도', '재료', '태그', '위치', '상태', '조회', '공감']];
  db.artworks.forEach(a => {
    rows.push([a.id, a.title, a.artist, a.year, a.medium, (a.tags || []).join('|'), locName(a.locationId), statusOf(a).text, a.views || 0, a.likes || 0]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `artbridge_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------------- 모달 및 화면 제어 ---------------- */
let lastFocus = null;
function showModal(sel) {
  lastFocus = lastFocus || document.activeElement;
  const m = $(sel);
  if (!m) return;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const c = $('.close', m); c && c.focus(); }, 30); } function closeModals() {   stopAIGeneration();   $$('.modal').forEach(m => (m.hidden = true));
  document.body.style.overflow = '';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

function refresh() {
  const active = $('.view.active') ?$('.view.active').id.replace('view-', '') : 'home';
  render(active);
}

/* ---------------- 초기화 및 이벤트 바인딩 ---------------- */
function init() {
  const locOpts = LOCATIONS.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  if ($('#regLoc')) { $('#regLoc').innerHTML = locOpts; $('#regLoc').value = 'STORE'; }
  if ($('#reqLoc')) $('#reqLoc').innerHTML = LOCATIONS.filter(l => l.id !== 'STORE' && l.id !== 'NONE').map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  if ($('#fLoc')) $('#fLoc').innerHTML += locOpts;

  if (pref.fontStep == null) pref.fontStep = pref.big ? 3 : 2;
  const applyA11y = () => {
    pref.fontStep = Math.max(0, Math.min(FONT_STEPS.length - 1, pref.fontStep));
    const px = FONT_STEPS[pref.fontStep];
    document.documentElement.style.setProperty('--fs', px + 'px');
    document.documentElement.classList.toggle('font-lg', px > 16);
    const pct = Math.round((px / 16) * 100) + '%';
    if ($('#btnFontReset')) {
      $('#btnFontReset').textContent = pct;
      $('#btnFontReset').classList.toggle('changed', px !== 16);
    }
    if ($('#btnFontDown')) $('#btnFontDown').disabled = pref.fontStep === 0;
    if ($('#btnFontUp')) $('#btnFontUp').disabled = pref.fontStep === FONT_STEPS.length - 1;
    return pct;
  };
  const setFont = step => { pref.fontStep = step; const pct = applyA11y(); savePref(); toast(`글자 크기 ${pct}`); };
  applyA11y();
  if ($('#btnFontDown')) $('#btnFontDown').onclick = () => setFont(pref.fontStep - 1);
  if ($('#btnFontUp')) $('#btnFontUp').onclick = () => setFont(pref.fontStep + 1);
  if ($('#btnFontReset')) $('#btnFontReset').onclick = () => setFont(2);

  renderAuth();
  if ($('#loginForm')) $('#loginForm').addEventListener('submit', submitLogin);
  if ($('#signupForm')) {
    $('#signupForm').addEventListener('submit', submitSignup);
    $('#signupForm').password.addEventListener('input', updatePwChecks);
    $('#signupForm').password2.addEventListener('input', updatePwChecks);     $$('#signupForm [name=accountType]').forEach(r => r.addEventListener('change', () => setAccountType(r.value)));
    $('#signupForm').adminKey.addEventListener('input', e => (e.target.value = e.target.value.toUpperCase()));
  }
  if ($('#deptAddForm')) $('#deptAddForm').addEventListener('submit', submitDeptAdd);
  if ($('#keyCopy')) $('#keyCopy').onclick = copyKey;
  if ($('#pwForm')) $('#pwForm').addEventListener('submit', submitPw);
  ['#mq', '#mRole', '#mSort'].forEach(s => $(s) && $(s).addEventListener('input', drawUserRows));$$('.pw-toggle').forEach(b => (b.onclick = () => {
    const input = b.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? '숨김' : '보기';
  }));

  document.addEventListener('click', e => {
    if (e.target.closest('a.corp')) return;
    const authEl = e.target.closest('[data-auth]');
    if (authEl) return openAuth(authEl.dataset.auth);
    const tabEl = e.target.closest('[data-auth-tab]');
    if (tabEl) { switchAuthTab(tabEl.dataset.authTab); return; }
    const rotateEl = e.target.closest('[data-rotate]');
    if (rotateEl) return rotateDeptKey(rotateEl.dataset.rotate);
    const resetEl = e.target.closest('[data-resetpw]');
    if (resetEl) return resetPassword(resetEl.dataset.resetpw);
    const delUserEl = e.target.closest('[data-deluser]');
    if (delUserEl) return deleteUser(delUserEl.dataset.deluser);
    if (e.target.closest('[data-changepw]')) return openPwModal(false);
    const demoEl = e.target.closest('[data-demo]');
    if (demoEl) return demoLogin(demoEl.dataset.demo);
    if (e.target.closest('[data-logout]')) return logout();
    if (e.target.closest('[data-my]')) return openMyPage();
    if (e.target.closest('#adminMenuBtn')) return toggleAdminMenu();
    if (!e.target.closest('#adminMenu')) closeAdminMenu();

    const goEl = e.target.closest('[data-go]');
    if (goEl) {
      if (goEl.dataset.go === 'register') resetRegForm();
      if (goEl.closest('.modal')) closeModals();
      go(goEl.dataset.go);
      return;
    }
    const openEl = e.target.closest('[data-open]');
    if (openEl) { e.preventDefault(); if ($('#myModal')) $('#myModal').hidden = true; openDetail(openEl.dataset.open); return; }
    const t = e.target;
    if (t.closest('[data-close]') || t.classList.contains('modal')) return closeModals();
    if (t.dataset.play) return openViewer(t.dataset.play);
    if (t.dataset.approve) handleRequest(t.dataset.approve, 'approve');
    if (t.dataset.reject) handleRequest(t.dataset.reject, 'reject');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && v3.open) return close3D();
    if (e.key === 'Escape') { closeAdminMenu(); $('#viewer').hidden ? closeModals() : closeViewer(); }
    if (!$('#viewer').hidden && e.key === 'ArrowRight') stepSlide(1);
    if (!$('#viewer').hidden && e.key === 'ArrowLeft') stepSlide(-1);
  });

  ['#q', '#fTag', '#fLoc', '#fSort'].forEach(s => $(s) &&$(s).addEventListener('input', renderArchive));

  if ($('#regForm')) {
    $('#regForm').addEventListener('submit', submitRegister);
    $('#regForm').addEventListener('input', updateRegPreview);
    $('#regReset').onclick = resetRegForm;
    $('#regImage').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try { regImageData = await resizeImage(file); updateRegPreview(); }
      catch (err) { toast('이미지를 불러올 수 없습니다.'); }
    });
  }

  if ($('#reqForm')) $('#reqForm').addEventListener('submit', submitRequest);
  if ($('#exForm')) $('#exForm').addEventListener('submit', submitExhibit);

  if ($('#vClose')) $('#vClose').onclick = closeViewer;
  if ($('#vPrev')) $('#vPrev').onclick = () => stepSlide(-1);
  if ($('#vNext')) $('#vNext').onclick = () => stepSlide(1);

  if ($('#btnExport')) $('#btnExport').onclick = exportCSV;
  if ($('#btnTop')) $('#btnTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  bindDragDrop();
  bind3D();
  initNiceSelects();

  const start = location.hash.slice(1);
  const views = ['home', 'archive', 'register', 'location', 'exhibit', 'stats', 'vision', 'members', 'requests'];
  const allowed = ['location', 'members', 'requests'].includes(start) ? isAdmin() : start === 'register' ? !!me() : views.includes(start);
  go(allowed ? start : 'home');
}

// 자동 부팅: DOM이 준비되면 세션 및 seed 작품 데이터를 로드하고 화면을 초기화합니다.
window.addEventListener('DOMContentLoaded', async () => {
  await loadSession();
  await loadArtworks();
  init();
});
