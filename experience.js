/* 관람 중심 경험과 서버 공유 기능. script.js의 기존 회원·작품 관리 기능을 확장합니다. */
let routing = false;
let experienceData = { artists: [], bookmarks: [], activity: [], artistDrafts: {} };
let archiveLimit = 24;
let detailOrder = [];
let routeBusy = false;
let localMigration = [];
const originalLocal = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } })();
localMigration = (originalLocal.exhibitions || []).filter(ex => ex.createdBy);

async function loadExperience() {
  const data = await api('/api/experience');
  experienceData = data;
  db.exhibitions = data.exhibitions;
  db.activity = data.activity;
}

// 브라우저에는 접근성 설정만 보관하고 공유 데이터는 서버를 원본으로 사용합니다.
save = function () {};
log = function () {};

async function migrateLocalExhibitions(user) {
  if (!user) return;
  for (const ex of localMigration.filter(x => x.createdBy===user.id)) {
    const marker = 'artbridge-migrated-'+ex.id;
    if (localStorage.getItem(marker)) continue;
    const ids = ex.artworkIds.filter(id => getArt(id));
    if (!ids.length) continue;
    await api('/api/exhibitions', { method:'POST', body:{title:ex.title,curator:ex.curator,desc:ex.desc,artworkIds:ids} });
    localStorage.setItem(marker, '1');
  }
}

const coreOnLogin = onLogin;
onLogin = async function (user) {
  experienceData.bookmarks = [];
  await coreOnLogin(user);
  try {
    await loadExperience();
    // 이 브라우저에서 만든 기존 전시는 작성자가 로그인했을 때 한 번 서버로 이관합니다.
    await migrateLocalExhibitions(user);
    await loadExperience();
    refresh();
  } catch (e) { toast(e.message); }
};
const coreLogout = logout;
logout = async function () { experienceData.bookmarks = []; await coreLogout(); await loadExperience().catch(e=>toast(e.message)); if (['saved','reviews'].includes($('.view.active').id.slice(5))) go('home'); else refresh(); };
const coreGo = go;
go = function (view) {
  if (view==='saved' && !requireLogin('관심 작품은 로그인 후 보관할 수 있어요.',view)) return false;
  if (view==='reviews' && !requireAdmin('담당 관리자만 해설을 검수할 수 있어요.',view)) return false;
  if (window.speechSynthesis) speechSynthesis.cancel();
  return coreGo(view);
};

const coreRenderHome = renderHome;
renderHome = function () {
  coreRenderHome();
  const featured = db.exhibitions.find(ex=>ex.featured) || db.exhibitions[0];
  $('#featuredExhibit').innerHTML = featured ? exhibitionCard(featured,true) : '<p class="empty">새로운 전시를 준비하고 있습니다.</p>';
  const photos = db.artworks.filter(a=>a.image);
  const day = Math.floor((Date.now()+9*3600000)/86400000);
  const a = photos[day % Math.max(photos.length,1)] || db.artworks[0];
  $('#dailyArtwork').innerHTML = a ? `<article class="daily-card"><button data-open="${esc(a.id)}" aria-label="${esc(a.title)} 상세 보기"><img src="${imgOf(a)}" alt="${esc(a.visualDescription || a.title+' 작품')}" /></button><div><p class="eyebrow">하루 3분 감상</p><h3>${esc(a.title)}</h3><p>${esc(a.artist)}</p><p>${esc(a.intent || '작품을 열어 등록된 정보와 해설을 만나보세요.')}</p><button class="btn primary" data-open="${esc(a.id)}">작품 만나기</button></div></article>` : '<p class="empty">등록된 작품이 없습니다.</p>';
  $('#homeArtists').innerHTML = experienceData.artists.slice(0,4).map(artistCard).join('');
  $('#activityList').innerHTML = db.activity.slice(0,6).map(x=>`<li>${esc(x.text)}<time>${fmt(x.at)}</time></li>`).join('') || '<li>새 전시와 설치 소식을 이곳에서 알려드립니다.</li>';
  if (!myLiked().length) $('#recoReason').textContent = '· 사진과 관람 관심을 바탕으로';
};
function artistCard(artist) {
  const art = db.artworks.find(a=>a.artist===artist.name && a.image) || db.artworks.find(a=>a.artist===artist.name);
  return `<button class="artist-card" data-artist="${esc(artist.name)}"><img src="${imgOf(art)}" alt="${esc(artist.name)} 작가의 대표 작품" loading="lazy" /><span><b>${esc(artist.name)}</b><small>${artist.count}점의 작품</small><span>${esc(artist.bio || '작품에서 작가의 시선을 만나보세요.')}</span></span></button>`;
}
function exhibitionCard(ex, large=false) {
  const arts = ex.artworkIds.map(getArt).filter(Boolean);
  const images = arts.filter(a=>a.image).slice(0,3);
  return `<article class="card ex-card ${large?'featured-ex':''}"><div class="ex-cover">${images.map(a=>`<img src="${imgOf(a)}" alt="${esc(a.title)}" loading="lazy" />`).join('') || '<p>작품 이미지를 준비하고 있습니다.</p>'}</div><div class="body"><p class="eyebrow">${ex.featured?'이달의 전시 · ':''}${esc(ex.curator)} 기획 · ${arts.length}점</p><h3>${esc(ex.title)}</h3><p>${esc(ex.desc)}</p><div class="actions"><button class="btn primary" data-play="${esc(ex.id)}" ${arts.length?'':'disabled'}>전시 감상하기</button><button class="btn ghost small" data-share-ex="${esc(ex.id)}">전시 공유</button>${isAdmin()?`<button class="btn ghost small" data-feature="${esc(ex.id)}">이달의 전시로 선정</button><button class="btn danger-ghost small" data-server-delex="${esc(ex.id)}">삭제</button>`:''}</div></div></article>`;
}

renderArchive = function () {
  fillFilters();
  const q=$('#q').value.trim().toLowerCase(), tag=$('#fTag').value, loc=$('#fLoc').value;
  const list=db.artworks.filter(a=>(!q || [a.title,a.artist,a.medium,a.intent,...a.tags].join(' ').toLowerCase().includes(q)) && (!tag||a.tags.includes(tag)) && (!loc||a.locationId===loc) && (!$('#photoOnly').checked||a.image));
  const sorters={featured:(a,b)=>Number(!!b.image)-Number(!!a.image)||popularity(b)-popularity(a),new:(a,b)=>b.createdAt-a.createdAt,likes:(a,b)=>b.likes-a.likes,views:(a,b)=>b.views-a.views,title:(a,b)=>a.title.localeCompare(b.title,'ko')};
  list.sort(sorters[$('#fSort').value]);
  detailOrder=list.map(a=>a.id);
  $('#resultCount').textContent=`총 ${list.length}점 · ${Math.min(list.length,archiveLimit)}점 표시`;
  $('#archiveGrid').innerHTML=list.slice(0,archiveLimit).map(cardHTML).join('') || '<p class="empty">조건에 맞는 작품이 없어요. 검색어나 필터를 바꿔 보세요.</p>';
  $('#archiveMore').hidden=list.length<=archiveLimit;
};

const audio = { utterance:null, rate:1, id:null, text:'' };
function audioControls(id) {
  return `<div class="audio-player" role="group" aria-label="작품 해설 재생"><button class="btn primary" data-listen="${esc(id)}">해설 듣기</button><button class="btn ghost small" data-audio="pause">일시정지 / 이어듣기</button><button class="btn ghost small" data-audio="stop">정지</button><label>속도 <select data-audio-rate aria-label="해설 재생 속도">${[0.8,1,1.2,1.5].map(rate=>`<option value="${rate}" ${audio.rate===rate?'selected':''}>${rate}배</option>`).join('')}</select></label><span data-audio-status role="status" aria-live="polite">재생 대기</span></div>`;
}
function audioStatus(text) { $$('[data-audio-status]').forEach(n=>n.textContent=text); }
speak = function (text, id=null) {
  if (!('speechSynthesis' in window)) return toast('이 브라우저는 음성 읽기를 지원하지 않습니다. 설명을 글로 읽을 수 있어요.');
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang='ko-KR'; utterance.rate=audio.rate;
  audio.utterance=utterance; audio.id=id; audio.text=text;
  utterance.onstart=()=>{audioStatus('재생 중'); if(id) api(`/api/artworks/${encodeURIComponent(id)}/events`,{method:'POST',body:{kind:'listen'}}).catch(()=>{});};
  utterance.onend=()=>{ if(audio.utterance===utterance) { audioStatus('재생 완료'); audio.utterance=null; } };
  utterance.onerror=e=>{ if(!['canceled','interrupted'].includes(e.error)) { audioStatus('음성 재생을 사용할 수 없어요.'); toast('기기의 한국어 음성 설정을 확인해 주세요.'); } };
  speechSynthesis.speak(utterance);
};
function listenArtwork(id, visual=false) {
  const a=getArt(id); if(!a) return;
  let text;
  if(visual) text=a.visualDescription;
  else if(currentDetailId===id && !$('#detailModal').hidden) text=$('#aiText').classList.contains('typing')?a.ai[currentAITab]:$('#aiText').value;
  else text=a.intent || (a.aiReviewedAt && a.ai?.full) || generateAI(a).full;
  if(!text) return toast('시각 묘사를 준비하고 있습니다.');
  speak(`${a.title}. ${a.artist} 작가. ${text}`,id);
}
const coreOpenDetail=openDetail;
openDetail=function(id,opts={}) {
  const a=getArt(id); if(!a) return toast('작품을 찾을 수 없어요.');
  if(window.speechSynthesis) speechSynthesis.cancel();
  if(!a.aiReviewedAt || a.aiIsDraft) a.ai=generateAI(a);
  coreOpenDetail(id,{...opts,autoAI:false});
  const info=$('#detailBody .d-info');
  const quick=document.createElement('div'); quick.className='detail-quick-actions';
  quick.innerHTML=audioControls(id)+`<div class="detail-tools"><button class="btn ghost small" data-bookmark="${esc(id)}" aria-pressed="${experienceData.bookmarks.includes(id)}">${experienceData.bookmarks.includes(id)?'★ 관심 작품 보관됨':'☆ 관심 작품 보관'}</button><button class="btn ghost small" data-share-art="${esc(id)}">QR · 공유</button><button class="btn ghost small" data-artist="${esc(a.artist)}">작가 만나기</button><button class="btn ghost small" data-request-art="${esc(id)}">우리 공간에 전시 제안</button></div>`;
  info.querySelector('.muted').after(quick);
  $('#aiSpeak').hidden=true;
  $('#dReq')?.remove();
  const note=document.createElement('p'); note.className='hint ai-provenance'; note.id='aiProvenance';
  note.textContent=a.aiReviewedAt&&!a.aiIsDraft?`담당자 검수 완료 · ${a.aiReviewedBy} · ${fmtDate(a.aiReviewedAt)}`:'등록 정보로 자동 구성한 초안입니다. 이미지 분석이나 작가의 새로운 발언을 생성하지 않습니다.';
  $('.ai-tabs').before(note);
  $$('[data-ai]').forEach(b=>{b.setAttribute('role','tab'); b.setAttribute('aria-selected',String(b.dataset.ai===currentAITab)); b.addEventListener('click',()=>$$('[data-ai]').forEach(x=>x.setAttribute('aria-selected',String(x===b))));});
  if($('#aiSave')) { $('#aiSave').textContent=isAdmin()?'검수하고 공개':'수정 제안 보내기'; $('#aiSave').onclick=async()=>{ const draft={...a.ai,[currentAITab]:$('#aiText').value}; if(await saveAI(a,draft)) { toast(isAdmin()?'검수한 설명을 공개했습니다.':'수정 제안을 보냈습니다. 담당자 검수 후 공개됩니다.'); if(isAdmin()) openDetail(id,{noView:true}); } }; }
  const visual=document.createElement('section'); visual.className='card visual-description';
  visual.innerHTML=`<h3>그림의 색과 모습</h3><p>${esc(a.visualDescription||'사진에서 확인한 색·구도·대상의 설명을 준비하고 있습니다. 확인되지 않은 모습은 추측하지 않습니다.')}</p>${a.visualDescription?`<button class="btn ghost small" data-visual="${esc(id)}">시각 묘사 듣기</button>`:''}`;
  $('.ai-box').after(visual);
  $('#svComment')?.setAttribute('placeholder','인상 깊었던 부분이나 작가에게 전하고 싶은 말을 남겨 주세요 (선택, 300자)');
  const ids=detailOrder.includes(id)?detailOrder:db.artworks.map(x=>x.id), idx=ids.indexOf(id);
  const nav=document.createElement('div'); nav.className='detail-pagination';
  nav.innerHTML=`<button class="btn ghost" data-detail-step="-1" ${idx<=0?'disabled':''}>이전 작품</button><span>${idx+1} / ${ids.length}</span><button class="btn ghost" data-detail-step="1" ${idx>=ids.length-1?'disabled':''}>다음 작품</button>`;
  info.append(nav);
  $('.modal-box',$('#detailModal')).scrollTop=0;
  if(!routing && location.hash!=='#art/'+encodeURIComponent(id)) history.pushState({},'', '#art/'+encodeURIComponent(id));
  if(opts.autoAI) runAI(a);
};
const coreRunAI=runAI;
runAI=function(a){ a.aiIsDraft=true; $('#aiProvenance').textContent='등록 정보로 자동 구성한 초안입니다. 공개된 해설은 수정 제안이나 검수 후 변경됩니다.'; coreRunAI(a); };
saveAI=async function(a, ai){
  if(!requireLogin()) return false;
  try {
    if(isAdmin()) { const {artwork}=await api(`/api/artworks/${encodeURIComponent(a.id)}`,{method:'PATCH',body:{ai}}); Object.assign(a,replaceArt(artwork)); a.aiIsDraft=false; }
    else await api(`/api/artworks/${encodeURIComponent(a.id)}/ai-proposals`,{method:'POST',body:{ai}});
    return true;
  } catch(e){toast(e.message); return false;}
};

renderExhibit=function(){
  $('#exhibitList').innerHTML=db.exhibitions.map(ex=>exhibitionCard(ex)).join('') || '<p class="empty">첫 전시를 준비하고 있습니다.</p>';
  const selected=new Set($$('input[name=pick]:checked').map(n=>n.value));
  $('#exPick').innerHTML=[...db.artworks].sort((a,b)=>Number(!!b.image)-Number(!!a.image)).map(a=>`<label class="pick" data-pick-search="${esc(a.title+' '+a.artist)}"><input type="checkbox" name="pick" value="${esc(a.id)}" ${selected.has(a.id)?'checked':''}/><img src="${imgOf(a)}" alt="" loading="lazy"/><span>${esc(a.title)}<small> · ${esc(a.artist)}</small></span></label>`).join('');
};
submitExhibit=async function(e){
  e.preventDefault(); if(!requireLogin('로그인 후 전시를 기획할 수 있어요.')) return;
  const f=e.target, ids=$$('input[name=pick]:checked',f).map(n=>n.value);
  if(!ids.length) return toast('전시할 작품을 선택해 주세요.');
  await withBusy(f,async()=>{try{await api('/api/exhibitions',{method:'POST',body:{title:f.title.value.trim(),curator:f.curator.value.trim(),desc:f.desc.value.trim(),artworkIds:ids}}); await loadExperience(); f.reset(); $('#exPlanner').hidden=true; renderExhibit(); toast('전시가 저장되었습니다. 공유 주소로 다른 기기에서도 볼 수 있어요.');}catch(e){toast(e.message);}});
};
const coreOpenViewer=openViewer;
openViewer=function(id){const ex=db.exhibitions.find(x=>x.id===id); if(!ex?.artworkIds.some(getArt)) return toast('전시할 작품이 없습니다.'); coreOpenViewer(id); lastFocus=document.activeElement; $('#vClose').focus(); if(!routing&&!id.startsWith('COURSE-')) history.pushState({},'','#exhibition/'+encodeURIComponent(id));};
const coreShowSlide=showSlide;
showSlide=function(){ coreShowSlide(); const a=getArt(viewer.ex.artworkIds.filter(getArt)[viewer.idx]); $('#vImg').alt=a.visualDescription||a.title+' 작품'; $('#vSpeak').hidden=true; $('#viewerAudio').innerHTML=audioControls(a.id); $('#vImg').onclick=()=>{closeViewer();openDetail(a.id);}; $('#vImg').style.cursor='zoom-in'; const button=document.createElement('button');button.className='btn ghost small';button.textContent='작품 자세히 보기';button.onclick=()=>{closeViewer();openDetail(a.id);};$('#viewerAudio').append(button); };
const coreCloseViewer=closeViewer;
closeViewer=function(){ coreCloseViewer(); audioStatus('재생 대기'); if(!routing && location.hash.startsWith('#exhibition/')) history.replaceState({},'','#exhibit'); lastFocus?.focus(); };
const coreCloseModals=closeModals;
closeModals=function(){ coreCloseModals(); audio.utterance=null; audioStatus('재생 대기'); if(!routing && location.hash.startsWith('#art/')) history.replaceState({},'','#'+$('.view.active').id.slice(5)); };

function renderArtists(){
  const q=$('#artistSearch').value.trim();
  $('#artistList').innerHTML=experienceData.artists.filter(a=>a.name.includes(q)).map(artistCard).join('') || '<p class="empty">작가를 찾을 수 없습니다.</p>';
}
function showArtist(name){
  closeModals(); go('artists');
  const artist=experienceData.artists.find(a=>a.name===name); if(!artist) return;
  $('#artistProfile').hidden=false;
  $('#artistProfile').innerHTML=`<article class="card artist-story"><p class="eyebrow">작가를 만나다</p><h2>${esc(name)}</h2><p>${esc(artist.bio||'작가 소개를 준비하고 있습니다.')}</p><h3>작업 이야기</h3><p class="preserve-lines">${esc(artist.story||'작가가 공개에 동의한 작업 이야기를 준비하고 있습니다.')}</p><h3>작가 인터뷰</h3><p class="preserve-lines">${esc(artist.interview||'공개된 인터뷰가 아직 없습니다.')}</p></article><h2 class="sec-title">${esc(name)} 작가의 작품</h2><div class="grid">${db.artworks.filter(a=>a.artist===name).map(cardHTML).join('')}</div>`;
  if(!routing) history.pushState({},'','#artist/'+encodeURIComponent(name));
  $('#artistProfile').scrollIntoView({behavior:pref.reduceMotion?'instant':'smooth'});
}
function renderSpaceMap(){
  const select=$('#mapLocation'), selected=select.value;
  const spaces=LOCATIONS.filter(l=>!['STORE','NONE'].includes(l.id));
  select.innerHTML=spaces.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join(''); if(selected) select.value=selected;
  $('#spaceMap').innerHTML=spaces.map(l=>{const arts=db.artworks.filter(a=>a.locationId===l.id);return `<section class="space-card card"><h2>${esc(l.name)} <small>${arts.length}점</small></h2><p class="hint">${/VIP|LAB/.test(l.id)?'담당자 확인이 필요한 공간입니다.':'사내 출입 권한을 확인해 주세요.'}</p><div class="grid">${arts.slice(0,4).map(cardHTML).join('')||'<p>현재 등록된 전시 작품이 없습니다.</p>'}</div><button class="btn ghost small" data-course="${l.id}" ${arts.length?'':'disabled'}>이 공간의 작품 감상</button></section>`;}).join('');
}
function startCourse(locationId){
  const ids=db.artworks.filter(a=>a.locationId===locationId).slice(0,4).map(a=>a.id);
  if(!ids.length) return toast('이 공간에 등록된 작품이 없어요.');
  const id='COURSE-'+locationId; db.exhibitions=db.exhibitions.filter(ex=>ex.id!==id);
  db.exhibitions.push({id,title:locName(locationId)+' · 10분 감상 코스',artworkIds:ids,curator:'아트브릿지',desc:'작품마다 약 2~3분의 감상 시간을 가져보세요.'}); openViewer(id);
}
async function toggleBookmark(id){
  if(!requireLogin('로그인하면 관심 작품을 다른 기기에서도 볼 수 있어요.','saved')) return;
  try{const {bookmarked}=await api(`/api/artworks/${encodeURIComponent(id)}/bookmark`,{method:'POST'});experienceData.bookmarks=experienceData.bookmarks.filter(x=>x!==id);if(bookmarked) experienceData.bookmarks.push(id);toast(bookmarked?'관심 작품에 보관했습니다.':'관심 작품에서 꺼냈습니다.');if(!$('#detailModal').hidden) openDetail(id,{noView:true});if($('.view.active').id==='view-saved') renderSaved();}catch(e){toast(e.message);}
}
async function renderSaved(){
  const arts=experienceData.bookmarks.map(getArt).filter(Boolean), names=new Set(arts.map(a=>a.artist));
  $('#savedGrid').innerHTML=arts.map(cardHTML).join('')||'<p class="empty">작품 상세에서 ☆ 관심 작품 보관을 눌러보세요.</p>';
  $('#savedRelated').innerHTML=db.artworks.filter(a=>names.has(a.artist)&&!experienceData.bookmarks.includes(a.id)).slice(0,8).map(cardHTML).join('')||'<p class="empty">관심 작품을 보관하면 같은 작가의 다른 작품을 보여드립니다.</p>';
  try{const {proposals}=await api('/api/ai-proposals');$('#myProposals').innerHTML='<h2 class="sec-title">내 해설 수정 제안</h2>'+proposals.filter(p=>p.user_id===me()?.id).map(p=>`<p>${esc(p.title)} · ${p.status==='pending'?'검수 대기':p.status==='approved'?'공개 완료':'반려'}</p>`).join('');}catch(e){$('#myProposals').textContent=e.message;}
}

function shareUrl(kind,id,qr=false){return location.origin+location.pathname+'#'+kind+'/'+encodeURIComponent(id)+(qr?'?source=qr':'');}
function openShare(kind,id){
  const isArt=kind==='art', a=isArt?getArt(id):db.exhibitions.find(ex=>ex.id===id), url=shareUrl(kind,id,isArt);
  const qr=isArt?`/api/artworks/${encodeURIComponent(id)}/qr?url=${encodeURIComponent(url)}`:'';
  $('#shareTitle').textContent=isArt?'작품 QR · 해설 공유':'전시 공유';
  $('#shareContent').innerHTML=`<h3>${esc(a.title)}</h3>${isArt?`<img class="qr-image" src="${qr}" alt="${esc(a.title)} 해설로 연결되는 QR 코드" /><a class="btn ghost" href="${qr}" download="artbridge-${esc(id)}-qr.svg">QR 내려받기</a><button class="btn ghost" data-print-qr>QR 인쇄</button>`:''}<label class="share-link-label">공유 주소<input id="shareLink" readonly value="${esc(url)}" /></label><button class="btn primary" data-copy-link>주소 복사</button>${['localhost','127.0.0.1'].includes(location.hostname)?'<p class="notice">현재 주소는 이 컴퓨터에서만 열립니다. 다른 기기에서 QR을 이용하려면 사이트를 사내 접속 가능한 주소로 운영한 뒤 QR을 내려받아 주세요.</p>':''}`;
  showModal('#shareModal');
}

const coreRenderStats=renderStats;
renderStats=async function(){await coreRenderStats();const ranked=db.artworks.filter(a=>a.likes>0).sort((a,b)=>b.likes-a.likes).slice(0,5);bars($('#barLikes'),ranked.map(a=>[a.title,a.likes]));await loadImpact();};
async function loadImpact(){try{const {metrics:m,monthly,note}=await api('/api/impact?days='+$('#impactPeriod').value);$('#impactKpis').innerHTML=[[m.view||0,'기간 내 관람 횟수'],[m.listen||0,'해설 듣기 횟수'],[m.qr||0,'QR로 열린 횟수'],[m.participants,'감상 참여 회원'],[m.installations,'설치 완료'],[m.fromStorage,'보관·미배치 작품의 새 전시'],[m.exhibitions,'새 온라인 전시'],[m.artists,'전체 참여 작가']].map(([v,l])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');$('#impactNote').textContent=note;bars($('#monthlyViews'),monthly.map(r=>[r.month,r.views]));$('#photoCoverage').textContent=`전체 ${m.total}점 중 ${m.photos}점 사진 등록 · ${m.total?Math.round(m.photos/m.total*100):0}%`;}catch(e){$('#impactNote').textContent=e.message;}}
const coreRenderRequests=renderRequests;
renderRequests=async function(){await coreRenderRequests();const shown=reqCache.filter(r=>!reqTab||r.status===reqTab);$$('#reqList .req-card').forEach((card,i)=>{const r=shown[i];if(r.status==='approved'){const panel=document.createElement('div');panel.className='installation-panel';panel.innerHTML=r.installedAt?`<p>${r.installationImage?'설치 확인':'이전 승인 기록'} ${fmt(r.installedAt)} · ${esc(r.installedBy)}</p>${r.installationImage?`<a href="${esc(r.installationImage)}" target="_blank" rel="noopener">설치 사진 보기</a>`:''}`:`<p>승인되었습니다. 실제 설치 확인을 기다리고 있습니다.</p><button class="btn primary small" data-install="${esc(r.id)}">설치 사진 확인</button> <button class="btn ghost small" data-cancelreq="${esc(r.id)}">설치 계획 취소</button>`;card.append(panel);}});};
function openInstall(id){const r=reqCache.find(x=>x.id===id);if(!r||!requireAdmin())return;$('#installForm').reset();$('#installForm').requestId.value=id;$('#installArtwork').textContent=`${r.title} → ${locName(r.locationId)}`;$('#installError').textContent='';showModal('#installModal');}

async function renderReviews(){
  if(!isAdmin())return;
  try{const {proposals}=await api('/api/ai-proposals');$('#reviewList').innerHTML=proposals.filter(p=>p.status==='pending').map(p=>`<article class="card review-card"><h2>${esc(p.title)}</h2><p>${esc(p.author||'탈퇴 회원')}의 수정 제안 · ${fmt(p.created_at)}</p><p class="hint">등록된 작가 설명·제작 정보와 대조한 뒤 공개해 주세요.</p>${Object.entries(p.content).map(([k,v])=>`<h3>${{full:'전시 해설',easy:'쉬운 설명',caption:'한 줄 캡션'}[k]}</h3><p class="preserve-lines">${esc(v)}</p>`).join('')}<button class="btn ghost" data-open="${esc(p.artwork_id)}">원본 작품 확인</button><button class="btn primary" data-review-id="${esc(p.id)}" data-review-action="approve">검수 완료 · 공개</button><button class="btn ghost" data-review-id="${esc(p.id)}" data-review-action="reject">반려</button></article>`).join('')||'<p class="empty">검수 대기 중인 제안이 없습니다.</p>';$('#editorArtist').innerHTML=experienceData.artists.map(a=>`<option>${esc(a.name)}</option>`).join('');fillArtistEditor();}catch(e){$('#reviewList').textContent=e.message;}
}
function fillArtistEditor(){const f=$('#artistEditor'),p=experienceData.artistDrafts?.[f.artist.value]||{};f.story.value=p.story||'';f.interview.value=p.interview||'';f.published.checked=!!p.published;f.consent.checked=false;}
async function exportMessages(){try{const {recent}=await api('/api/reactions/summary');const rows=[['작품','작가','감상','작성일'],...recent.map(r=>[r.title,getArt(r.artworkId)?.artist||'',r.comment,fmtDate(r.updatedAt)])];downloadCSV(rows,'작가에게 전하는 최근 감상.csv');toast('최근 감상 최대 30건을 내려받았습니다.');}catch(e){toast(e.message);}}
function downloadCSV(rows,name){const csv='\ufeff'+rows.map(r=>r.map(v=>{let value=String(v??'');if(/^[\s]*[=+@-]/.test(value))value="'"+value;return `"${value.replace(/"/g,'""')}"`;}).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);}

async function handleRoute(){
  if(routeBusy)return;routeBusy=true;routing=true;
  try{const hash=location.hash.slice(1), [path,query]=hash.split('?'),[kind,encoded]=path.split('/'),id=encoded?decodeURIComponent(encoded):'';
    if(kind==='art'&&id){closeModals();go('archive');openDetail(id);if(new URLSearchParams(query).get('source')==='qr')api(`/api/artworks/${encodeURIComponent(id)}/events`,{method:'POST',body:{kind:'qr'}}).catch(()=>{});}
    else if(kind==='exhibition'&&id){closeModals();go('exhibit');openViewer(id);}
    else if(kind==='artist'&&id)showArtist(id);
    else if(['home','archive','artists','map','saved','reviews','exhibit','stats','vision','register','location','members','requests'].includes(kind)){coreCloseModals();if(!$('#viewer').hidden)coreCloseViewer();go(kind);}
  }catch(e){toast('이 주소를 열 수 없습니다. 작품 목록에서 다시 선택해 주세요.');}
  finally{routing=false;routeBusy=false;}
}
function initExperience(){
  $('#contrastToggle').checked=!!pref.highContrast;$('#motionToggle').checked=!!pref.reduceMotion;
  const apply=()=>{document.documentElement.classList.toggle('high-contrast',!!pref.highContrast);document.documentElement.classList.toggle('reduce-motion',!!pref.reduceMotion);};apply();
  $('#contrastToggle').onchange=e=>{pref.highContrast=e.target.checked;savePref();apply();};$('#motionToggle').onchange=e=>{pref.reduceMotion=e.target.checked;savePref();apply();set3DAuto(false);};
  $('#regImage').addEventListener('change',()=>{if($('#regImage').files.length)$('#regForm').visualDescription.value='';});
  $('#clearFilters').onclick=()=>{$('#q').value='';$('#fTag').value='';$('#fLoc').value='';$('#fSort').value='featured';$('#photoOnly').checked=false;archiveLimit=24;renderArchive();};
  $('#photoOnly').onchange=()=>{archiveLimit=24;renderArchive();};$('#archiveMore').onclick=()=>{archiveLimit+=24;renderArchive();};
  ['#q','#fTag','#fLoc','#fSort'].forEach(s=>$(s).addEventListener('input',()=>{archiveLimit=24;renderArchive();}));
  $('#artistSearch').oninput=renderArtists;$('#impactPeriod').onchange=loadImpact;
  $('#openExPlanner').onclick=()=>{if(!requireLogin('로그인 후 전시를 기획할 수 있어요.'))return;$('#exPlanner').hidden=!$('#exPlanner').hidden;$('#exPlanner input').focus();};
  $('#exPickSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();$$('[data-pick-search]').forEach(n=>n.hidden=!n.dataset.pickSearch.toLowerCase().includes(q));};
  $('#startCourse').onclick=()=>startCourse($('#mapLocation').value);$('#editorArtist').onchange=fillArtistEditor;$('#exportMessages').onclick=exportMessages;
  $('#artistEditor').onsubmit=async e=>{e.preventDefault();const f=e.target;await withBusy(f,async()=>{try{await api('/api/artists/'+encodeURIComponent(f.artist.value),{method:'PATCH',body:{story:f.story.value,interview:f.interview.value,published:f.published.checked,consentConfirmed:f.consent.checked}});await loadExperience();$('#artistEditorError').textContent='';toast('작가 이야기를 저장했습니다.');}catch(e){$('#artistEditorError').textContent=e.message;}});};
  for(const id of ['shareModal','installModal']) { const modal=$('#'+id); const dismiss=e=>{e.stopPropagation();modal.hidden=true;document.body.style.overflow=$$('.modal:not([hidden])').length?'hidden':'';if(id==='shareModal'&&!$('#detailModal').hidden) $('#detailBody [data-share-art]')?.focus();};$('.close',modal).onclick=dismiss;modal.addEventListener('click',e=>{if(e.target===modal)dismiss(e);}); }
  $('#installForm').onsubmit=async e=>{e.preventDefault();const f=e.target;await withBusy(f,async()=>{try{if(!f.confirmed.checked||!f.photo.files[0])throw new Error('설치 사진과 실제 설치 확인이 필요합니다.');const image=await resizeImage(f.photo.files[0]);await api(`/api/requests/${encodeURIComponent(f.requestId.value)}/install`,{method:'POST',body:{image}});await Promise.all([loadRequests(),loadArtworks(),loadExperience()]);closeModals();renderRequests();toast('설치를 확인하고 작품 위치를 업데이트했습니다.');}catch(e){$('#installError').textContent=e.message;}});};
  document.addEventListener('click',async e=>{
    const n=e.target.closest('button');if(!n)return;
    try{
      if(n.dataset.artist)return showArtist(n.dataset.artist);
      if(n.dataset.bookmark)return toggleBookmark(n.dataset.bookmark);
      if(n.dataset.listen)return listenArtwork(n.dataset.listen);
      if(n.dataset.visual)return listenArtwork(n.dataset.visual,true);
      if(n.dataset.requestArt)return openRequest(n.dataset.requestArt);
      if(n.dataset.shareArt)return openShare('art',n.dataset.shareArt);
      if(n.dataset.shareEx)return openShare('exhibition',n.dataset.shareEx);
      if(n.hasAttribute('data-print-qr'))return window.print();
      if(n.hasAttribute('data-copy-link')){const value=$('#shareLink').value;try{await navigator.clipboard.writeText(value);toast('공유 주소를 복사했습니다.');}catch{$('#shareLink').focus();$('#shareLink').select();toast('선택된 주소를 복사해 주세요.');}return;}
      if(n.dataset.course)return startCourse(n.dataset.course);
      if(n.dataset.install)return openInstall(n.dataset.install);
      if(n.dataset.detailStep){const ids=detailOrder.includes(currentDetailId)?detailOrder:db.artworks.map(a=>a.id);const id=ids[ids.indexOf(currentDetailId)+Number(n.dataset.detailStep)];if(id)openDetail(id);return;}
      if(n.dataset.audio){if(!window.speechSynthesis)return; if(n.dataset.audio==='stop'){speechSynthesis.cancel();audio.utterance=null;audioStatus('재생 대기');}else if(speechSynthesis.speaking){if(speechSynthesis.paused){speechSynthesis.resume();audioStatus('재생 중');}else{speechSynthesis.pause();audioStatus('일시정지');}}return;}
      if(n.dataset.feature){await api(`/api/exhibitions/${n.dataset.feature}/feature`,{method:'POST'});await loadExperience();renderExhibit();toast('이달의 전시를 변경했습니다.');return;}
      if(n.dataset.serverDelex){if(!confirm('이 전시를 삭제할까요?'))return;await api('/api/exhibitions/'+n.dataset.serverDelex,{method:'DELETE'});await loadExperience();renderExhibit();return;}
      if(n.dataset.reviewId){await api(`/api/ai-proposals/${n.dataset.reviewId}/${n.dataset.reviewAction}`,{method:'POST'});await loadArtworks();renderReviews();toast(n.dataset.reviewAction==='approve'?'검수한 해설을 공개했습니다.':'제안을 반려했습니다.');return;}
    }catch(err){toast(err.message);}
  });
  document.addEventListener('change',e=>{if(e.target.matches('[data-audio-rate]')){audio.rate=Number(e.target.value);$$('[data-audio-rate]').forEach(n=>n.value=String(audio.rate));toast('다음 재생부터 선택한 속도를 사용합니다.');}});
  // 마우스 없이도 열린 대화상자 안에서 모든 조작에 접근합니다.
  document.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const dialogs=$$('.modal:not([hidden]), .viewer:not([hidden]), .viewer3d:not([hidden])');const dialog=dialogs.at(-1);if(!dialog)return;const items=$$('button:not(:disabled), a[href], input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',dialog).filter(n=>n.getClientRects().length);const first=items[0],last=items.at(-1);if(!first)return;if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}});
  let swipe=null;$('#viewer').addEventListener('touchstart',e=>{const t=e.changedTouches[0];swipe={x:t.clientX,y:t.clientY};},{passive:true});$('#viewer').addEventListener('touchend',e=>{if(!swipe)return;const t=e.changedTouches[0],dx=t.clientX-swipe.x,dy=t.clientY-swipe.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)stepSlide(dx<0?1:-1);swipe=null;},{passive:true});
  window.addEventListener('hashchange',handleRoute);
}

loadSession().then(()=>Promise.all([loadArtworks(),loadRequests(),loadExperience()])).then(async()=>{try{await migrateLocalExhibitions(me());await loadExperience();}catch(e){toast('기존 전시 이관을 완료하지 못했습니다. '+e.message);}const start=location.hash;routing=true;init();routing=false;initExperience();if(start)history.replaceState({},'',start);handleRoute();}).catch(e=>{const notice=document.createElement('div');notice.className='notice startup-error';notice.setAttribute('role','alert');notice.textContent='작품을 불러오지 못했습니다. 서버 실행 상태를 확인하고 새로고침해 주세요. '+e.message;$('#main').prepend(notice);});
