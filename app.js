
(() => {
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const FP = [['in','دخول'],['presence','تواجد'],['out','خروج']];
const FPN = Object.fromEntries(FP);
const KIND = {permission:'استئذان',exemption:'إعفاء بصمة',sick:'مرضية',vacation:'إجازة',mission:'مهمة رسمية'};
const FULLDAY = new Set(['sick','vacation','mission']);
// Shift types: start minute, 8 hours each
const SHIFT = {
  m:{n:'صبح', long:'خفارة صباحية', abbr:'ص', start:420},
  e:{n:'عصر', long:'خفارة مسائية', abbr:'ع', start:900},
  n:{n:'ليل', long:'خفارة ليلية', abbr:'ل', start:1380}
};
const SHIFT_H = 8;
const SHIFT_IC = {m:'☀️', e:'🌇', n:'🌙'};
// Roster: 5-day rotation. Reference = the date each crew had the 7:00AM shift in the Nov 2026 roster (days 1..5 = C,B,A,D,E)
const CREW_MORNING = {A:'2026-11-03', B:'2026-11-02', C:'2026-11-01', D:'2026-11-04', E:'2026-11-05'};
const PATTERN = ['m','e','n',null,null];
const DEFAULTS = {sickLimit:15,name:'',fullName:'',siteTarget:12,siteAllowance:200,team:[],crew:'D',trackFrom:'2026-11-12',grace:15,presAfter:120,presLen:60,permLimit:4};
const STC = {
  ok:['مكتملة','--ok','--ok-bg'], late:['تأخير','--late','--late-bg'], miss:['بصمة ناقصة','--miss','--miss-bg'],
  lateMiss:['تأخير + نقص','--miss','--miss-bg'], absent:['غياب','--absent','--absent-bg'], excused:['معذور','--excused','--excused-bg'],
  untracked:['غير مسجّلة','--rest','--rest-bg'], future:['قادمة','--primary','--primary-soft'], live:['جارية الآن','--primary','--primary-soft'], rest:['راحة','--rest','--rest-bg']
};

const S = {settings:{...DEFAULTS}, days:{}, leaves:[], visits:[], stations:[], plans:{}, members:[], db:null, dl:null, canWrite:true};
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parseISO(s); d.setDate(d.getDate()+n); return iso(d); };
const diffDays = (a,b) => Math.round((parseISO(b)-parseISO(a))/86400000);
const mins = t => { if(!t) return null; const [h,m] = t.split(':').map(Number); return h*60+m; };
const hhmm = m => { m = ((m%1440)+1440)%1440; return pad(Math.floor(m/60))+':'+pad(m%60); };
const fmtM = m => { m=Math.round(m); if (m<60) return m+' د'; const h=Math.floor(m/60), r=m%60; return h+' س'+(r?' '+r+' د':''); };
const nowHM = () => { const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const todayISO = () => iso(new Date());
const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = (s,opt={weekday:'long',day:'numeric',month:'long'}) => new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',opt).format(parseISO(s));
const to12 = t => { if(!t) return ''; let [h,m]=t.split(':').map(Number); const ap = h<12?'ص':'م'; h=h%12||12; return h+':'+pad(m)+' '+ap; };

let view = (() => { const t = new Date(); return {y:t.getFullYear(), m:t.getMonth()}; })();
let tab = 'home';

function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2200); }
function banner(msg){ const b=$('banner'); if(!msg){b.hidden=true;return;} b.textContent=msg; b.hidden=false; }

/* ---------- theme ---------- */
const ICONS = {
  auto:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark:'<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
};
const TLABEL = {auto:'المظهر: تلقائي',light:'المظهر: فاتح',dark:'المظهر: داكن'};
let theme = 'auto';
try { theme = localStorage.getItem('dawami.theme') || 'auto'; } catch(e){}
function applyTheme(){
  const r = document.documentElement;
  if (theme==='auto') { if (r.dataset.themeByPage) { delete r.dataset.theme; delete r.dataset.themeByPage; } }
  else { r.dataset.theme = theme; r.dataset.themeByPage = '1'; }
  $('themeBtn').innerHTML = ICONS[theme]; $('themeBtn').title = TLABEL[theme]; $('themeBtn').setAttribute('aria-label', TLABEL[theme]);
}
$('themeBtn').onclick = () => { theme = {auto:'light',light:'dark',dark:'auto'}[theme]; try{localStorage.setItem('dawami.theme',theme);}catch(e){} applyTheme(); toast(TLABEL[theme]); };
applyTheme();

/* ---------- roster ---------- */
function scheduledShift(date){
  const ref = CREW_MORNING[S.settings.crew] || CREW_MORNING.D;
  const i = ((diffDays(ref, date) % 5) + 5) % 5;
  return PATTERN[i];
}
function shiftOf(date){
  const t = S.days[date]?.type;
  if (t==='off') return null;
  if (SHIFT[t]) return t;
  return scheduledShift(date);
}
function startMs(date, k){ const d = parseISO(date); d.setMinutes(SHIFT[k].start); return d.getTime(); }
// "HH:MM" -> minutes relative to the shift start, resolving midnight wrap
function rel(t, k, kind){
  let r = (((mins(t) - SHIFT[k].start) % 1440) + 1440) % 1440;
  if (r > SHIFT_H*60 + 600) r -= 1440;          // a bit before the start
  if (kind==='in' && r > 1440-180) r -= 1440;
  return r;
}
function leavesOn(date){ return S.leaves.filter(l => l.from <= date && date <= (l.to||l.from)); }

function evalDay(date){
  const st = S.settings, rec = S.days[date] || {};
  const k = shiftOf(date);
  const lv = leavesOn(date);
  const r = {date, k, duty:!!k, rec, lv, state:{}, lateMin:0, earlyMin:0, missing:0, missingKeys:[], notes:[], status:'rest', live:false};
  if (!k) return r;
  const H = SHIFT_H*60, s0 = startMs(date,k), now = Date.now();
  r.live = now >= s0 && now < s0 + H*60000;
  const full = lv.find(l => FULLDAY.has(l.kind));
  if (full) { r.status='excused'; r.excuseKind=full.kind; return r; }
  const grace = +st.grace||0, pA = +st.presAfter||120, pL = +st.presLen||60;
  const inR = rec.in ? rel(rec.in,k,'in') : null;
  const base = inR ?? 0;
  r.win = [base+pA, base+pA+pL];
  const ex = new Set(); let exLate=false, exEarly=false;
  r.visit = S.visits.find(v => claimOf(v)===date);
  for (const v of S.visits) { if (claimOf(v)!==date) continue; if (v.exemption==='inPres') { ex.add('in'); ex.add('presence'); exLate = true; } if (v.exemption==='out') { ex.add('out'); exEarly = true; } }
  for (const l of lv) {
    if (l.kind==='exemption') (l.covers||[]).forEach(x=>ex.add(x));
    if (l.kind==='permission' && l.t1 && l.t2) {
      const a = rel(l.t1,k,'in'), b = rel(l.t2,k,'out');
      if (a <= grace && b > 0) exLate = true;
      if (b >= H-1 && a < H) exEarly = true;
      if (a <= r.win[0] && b >= r.win[1]) ex.add('presence');
      if (a <= 0 && b >= H) { ex.add('in'); ex.add('out'); ex.add('presence'); }
    }
  }
  const deadline = {in: s0 + H*60000, presence: s0 + r.win[1]*60000, out: s0 + (H+60)*60000};
  let any = false;
  for (const [f] of FP) {
    if (rec[f]) { any = true; r.state[f] = 'done'; }
    else if (ex.has(f)) r.state[f] = 'exempt';
    else if (now < deadline[f]) r.state[f] = 'pending';
    else r.state[f] = 'missing';
  }
  if (rec.in && !exLate && !ex.has('in') && inR > grace) { r.lateMin = inR; r.state.in = 'late'; }
  if (rec.out && !exEarly && !ex.has('out')) { const o = rel(rec.out,k,'out'); if (o < H) r.earlyMin = H - o; }
  if (rec.presence && !ex.has('presence')) { const p = rel(rec.presence,k,'presence'); if (p < r.win[0] || p > r.win[1]) { r.state.presence='missing'; r.notes.push('التواجد خارج النافذة'); r.presOut = true; } }
  r.missingKeys = FP.map(a=>a[0]).filter(f => r.state[f]==='missing');
  r.missing = r.missingKeys.length;
  if (now < s0) { r.status = 'future'; return r; }
  if (!any && S.settings.trackFrom && date < S.settings.trackFrom) { r.status='untracked'; r.missing=0; r.missingKeys=[]; r.lateMin=0; return r; }
  if (!any && !r.live && !FP.some(([f]) => r.state[f]==='exempt')) { r.status='absent'; r.missing = 0; return r; }
  if (r.live && !r.lateMin && !r.missing) { r.status = 'live'; return r; }
  r.status = r.lateMin && r.missing ? 'lateMiss' : r.lateMin ? 'late' : r.missing ? 'miss' : 'ok';
  return r;
}

function monthDates(){ const n = new Date(view.y, view.m+1, 0).getDate(); return Array.from({length:n}, (_,i) => iso(new Date(view.y, view.m, i+1))); }
function currentShift(){
  const t = todayISO(), now = Date.now();
  for (const d of [addDays(t,-1), t]) { const k = shiftOf(d); if (k) { const s = startMs(d,k); if (now >= s && now < s + SHIFT_H*3600000) return d; } }
  return null;
}
function nextShift(){ const t = todayISO(); for (let i=0;i<60;i++){ const d=addDays(t,i), k=shiftOf(d); if (k && startMs(d,k) > Date.now()) return d; } return null; }
function lastShift(){ const t = todayISO(); for (let i=0;i<60;i++){ const d=addDays(t,-i), k=shiftOf(d); if (k && startMs(d,k)+SHIFT_H*3600000 <= Date.now()) return d; } return null; }
function shiftRange(k){ return to12(hhmm(SHIFT[k].start))+' – '+to12(hhmm(SHIFT[k].start+SHIFT_H*60)); }

/* ---------- render ---------- */
function render(){
  $('who').textContent = (S.settings.name ? S.settings.name+' · ' : '') + 'نوبة '+(S.settings.crew||'D')+' · وزارة الكهرباء والماء';
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab===tab ? 'page' : 'false'));
  document.querySelectorAll('[data-view]').forEach(v => v.hidden = v.dataset.view !== tab);
  const evs = monthDates().map(evalDay);
  if (tab==='home') { renderHero(); renderTodo(); renderOverview(); }
  if (tab==='calendar') { renderCal(evs); renderList(evs); }
  if (tab==='leaves') renderLeaves();
  if (tab==='sites') renderSites();
}

function winText(e){ const s = SHIFT[e.k].start; return to12(hhmm(s+e.win[0]))+' – '+to12(hhmm(s+e.win[1])); }
function slotHTML(e, f, nextKey){
  const st = e.state[f] || 'pending';
  let v = e.rec[f] ? to12(e.rec[f]) : st==='exempt' ? 'معفاة' : st==='missing' ? 'ناقصة' : '—';
  const cls = st==='done'?'done':st==='late'?'done late':st==='missing'?'missing':st==='exempt'?'exempt':'';
  let hint = '';
  if (f==='presence' && !e.rec.presence && st==='pending') hint = winText(e);
  if (f==='presence' && e.presOut) hint = 'خارج النافذة';
  if (f==='in' && e.lateMin) hint = 'تأخير '+fmtM(e.lateMin);
  if (f==='out' && e.earlyMin) hint = 'مبكر '+fmtM(e.earlyMin);
  return `<div class="slot ${cls} ${nextKey===f?'next':''}"><span class="k">${FPN[f]}</span><span class="v">${esc(v)}</span>${hint?`<span class="xs muted">${esc(hint)}</span>`:''}</div>`;
}

function renderHero(){
  const h = $('hero');
  const cur = currentShift();
  h.classList.toggle('live', !!cur); h.classList.toggle('rest', !cur);
  if (cur) {
    const e = evalDay(cur), k = e.k;
    const s0 = startMs(cur,k), pct = Math.min(100, Math.max(0, (Date.now()-s0)/(SHIFT_H*36000)));
    const nk = FP.map(a=>a[0]).find(f => e.state[f]==='pending') || '';
    h.innerHTML = `<div class="card-head"><div class="state" style="color:var(--ok)"><span class="pulse"></span>${SHIFT[k].long} · الآن</div><span class="xs muted">${fmtDate(cur)}</span></div>
      <div class="big-t">${nk ? 'البصمة القادمة: '+FPN[nk] : 'سجّلت كل بصمات الخفارة'}</div>
      ${nk==='presence' ? `<p class="muted">نافذة التواجد ${winText(e)}</p>` : ''}
      <div><div class="timeline"><span style="background:var(--primary-soft)"></span><i class="now" style="right:calc(${pct}% - 1px)"></i></div></div>
      <div class="tl-labels"><span>${to12(hhmm(SHIFT[k].start))}</span><span>${to12(hhmm(SHIFT[k].start+SHIFT_H*60))}</span></div>
      <div class="row3">${FP.map(([f])=>slotHTML(e,f,nk)).join('')}</div>
      ${S.canWrite ? `<div class="hero-actions">${nk ? `<button class="btn primary big" data-punch="${cur}|${nk}">سجّل بصمة ${FPN[nk]} الآن · ${to12(nowHM())}</button>` : ''}
        <button class="btn photo" data-fpup type="button">${CAM_IC} ${nk ? 'أو ارفع صورة البصمة من التطبيق' : 'ارفع صورة البصمة'}</button></div>` : ''}
      <button class="btn ghost" data-open="${cur}">تعديل أوقات هذه الخفارة</button>`;
    return;
  }
  const nx = nextShift(), last = lastShift();
  let left = '';
  if (nx) { const ms = startMs(nx, shiftOf(nx)) - Date.now(); const hrs = Math.floor(ms/3600000), d = Math.floor(hrs/24), hh = hrs%24, mm = Math.floor(ms/60000)%60;
    left = d ? `بعد ${d} ${d===1?'يوم':'أيام'} و${hh} ساعة` : hh ? `بعد ${hh} ساعة و${mm} دقيقة` : `بعد ${mm} دقيقة`; }
  let lastHTML = '';
  if (last) { const e = evalDay(last);
    lastHTML = `<button class="drow" data-open="${last}" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px">
      <div class="body"><span class="xs muted">آخر خفارة · ${SHIFT[e.k].long} · ${fmtDate(last,{weekday:'long',day:'numeric',month:'long'})}</span><div class="chips">${statusChips(e)}</div></div><span class="chev">‹</span></button>`; }
  const nk = nx ? shiftOf(nx) : null;
  h.innerHTML = `<div class="state" style="color:var(--muted)"><span class="pulse rest"></span>راحة</div>
    <div class="big-t">${nx ? SHIFT[nk].long+' '+fmtDate(nx,{weekday:'long'}) : 'لا توجد خفارة قادمة'}</div>
    ${nx ? `<p class="muted">${fmtDate(nx,{day:'numeric',month:'long'})} · ${shiftRange(nk)} · <b style="color:var(--primary)">${left}</b></p>` : ''}
    ${lastHTML}
    ${S.canWrite ? `<button class="btn photo wide" data-fpup type="button">${CAM_IC} ارفع صورة البصمة</button>` : ''}`;
}
const CAM_IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

/* push reminders */
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToU8 = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function pushSub(){ if (!pushOK()) return null; const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
async function renderNotif(){
  const hint = $('stNotifHint'); hint.hidden = true;
  let sub = null; try { sub = await pushSub(); } catch(e){}
  const on = !!sub && Notification.permission === 'granted';
  $('stNotifState').textContent = on ? '· شغالة' : '';
  $('stNotifOn').hidden = on; $('stNotifTest').hidden = !on; $('stNotifOff').hidden = !on;
  if (!pushOK()) { hint.hidden = false; hint.textContent = isIOS() && !isStandalone() ? 'على الآيفون: ثبّت الداشبورد في تلفونك أول (زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»)، وافتحه من الأيقونة، وبعدها فعّل التنبيهات.' : 'هالمتصفح ما يدعم التنبيهات.'; $('stNotifOn').hidden = true; }
  else if (Notification.permission === 'denied') { hint.hidden = false; hint.textContent = 'التنبيهات مقفلة للداشبورد من إعدادات الجهاز أو المتصفح. فعّلها من هناك وارجع هنا.'; }
}
$('stNotifOn').onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { renderNotif(); return; }
    const {data, error} = await sb.functions.invoke('push', {body:{action:'vapid'}}); if (error || !data?.key) throw error || new Error('no key');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64ToU8(data.key)});
    const j = sub.toJSON();
    const {error: e2} = await sb.from('push_subs').upsert({endpoint: j.endpoint, sub: j, user_id: S.uid}, {onConflict: 'endpoint'}); if (e2) throw e2;
    toast('تم تفعيل التنبيهات'); renderNotif();
  } catch(e) { toast('ما تفعّلت التنبيهات، جرّب مرة ثانية'); renderNotif(); }
};
$('stNotifTest').onclick = async () => {
  const {data, error} = await sb.functions.invoke('push', {body:{action:'test'}});
  toast(!error && data?.sent ? 'انرسل تنبيه التجربة' : 'ما وصل التنبيه. جرّب توقف التنبيهات وتفعّلها من جديد');
};
$('stNotifOff').onclick = async () => {
  try { const sub = await pushSub(); if (sub) { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); } toast('توقفت التنبيهات على هالجهاز'); } catch(e) {}
  renderNotif();
};

/* yearly fingerprint log with proof screenshots */
let logYear = new Date().getFullYear();
function renderLog(){
  const today = todayISO(), rows = [];
  for (let d = logYear+'-01-01'; d <= logYear+'-12-31' && d <= today; d = addDays(d,1)) {
    const e = evalDay(d); if (!e.duty || e.status==='future' || e.status==='untracked') continue; rows.push(e);
  }
  const sum = {att:0, late:0, lateMin:0, miss:0, absent:0, proofs:0};
  for (const e of rows) { if (e.status==='absent') sum.absent++; else if (e.status!=='excused') sum.att++; if (e.lateMin) { sum.late++; sum.lateMin += e.lateMin; } sum.miss += e.missing||0; sum.proofs += Object.keys(e.rec.proof||{}).length; }
  $('logTitle').textContent = 'سجل البصمات ' + logYear;
  $('logSub').textContent = (S.settings.fullName || S.settings.name || '') + ' · نوبة ' + (S.settings.crew||'D');
  $('logSum').innerHTML = [['حضور',sum.att],['تأخير',sum.late+(sum.lateMin?' ('+fmtM(sum.lateMin)+')':'')],['بصمات ناقصة',sum.miss],['غياب',sum.absent],['صور إثبات',sum.proofs]]
    .map(([l,v]) => `<div><span class="xs muted">${l}</span><b class="num">${v}</b></div>`).join('');
  if (!rows.length) { $('logBody').innerHTML = '<div class="empty">ما في خفارات مسجلة في هالسنة.</div>'; return; }
  let h = '', curM = -1;
  for (const e of rows.reverse()) {
    const m = +e.date.slice(5,7)-1;
    if (m !== curM) { if (curM !== -1) h += '</div>'; curM = m; h += `<h3 class="logm">${MONTHS[m]}</h3><div class="logtable">`; }
    const cell = f => {
      const t = e.rec[f], st = e.state[f], pd = !t && st==='exempt' && (e.rec.proof||{}).diwan, pr = (e.rec.proof||{})[f] || pd;
      const v = t ? to12(t) : st==='exempt' ? 'معفاة' : st==='missing' ? '✕' : '—';
      return `<span class="lc ${st==='missing'?'x':''}">${esc(v)}${pr ? ` <button type="button" class="proof" data-proof="${esc(pr)}" data-proof-t="${esc((pd ? 'موافقة الديوان' : FPN[f])+' '+fmtDate(e.date,{day:'numeric',month:'short'}))}" aria-label="صورة الإثبات">${CAM_IC}</button>` : ''}</span>`;
    };
    h += `<div class="logrow" role="button" tabindex="0" data-open="${e.date}"><span class="ld"><b>${+e.date.slice(8)}</b><small>${SHIFT[e.k].n}</small></span>${FP.map(([f]) => cell(f)).join('')}<span class="lst">${e.status==='excused' ? KIND[e.excuseKind] : e.status==='absent' ? 'غياب' : e.lateMin ? 'تأخير '+fmtM(e.lateMin) : e.missing ? 'ناقصة' : 'مكتملة'}</span></div>`;
  }
  h += '</div>';
  $('logBody').innerHTML = `<div class="logtable"><div class="logrow head"><span class="ld">اليوم</span>${FP.map(([,l]) => `<span class="lc">${l}</span>`).join('')}<span class="lst">الحالة</span></div></div>` + h;
}
$('logOpen').onclick = () => { logYear = view.y; renderLog(); $('logSheet').hidden = false; };
$('logPrint').onclick = () => { document.body.classList.add('printing-log'); window.print(); setTimeout(() => document.body.classList.remove('printing-log'), 500); };
window.addEventListener('afterprint', () => document.body.classList.remove('printing-log'));
document.addEventListener('click', async ev => {
  const y = ev.target.closest('[data-logyear]'); if (y) { logYear += +y.dataset.logyear; renderLog(); return; }
  const pb = ev.target.closest('[data-proof]'); if (!pb) return;
  ev.stopPropagation(); ev.preventDefault();
  $('proofTitle').textContent = (pb.dataset.proofT.startsWith('موافقة') ? '' : 'إثبات بصمة ') + pb.dataset.proofT; $('proofBody').textContent = 'جاري التحميل من الدرايف…'; $('proofSheet').hidden = false;
  try { const blob = await driveBlob(pb.dataset.proof); $('proofBody').innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="صورة الإثبات" style="width:100%;border-radius:12px">`; }
  catch(e) { $('proofBody').textContent = 'ما قدرت أحمّل الصورة من الدرايف.'; }
}, true);

/* PWA: service worker, install tip, images shared from other apps */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstallTip(); });
function renderInstallTip(){
  const el = $('installTip'); if (!el) return;
  let hidden = false; try { hidden = localStorage.getItem('mew.installSkip') === '1'; } catch(e){}
  if (isStandalone() || hidden || (!isIOS() && !installEvt)) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card tip"><div class="tip-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg></div>
    <div class="tip-tx"><b>ثبّت الداشبورد في تلفونك</b>
      <small>${isIOS() ? 'من Safari اضغط زر المشاركة <span class="ltr">⬆</span> ثم «إضافة إلى الشاشة الرئيسية». يفتح مثل التطبيق وتوصلك التنبيهات.' : 'يفتح مثل التطبيق، وتقدر تشارك صورة البصمة له مباشرة، وتوصلك التنبيهات.'}</small>
      <span class="actions">${installEvt ? '<button type="button" class="btn sm primary" id="installGo">ثبّت الحين</button>' : ''}<button type="button" class="btn sm" id="installSkip">لاحقاً</button></span></div></div>`;
}
document.addEventListener('click', async ev => {
  if (ev.target.id === 'installSkip') { try { localStorage.setItem('mew.installSkip','1'); } catch(e){} renderInstallTip(); }
  if (ev.target.id === 'installGo' && installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch(e){} installEvt = null; renderInstallTip(); }
});
async function takeSharedImage(){
  if (!new URLSearchParams(location.search).has('share') || !('caches' in window)) return;
  try { history.replaceState(null, '', location.pathname + '#home'); } catch(e){}
  try {
    const cache = await caches.open('mew-share'); const r = await cache.match('shared-image');
    if (!r) return; const blob = await r.blob(); await cache.delete('shared-image');
    setTab('home'); openFpFile(new File([blob], 'shared.jpg', {type: blob.type || 'image/jpeg'}));
  } catch(e) {}
}

/* «المطلوب منك»: what needs doing, newest first */
function renderTodo(){
  const items = [];
  const t = todayISO();
  for (let i=1;i<=31 && items.length<6;i++) {
    const d = addDays(t,-i); if (d < (S.settings.trackFrom||'')) break;
    const e = evalDay(d); if (!e.duty || ['excused','untracked','future','rest','live'].includes(e.status)) continue;
    const when = SHIFT[e.k].long+' '+fmtDate(d,{weekday:'long',day:'numeric',month:'short'});
    if (e.status==='absent') items.push({open:d, ic:'absent', t:'ما في أي بصمة مسجلة', s:when});
    else if (e.missingKeys && e.missingKeys.length) items.push({open:d, ic:'miss', t:`بصمة ${e.missingKeys.map(k=>FPN[k]).join(' و')} ناقصة`, s:when});
  }
  const vs = S.visits.filter(v => nextStep(v) && v.steps && v.steps.visited).sort((a,b) => (claimOf(b)||'').localeCompare(claimOf(a)||'')).slice(0,4);
  for (const v of vs) items.push({visit:v.id, ic:'late', t:`${vNames(v)||'زيارة'}: ${nextStep(v)[1]}`, s:'الخطوة الجاية للزيارة'});
  S.shares.filter(x => x.to_uid === S.uid && x.status === 'pending').forEach(x => items.unshift({tab:'sites', ic:'late', t:`${x.from_name||'زميلك'} شاركك زيارة`, s:'اقبلها أو ارفضها'}));
  if (!items.length) { $('todo').innerHTML = ''; return; }
  const shown = todoAll ? items : items.slice(0,3);
  $('todo').innerHTML = `<div class="card todo"><div class="card-head"><h2>المطلوب منك</h2><span class="xs muted">${items.length} ${items.length===1?'مهمة':items.length<=10?'مهام':'مهمة'}</span></div>
    ${shown.map(x => `<button class="todo-row" ${x.tab?`data-tab="${x.tab}"`:x.open?`data-open="${x.open}"`:`data-visit="${x.visit}"`}><i style="--c:var(--${x.ic})"></i><span><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span><span class="chev">‹</span></button>`).join('')}
    ${items.length > 3 ? `<button type="button" class="todo-more" id="todoMore">${todoAll ? 'عرض أقل' : 'عرض الكل ('+items.length+')'}</button>` : ''}</div>`;
}
let todoAll = false;
document.addEventListener('click', ev => { if (ev.target.id==='todoMore') { todoAll = !todoAll; renderTodo(); } });

function statusChips(e){
  const ch = (t,c) => `<span class="chip" style="--c:var(--${c});--cbg:var(--${c}-bg)">${t}</span>`;
  if (e.status==='excused') return ch(KIND[e.excuseKind],'excused');
  if (['future','live'].includes(e.status)) return `<span class="chip" style="--c:var(--primary);--cbg:var(--primary-soft)">${STC[e.status][0]}</span>`;
  if (['ok','absent','rest'].includes(e.status)) return ch(STC[e.status][0], e.status);
  if (e.status==='untracked') return ch(STC.untracked[0],'rest');
  let out = '';
  if (e.lateMin) out += ch('تأخير '+fmtM(e.lateMin),'late');
  if (e.missing) out += ch(e.missing+' بصمة ناقصة','miss');
  if (e.earlyMin) out += ch('خروج مبكر '+fmtM(e.earlyMin),'miss');
  return out;
}

function renderCal(evs){
  $('monthLabel').textContent = new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',{month:'long',year:'numeric'}).format(new Date(view.y,view.m,1));
  const first = new Date(view.y, view.m, 1).getDay();
  let h = DAYS.map(d => `<div class="dow">${d.replace('ال','')}</div>`).join('');
  for (let i=0;i<first;i++) h += '<div class="cell blank" aria-hidden="true"></div>';
  const t = todayISO();
  for (const e of evs) {
    const c = e.status==='excused' ? STC.excused : (STC[e.status]||STC.rest);
    const cls = ['cell', e.duty?'duty':'', e.status==='future'?'future':'', e.date===t?'today':''].join(' ');
    const mini = e.duty && e.status!=='future' && (e.lateMin||e.missing) ? `<span class="mini">${e.lateMin?'<b></b>':''}${e.missing?'<b></b><b></b>':''}</span>` : '';
    h += `<button class="${cls}" data-open="${e.date}" style="--c:var(${c[1]});--cbg:var(${c[2]})" aria-label="${fmtDate(e.date)}: ${e.duty?SHIFT[e.k].long+' '+c[0]:'راحة'}"><span class="d">${+e.date.slice(8)}</span>${e.duty?`<span class="ty"><i class="sic" aria-hidden="true">${SHIFT_IC[e.k]}</i>${SHIFT[e.k].n}</span>`:''}${mini}</button>`;
  }
  $('cal').innerHTML = h;
}

let showFuture = false;
function renderList(evs){
  const all = evs.filter(e => e.duty);
  if (!all.length) { $('dlist').innerHTML = '<div class="empty">لا توجد خفارات في هذا الشهر.</div>'; return; }
  const fut = all.filter(e => e.status==='future'), past = all.filter(e => e.status!=='future');
  const ds = showFuture || !past.length ? all : past.slice().reverse();
  const more = fut.length && past.length ? `<button type="button" class="btn ghost" id="toggleFuture">${showFuture ? 'إخفاء الخفارات القادمة' : 'عرض الخفارات القادمة ('+fut.length+')'}</button>` : '';
  $('dlist').innerHTML = ds.map(e => {
    let fps = '';
    if (e.status==='future') fps = `<span>${shiftRange(e.k)}</span>`;
    else if (e.status!=='excused') fps = FP.map(([f]) => e.rec[f] ? `<span>${FPN[f]} ${to12(e.rec[f])}</span>` : e.state[f]==='missing' ? `<span class="x">✕ ${FPN[f]}</span>` : e.state[f]==='exempt' ? `<span>${FPN[f]} معفاة</span>` : '').join('');
    const d = parseISO(e.date);
    return `<button class="drow" data-open="${e.date}"><span class="date"><b>${d.getDate()}</b><span>${DAYS[d.getDay()].replace('ال','')}</span></span>
      <span class="body"><span class="chips"><span class="chip" style="--c:var(--ink);--cbg:var(--sunk)">${SHIFT_IC[e.k]} ${SHIFT[e.k].n}</span>${statusChips(e)}${e.visit?'<span class="chip" style="--c:var(--primary);--cbg:var(--primary-soft)">زيارة موقع</span>':''}${e.visit && e.visit.exemption && e.visit.exemption!=='none' ? ((e.visit.steps||{}).diwanOk ? '<span class="chip" style="--c:var(--ok);--cbg:var(--ok-bg)">الإعفاء معتمد</span>' : '<span class="chip" style="--c:var(--late);--cbg:var(--late-bg)">الإعفاء بانتظار الديوان</span>') : ''}</span>${fps?`<span class="fprow">${fps}</span>`:''}${e.rec.note?`<span class="xs muted">${esc(e.rec.note)}</span>`:''}</span><span class="chev">‹</span></button>`;
  }).join('') + more;
}

function leaveDesc(l){
  let s = l.kind==='permission' || l.from===(l.to||l.from) ? fmtDate(l.from,{weekday:'short',day:'numeric',month:'short'}) : fmtDate(l.from,{day:'numeric',month:'short'})+' ← '+fmtDate(l.to,{day:'numeric',month:'short'});
  if (l.t1) s += ' · '+to12(l.t1)+' – '+to12(l.t2);
  if (l.kind==='exemption') s += ' · '+(l.covers||[]).map(k=>FPN[k]).join('، ');
  return s;
}
function renderLeaves(){
  const ym = view.y+'-'+pad(view.m+1);
  $('leavesTitle').textContent = 'سجل '+new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',{month:'long'}).format(new Date(view.y,view.m,1));
  const list = S.leaves.filter(l => l.from.slice(0,7) <= ym && (l.to||l.from).slice(0,7) >= ym).sort((a,b)=>a.from<b.from?-1:1);
  $('leaves').innerHTML = list.length ? list.map(l => `<div class="item"><div style="display:flex;flex-direction:column;gap:4px"><span class="chip" style="--c:var(--excused);--cbg:var(--excused-bg);align-self:flex-start">${KIND[l.kind]}</span>
    <span class="meta">${esc(leaveDesc(l))}</span>${l.note?`<span class="small">${esc(l.note)}</span>`:''}</div>
    ${S.canWrite?`<button class="btn sm danger" data-del-leave="${l.id}">حذف</button>`:''}</div>`).join('')
    : '<div class="empty">ما في استئذانات أو إعفاءات أو مرضيات هالشهر.<br>أي سجل تضيفه ينعكس على حساب التأخير والبصمات مباشرة.</div>';
}

/* ---------- shift editor ---------- */
let editing = null;
function openDuty(date){
  editing = date;
  const e = evalDay(date);
  const sch = scheduledShift(date);
  $('dutyTitle').textContent = fmtDate(date);
  $('dutySub').textContent = e.duty ? SHIFT[e.k].long+' · '+shiftRange(e.k) : 'يوم راحة';
  const ro = S.canWrite ? '' : 'disabled';
  const type = e.rec.type || '';
  const typeField = `<div class="field"><label for="d_type">الخفارة في هذا اليوم</label>
      <select id="d_type" ${ro}>
        <option value="">حسب الجدول (${sch?SHIFT[sch].long:'راحة'})</option>
        <option value="m" ${type==='m'?'selected':''}>صبح (تبديل أو إضافية)</option>
        <option value="e" ${type==='e'?'selected':''}>عصر (تبديل أو إضافية)</option>
        <option value="n" ${type==='n'?'selected':''}>ليل (تبديل أو إضافية)</option>
        <option value="off" ${type==='off'?'selected':''}>راحة (تبديل)</option>
      </select></div>`;
  $('dutyBody').innerHTML = `
    ${e.duty ? `<div class="chips">${statusChips(e)}</div>` : ''}
    ${e.duty ? '' : typeField}
    ${e.duty ? `<div class="seg-edit">
      <div class="fprows">${FP.map(([f,l]) => `<div class="fprow"><label class="flabel" for="t_${f}">${l}${e.state[f]==='exempt'?' <span class="xs muted">(معفاة)</span>':''}</label>
        <input type="time" id="t_${f}" value="${esc(e.rec[f]||'')}" ${ro}><button type="button" data-now="t_${f}" ${ro} aria-label="الوقت الحالي">الآن</button></div>`).join('')}</div>
      ${e.notes.length ? `<span class="xs" style="color:var(--late)">${e.notes.join(' · ')}</span>` : ''}
      ${e.win ? `<span class="xs muted">نافذة التواجد: ${winText(e)}</span>` : ''}
    </div>` : '<p class="small muted">إذا بدّلت مع أحد، اختر نوع الخفارة فوق واحفظ، وبعدها تقدر تسجل البصمات.</p>'}
    ${e.duty ? `<details class="st-sec"><summary>تبديل أو تغيير نوع الخفارة</summary><div class="st-body">${typeField}</div></details>` : ''}
    ${e.lv.length ? `<div class="chips">${e.lv.map(l=>`<span class="chip" style="--c:var(--excused);--cbg:var(--excused-bg)">${KIND[l.kind]}${l.t1?' '+to12(l.t1)+' – '+to12(l.t2):''}</span>`).join('')}</div>` : ''}
    <div class="field"><label for="d_note">ملاحظة</label><input id="d_note" value="${esc(e.rec.note||'')}" placeholder="مثال: عطل جهاز البصمة، بدّلت مع فلان" ${ro}></div>
    <button class="btn primary big" type="submit" ${ro}>حفظ</button>
    <div class="actions" style="justify-content:space-between">
      <button type="button" class="btn sm" data-leave-for="${date}" ${ro}>+ استئذان أو إعفاء لهذا اليوم</button>
      ${S.days[date] ? `<button type="button" class="btn sm danger" id="dutyDel" ${ro}>مسح البيانات</button>` : ''}
    </div>`;
  $('dutySheet').hidden = false;
}

/* ---------- writes ---------- */
async function write(fn, okMsg){
  if (!S.db) { toast('الحفظ غير متاح في هذا العرض'); return false; }
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch(err){
    if (err && err.code==='invalid_argument') { S.canWrite=false; render(); toast('ما عندك صلاحية تعديل هذه الصفحة'); }
    else if (err && err.code==='quota_exceeded') toast('امتلأت مساحة التخزين');
    else toast('تعذّر الحفظ، حاول مرة ثانية');
    return false;
  }
}
function recFor(date){ return S.days[date] ? {...S.days[date]} : {date}; }

/* ---------- events ---------- */
document.addEventListener('click', async ev => {
  const t = ev.target;
  const tb = t.closest('[data-tab]'); if (tb) { setTab(tb.dataset.tab); return; }
  if (t.closest('[data-close]')) { t.closest('.sheet-bg').hidden = true; return; }
  if (t.classList.contains('sheet-bg')) { t.hidden = true; return; }
  if (t.closest('[data-open-settings]')) { openSettings(); return; }
  const op = t.closest('[data-open]'); if (op) { $('logSheet').hidden = true; openDuty(op.dataset.open); return; }
  const nw = t.closest('[data-now]'); if (nw) { $(nw.dataset.now).value = nowHM(); return; }
  const pu = t.closest('[data-punch]');
  if (pu) { const [date,f] = pu.dataset.punch.split('|'); const r = recFor(date); r[f] = nowHM(); r.updatedAt = new Date().toISOString();
    await write(() => S.db.doc('days/'+date).set(r), 'تم تسجيل بصمة '+FPN[f]); return; }
  if (t.id==='dutyDel') { if (await write(() => S.db.doc('days/'+editing).delete(), 'تم المسح')) $('dutySheet').hidden = true; return; }
  const lf = t.closest('[data-leave-for]');
  if (lf) { $('dutySheet').hidden = true; setTab('leaves'); $('leaveF').hidden = false; $('lAddBtn').hidden = true; $('lFrom').value = lf.dataset.leaveFor; $('lTo').value = lf.dataset.leaveFor; $('lKind').focus(); return; }
  const dl = t.closest('[data-del-leave]');
  if (dl) { await write(() => S.db.doc('leaves/'+dl.dataset.delLeave).delete(), 'تم الحذف'); return; }
});
document.addEventListener('keydown', e => { if (e.key==='Escape') document.querySelectorAll('.sheet-bg').forEach(s => s.hidden = true); });

document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id==='dutyF') {
    const r = recFor(editing);
    for (const [k] of FP) { const el = $('t_'+k); if (!el) continue; if (el.value) r[k]=el.value; else delete r[k]; }
    const ty = $('d_type').value; if (ty) r.type = ty; else delete r.type;
    const n = $('d_note').value.trim(); if (n) r.note = n; else delete r.note;
    r.updatedAt = new Date().toISOString();
    if (await write(() => S.db.doc('days/'+editing).set(r), 'تم الحفظ')) $('dutySheet').hidden = true;
  }
  if (f.id==='leaveF') {
    const kind=$('lKind').value, from=$('lFrom').value; let to=$('lTo').value||from;
    if (!from) { toast('حدد التاريخ'); return; }
    if (to<from) to=from;
    const o = {kind, from, to: (kind==='permission'||kind==='exemption')?from:to, createdAt:new Date().toISOString()};
    if (kind==='permission') { o.t1=$('lT1').value; o.t2=$('lT2').value; if(!o.t1||!o.t2){toast('حدد وقت بداية ونهاية الاستئذان');return;} }
    if (kind==='exemption') { o.covers=[...document.querySelectorAll('#lCovers input:checked')].map(i=>i.value); if(!o.covers.length){toast('اختر البصمة المعفاة');return;} }
    const note=$('lNote').value.trim(); if(note) o.note=note;
    if (await write(() => S.db.collection('leaves').add(o), 'تمت الإضافة')) { f.reset(); syncLeaveForm(); f.hidden = true; $('lAddBtn').hidden = false; }
  }
  if (f.id==='settingsF') {
    const crew = (document.querySelector('#crewCtl input:checked')||{}).value || 'D';
    const o = {name:$('stName').value.trim(), crew, grace:+$('stGrace').value||0, presAfter:+$('stPA').value||0, presLen:+$('stPL').value||60, permLimit:+$('stPerm').value||0, trackFrom:$('stFrom').value};
    const all = {...S.ownSettings, ...o, fullName:$('stFull').value.trim(), siteTarget:+$('stTarget').value||12, siteAllowance:+$('stAllow').value||0, sickLimit:+$('stSick').value||15};
    if (!S.isAdmin) for (const k of RULE_KEYS) { if (S.rules && S.rules[k] != null) delete all[k]; }
    const ok = await write(async () => {
      await S.db.doc('settings/main').set(all);
      if (S.isAdmin) { const r = {}; for (const k of RULE_KEYS) r[k] = all[k]; const keep = (S.rules||{}).allowances; if (keep) { r.allowances = {...keep, [String(S.myIndex)]: all.siteAllowance}; r.siteAllowance = (S.rules||{}).siteAllowance ?? r.siteAllowance; } r.updatedAt = new Date().toISOString(); await S.db.doc('config/rules').set(r); }
    }, 'تم حفظ الإعدادات');
    if (ok) $('settingsSheet').hidden=true;
  }
});

function syncLeaveForm(){
  const k=$('lKind').value;
  if (!$('lFrom').value) $('lFrom').value = todayISO();
  $('lTimesWrap').hidden = k!=='permission';
  $('lCovers').hidden = k!=='exemption';
  $('lToWrap').hidden = k==='permission' || k==='exemption';
  $('lFromL').textContent = FULLDAY.has(k) ? 'من تاريخ' : 'تاريخ الخفارة';
}
$('lKind').addEventListener('change', syncLeaveForm); syncLeaveForm();
$('lAddBtn').onclick = () => { $('leaveF').hidden = false; $('lAddBtn').hidden = true; $('lKind').focus(); };
$('lCancel').onclick = () => { $('leaveF').reset(); syncLeaveForm(); $('leaveF').hidden = true; $('lAddBtn').hidden = false; };
document.addEventListener('click', ev => { const q = ev.target.closest('[data-qperm]'); if (!q) return;
  const d = $('lFrom').value || todayISO(), k = shiftOf(d);
  if (!k) { toast('هذا اليوم راحة في جدولك'); return; }
  const s = SHIFT[k].start, e = s + SHIFT_H*60;
  if (q.dataset.qperm==='first') { $('lT1').value = hhmm(s); $('lT2').value = hhmm(s+60); } else { $('lT1').value = hhmm(e-60); $('lT2').value = hhmm(e); } });

$('crewCtl').innerHTML = Object.keys(CREW_MORNING).map(c => `<label><input type="radio" name="crew" value="${c}">${c}</label>`).join('');
function openSettings(){
  const s=S.settings;
  $('stName').value=s.name||'';
  document.querySelectorAll('#crewCtl input').forEach(i => i.checked = i.value===(s.crew||'D'));
  $('stGrace').value=s.grace??15; $('stPA').value=s.presAfter??120; $('stPL').value=s.presLen??60; $('stPerm').value=s.permLimit??4; $('stFrom').value=s.trackFrom||'';
  $('stFull').value=s.fullName||''; $('stTarget').value=s.siteTarget||12; $('stAllow').value=s.siteAllowance??200; $('stSick').value=s.sickLimit??15;
  const locked = !S.isAdmin && !!S.rules;
  ['stGrace','stPA','stPL','stPerm','stTarget','stAllow','stSick'].forEach(id => $(id).disabled = locked);
  $('stRulesNote').textContent = S.isAdmin ? '· تنطبق على كل الفريق' : locked ? '· يحددها مدير الفريق' : '';
  $('stPw').value = '';
  renderNotif();
  renderMembers();
  $('settingsSheet').hidden=false;
}
$('settingsBtn').onclick = openSettings;
document.addEventListener('click', ev => { if (ev.target.id==='toggleFuture') { showFuture = !showFuture; render(); } });
$('stPwSave').onclick = async () => {
  const pw = $('stPw').value;
  if (pw.length < 6) { toast('كلمة السر لازم 6 أحرف أو أكثر'); return; }
  if (['123456','12345678','000000','111111'].includes(pw)) { toast('اختر كلمة سر غير الرمز المبدئي'); return; }
  const {error} = await sb.auth.updateUser({password: pw});
  if (error) { toast('ما تغيرت كلمة السر، جرّب مرة ثانية'); return; }
  $('stPw').value = ''; toast('تم تغيير كلمة السر');
};
$('stPk').onclick = async () => {
  if (!window.PublicKeyCredential) { toast('هالجهاز ما يدعم الدخول بالبصمة'); return; }
  try { const {error} = await sb.auth.registerPasskey(); if (error) throw error; try { localStorage.setItem('mew.pkReg','1'); } catch(e){} toast('تم. المرة الجاية ادخل ببصمة الوجه أو الإصبع'); }
  catch(e) { toast('ما تم التفعيل. جرّب مرة ثانية'); }
};
$('prev').onclick = () => { view.m--; if(view.m<0){view.m=11;view.y--;} render(); };
$('next').onclick = () => { view.m++; if(view.m>11){view.m=0;view.y++;} render(); };
$('todayBtn').onclick = () => { const t=new Date(); view={y:t.getFullYear(),m:t.getMonth()}; render(); };

const TABS = ['home','calendar','sites','leaves'];
function setTab(t){ if(!TABS.includes(t)) t='home'; tab=t; if (location.hash !== '#'+t) { try { history.replaceState(null,'','#'+t); } catch(e){ location.hash=t; } } render(); window.scrollTo(0,0); }
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h!==tab) { tab=h; render(); } });
{ const h = location.hash.slice(1); if (TABS.includes(h)) tab = h; }

$('bulkBtn').onclick = async () => {
  const lines = $('bulk').value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let ok=0; const bad=[];
  const norm = v => (v && /^\d{1,2}:\d{2}$/.test(v)) ? v.padStart(5,'0') : null;
  for (const line of lines) {
    const p = line.split(/[\s,;\t]+/);
    const date = p[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad.push(line); continue; }
    const r = recFor(date);
    FP.forEach(([k],i) => { const v = p[i+1]; const n = norm(v); if (n) r[k]=n; else if (v==='-') delete r[k]; });
    r.updatedAt = new Date().toISOString();
    if (await write(() => S.db.doc('days/'+date).set(r))) ok++; else break;
  }
  $('bulkMsg').textContent = `تم استيراد ${ok} خفارة` + (bad.length ? ` · ${bad.length} سطر غير مفهوم` : '');
  if (ok) $('bulk').value = bad.join('\n');
};

setInterval(() => { if (tab==='home' && document.visibilityState==='visible' && document.querySelectorAll('.sheet-bg:not([hidden])').length===0) renderHero(); }, 60000);

const TPL_SRC = 'data:image/jpeg;base64,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GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4GZd5Ohb4a8ayqnYKd8GmfMjWVU7BTvg0z5k2HAzLvJ0LfDXjWVU7BTvg0z5kayqnYKd8GmfMmw4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LviEnyqemMrveyWIxky9SeSP9KXfEA2vqrDk1TJuWaw5x1haE38V8UxhAq2gWYylWfkdGkNAlW14V5rSULhBeBKY7Ysxj7Et4AVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVpomVr3XTvCG/MDRMrXuuneEN+YLLAFaaJla9107whvzA0TK17rp3hDfmCywBWmiZWvddO8Ib8wNEyte66d4Q35gssAVnomVr3XTvCG/q5i61Y/KNX3pRyouSTuiLUpvDNITdiTdH/ACNuwt8DdojypTe5t7/svDU+YG9zb3/ZeGp8wXWDXIucqdOHClN7m3v+y8NT5gb3Nvf9l4anzBdYGRc5OnDhSm9zb3/ZeGp8wN7m3v8AsvDU+YLrAyLnJ04cKU3ube/7Lw1PmBvc29/2XhqfMF1gZFzk6cOFKb3Nvf8AZeGp8wN7m3v+y8NT5gusDIucnThwpTe5t7/svDU+YG9zb3/ZeGp8wXWBkXOTpw4Upvc29/2X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BZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBZYK0+2RyUduEt4O/wCQPtkclHbhLeDv+QBZYK0+2RyUduEt4O/5A+2RyUduEt4O/wCQBkMuvrQWt73OGudqfXuyZd76d4pZ2VnLvk4tFk2tFSaXaeWmZ2bkltMNZl2GJcffRcVradnOZaMmjnM/udTvZp9qBemQ/wC+/v6/8xZ5WORFOHdh39f+Ys4AAAAAAAADXTKHSKnW6tlSp9IknpybmJGUbQ00nEpZX1jd/iy1mZahU6wiXZGWcU6zp0gla0qj+UqH9DYmt5E6DXLRz1oFVe0klNz0EweTT6iqXRHDxbE7f1xPLvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTe6T7IztCp3JjXlDdJ9kZ2hU7kxryi5N4Oh9sttuXHhvB0Ptltty48BTK7Q/ZFOdFYCnK//AMYz5RhmbP5XbV5V7N2htLY+ZldCeZRjl5TAy22lXvxh/Ev/AHg6H2y225ceOU5BaKn757b8uv8A0gfORJEUrtji7Ovf0gWcRWweT2k5PJKblKXM1GZhNvxmHXJ5/PLiuP410P47e6SoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//2Q==';
const LOGO_SRC = 'data:image/jpeg;base64,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';
/* ---------- overview (month / year) ---------- */
let pmode = 'month';
try { pmode = localStorage.getItem('dawami.pmode') || 'month'; } catch(e){}
const MONTHS = Array.from({length:12}, (_,i) => new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',{month:'long'}).format(new Date(2026,i,1)));
function datesOfMonth(y,m){ const n = new Date(y,m+1,0).getDate(); return Array.from({length:n}, (_,i) => iso(new Date(y,m,i+1))); }
function overlapDays(a1,a2,b1,b2){ const s = a1>b1?a1:b1, e = a2<b2?a2:b2; return e<s ? 0 : diffDays(s,e)+1; }
function monthStats(y,m){
  const ds = datesOfMonth(y,m), start = ds[0], end = ds[ds.length-1], ym = start.slice(0,7);
  const evs = ds.map(evalDay).filter(e => e.duty);
  const c = k => evs.filter(e => e.status===k).length;
  const sum = f => evs.reduce((a,e) => a+(e[f]||0), 0);
  const st = {duties:evs.length, ok:c('ok')+c('live'), lateOnly:c('late'), miss:c('miss')+c('lateMiss'), absent:c('absent'), excused:c('excused'), future:c('future'), untracked:c('untracked'),
    late:evs.filter(e=>e.lateMin>0).length, lateMin:sum('lateMin'), missFp:sum('missing'), missShifts:evs.filter(e=>e.missing>0).length,
    early:evs.filter(e=>e.earlyMin>0).length, earlyMin:sum('earlyMin')};
  st.attended = st.ok + st.lateOnly + st.miss;
  const inP = l => l.from >= start && l.from <= end;
  const perms = S.leaves.filter(l => l.kind==='permission' && inP(l));
  st.perms = perms.length;
  st.permMin = perms.reduce((a,l)=>{ let d=(mins(l.t2)||0)-(mins(l.t1)||0); if(d<0)d+=1440; return a+d; },0);
  const days = k => S.leaves.filter(l => l.kind===k).reduce((a,l) => a+overlapDays(l.from, l.to||l.from, start, end), 0);
  st.sick = days('sick'); st.vac = days('vacation'); st.mission = days('mission');
  st.exempt = S.leaves.filter(l => l.kind==='exemption' && inP(l)).length;
  const vs = visitsIn(ym), target = +S.settings.siteTarget||12, per = (+S.settings.siteAllowance||0)/target;
  st.visits = vs.length; st.approved = vs.filter(v => (v.steps||{}).diwanOk).length; st.pending = vs.length - st.approved;
  st.earned = Math.min(vs.length,target)*per; st.targetHit = vs.length>=target ? 1 : 0;
  return st;
}
function sumStats(list){ const o = {}; for (const s of list) for (const k in s) o[k] = (o[k]||0) + s[k]; return o; }
const pct = (a,b) => b ? Math.round(a/b*100) : null;
const kwd = n => (Math.round(n*100)/100).toFixed(n%1 ? 2 : 0);
function ringSVG(frac, big, small, color='--ok'){
  const R = 46, C = 2*Math.PI*R, f = Math.max(0, Math.min(1, frac||0));
  return `<svg viewBox="0 0 110 110" class="ring" aria-hidden="true"><circle cx="55" cy="55" r="${R}" stroke="var(--sunk)"/>${f>0?`<circle cx="55" cy="55" r="${R}" stroke="var(${color})" stroke-dasharray="${C*f} ${C}" transform="rotate(-90 55 55)" stroke-linecap="round"/>`:''}
    <text x="55" y="${small?52:63}" text-anchor="middle" class="ring-n" style="font-size:${String(big).length>3?24:30}px">${big}</text>${small?`<text x="55" y="72" text-anchor="middle" class="ring-s">${small}</text>`:''}</svg>`;
}
function meter(label, value, frac, note, color='--primary'){
  return `<div class="mrow"><div class="mtop"><span>${label}</span><b>${value}</b></div>${frac!=null?`<div class="bar"><i style="width:${Math.min(100,Math.max(0,frac*100))}%;background:var(${color})"></i></div>`:''}${note?`<span class="xs muted">${note}</span>`:''}</div>`;
}
function renderOverview(){
  document.querySelectorAll('#modeCtl input').forEach(i => i.checked = i.value===pmode);
  const year = pmode==='year';
  const months = Array.from({length:12}, (_,m) => monthStats(view.y, m));
  const st = year ? sumStats(months) : months[view.m];
  const ytd = sumStats(months);
  $('periodLabel').textContent = year ? 'سنة '+view.y : MONTHS[view.m]+' '+view.y;
  const due = st.attended + st.absent, rate = pct(st.attended, due);
  const target = +S.settings.siteTarget||12, allow = +S.settings.siteAllowance||0, sickLimit = +S.settings.sickLimit||15, permLimit = +S.settings.permLimit||0;
  const segs = [['ok','مكتملة','--ok'],['lateOnly','تأخير','--late'],['miss','بصمة ناقصة','--miss'],['absent','غياب','--absent'],['excused','معذور','--excused'],['untracked','غير مسجّلة','--rest'],['future','قادمة','--primary-soft']].filter(s => st[s[0]]>0);
  const verdict = rate==null ? 'ما في خفارات محسوبة للحين' : rate===100 && !st.late && !st.missFp ? 'التزام كامل، بدون تأخير ولا نقص' : rate===100 ? 'داومت كل خفاراتك' : `غبت عن ${st.absent} ${st.absent===1?'خفارة':'خفارات'}`;
  let h = `<div class="card">
    <div class="card-head"><h2>الحضور والدوام</h2><span class="xs muted">${st.duties} خفارة في ${year?'السنة':'الشهر'}</span></div>
    <div class="att"><div class="att-ring">${ringSVG(rate==null ? 0 : rate/100, rate==null ? '—' : rate+'%', 'حضور', rate!=null && rate<90 ? '--late' : '--ok')}</div>
      <div><div class="money"><span class="num">${st.attended}</span> <small>من ${due} خفارة مضت</small></div>
        <div class="small">${verdict}${st.future ? ' · <span class="muted">باقي '+st.future+' قادمة</span>' : ''}${st.excused ? ' · <span class="muted">'+st.excused+' بعذر</span>' : ''}</div></div></div>
    ${st.duties ? `<div class="strip" role="img" aria-label="توزيع الخفارات حسب الحالة">${segs.map(s=>`<i style="flex:${st[s[0]]};background:var(${s[2]})" title="${s[1]}: ${st[s[0]]}"></i>`).join('')}</div>
    <div class="legend">${segs.map(s=>`<span><i style="--c:var(${s[2]})"></i>${s[1]} <b class="num">${st[s[0]]}</b></span>`).join('')}</div>` : ''}
  </div>`;

  const tile = (l,v,s,c,bad) => `<button type="button" class="kpi" data-tab="calendar" style="--k:var(${v?c:'--rest'})"><span class="top"><i style="background:var(${v?c:'--line'})"></i>${l}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  h += `<div class="kpis">
    ${tile('التأخير', st.late, st.lateMin ? 'المجموع '+fmtM(st.lateMin) : 'ما في تأخير', '--late')}
    ${tile('بصمات ناقصة', st.missFp, st.missFp ? 'في '+st.missShifts+' خفارة' : 'كل البصمات مسجلة', '--miss')}
    ${tile('غياب', st.absent, st.absent ? 'خفارة بدون أي بصمة' : 'ما في غياب', '--absent')}
    ${tile('خروج مبكر', st.early, st.earlyMin ? 'المجموع '+fmtM(st.earlyMin) : 'ما في خروج مبكر', '--miss')}
  </div>`;

  const sickLeft = sickLimit - ytd.sick;
  const permTxt = permLimit && !year ? `${st.perms} من ${permLimit}` : String(st.perms);
  const extra = [[st.vac,'يوم إجازة'],[st.mission,'يوم مهمة'],[st.exempt,'إعفاء بصمة']].filter(x=>x[0]>0);
  h += `<div class="card"><div class="card-head"><h2>الإجازات والاستئذانات</h2><button class="btn sm" data-tab="leaves">+ إضافة</button></div>
    <div class="lvline">
      <div><span class="xs muted">الاستئذانات ${year?'بالسنة':'هالشهر'}</span><b class="num" style="color:var(${permLimit && !year && st.perms>=permLimit?'--absent':'--ink'})">${permTxt}</b></div>
      <div><span class="xs muted">المرضيات في ${view.y}</span><b class="num" style="color:var(${ytd.sick>sickLimit?'--absent':ytd.sick>=sickLimit*0.8?'--late':'--ink'})">${ytd.sick} من ${sickLimit}</b></div>
      ${extra.map(x=>`<div><span class="xs muted">${x[1]}</span><b class="num">${x[0]}</b></div>`).join('')}
    </div>
    ${sickLeft < 0 ? `<p class="xs" style="color:var(--absent)">تجاوزت حد المرضيات بـ ${-sickLeft} يوم</p>` : ''}
  </div>`;

  if (year) {
    const hit = st.targetHit, maxAllow = allow*12;
    h += `<div class="card"><div class="card-head"><h2>زيارات المواقع</h2><button class="btn sm" data-tab="sites">فتح</button></div>
      <div class="sprog">${ringSVG(st.visits/(target*12), st.visits, 'زيارة', '--primary')}
        <div class="sprog-txt"><div class="xs muted">بدل الموقع المستحق في ${view.y}</div><div class="money"><span class="num">${kwd(st.earned)}</span> <small>د.ك</small></div>
          <div class="xs muted">اكتمل العدد في ${hit} ${hit===1?'شهر':'أشهر'} · ${st.approved} معتمدة بالديوان</div></div></div></div>`;
    h += `<div class="card"><div class="card-head"><h2>شهر بشهر</h2><span class="xs muted">اضغط الشهر لتفاصيله</span></div>
      <div class="ytable"><div class="yrow yhead"><span>الشهر</span><span>الحضور</span><span>تأخير</span><span>مواقع</span></div>
      ${months.map((s,m) => { const d = s.attended+s.absent, r = pct(s.attended,d); return `<button class="yrow" data-goto-month="${m}"><span>${MONTHS[m]}</span>
        <span class="ybar"><span class="bar"><i style="width:${r??0}%;background:var(${r!=null&&r<90?'--late':'--ok'})"></i></span><b class="num">${r==null?'—':r+'%'}</b></span>
        <span class="num">${d ? s.late : '—'}</span><span class="num">${s.visits}/${target}</span></button>`; }).join('')}</div></div>`;
  } else {
    h += `<div class="card"><div class="card-head"><h2>زيارات المواقع</h2><button class="btn sm" data-tab="sites">فتح</button></div>
      <div class="sprog">${ringSVG(st.visits/target, st.visits, 'من '+target, '--primary')}
        <div class="sprog-txt"><div class="xs muted">بدل الموقع لهذا الشهر</div><div class="money"><span class="num">${kwd(st.earned)}</span> <small>من ${allow} د.ك</small></div>
          <div class="xs muted">${st.visits>=target ? 'اكتمل العدد المطلوب' : 'باقي '+(target-st.visits)+' '+(target-st.visits===1?'موقع':'مواقع')}${st.pending ? ' · '+st.pending+' تنتظر الاعتماد' : ''}</div></div></div></div>`;
  }
  $('ov').innerHTML = h;
}
document.addEventListener('change', ev => { if (ev.target.name==='pmode') { pmode = ev.target.value; try { localStorage.setItem('dawami.pmode', pmode); } catch(e){} render(); } });
document.addEventListener('click', ev => {
  const p = ev.target.closest('[data-period]');
  if (p) { const d = +p.dataset.period; if (pmode==='year') view.y += d; else { view.m += d; if (view.m<0){view.m=11;view.y--;} if (view.m>11){view.m=0;view.y++;} } render(); return; }
  const g = ev.target.closest('[data-goto-month]');
  if (g) { view.m = +g.dataset.gotoMonth; pmode = 'month'; try { localStorage.setItem('dawami.pmode', pmode); } catch(e){} render(); window.scrollTo(0,0); }
});

/* ---------- normalisation: Arabic digits -> English, old checklist wording ---------- */
const ar2en = t => String(t ?? '').replace(/[٠-٩]/g, c => c.charCodeAt(0) - 1632).replace(/[۰-۹]/g, c => c.charCodeAt(0) - 1776).replace(/٫/g, '.');
const LEGACY_OBS = {'يوجد نفايات بجانب المحطة وتم اللازم':'يوجد نفايات بجانب المحطة', 'يوجد أنقاض أمام المحطة أو حولها':'يوجد أنقاض', 'يوجد أنقاض أمام المحطة':'يوجد أنقاض'};
const fixObs = x => LEGACY_OBS[x] || x;
const normSt = o => { if (!o) return o; const r = {...o}; for (const k of ['stationName','name','block','street']) if (r[k] != null) r[k] = ar2en(r[k]); return r; };
function normVisit(d){
  const r = normSt(d);
  if (Array.isArray(r.checks)) r.checks = r.checks.map(fixObs);
  if (r.desc) r.desc = String(r.desc).split('\n').map(fixObs).join('\n');
  if (r.s2) { r.s2 = normSt(r.s2); if (Array.isArray(r.s2.checks)) r.s2.checks = r.s2.checks.map(fixObs); if (r.s2.desc) r.s2.desc = String(r.s2.desc).split('\n').map(fixObs).join('\n'); }
  return r;
}

/* ---------- visit photos + checklist ---------- */
const OBS = ['المحطة سليمة خارجياً (لا يوجد ملاحظات)','السور الخارجي سليم','السور الخارجي متضرر وبحاجة إلى صيانة','القفل سليم','القفل تالف أو غير موجود','باب المحطة غير محكم الإغلاق','يوجد نفايات بجانب المحطة','يوجد أنقاض','يوجد كتابات أو ملصقات على جدران المحطة','يوجد تجمع مياه حول المحطة','لوحة اسم المحطة غير موجودة أو غير واضحة','يوجد سيارات أو عوائق تسد مدخل المحطة','يوجد تعديات على المحطة','تم إبلاغ الجهة المختصة بالملاحظات'];
let vPhotos = [];   // {id?, url, blob?, busy?}
// only problems are listed; anything not ticked counts as fine
const NEG = [[2,'السور متضرر'],[4,'القفل تالف أو مفقود'],[5,'الباب غير محكم الإغلاق'],[6,'نفايات'],[7,'أنقاض'],[8,'كتابات أو ملصقات'],[9,'تجمع مياه'],[10,'لوحة الاسم مفقودة أو غير واضحة'],[11,'عوائق تسد المدخل'],[12,'تعديات'],[13,'تم إبلاغ الجهة المختصة']];
const negHtml = checks => NEG.map(([i,l]) => `<label class="negck"><input type="checkbox" value="${i}" ${checks.includes(OBS[i])?'checked':''}><span>${l}</span></label>`).join('');
const readNeg = box => { const c = [...document.querySelectorAll(box+' input:checked')].map(i => OBS[+i.value]); return c.filter(x => x !== OBS[13]).length ? c : [OBS[0], ...c]; };
function setObs(v){
  let checks = v.checks, extra = v.extra;
  if (!checks) { const lines = (v.desc||'').split(/\n+/).map(s=>s.trim()).filter(Boolean); checks = lines.filter(l => OBS.includes(l)); extra = lines.filter(l => !OBS.includes(l)).join('\n'); }
  $('v_obs').innerHTML = negHtml(checks);
  $('v_desc').value = extra||'';
}
function getObs(){ return readNeg('#v_obs'); }
function setObs2(s){
  $('v2_obs').innerHTML = negHtml(s.checks || []);
  $('v2_desc').value = s.extra||'';
}
function getObs2(){ return readNeg('#v2_obs'); }
const vNames = v => [v.stationName, v.s2 && v.s2.stationName].filter(Boolean).join(' و ');
const stationsOf = v => [{stationName:v.stationName, area:v.area, block:v.block, street:v.street, stType:v.stType, desc:v.desc, checks:v.checks, extra:v.extra, full:v.full},
  ...(v.s2 && v.s2.stationName ? [v.s2] : [])];
function renderPhotos(){
  $('v_photos').innerHTML = vPhotos.map((p,i) => `<div class="ph"><img src="${p.url||'data:image/gif;base64,R0lGODlhAQABAAAAACw='}" alt="صورة ${i+1}">${p.busy?'<span class="phb">يرفع…</span>':''}<button type="button" data-del-photo="${i}" aria-label="حذف الصورة">×</button></div>`).join('');
  $('v_photoNote').textContent = vPhotos.length ? `${vPhotos.length} ${vPhotos.length===1?'صورة':'صور'} · تنضاف للتقرير بعد صفحة النموذج` : 'صوّر المحطة أو اختر من الاستديو. الصور تنضاف للـ PDF تلقائياً.';
}
function loadImg(src){ return new Promise((res,rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function shrink(file){
  const u = URL.createObjectURL(file);
  try { const img = await loadImg(u); const k = Math.min(1, 1600/Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
  } finally { URL.revokeObjectURL(u); }
}
// GPS from the photo's EXIF (read from the original file, the resized copy has no metadata)
async function exifGps(file){
  try {
    const buf = await file.slice(0, 262144).arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < dv.byteLength) {
      const mk = dv.getUint16(o), len = dv.getUint16(o+2);
      if (mk === 0xFFE1 && dv.getUint32(o+4) === 0x45786966) { // "Exif"
        const t = o + 10, le = dv.getUint16(t) === 0x4949, u16 = x => dv.getUint16(t+x, le), u32 = x => dv.getUint32(t+x, le);
        const ifd = (off) => { const n = u16(off), m = {}; for (let i=0;i<n;i++) { const e = off+2+i*12; m[u16(e)] = {type:u16(e+2), cnt:u32(e+4), val:e+8}; } return m; };
        const i0 = ifd(u32(4)); if (!i0[0x8825]) return null;
        const g = ifd(u32(i0[0x8825].val));
        const ref = tg => String.fromCharCode(dv.getUint8(t + g[tg].val));
        const rat = tg => { let a = u32(g[tg].val); const r = []; for (let i=0;i<3;i++) { const n = u32(a+i*8), d = u32(a+i*8+4); r.push(d ? n/d : 0); } return r[0] + r[1]/60 + r[2]/3600; };
        if (!g[2] || !g[4]) return null;
        let lat = rat(2), lng = rat(4); if (g[1] && ref(1) === 'S') lat = -lat; if (g[3] && ref(3) === 'W') lng = -lng;
        if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) return null;
        return {lat: lat.toFixed(6), lng: lng.toFixed(6)};
      }
      if ((mk & 0xFF00) !== 0xFF00) break; o += 2 + len;
    }
  } catch(e){}
  return null;
}
const vGeo = {1:null, 2:null};
const gmap = g => g ? `https://www.google.com/maps?q=${encodeURIComponent(g.lat+','+g.lng)}` : '';
function renderGeo(){
  for (const n of [1,2]) { const el = $(n===1 ? 'v_geo' : 'v2_geo'); if (!el) continue; const g = vGeo[n];
    el.innerHTML = g ? `<a class="btn sm primary" href="${gmap(g)}" target="_blank" rel="noopener">📍 افتح موقع المحطة في خرائط جوجل</a><button type="button" class="btn sm" data-geoclear="${n}">مسح</button>`
      : `<button type="button" class="btn sm" data-geonow="${n}">📍 حدّد موقعي الحين كموقع للمحطة</button><span class="xs muted">أو يؤخذ تلقائياً من موقع تصوير الصورة</span>`; }
}
document.addEventListener('click', ev => {
  const c = ev.target.closest('[data-geoclear]'); if (c) { vGeo[c.dataset.geoclear] = null; renderGeo(); return; }
  const b = ev.target.closest('[data-geonow]'); if (!b) return;
  if (!navigator.geolocation) { toast('هالجهاز ما يدعم تحديد الموقع'); return; }
  b.disabled = true; b.textContent = 'جاري تحديد الموقع…';
  navigator.geolocation.getCurrentPosition(pos => { vGeo[b.dataset.geonow] = {lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6)}; renderGeo(); toast('انحفظ موقعك للمحطة'); },
    () => { toast('ما قدرت أحدد موقعك، فعّل الموقع للمتصفح'); renderGeo(); }, {enableHighAccuracy:true, timeout:15000});
});
async function addPhotos(files){
  for (const f of files) {
    if (vPhotos.length >= 8) { toast('الحد ٨ صور للزيارة'); break; }
    const gps = await exifGps(f);
    if (gps) { const n = !vGeo[1] ? 1 : (!vGeo[2] && $('v2Sec') && !$('v2Sec').hidden ? 2 : 0); if (n) { vGeo[n] = gps; renderGeo(); toast(n===1 ? 'أخذت موقع المحطة من الصورة' : 'أخذت موقع المحطة الثانية من الصورة'); } }
    let blob; try { blob = await shrink(f); } catch(e) { toast('تعذّر قراءة الصورة'); continue; }
    const p = {blob, url: URL.createObjectURL(blob), busy: !!S.assets};
    vPhotos.push(p); renderPhotos();
    if (S.assets) { try { const r = await S.assets.upload(blob, {type:'image/jpeg'}); p.id = r.id; } catch(e) { toast('الصورة ما انحفظت بالسحابة، بس تقدر تنزل التقرير الحين'); } p.busy = false; renderPhotos(); }
  }
}
async function photoImages(){
  const out = [];
  for (const p of vPhotos) { try { let src = p.url; if (!p.blob && p.id) { const b = await driveBlob(p.id); p.blob = b; src = URL.createObjectURL(b); } out.push(await loadImg(src)); } catch(e){} }
  return out;
}
function photoPages(imgs, v, first=2){
  const W = 1240, H = 1754, pages = [];
  const F = (s,w=600) => `${w} ${s}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
  for (let i = 0; i < imgs.length; i += 2) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0,0,W,H);
    x.fillStyle = '#8eaadb'; x.fillRect(60,60,W-120,110);
    x.fillStyle = '#111'; x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = F(34); x.fillText('صور الموقع - '+(v.s2 && v.s2.stationName ? 'محطتي ' : 'محطة ')+vNames(v), W/2, 100);
    x.font = F(22,400); x.fillText([v.area, v.block?'قطعة '+v.block:'', v.street?'شارع '+v.street:'', fmtDMY(v.claimDate), v.visitTime?to12(v.visitTime):''].filter(Boolean).join(' · '), W/2, 145);
    [imgs[i], imgs[i+1]].forEach((img, j) => { if (!img) return;
      const bx = 60, by = 200 + j*750, bw = W-120, bh = 700;
      const k = Math.min(bw/img.naturalWidth, bh/img.naturalHeight), w = img.naturalWidth*k, hh = img.naturalHeight*k;
      x.drawImage(img, bx+(bw-w)/2, by+(bh-hh)/2, w, hh);
      x.strokeStyle = '#999'; x.lineWidth = 1; x.strokeRect(bx+(bw-w)/2, by+(bh-hh)/2, w, hh);
      x.fillStyle = '#333'; x.font = F(20,400); x.fillText('صورة '+(i+j+1), W/2, by+bh+22);
    });
    x.fillStyle = '#555'; x.font = F(18,400); x.fillText((S.settings.fullName||S.settings.name||'')+' · صفحة '+(i/2+first), W/2, H-50);
    pages.push(c);
  }
  return pages;
}
document.addEventListener('change', ev => { if (ev.target.id==='v_file' || ev.target.id==='v_cam') { const fs = [...ev.target.files]; ev.target.value = ''; addPhotos(fs); } });
document.addEventListener('click', ev => {
  const d = ev.target.closest('[data-del-photo]');
  if (d) { const p = vPhotos.splice(+d.dataset.delPhoto, 1)[0]; if (p && p.id && S.assets) S.assets.delete(p.id).catch(()=>{}); renderPhotos(); }
});

/* ---------- site visits ---------- */
const STEPS = [['visited','الزيارة والفحص'],['photo','تصوير المحطة'],['sent','رفع التقرير بالتراسل'],['mgmt','اعتماد الإدارة'],['diwan','التقديم بالديوان'],['diwanOk','موافقة الديوان']];
const STEP_NEXT = {visited:'زرت المحطة وفحصتها',photo:'صوّرت المحطة',sent:'رفعت التقرير بالتراسل',mgmt:'اعتمدته الإدارة',diwan:'قدّمته بالديوان',diwanOk:'وافق الديوان'};
const STEP_SHORT = ['زيارة','تصوير','تراسل','الإدارة','الديوان','موافقة'];
const EXN = {inPres:'إعفاء الحضور والتواجد', out:'إعفاء الانصراف'};
const PRESETS = ['المحطة سليمة خارجياً (لا يوجد ملاحظات)','يوجد نفايات بجانب المحطة','يوجد أنقاض','السور الخارجي بحاجة إلى صيانة','القفل تالف أو غير موجود','الباب غير محكم الإغلاق'];
const memberLabel = m => m.name || ((m.email||'').endsWith('@mew-team.app') ? 'عضو' : (m.email||'').split('@')[0]);
const teamNames = () => { const a=[]; S.members.forEach(m => a[m.idx]=memberLabel(m)); return Array.from(a, x => x||'(محذوف)'); };
const team = () => { if (S.members.length) return teamNames(); const t = S.settings.team && S.settings.team.length ? S.settings.team.slice() : []; while (t.length<5) t.push(t.length===0 ? (S.settings.name||'أنا') : 'زميل '+(t.length+1)); return t; };
const ymOf = () => view.y+'-'+pad(view.m+1);
const claimOf = v => v.claimDate || v.visitDate || '';
const nextStep = v => STEPS.find(([k]) => !(v.steps||{})[k]);
const visitsIn = ym => S.visits.filter(v => claimOf(v).startsWith(ym)).sort((a,b)=> claimOf(a)<claimOf(b)?-1:1);
const prevYm = ym => { let [y,m] = ym.split('-').map(Number); m--; if(!m){m=12;y--;} return y+'-'+pad(m); };
const planOf = ym => (S.plans[ym] && S.plans[ym].assign) || {};
const stationById = id => S.stations.find(s => s.id===id);
const mapUrl = s => s && s.lat && s.lng ? `https://www.google.com/maps?q=${encodeURIComponent(s.lat+','+s.lng)}` : '';
const diwanNote = v => `الكشف على ${v.s2 && v.s2.stationName ? 'محطتي' : 'محطة'} ${vNames(v)}${v.area?' في '+v.area:''}`;
function fmtDMY(d){ if(!d) return ''; const [y,m,dd] = d.split('-'); return `${+dd}/${+m}/${y}`; }

let sview = 'visits';
document.addEventListener('change', ev => { if (ev.target.name==='sview') { sview = ev.target.value; render(); } });
function renderSites(){
  document.querySelectorAll('[data-sv]').forEach(c => c.hidden = S.isAdmin && c.dataset.sv !== sview);
  const ym = ymOf();
  $('sMonthLabel').textContent = new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',{month:'long',year:'numeric'}).format(new Date(view.y,view.m,1));
  const vs = visitsIn(ym);
  const target = +S.settings.siteTarget||12, allow = +S.settings.siteAllowance||200, per = allow/target;
  const n = vs.length, counted = Math.min(n,target), approved = vs.filter(v => (v.steps||{}).diwanOk).length;
  const earned = counted*per;
  const stuck = {}; vs.forEach(v => { const s = nextStep(v); if (s) stuck[s[0]] = (stuck[s[0]]||0)+1; });
  const R = 46, C = 2*Math.PI*R, frac = Math.min(1, n/target);
  $('sProg').innerHTML = `
    <svg viewBox="0 0 110 110" class="ring" aria-hidden="true"><circle cx="55" cy="55" r="${R}" stroke="var(--sunk)"/><circle cx="55" cy="55" r="${R}" stroke="var(--primary)" stroke-dasharray="${C*frac} ${C}" transform="rotate(-90 55 55)" stroke-linecap="round"/>
      <text x="55" y="52" text-anchor="middle" class="ring-n">${n}</text><text x="55" y="72" text-anchor="middle" class="ring-s">من ${target}</text></svg>
    <div class="sprog-txt">
      <div class="xs muted">بدل الموقع لهذا الشهر</div>
      <div class="money"><span class="num">${earned.toFixed(earned%1?2:0)}</span> <small>من ${allow} د.ك</small></div>
      <div class="xs muted">${n>=target ? 'اكتمل العدد المطلوب' : `باقي ${target-n} ${target-n===1?'موقع':'مواقع'} · كل موقع ${per.toFixed(2)} د.ك`}</div>
      <div class="xs" style="color:var(--ok)">${approved} معتمدة بالديوان${n>target?` · ${n-target} زيادة على المطلوب`:''}</div>
    </div>`;
  if (Object.keys(stuck).length) $('sProg').innerHTML += `<div class="stuck">${STEPS.filter(([k])=>stuck[k]).map(([k,l])=>`<span class="chip" style="--c:var(--late);--cbg:var(--late-bg)">${stuck[k]} بانتظار: ${l}</span>`).join('')}</div>`;

  const T = team();
  $('sVisits').innerHTML = vs.length ? vs.map(v => {
    const st = v.steps||{}, nx = nextStep(v);
    const dots = STEPS.map(([k,l],i) => `<span class="sd ${st[k]?'on':''} ${nx&&nx[0]===k?'cur':''}"><i></i><small>${STEP_SHORT[i]}</small></span>`).join('');
    return `<div class="visit">
      <button class="vmain" data-visit="${v.id}">
        <span class="vtop"><b>${esc(vNames(v)||'محطة')}</b><span class="xs muted">${fmtDate(claimOf(v),{weekday:'short',day:'numeric',month:'short'})}${v.visitDate && v.visitDate!==claimOf(v) ? ' · زرتها '+fmtDate(v.visitDate,{day:'numeric',month:'short'}) : ''}</span></span>
        <span class="stepdots">${dots}</span>
        <span class="chips">${nx ? `<span class="chip" style="--c:var(--late);--cbg:var(--late-bg)">الخطوة الجاية: ${nx[1]}</span>` : `<span class="chip" style="--c:var(--ok);--cbg:var(--ok-bg)">مكتملة</span>`}
          ${v.exemption && v.exemption!=='none' ? `<span class="chip" style="--c:var(--excused);--cbg:var(--excused-bg)">${EXN[v.exemption]}</span>` : ''}
          ${(v.photos||[]).length ? `<span class="chip">${v.photos.length} صور</span>` : ''}
          ${v.partner!=null && v.partner!=='' ? `<span class="chip">مع ${esc(T[+v.partner]||'')}</span>` : ''}${sharesOf(v.id).map(x => `<span class="chip" style="--c:${SH_ST[x.status][1]};--cbg:${SH_ST[x.status][2]}">${esc(T[x.to_idx]||'الزميل')}: ${SH_ST[x.status][0]}</span>`).join('')}${v.sharedFrom ? `<span class="chip">مشتركة من ${esc(v.sharedFrom.name||'زميل')}</span>` : ''}</span>
      </button>
      ${nx && S.canWrite ? `<button class="btn primary stepgo" data-step="${v.id}|${nx[0]}"><span class="stepck-ic" aria-hidden="true">✓</span>اضغط إذا ${STEP_NEXT[nx[0]]}</button>` : ''}
    </div>`; }).join('')
    : `<div class="empty">ما سجلت زيارات هالشهر.<br>بعد ما تزور أي محطة، سجّلها من زر "تسجيل زيارة موقع" فوق.</div>`;

  renderCover();
  renderTeamProgress(ym, target);
  renderShares();
  refreshTeamData();
  renderReports();
  renderStations();
}

/* ---------- coverage: which stations the team has (not) inspected ---------- */
S.cover = {}; S.shares = []; S.here = null; let nearMode = false, moreN = 5, tdAt = 0, tdBusy = false, teamProg = null;
const daysAgo = d => d ? Math.round((parseISO(todayISO()) - parseISO(d)) / 864e5) : null;
const covOf = s => S.cover[s.id] || null;
const covAge = s => { const c = covOf(s); return c ? daysAgo(c.last) : null; };
const covTier = s => { const a = covAge(s); return a == null || a > 60 ? 'old' : a > 30 ? 'mid' : 'new'; };
const coverRank = s => { const a = covAge(s); return a == null ? 9999 : a; }; // higher = needs a visit sooner
const TIER = {new:['var(--ok)','var(--ok-bg)','حديثة'], mid:['var(--late)','var(--late-bg)','تقترب'], old:['var(--absent)','var(--absent-bg)','تحتاج كشف']};
const ageTxt = a => a == null ? 'ما انكشفت لحد الحين' : a === 0 ? 'انكشفت اليوم' : a === 1 ? 'انكشفت أمس' : `آخر كشف قبل ${a} يوم`;
function lastChip(s){
  const t = TIER[covTier(s)], c = covOf(s);
  return `<span class="chip" style="--c:${t[0]};--cbg:${t[1]}">${ageTxt(covAge(s))}</span>${c && c.last ? `<span class="xs muted">${fmtDate(c.last,{day:'numeric',month:'short'})}${c.by?' · '+esc(c.by):''}</span>` : ''}`;
}
const dirUrl = s => s.lat && s.lng ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat+','+s.lng)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((s.name||'')+' '+(s.area||'شرق')+' الكويت')}`;
function kmBetween(a, b){ const R = 6371, r = x => x*Math.PI/180, dLa = r(b.lat-a.lat), dLo = r(b.lng-a.lng); const h = Math.sin(dLa/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
const distOf = s => S.here && s.lat && s.lng && !isNaN(+s.lat) ? kmBetween(S.here, {lat:+s.lat, lng:+s.lng}) : null;
const distTxt = d => d == null ? '' : d < 1 ? `${Math.round(d*1000)} م` : `${d.toFixed(1)} كم`;
function renderCover(){
  const all = S.stations, ym = todayISO().slice(0,7);
  const el = $('sMine'); if (!el) return;
  if (!all.length) { $('sCover').innerHTML = ''; $('sMineCount').textContent = ''; el.innerHTML = '<div class="empty">ما في محطات مسجلة بعد. تنضاف تلقائي مع أول زيارة تسجلها.</div>'; $('sMore').hidden = true; $('sNear').hidden = true; return; }
  const tiers = {new:0, mid:0, old:0}; all.forEach(s => tiers[covTier(s)]++);
  const doneM = all.filter(s => (covOf(s)||{}).nm > 0).length;
  const seg = k => tiers[k] ? `<i style="width:${tiers[k]/all.length*100}%;background:${TIER[k][0]}"></i>` : '';
  $('sCover').innerHTML = `<div class="cov">
    <div class="xs muted">تمت تغطية <b style="color:var(--ink)">${doneM}</b> من ${all.length} محطة هالشهر · آخر كشف لكل محطة (الفريق كله)</div>
    <div class="covbar" role="img" aria-label="حالة التغطية">${seg('new')}${seg('mid')}${seg('old')}</div>
    <div class="covleg">${['old','mid','new'].map(k => `<span><em style="background:${TIER[k][0]}"></em>${TIER[k][2]} <b>${tiers[k]}</b></span>`).join('')}</div></div>`;
  let list = all.filter(s => !((covOf(s)||{}).nm > 0));
  $('sMineCount').textContent = list.length ? `${list.length} محطة` : '';
  if (nearMode && S.here) list.sort((a,b) => (distOf(a) ?? 1e9) - (distOf(b) ?? 1e9));
  else list.sort((a,b) => coverRank(b)-coverRank(a) || (+a.block||999)-(+b.block||999));
  if (!list.length) { el.innerHTML = '<div class="empty">كل المحطات انكشف عليها هالشهر. عاشت أيديكم.</div>'; $('sMore').hidden = true; $('sNear').hidden = true; return; }
  const shown = list.slice(0, moreN);
  el.innerHTML = shown.map(s => { const d = distOf(s); return `<div class="srow">
    <div class="top"><span class="stbody"><b>${esc(s.name)}</b><span class="xs muted">${esc(stAddr(s))}</span></span>${d != null ? `<span class="dist">${distTxt(d)}</span>` : ''}</div>
    <div class="chips">${lastChip(s)}</div>
    <div class="btns"><a class="btn sm" href="${dirUrl(s)}" target="_blank" rel="noopener">📍 اتجاهات</a>${S.canWrite ? `<button type="button" class="btn sm primary" data-visit-station="${s.id}">سجّل زيارة</button>` : ''}</div></div>`; }).join('');
  $('sMore').hidden = list.length <= moreN; $('sMore').textContent = `عرض المزيد (${list.length - moreN})`;
  $('sNear').hidden = false; $('sNear').textContent = nearMode ? 'حسب الأولوية' : 'الأقرب لي';
}
async function refreshTeamData(force){
  if (!S.uid || tdBusy || (!force && Date.now() - tdAt < 20000)) return;
  tdBusy = true; tdAt = Date.now();
  try {
    const [cv, sh, tp] = await Promise.all([
      sb.rpc('station_last_visits'), sb.from('visit_shares').select('*').order('created_at', {ascending:false}),
      S.isAdmin ? sb.rpc('team_progress', {p_ym: ymOf()}) : Promise.resolve({data:null})]);
    const before = JSON.stringify([S.cover, S.shares, teamProg]);
    if (!cv.error && cv.data) { S.cover = {}; cv.data.forEach(r => S.cover[r.station_id] = {last:r.last_date, by:r.last_by, n:r.n, nm:r.n_month}); }
    if (!sh.error && sh.data) S.shares = sh.data;
    if (tp.data) teamProg = tp.data;
    if (JSON.stringify([S.cover, S.shares, teamProg]) !== before && tab === 'sites') { renderCover(); renderTeamProgress(ymOf(), +S.settings.siteTarget||12); renderShares(); renderStations(); }
  } catch(e) { /* offline: keep the last data */ }
  tdBusy = false;
}
function renderTeamProgress(ym, target){
  const el = $('sTeam'); if (!el) return;
  if (!teamProg) { el.innerHTML = '<div class="empty">جاري التحميل…</div>'; return; }
  el.innerHTML = teamProg.map(r => `<div class="tm"><span class="av">${esc((r.name||'?').trim().charAt(0))}</span><span class="stbody"><b>${esc(r.name)}${r.idx===S.myIndex?' (أنت)':''}</b><span class="xs muted">${r.visits} من ${target} زيارة</span></span>
    <span class="bar"><i style="width:${Math.min(100,r.visits/target*100)}%"></i></span></div>`).join('');
  $('sTeamSub').textContent = `${teamProg.reduce((a,r)=>a+r.visits,0)} زيارة للفريق`;
}

/* ---------- sharing a visit with a partner ---------- */
const SH_ST = {pending:['بانتظار الرد','var(--late)','var(--late-bg)'], accepted:['قبلها','var(--ok)','var(--ok-bg)'], declined:['رفضها','var(--absent)','var(--absent-bg)']};
const sharesOf = vid => S.shares.filter(x => x.visit_id === vid && x.from_uid === S.uid);
function sharePayload(v){
  const {steps, partner, exemption, sharedFrom, reportFile, createdAt, updatedAt, id, ...rest} = v;
  return {...rest, fromIdx: S.myIndex};
}
async function sendShare(vid, v){
  if (v.partner == null || v.partner === '' || v.sharedFrom) return null;
  const {data, error} = await sb.rpc('share_visit', {p_visit_id: vid, p_to_idx: +v.partner, p_payload: sharePayload(v)});
  if (error) { toast('تعذّر إرسال الزيارة للزميل'); return null; }
  const i = S.shares.findIndex(x => x.id === data.id); if (i >= 0) S.shares[i] = data; else S.shares.unshift(data);
  return data;
}
function renderShareBox(){
  const box = $('v_shareBox'), p = $('v_partner').value;
  const v = editingVisit ? S.visits.find(x => x.id === editingVisit) : null;
  if (p === '' || (v && v.sharedFrom)) { box.hidden = true; return; }
  const T = team(), sh = v ? S.shares.find(x => x.visit_id === v.id && x.to_idx === +p && x.from_uid === S.uid) : null;
  box.hidden = false;
  if (!sh) box.innerHTML = `<span>بعد ما تحفظ، نرسل الزيارة لـ <b>${esc(T[+p]||'')}</b> يقبلها أو يرفضها. ما تتحدّث عنده تلقائي بعد الإرسال.</span>`;
  else { const st = SH_ST[sh.status]; box.innerHTML = `<span>مشاركة مع <b>${esc(T[+p]||'')}</b>: <span class="chip" style="--c:${st[1]};--cbg:${st[2]}">${st[0]}</span></span>${sh.status!=='accepted' ? `<button type="button" class="btn sm" id="v_resend">أعد الإرسال</button>` : '<span class="xs muted">انسخت عنده ولا تتحدث تلقائي.</span>'}`; }
}
function renderShares(){
  const mine = S.shares.filter(x => x.to_uid === S.uid && x.status === 'pending');
  $('sSharesCard').hidden = !mine.length || (S.isAdmin && sview !== 'visits');
  $('sShares').innerHTML = mine.map(x => { const pl = x.payload || {}; const names = [pl.stationName, pl.s2 && pl.s2.stationName].filter(Boolean).join(' + ');
    return `<div class="shrow"><div><b>${esc(x.from_name||'زميلك')}</b> شاركك زيارة<div class="xs muted">${esc(names||'محطة')} · ${fmtDate(pl.claimDate||pl.visitDate||todayISO(),{day:'numeric',month:'short'})} · ${(pl.photos||[]).length} صور</div></div>
      <div class="btns" style="display:flex;gap:8px"><button type="button" class="btn sm primary" data-share-accept="${x.id}" style="flex:1">قبول</button><button type="button" class="btn sm" data-share-decline="${x.id}" style="flex:1">رفض</button></div></div>`; }).join('');
}
let acceptingShare = null;
async function acceptShare(id){
  const x = S.shares.find(r => r.id === id); if (!x) return;
  const pl = x.payload || {}; const ps = (pl.photos||[]).length;
  $('shareMsg').textContent = ''; $('shareGo').disabled = false; $('share_ex').value = 'none';
  $('shareSub').textContent = `من ${x.from_name||'زميلك'} · ${[pl.stationName, pl.s2 && pl.s2.stationName].filter(Boolean).join(' + ')} · ${ps} صور`;
  acceptingShare = x; $('shareSheet').hidden = false;
}
async function doAccept(){
  const x = acceptingShare; if (!x) return; const pl = x.payload || {};
  $('shareGo').disabled = true;
  const o = {...pl, exemption: $('share_ex').value, partner: pl.fromIdx != null ? String(pl.fromIdx) : '', sharedFrom: {name: x.from_name||'', share: x.id}, photos: [], steps: {visited: pl.visitDate || todayISO()}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
  delete o.fromIdx;
  try {
    const src = pl.photos || [];
    for (let i = 0; i < src.length; i++) {
      $('shareMsg').textContent = `ننسخ الصور ${i+1} من ${src.length}…`;
      const blob = await driveBlob(src[i], x.id);
      const r = await driveUpload(blob, `صورة ${i+1} من ${x.from_name||'زميل'}.jpg`, blob.type || 'image/jpeg', o);
      o.photos.push(r.id); driveCache[r.id] = blob;
    }
    let ref; const ok = await write(async () => { ref = await S.db.collection('visits').add(o); });
    if (!ok || !ref) throw new Error('save');
    const {error} = await sb.rpc('respond_share', {p_id: x.id, p_accept: true, p_new_visit_id: ref.id});
    if (error) throw error;
    x.status = 'accepted'; $('shareSheet').hidden = true; acceptingShare = null; render(); toast('انضافت الزيارة لحسابك');
    openVisit(ref.id);
  } catch(e) { $('shareMsg').textContent = 'تعذّر نسخ الزيارة. حاول مرة ثانية.'; $('shareGo').disabled = false; }
}
function stAddr(s){ return [s.area||'شرق', s.block?'ق '+s.block:'', s.street?'ش '+s.street:'', s.addr||''].filter(Boolean).join(' · '); }
function renderStations(){
  const q = ($('stSearch').value||'').trim();
  const list = S.stations.filter(s => !q || (s.name||'').includes(q) || String(s.block||'')===q).sort((a,b) => coverRank(b)-coverRank(a) || (+a.block||999)-(+b.block||999) || (a.name||'').localeCompare(b.name||'','ar'));
  $('sStations').innerHTML = list.length ? `<div class="stlist">${list.map(s => `<div class="strow">
      <button class="stbody linkish" data-station="${s.id}"><b>${esc(s.name)}</b><span class="xs muted">${esc(stAddr(s))}${s.source==='prelim'?' · مبدئية':''}</span></button>
      ${mapUrl(s)?`<a class="btn sm" href="${mapUrl(s)}" target="_blank" rel="noopener">خريطة</a>`:''}
      <span class="lc">${lastChip(s)}</span>
    </div>`).join('')}</div>`
    : `<div class="empty">${q?'ما في نتائج.':'ما في محطات مسجلة. أضفها وحدة وحدة أو استورد القائمة الرسمية لما توصلك.'}</div>`;
}

/* visit editor */
let editingVisit = null;
async function ensureStations(o){
  const one = async (st, setId) => {
    if (!st || !st.stationName) return;
    const known = st.stationId && stationById(st.stationId);
    const needGeo = st.lat && st.lng && !(known && known.lat && known.lng);
    const needInfo = known && ((st.block && !known.block) || (st.street && !known.street));
    if (known && !needGeo && !needInfo) return;
    try {
      const {data, error} = await sb.rpc('upsert_station', {p_name: st.stationName, p_data: {area: st.area, block: st.block, street: st.street, lat: st.lat, lng: st.lng}});
      if (error) throw error;
      if (data && data.id) { setId(data.id); applyLocal('stations', data.id, data.data); }
    } catch(e) { /* the visit still saves; the station can be added from the list */ }
  };
  await one(o, id => { o.stationId = id; });
  if (o.s2) await one(o.s2, id => { o.s2.stationId = id; });
}
async function saveVisit(o, quiet){
  await ensureStations(o);
  let ok;
  if (editingVisit) ok = await write(() => S.db.doc('visits/'+editingVisit).set(o), quiet ? '' : 'تم حفظ الزيارة');
  else { let ref; ok = await write(async () => { ref = await S.db.collection('visits').add(o); }, quiet ? '' : 'تمت إضافة الزيارة'); if (ok && ref) editingVisit = ref.id; }
  if (ok && editingVisit) {
    if (o.partner !== '' && o.partner != null && !o.sharedFrom && !S.shares.some(x => x.visit_id === editingVisit && x.to_idx === +o.partner && x.from_uid === S.uid)) { const sh = await sendShare(editingVisit, o); if (sh) toast('أرسلنا الزيارة لزميلك'); }
    refreshTeamData(true);
  }
  return ok;
}
function openVisit(id, presetStation){
  const v = id ? {...S.visits.find(x=>x.id===id)} : {visitDate: todayISO(), claimDate: todayISO(), visitTime: nowHM(), workType:'كشف محطات', area:'شرق', exemption:'none', steps:{visited: todayISO()}, desc:''};
  if (!id && presetStation) { const s = stationById(presetStation); if (s) Object.assign(v,{stationId:s.id, stationName:s.name, block:s.block||'', street:s.street||'', area:s.area||'شرق'}); }
  editingVisit = id || null;
  $('visitTitle').textContent = id ? 'تعديل الزيارة' : 'زيارة موقع جديدة';
  const opts = S.stations.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar'));
  $('v_station').innerHTML = '<option value="">— اختر المحطة —</option>' + opts.map(s=>`<option value="${s.id}">${esc(s.name)}${s.block?' (ق '+esc(s.block)+')':''}</option>`).join('') + '<option value="__other">محطة غير موجودة بالقائمة</option>';
  $('v_station').value = v.stationId && stationById(v.stationId) ? v.stationId : (v.stationName ? '__other' : '');
  $('v_name').value = v.stationName||''; $('v_nameWrap').hidden = $('v_station').value!=='__other';
  const s2 = v.s2 || {};
  $('v2_station').innerHTML = $('v_station').innerHTML;
  $('v2_station').value = s2.stationId && stationById(s2.stationId) ? s2.stationId : (s2.stationName ? '__other' : '');
  $('v2_name').value = s2.stationName||''; $('v2_nameWrap').hidden = $('v2_station').value!=='__other';
  $('v2_area').value = s2.area||'شرق'; $('v2_block').value = s2.block||''; $('v2_street').value = s2.street||''; $('v2_stType').value = s2.stType||'sub';
  setObs2(s2);
  toggleV2();
  $('v_area').value = v.area||'شرق'; $('v_block').value = v.block||''; $('v_street').value = v.street||'';
  $('v_vdate').value = v.visitDate||''; $('v_time').value = v.visitTime||''; $('v_cdate').value = v.claimDate||v.visitDate||'';
  $('v_ex').value = v.exemption||'none'; $('v_type').value = v.workType||'كشف محطات';
  const T = team();
  $('v_partner').innerHTML = '<option value="">بروحي</option>' + T.map((n,i)=>[n,i]).filter(([,i]) => i !== S.myIndex).map(([n,i])=>`<option value="${i}">${esc(n)}</option>`).join('');
  $('v_partner').value = v.partner ?? ''; renderShareBox();
  vGeo[1] = v.lat ? {lat:v.lat, lng:v.lng} : null; vGeo[2] = v.s2 && v.s2.lat ? {lat:v.s2.lat, lng:v.s2.lng} : null; renderGeo();
  setObs(v); $('v_notes').value = v.notes||'';
  $('v_stType').value = v.stType||'sub'; $('v_full').checked = !!v.fullForm; renderFull(v.full || fullDefaults(v.checks || getObs()), s2.full || fullDefaults(s2.checks));
  vPhotos = (v.photos||[]).map(id => ({id, url:''})); renderPhotos(); hydratePhotos();
  const st = v.steps||{};
  $('v_steps').innerHTML = STEPS.map(([k,l],i) => `<label class="stepck"><input type="checkbox" id="vs_${k}" ${st[k]?'checked':''} data-date="${st[k]||''}"><span class="n">${i+1}</span><span>${l}</span>${typeof st[k]==='string'?`<span class="xs muted">${fmtDate(st[k],{day:'numeric',month:'short'})}</span>`:''}</label>`).join('');
  updateDiwan();
  $('v_del').hidden = !id;
  $('visitSheet').hidden = false;
}
function visitFromForm(){
  const sid = $('v_station').value;
  const s = sid && sid!=='__other' ? stationById(sid) : null;
  const old = editingVisit ? S.visits.find(x=>x.id===editingVisit) : null;
  const steps = {};
  STEPS.forEach(([k]) => { const el = $('vs_'+k); if (el.checked) steps[k] = el.dataset.date || todayISO(); });
  const o = {
    stationId: s ? s.id : '', stationName: s ? s.name : ar2en($('v_name').value.trim()),
    area: $('v_area').value.trim(), block: ar2en($('v_block').value.trim()), street: ar2en($('v_street').value.trim()),
    visitDate: $('v_vdate').value, visitTime: $('v_time').value, claimDate: $('v_cdate').value || $('v_vdate').value,
    exemption: $('v_ex').value, workType: $('v_type').value.trim(), partner: $('v_partner').value,
    checks: getObs(), extra: $('v_desc').value.trim(), desc: [...getObs(), ...$('v_desc').value.split(/\n+/).map(x=>x.trim()).filter(Boolean)].join('\n'),
    photos: vPhotos.filter(p=>p.id).map(p=>p.id), notes: $('v_notes').value.trim(), steps,
    lat: vGeo[1] ? vGeo[1].lat : '', lng: vGeo[1] ? vGeo[1].lng : '',
    stType: $('v_stType').value, fullForm: $('v_full').checked, full: getFull('fr_'), s2: station2FromForm(),
    createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  return o;
}
// two stations per trip are required from 15 Nov 2026; before that one station is enough
const TWO_FROM = '2026-11-15';
const needS2 = o => (o.visitDate || o.claimDate || todayISO()) >= TWO_FROM;
function toggleV2(){ const need = needS2({visitDate: $('v_vdate').value, claimDate: $('v_cdate').value}); const has = !!station2FromForm(); $('v2Sec').hidden = !need && !has; $('v2Req').textContent = need ? '' : '(اختياري قبل ١٥ نوفمبر)'; }
function station2FromForm(){
  const sid = $('v2_station').value, s = sid && sid!=='__other' ? stationById(sid) : null;
  const name = s ? s.name : ar2en($('v2_name').value.trim());
  if (!name) return null;
  const checks = getObs2(), extra = $('v2_desc').value.trim();
  return {stationId: s ? s.id : '', stationName: name, area: $('v2_area').value.trim(), block: ar2en($('v2_block').value.trim()), street: ar2en($('v2_street').value.trim()),
    lat: vGeo[2] ? vGeo[2].lat : '', lng: vGeo[2] ? vGeo[2].lng : '',
    stType: $('v2_stType').value, checks, extra, desc: [...checks, ...extra.split(/\n+/).map(x=>x.trim()).filter(Boolean)].join('\n'), full: getFull('fr2_')};
}
function updateDiwan(){
  const v = visitFromForm();
  const ex = v.exemption==='inPres' ? 'الحضور والتواجد' : v.exemption==='out' ? 'الانصراف' : 'حسب اختيارك';
  $('v_diwan').innerHTML = `<b class="small">للديوان: طلب مهمة رسمية ← إعفاء جزئي (${ex}) ← تاريخ ${fmtDMY(v.claimDate)||'—'}</b>
    <div class="copyrow"><span id="v_dnote">${esc(diwanNote(v))}</span><button type="button" class="btn sm" id="v_copy">نسخ الملاحظة</button></div>
    <span class="xs muted">المرفق: صورة التقرير بعد توقيع الإدارة (JPG).</span>`;
}

/* report drawing on the ministry template */
const TPL_W = 1135, TPL_H = 1486;
let tplImg = null;
function loadTpl(){ return tplImg ? Promise.resolve(tplImg) : new Promise((res,rej) => { const i = new Image(); i.onload = () => { tplImg = i; res(i); }; i.onerror = rej; i.src = TPL_SRC; }); }
async function drawReport(v, nPhotos=0){
  const img = await loadTpl();
  try { await document.fonts.load('600 22px "IBM Plex Sans Arabic"'); } catch(e){}
  const k = 2, c = document.createElement('canvas'); c.width = TPL_W*k; c.height = TPL_H*k;
  const x = c.getContext('2d'); x.scale(k,k); x.drawImage(img,0,0,TPL_W,TPL_H);
  x.fillStyle = '#0b2a78'; x.textBaseline = 'middle'; x.direction = 'rtl';
  const F = s => `600 ${s}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
  const put = (t, cx, cy, maxW, size=22) => { if (!t) return; let s = size; x.font = F(s); while (x.measureText(t).width > maxW && s > 11) { s--; x.font = F(s); } x.textAlign = 'center'; x.fillText(t, cx, cy); };
  // new template (Nov 2026): date + work type, then one table row PER station, signature by the section head only
  put(fmtDMY(v.claimDate), 786, 404, 170);
  put(v.workType, 282, 404, 440);
  const sts = stationsOf(v);
  const OK_LINES = new Set([OBS[0], OBS[1], OBS[3]]);
  const extraNotes = (v.notes||'').trim();
  const issuesOf = st => (st.desc||'').split(/\n+/).map(s=>s.trim()).filter(s => s && !OK_LINES.has(s)).length > 0;
  const rowY = [645, 702];
  sts.slice(0,2).forEach((st, i) => {
    const y = rowY[i], iss = issuesOf(st) || (i === 0 && !!extraNotes);
    put(st.area, 972, y, 200, 21);
    put(st.block, 778, y, 160, 21);
    put(st.street, 600, y, 170, 21);
    put(st.stationName, 403, y, 195, 21);
    put(iss ? 'يوجد ملاحظات مذكورة أدناه' : 'لا يوجد ملاحظات', 177, y, 230, 18);
  });
  // description on the dotted lines
  x.font = F(20); x.textAlign = 'right';
  const lines = [];
  const fixDesc = st => issuesOf(st) ? (st.desc||'').split('\n').map(s => s.trim()===OBS[0] ? 'المحطة سليمة خارجياً' : s).join('\n') : (st.desc||'');
  const descText = sts.length > 1 ? sts.map(st => `محطة ${st.stationName}:\n${fixDesc(st) || 'لا يوجد ملاحظات'}`).join('\n') : fixDesc(sts[0]);
  for (const para of (descText + (extraNotes ? '\n'+extraNotes : '') + (nPhotos ? '\nمرفق '+(nPhotos===1?'صورة واحدة':nPhotos+' صور')+' للموقع' : '')).split(/\n+/)) {
    let cur = '';
    for (const w of para.split(/\s+/)) { const t = cur ? cur+' '+w : w; if (x.measureText(t).width > 985 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
  }
  // the box holds 8 text rows between the dotted lines; longer text is packed tighter so it never leaves the frame
  const step = lines.length > 8 ? 226 / lines.length : 28.4, fs = Math.max(13, Math.min(20, step * 0.7));
  x.font = F(fs);
  lines.slice(0, 16).forEach((l,i) => x.fillText(l, 1068, 887 + i*step - (lines.length > 8 ? 4 : 0)));
  // employee name is left blank: it is added with the signature in the e-correspondence system
  return c;
}
/* extra forms: comprehensive inspection (optional, off by default) + stations summary (always) */
const FULL_ITEMS = [['wall','حائط'],['num','رقم المحطة'],['fence','سور المحطة'],['emerg','باب الطوارئ']];
const FULL_BAD_NOTE = {wall:'يوجد كتابات أو ملصقات', num:'اللوحة غير موجودة أو غير واضحة', fence:'بحاجة إلى صيانة', emerg:''};
const ST_TYPES = {sub:'محطة تحويل ثانوية', rmu:'وحدة توزيع متكاملة'};
const OBS_DEBRIS = 'يوجد أنقاض', OBS_MOD = 'يوجد تعديات على المحطة';
function fullDefaults(checks){ checks = checks||[]; return {wall: checks.includes(OBS[8])?'bad':'ok', num: checks.includes(OBS[10])?'bad':'ok', fence: checks.includes(OBS[2])?'bad':'ok', emerg:'ok'}; }
function renderFull(f, f2){
  $('v_fullBox').hidden = !$('v_full').checked;
  const rows = (pre, f) => FULL_ITEMS.map(([k,l]) => `<div class="fullrow"><span>${l}</span><div class="seg-ctl">
    <label><input type="radio" name="${pre}${k}" value="ok" ${f[k]!=='bad'?'checked':''}>سليم</label>
    <label><input type="radio" name="${pre}${k}" value="bad" ${f[k]==='bad'?'checked':''}>غير سليم</label></div></div>`).join('');
  $('v_fullRows').innerHTML = `<b class="small">المحطة الأولى</b>${rows('fr_', f)}<b class="small">المحطة الثانية</b>${rows('fr2_', f2 || fullDefaults([]))}`;
}
function getFull(pre){ const o = {}; FULL_ITEMS.forEach(([k]) => { const r = document.querySelector(`input[name="${pre}${k}"]:checked`); o[k] = r ? r.value : 'ok'; }); return o; }
const OK_OBS = () => new Set([OBS[0], OBS[1], OBS[3]]);
function visitIssues(v){ const ok = OK_OBS(); return (v.desc||'').split(/\n+/).map(s=>s.trim()).filter(s => s && !ok.has(s)); }
let logoImg = null;
function loadLogo(){ return logoImg ? Promise.resolve(logoImg) : loadImg(LOGO_SRC).then(i => (logoImg = i)); }
function formPage(){
  const W = 1240, H = 1754, k = 1.5, c = document.createElement('canvas'); c.width = W*k; c.height = H*k;
  const x = c.getContext('2d'); x.scale(k,k); x.fillStyle = '#fff'; x.fillRect(0,0,W,H); x.direction = 'rtl'; x.textBaseline = 'middle';
  return {c, x, W, H};
}
const FF = (s, w=600) => `${w} ${s}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
const INK = '#0b2a78';
function ftext(x, t, cx, cy, maxW, size=20, w=600, color='#111', align='center'){
  if (t==null || t==='') return; t = String(t); let s = size; x.font = FF(s,w);
  while (maxW && x.measureText(t).width > maxW && s > 12) { s--; x.font = FF(s,w); }
  x.fillStyle = color; x.textAlign = align;
  if (maxW && x.measureText(t).width > maxW && t.includes(' ')) { // still too long: two lines
    const ws = t.split(' '); let a = ''; while (ws.length && x.measureText(a ? a+' '+ws[0] : ws[0]).width <= maxW) a = a ? a+' '+ws.shift() : ws.shift();
    x.fillText(a, cx, cy - s*0.6); x.fillText(ws.join(' '), cx, cy + s*0.6); return;
  }
  x.fillText(t, cx, cy);
}
function ftick(x, cx, cy){ x.save(); x.strokeStyle = INK; x.lineWidth = 3.5; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(cx-11, cy); x.lineTo(cx-3, cy+9); x.lineTo(cx+13, cy-10); x.stroke(); x.restore(); }
function fdash(x, cx, cy){ x.save(); x.strokeStyle = '#444'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx-12, cy); x.lineTo(cx+12, cy); x.stroke(); x.restore(); }
// widths go right to left; a cell is a label string, {f:text} (filled in ink), '✓', '—', or {span:n, ...}
function ftable(x, right, y, widths, rows){
  for (const r of rows) {
    let cx = right, i = 0;
    while (i < widths.length) {
      const raw = r.cells[i]; const cellObj = raw && typeof raw === 'object' ? raw : {t: raw};
      const span = cellObj.span || 1; let w = 0; for (let j=0;j<span;j++) w += widths[i+j];
      const x0 = cx - w;
      if (r.fill) { x.fillStyle = r.fill; x.fillRect(x0, y, w, r.h); }
      x.strokeStyle = '#000'; x.lineWidth = 1.4; x.strokeRect(x0, y, w, r.h);
      const mid = x0 + w/2, my = y + r.h/2 + 1;
      const v = cellObj.f != null ? cellObj.f : cellObj.t;
      if (v === '✓') ftick(x, mid, my);
      else if (v === '—') fdash(x, mid, my);
      else ftext(x, v, mid, my, w-14, r.size || 19, r.bold ? 700 : (cellObj.f != null ? 600 : 500), cellObj.f != null ? INK : '#111');
      cx = x0; i += span;
    }
    y += r.h;
  }
  return y;
}
function fbar(x, L, R, y, h, t){ x.fillStyle = '#8eaadb'; x.fillRect(L, y, R-L, h); x.strokeStyle = '#000'; x.lineWidth = 1.4; x.strokeRect(L, y, R-L, h); ftext(x, t, (L+R)/2, y+h/2+1, 0, 24, 700); }
function fdots(x, R, L, y){ x.save(); x.strokeStyle = '#555'; x.lineWidth = 1.2; x.setLineDash([2,4]); x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); x.restore(); }

async function drawFullForm(v, st){
  st = st || stationsOf(v)[0];
  const logo = await loadLogo();
  try { await document.fonts.load('600 20px "IBM Plex Sans Arabic"'); } catch(e){}
  const {c, x, W} = formPage(), L = 60, R = W-60;
  x.strokeStyle = '#000'; x.lineWidth = 2; x.strokeRect(48, 48, W-96, 1650);
  x.lineWidth = 1.4; x.strokeRect(L, 60, R-L, 262);
  ftext(x, 'وزارة الكهرباء والماء والطاقة المتجددة', R-30, 110, 0, 24, 700, '#111', 'right');
  ftext(x, 'إدارة شبكات التوزيع الكهربائية', R-30, 170, 0, 23, 700, '#111', 'right');
  ftext(x, 'مراقبة محافظة العاصمة', R-30, 230, 0, 23, 700, '#111', 'right');
  x.drawImage(logo, W/2-150, 70, 300, 140);
  ftext(x, 'الكشف على المحطات الثانوية ( الشامل )', W/2, 290, 0, 25, 700);
  const hdr = [['المنطقة', st.area], ['القطعة', st.block], ['المحطة', st.stationName], ['نوع المحطة', ST_TYPES[st.stType||'sub']]];
  hdr.forEach(([l, val], i) => { const y = 92 + i*52; x.font = FF(22,700); const lw = x.measureText(l+' / ').width;
    ftext(x, l+' / ', 430, y, 0, 22, 700, '#111', 'right'); ftext(x, val||'', 430-lw-4, y, 240, 21, 600, INK, 'right'); });
  const f = st.full || fullDefaults(st.checks), key = {'حائط':'wall','رقم المحطة':'num','سور المحطة':'fence','باب الطوارئ':'emerg'};
  const CIVIL = ['شفاط','اللمبات','باب','حائط','سقف','قفل','رقم المحطة','سور المحطة','البلكات','نظافة المحطة','باب الطوارئ','الترنشات'];
  let y = 334; fbar(x, L, R, y, 50, '( مدني )'); y += 50;
  y = ftable(x, R, y, [70,230,230,230,360], [{h:40, bold:true, cells:['م','البيانات المطلوبة','سليم','غير سليم','ملاحظات أخرى']},
    ...CIVIL.map((n,i) => { const k = key[n]; const cells = [String(i+1), n];
      if (!k) cells.push('—','—','—'); else if (f[k]==='bad') cells.push('', '✓', {f: FULL_BAD_NOTE[k]}); else cells.push('✓', '', '');
      return {h:34, cells}; })]);
  fbar(x, L, R, y, 50, '( معدات )'); y += 50;
  y = ftable(x, R, y, [70,230,230,230,180,180], [{h:40, bold:true, cells:['م','البيانات المطلوبة','سليم','غير سليم','حجم المحول','ملاحظات أخرى']},
    ...['TR - 1','TR - 2','TR - 3','TR - 4'].map((n,i) => ({h:34, cells:[String(i+1), n, '—','—','—','—']})),
    ...['كيبلات سنجل كور','أيرث محطة','بطارية'].map((n,i) => ({h:34, cells:[String(i+5), n, '—','—', {t:'—', span:2}]}))]);
  fbar(x, L, R, y, 50, '( لوحة التوزيع )'); y += 50;
  y = ftable(x, R, y, [70,230,170,170,170,170,140], [{h:40, bold:true, cells:['م','بيانات المطلوبة','TR - 1','TR - 2','TR - 3','TR - 4','ملاحظات أخرى']},
    ...['عدد اليونتات الأحتياط','عدد اليونتات المستخدمة','كتاوت على الحائط'].map((n,i) => ({h:34, cells:[String(i+1), n, '—','—','—','—','—']}))]);
  y += 34; ftext(x, 'ملاحظات أخرى : -', R-10, y, 0, 22, 700, '#111', 'right');
  const more = [st.extra, st.stationName === v.stationName ? v.notes : ''].map(s => (s||'').trim()).filter(Boolean).join(' · ');
  for (let i = 0; i < 3; i++) fdots(x, R-130, L+60, y + 34 + i*34);
  ftext(x, more || 'لا يوجد', R-140, y + 20, R-L-220, 20, 600, INK, 'right');
  ftext(x, 'توقيع الكاشف', R-90, y + 170, 0, 21, 700);
  ftext(x, 'رئيس القسم', L+120, y + 170, 0, 21, 700);
  ftext(x, 'مراقب محافظة العاصمة', W/2, y + 240, 0, 21, 700);
  return c;
}
async function drawSummaryForm(v){
  const logo = await loadLogo();
  try { await document.fonts.load('600 20px "IBM Plex Sans Arabic"'); } catch(e){}
  const {c, x, W, H} = formPage(), L = 60, R = W-60;
  x.drawImage(logo, W/2-200, 50, 400, 187);
  const sts = stationsOf(v), nSub = sts.filter(s => (s.stType||'sub') === 'sub').length;
  const line = (label, val, y) => { x.font = FF(26,600); const lw = x.measureText(label).width; ftext(x, label, R-20, y, 0, 26, 600, '#111', 'right');
    fdots(x, R-20-lw-8, R-20-lw-200, y+14); ftext(x, val, R-20-lw-100, y, 0, 26, 700, INK); };
  line('عدد المحطات التحويل الثانوية:', String(nSub), 290);
  line('عدد وحدات التوزيع المتكاملة:', String(sts.length - nSub), 345);
  const rowOf = (st, i) => {
    const iss = visitIssues(st), extra = i === 0 ? (v.notes||'').trim() : '';
    const debris = (st.desc||'').includes(OBS_DEBRIS), mod = (st.desc||'').includes(OBS_MOD);
    const others = iss.filter(s => s !== OBS_DEBRIS && s !== OBS_MOD && s !== OBS[OBS.length-1]);
    let note = others.join('، '); if (extra) note = note ? note + '، ' + extra : extra;
    x.font = FF(12,600); if (x.measureText(note).width > 480) note = 'مذكورة في نموذج الانتقال';
    return [String(i+1), {f:st.stationName||''}, {f:(iss.length || extra) ? 'يوجد ملاحظات' : 'سليمة'}, {f:debris?'نعم':'لا'}, {f:mod?'نعم':'لا'}, {f:note||'لا يوجد'}];
  };
  const rows = [{h:44, fill:'#d9d9d9', bold:true, cells:['م','رقم المحطة','حالة المحطة','يوجد أنقاض','يوجد تعديات','ملاحظات اخرى']}];
  for (let i = 1; i <= 30; i++) rows.push({h:34, cells: sts[i-1] ? rowOf(sts[i-1], i-1) : [String(i),'','','','','']});
  let y = ftable(x, R, 390, [60,230,200,170,190,270], rows);
  y += 40;
  ftext(x, 'توقيع الكاشف:', R-10, y, 0, 24, 600, '#111', 'right'); fdots(x, R-170, R-420, y+12);
  ftext(x, 'رئيس القسم:', 460, y, 0, 24, 600, '#111', 'right'); fdots(x, 320, L+10, y+12);
  ftext(x, 'مراقب محافظة العاصمة:', 760, y+90, 0, 24, 600, '#111', 'right'); fdots(x, 500, 300, y+102);
  const g = x.createLinearGradient(0,0,W,0); g.addColorStop(0,'#3bb7a5'); g.addColorStop(1,'#4b5aa8');
  x.fillStyle = g; x.fillRect(0, H-110, W, 46); ftext(x, 'WWW.MEW.GOV.KW', W/2, H-86, 0, 20, 700, '#fff');
  return c;
}
async function reportPages(v, nPhotos){
  const pages = [await drawReport(v, nPhotos)];
  if (v.fullForm) for (const st of stationsOf(v)) pages.push(await drawFullForm(v, st));
  pages.push(await drawSummaryForm(v));
  return pages;
}
let reportCanvas = null, reportVisit = null, reportPagesC = [];
async function openReport(v){
  reportVisit = v;
  $('reportImg').removeAttribute('src');
  $('reportSheet').hidden = false;
  $('reportExtra').innerHTML = '';
  reportPagesC = await reportPages(v, vPhotos.length);
  reportCanvas = reportPagesC[0];
  $('reportImg').src = reportCanvas.toDataURL('image/jpeg', .92);
  $('reportExtra').innerHTML = reportPagesC.slice(1).map((c,i) => `<img src="${c.toDataURL('image/jpeg', .85)}" alt="صفحة ${i+2} من التقرير" class="rpage">`).join('');
  const can = !!S.dl;
  $('reportBtns').hidden = !can;
  if (can) { const b = $('shareBtn'); b.hidden = false; b.disabled = true; b.textContent = 'جاري تجهيز ملف الـ PDF…'; pendingFile = null; saveReport('pdf'); }
  $('reportHint').textContent = can ? `ملف الـ PDF فيه ${reportPagesC.length} ${reportPagesC.length===2?'نموذجين':'نماذج'}${vPhotos.length ? ` و${vPhotos.length} ${vPhotos.length===1?'صورة':'صور'}` : ''}. ` + 'نزّله وارفعه بالتراسل ووقّع من هناك.' : 'الحفظ غير متاح في هذا العرض. اضغط مطولاً على الصورة لحفظها.';
}
function reportRows(){ return S.visits.filter(v => v.reportFile).sort((a,b) => claimOf(a) < claimOf(b) ? 1 : -1); }
let allReports = false;
function renderReports(){
  const el = $('sReports'); if (!el) return;
  const vs = S.visits.slice().sort((a,b) => claimOf(a) < claimOf(b) ? 1 : -1);
  const n = vs.filter(v => v.reportFile).length;
  $('sReportsCount').textContent = vs.length ? `${n} من ${vs.length} زيارة جاهز تقريرها` : '';
  const shown = allReports ? vs : vs.slice(0, 5);
  el.innerHTML = vs.length ? shown.map(v => `<div class="rep"><span class="rep-ic" aria-hidden="true">PDF</span><span class="stbody"><b>${esc(vNames(v)||'محطة')}</b><span class="xs muted">${fmtDate(claimOf(v),{weekday:'short',day:'numeric',month:'short'})}${v.reportFile ? '' : ' · ما انحفظ له تقرير'}</span></span>
      ${v.reportFile ? `<button type="button" class="btn sm primary" data-repdl="${v.id}">تنزيل</button>` : ''}
      <button type="button" class="btn sm" data-repopen="${v.id}">${v.reportFile ? 'مراجعة' : 'جهّز التقرير'}</button></div>`).join('')
      + (vs.length > 5 ? `<button type="button" class="btn ghost" id="repMore">${allReports ? 'عرض الأحدث فقط' : 'عرض كل التقارير ('+vs.length+')'}</button>` : '')
    : '<div class="empty">ما في تقارير للحين. أول ما تسجّل زيارة وتجهّز تقريرها ينحفظ هنا.</div>';
}
document.addEventListener('click', async ev => {
  if (ev.target.closest('#repMore')) { allReports = !allReports; renderReports(); return; }
  const dl = ev.target.closest('[data-repdl]'), op = ev.target.closest('[data-repopen]');
  if (dl) {
    const v = S.visits.find(x => x.id === dl.dataset.repdl); if (!v || !v.reportFile) return;
    dl.disabled = true; const old = dl.textContent; dl.textContent = 'جاري التحميل…';
    try { const b = await driveBlob(v.reportFile); pendingFile = new File([b], fileBase(v)+'.pdf', {type:'application/pdf'}); await handOff(); }
    catch(e) { toast('ما قدرت أحمّل التقرير من الدرايف'); }
    dl.disabled = false; dl.textContent = old; return;
  }
  if (op) { const v = S.visits.find(x => x.id === op.dataset.repopen); if (v) { openVisit(v.id); if (!v.reportFile) setTimeout(() => $('v_go') && $('v_go').click(), 400); } }
});
function fileBase(v){ return `تقرير ${(vNames(v)||'محطة').replace(/[\\/:*?"<>|]/g,'')} ${v.claimDate||''}`.trim(); }

/* tiny PDF writer: each page is one full-page JPEG */
async function canvasJpeg(c, q){ const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); return {bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height}; }
function makePdf(pages){
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(n+' 0 obj\n'); body(); push('\nendobj\n'); };
  const PW = 595.28, PH = 841.89, n = pages.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')}] >>`));
  pages.forEach((pg, i) => {
    const P = 3+i*3, C = P+1, I = P+2;
    const k = Math.min((PW-20)/pg.w, (PH-20)/pg.h), w = pg.w*k, h = pg.h*k, x = (PW-w)/2, y = (PH-h)/2;
    const cs = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(P, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${I} 0 R >> >> /Contents ${C} 0 R >>`));
    obj(C, () => { push(`<< /Length ${cs.length} >>\nstream\n`); push(cs); push('\nendstream'); });
    obj(I, () => { push(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`); push(pg.bytes); push('\nendstream'); });
  });
  const total = 3 + n*3, x0 = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + Array.from({length:total-1}, (_,i) => String(offs[i+1]).padStart(10,'0')+' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${x0}\n%%EOF`);
  return new Blob(parts, {type:'application/pdf'});
}
function loadJsPDF(){ return window.jspdf ? Promise.resolve(window.jspdf) : new Promise((res,rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = () => res(window.jspdf); s.onerror = rej; document.head.appendChild(s); }); }
async function saveReport(kind){
  if (!S.dl || !reportCanvas) return;
  try {
    if (kind==='jpg') {
      const blob = await new Promise(r => reportCanvas.toBlob(r, 'image/jpeg', .92));
      await S.dl.save({filename: fileBase(reportVisit)+'.jpg', data: blob});
    } else {
      toast('جاري تجهيز الملف…');
      const pages = [];
      for (const c of reportPagesC) pages.push(await canvasJpeg(c, .9));
      for (const pg of photoPages(await photoImages(), reportVisit, reportPagesC.length+1)) pages.push(await canvasJpeg(pg, .85));
      await S.dl.save({filename: fileBase(reportVisit)+'.pdf', data: makePdf(pages)});
    }
  } catch(err) {
    { const b = $('shareBtn'); if (b.disabled) { b.disabled = false; b.textContent = 'أعد تجهيز ملف الـ PDF'; b.onclick = () => { b.onclick = handOff; saveReport('pdf'); }; } }
    if (err && err.code==='declined') return;
    toast(err && err.code==='rate_limited' ? 'في نافذة حفظ مفتوحة، كمّلها أول' : 'تعذّر حفظ الملف');
  }
}

/* team plan */
async function savePlan(ym, assign){ await write(() => S.db.doc('plans/'+ym).set({assign, updatedAt:new Date().toISOString()}), 'تم حفظ التوزيع'); }
function autoAssign(){
  const target = +S.settings.siteTarget||12, plan = {...planOf(ymOf())};
  const counts = [0,0,0,0,0]; Object.values(plan).forEach(i => { if (counts[i]!=null) counts[i]++; });
  const free = S.stations.filter(s => plan[s.id]==null).sort((a,b) => (+a.block||999)-(+b.block||999) || (a.name||'').localeCompare(b.name||'','ar'));
  // contiguous chunks keep each engineer's stations close together
  for (const s of free) { let best = -1; for (let i=0;i<5;i++) if (counts[i] < target && (best<0 || counts[i] < counts[best])) best = i; if (best<0) break; plan[s.id] = best; counts[best]++; }
  return plan;
}
function planText(){
  const ym = ymOf(), plan = planOf(ym), T = team();
  const label = new Intl.DateTimeFormat('ar-KW-u-nu-latn-ca-gregory',{month:'long',year:'numeric'}).format(new Date(view.y,view.m,1));
  let out = `توزيع محطات منطقة شرق - ${label}\n`;
  T.forEach((n,i) => { const st = S.stations.filter(s => plan[s.id]===i); out += `\n${n} (${st.length}):\n` + st.map((s,j)=>`${j+1}. ${s.name}${s.block?' - ق '+s.block:''}${s.street?' ش '+s.street:''}`).join('\n') + '\n'; });
  return out;
}
async function copyText(t){ try { await navigator.clipboard.writeText(t); toast('تم النسخ'); } catch(e) { toast('النسخ غير متاح هنا'); } }

document.addEventListener('click', async ev => {
  const t = ev.target;
  const mo = t.closest('[data-month]'); if (mo) { view.m += +mo.dataset.month; if (view.m<0){view.m=11;view.y--;} if (view.m>11){view.m=0;view.y++;} render(); return; }
  if (t.closest('#newVisit')) { openVisit(null); return; }
  const vv = t.closest('[data-visit]'); if (vv) { openVisit(vv.dataset.visit); return; }
  const vst = t.closest('[data-visit-station]'); if (vst) { openVisit(null, vst.dataset.visitStation); return; }
  const sp = t.closest('[data-step]');
  if (sp) { const [id,k] = sp.dataset.step.split('|'); const v = S.visits.find(x=>x.id===id); if (!v) return; const steps = {...(v.steps||{}), [k]: todayISO()};
    await write(() => S.db.doc('visits/'+id).update({steps}), 'تم: '+STEPS.find(s=>s[0]===k)[1]); return; }
  if (t.id==='sMore') { moreN += 10; renderCover(); return; }
  if (t.id==='sNear') {
    if (nearMode) { nearMode = false; renderCover(); return; }
    if (S.here) { nearMode = true; renderCover(); return; }
    if (!navigator.geolocation) { toast('جهازك ما يدعم تحديد الموقع'); return; }
    navigator.geolocation.getCurrentPosition(p => { S.here = {lat:p.coords.latitude, lng:p.coords.longitude}; nearMode = true; renderCover(); }, () => toast('ما قدرنا نحدد موقعك. فعّل الموقع للمتصفح.'), {enableHighAccuracy:true, timeout:12000});
    return;
  }
  const sa = t.closest('[data-share-accept]'); if (sa) { acceptShare(sa.dataset.shareAccept); return; }
  const sd = t.closest('[data-share-decline]'); if (sd) {
    const {error} = await sb.rpc('respond_share', {p_id: sd.dataset.shareDecline, p_accept: false});
    if (error) { toast('تعذّر الرفض، حاول مرة ثانية'); return; }
    const r = S.shares.find(x => x.id === sd.dataset.shareDecline); if (r) r.status = 'declined'; renderShares(); toast('رفضت المشاركة. سجّل زيارتك بنفسك.'); return;
  }
  if (t.id==='v_resend') {
    const o = visitFromForm(); if (!editingVisit || !o.stationName) { toast('احفظ الزيارة أول'); return; }
    if (await saveVisit(o, true)) { const sh = await sendShare(editingVisit, o); if (sh) { toast('انرسلت من جديد'); renderShareBox(); } }
    return;
  }
  if (t.id==='v_copy') { copyText(diwanNote(visitFromForm())); return; }
  if (t.id==='v_saveonly') { const o = visitFromForm(); if (!o.stationName) { toast('اختر المحطة أو اكتب اسمها'); return; } if (!o.visitDate) { toast('حدد تاريخ الزيارة'); return; } if (vPhotos.some(p=>p.busy)) { toast('انتظر لين تخلص الصور من الرفع'); return; } if (await saveVisit(o)) $('visitSheet').hidden = true; return; }
  if (t.id==='v_report') { const o = visitFromForm(); if (!o.stationName) { toast('اختر المحطة أو اكتب اسمها'); return; } if (needS2(o) && !o.s2) { toast('اختر المحطة الثانية، التقرير لازم يكون لمحطتين'); $('v2Sec').scrollIntoView({behavior:'smooth', block:'start'}); return; } if (vPhotos.some(p=>p.busy)) { toast('انتظر لين تخلص الصور من الرفع'); return; } if (S.db && S.canWrite) await saveVisit(o, true); openReport(o); return; }
  if (t.id==='v_del') { if (await write(() => S.db.doc('visits/'+editingVisit).delete(), 'تم حذف الزيارة')) $('visitSheet').hidden = true; return; }
  if (t.id==='savePdf') { saveReport('pdf'); return; }
  if (t.id==='saveJpg') { saveReport('jpg'); return; }
  if (t.closest('#addStation')) { openStation(null); return; }
  const so = t.closest('[data-station]'); if (so) { openStation(so.dataset.station); return; }
  if (t.id==='sn_del') { if (await write(() => S.db.doc('stations/'+editingStation).delete(), 'تم حذف المحطة')) $('stationSheet').hidden = true; return; }
  if (t.id==='autoPlan') { if (!S.stations.length) { toast('أضف المحطات أول'); return; } await savePlan(ymOf(), autoAssign()); return; }
  if (t.id==='copyPrev') { const p = planOf(prevYm(ymOf())); if (!Object.keys(p).length) { toast('ما في توزيع للشهر الماضي'); return; } await savePlan(ymOf(), {...p}); return; }
  if (t.id==='copyPlan') { copyText(planText()); return; }
  if (t.id==='stImportBtn') { importStations(); return; }
});
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (t.id==='v_station') { const s = stationById(t.value); $('v_nameWrap').hidden = t.value!=='__other'; if (s) { $('v_block').value = s.block||''; $('v_street').value = s.street||''; $('v_area').value = s.area||'شرق'; if (s.lat && s.lng) { vGeo[1] = {lat:s.lat, lng:s.lng}; renderGeo(); } } updateDiwan(); }
  if (['v_ex','v_cdate','v_name','v_area'].includes(t.id)) updateDiwan();
  if (t.id==='v_full') { if (t.checked) renderFull(fullDefaults(getObs()), fullDefaults(getObs2())); else $('v_fullBox').hidden = true; }
  if (t.id==='v2_station') { const s = stationById(t.value); $('v2_nameWrap').hidden = t.value!=='__other'; if (s) { $('v2_block').value = s.block||''; $('v2_street').value = s.street||''; $('v2_area').value = s.area||'شرق'; if (s.lat && s.lng) { vGeo[2] = {lat:s.lat, lng:s.lng}; renderGeo(); } } updateDiwan(); }
  if (t.id==='v2_name') updateDiwan();
  if (t.id==='v_vdate' && !editingVisit) { $('v_cdate').value = t.value; updateDiwan(); }
  if (t.id==='v_vdate' || t.id==='v_cdate') toggleV2();
  if (t.id && t.id.startsWith('vs_') && t.checked && !t.dataset.date) t.dataset.date = todayISO();
  if (t.dataset.assign) { const plan = {...planOf(ymOf())}; if (t.value==='') delete plan[t.dataset.assign]; else plan[t.dataset.assign] = +t.value; await savePlan(ymOf(), plan); }
});
document.addEventListener('input', ev => { if (ev.target.id==='stSearch') renderStations(); });
document.addEventListener('change', ev => { if (ev.target.id==='v_partner') renderShareBox(); });
document.addEventListener('submit', async ev => {
  const f = ev.target;
  if (f.id==='visitF') {
    const o = visitFromForm();
    if (!o.stationName) { toast('اختر المحطة أو اكتب اسمها'); return; }
    if (!o.visitDate) { toast('حدد تاريخ الزيارة'); return; }
    if (needS2(o) && !o.s2) { toast('اختر المحطة الثانية، التقرير لازم يكون لمحطتين'); $('v2Sec').scrollIntoView({behavior:'smooth', block:'start'}); return; }
    if (vPhotos.some(p=>p.busy)) { toast('انتظر لين تخلص الصور من الرفع'); return; }
    if (S.db && S.canWrite) await saveVisit(o, true);
    openReport(o);
  }
  if (f.id==='shareF') { await doAccept(); return; }
  if (f.id==='stationF') {
    const o = {name:ar2en($('sn_name').value.trim()), area:$('sn_area').value.trim()||'شرق', block:ar2en($('sn_block').value.trim()), street:ar2en($('sn_street').value.trim()),
      lat:$('sn_lat').value.trim(), lng:$('sn_lng').value.trim(), addr:$('sn_addr').value.trim(), type:'ثانوية', source:'manual', updatedAt:new Date().toISOString()};
    if (!o.name) return;
    const ok = editingStation ? await write(() => S.db.doc('stations/'+editingStation).set((({id, ...rest}) => ({...rest, ...o}))(stationById(editingStation))), 'تم الحفظ') : await write(() => S.db.collection('stations').add(o), 'تمت إضافة المحطة');
    if (ok) $('stationSheet').hidden = true;
  }
});
let editingStation = null;
function openStation(id){
  editingStation = id;
  const s = id ? stationById(id) : {area:'شرق'};
  $('stationTitle').textContent = id ? 'تعديل المحطة' : 'محطة جديدة';
  $('sn_name').value = s.name||''; $('sn_area').value = s.area||'شرق'; $('sn_block').value = s.block||''; $('sn_street').value = s.street||'';
  $('sn_lat').value = s.lat||''; $('sn_lng').value = s.lng||''; $('sn_addr').value = s.addr||'';
  const u = mapUrl(s); $('sn_map').hidden = !u; if (u) $('sn_map').href = u;
  $('sn_del').hidden = !id;
  $('stationSheet').hidden = false;
}
async function importStations(){
  const lines = $('stImport').value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let ok = 0, dup = 0;
  const have = new Set(S.stations.map(s => (s.name||'').trim()));
  for (const line of lines) {
    const p = line.split(/[,،\t]/).map(s=>s.trim());
    if (!p[0]) continue;
    if (have.has(p[0])) { dup++; continue; }
    const o = {name:p[0], block:p[1]||'', street:p[2]||'', lat:p[3]||'', lng:p[4]||'', area:'شرق', type:'ثانوية', source:'import', updatedAt:new Date().toISOString()};
    if (await write(() => S.db.collection('stations').add(o))) { ok++; have.add(p[0]); } else break;
  }
  $('stImportMsg').textContent = `تمت إضافة ${ok} محطة` + (dup ? ` · ${dup} موجودة من قبل` : '');
  if (ok) $('stImport').value = '';
}

/* ---------- data ---------- */
render();
/* ---------- Supabase backend ---------- */
const CFG = window.MEW_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, experimental: { passkey: true } } });
const TEAM_COLLS = new Set(['stations','plans','config']);
S.isAdmin = false; S.myIndex = 0; S.members = []; S.uid = null;

function dbErr(e){ const m = (e && (e.message||'')) + ''; const err = new Error(m); err.code = (e && (e.code==='42501' || /row-level security|permission/i.test(m))) ? 'invalid_argument' : 'unavailable'; return err; }
const RULE_KEYS = ['grace','presAfter','presLen','permLimit','sickLimit','siteTarget','siteAllowance'];
// personal settings + the team rules the admin set (rules win for everyone)
function mergeSettings(own){
  S.ownSettings = {...(own||{})}; delete S.ownSettings.team;
  const rules = {}; if (S.rules) for (const k of RULE_KEYS) if (S.rules[k] != null) rules[k] = S.rules[k];
  const al = S.rules && S.rules.allowances, mine = al && al[String(S.myIndex)];
  if (mine != null) rules.siteAllowance = +mine;
  return {...DEFAULTS, ...S.ownSettings, ...rules, team: teamNames()};
}
function applyLocal(coll, id, data){
  if (coll==='settings') { S.settings = mergeSettings(data); }
  else if (coll==='config' && id==='rules') { S.rules = data||null; S.settings = mergeSettings(localDoc('settings','main')); }
  else if (coll==='days') { if (data) S.days[id] = data; else delete S.days[id]; }
  else if (coll==='plans') { if (data) S.plans[id] = data; else delete S.plans[id]; }
  else if (['leaves','visits','stations'].includes(coll)) { const arr = S[coll].filter(x => x.id!==id); if (data) arr.push({id, ...data}); S[coll] = arr; }
  render();
}
function localDoc(coll, id){
  if (coll==='settings') { const {team, ...rest} = S.settings; return S.ownSettings || rest; }
  if (coll==='days') return S.days[id]; if (coll==='plans') return S.plans[id];
  const x = (S[coll]||[]).find(y => y.id===id); if (!x) return null; const {id:_, ...rest} = x; return rest;
}
function scopeOf(coll){ return TEAM_COLLS.has(coll) ? 'team' : S.uid; }
function docRef(coll, id){
  return {
    id,
    async set(data){ const clean = JSON.parse(JSON.stringify(data)); const {error} = await sb.from('docs').upsert({scope:scopeOf(coll), owner: TEAM_COLLS.has(coll)?null:S.uid, coll, id, data:clean, updated_at:new Date().toISOString()}); if (error) throw dbErr(error); applyLocal(coll, id, clean); },
    async update(part){ const cur = localDoc(coll, id); if (!cur) { const e = new Error('missing'); e.code='invalid_argument'; throw e; } return this.set({...cur, ...part}); },
    async delete(){ const {error} = await sb.from('docs').delete().match({scope:scopeOf(coll), coll, id}); if (error) throw dbErr(error); applyLocal(coll, id, null); }
  };
}
S.db = {
  doc(path){ const [coll, id] = path.split('/'); return docRef(coll, id); },
  collection(coll){ return { async add(o){ const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2)); await docRef(coll, id).set(o); return {id}; } }; }
};

/* Google Drive through the `drive` edge function */

async function driveCall(body){
  const {data, error} = await sb.functions.invoke('drive', {body});
  if (error) throw error; if (data && data.error) throw new Error(data.error); return data;
}
const blobToB64 = b => new Promise((res,rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
function visitFolder(v){ return `${v.claimDate||v.visitDate||todayISO()} - ${(vNames(v)||'محطة').replace(/[\\/:*?"<>|]/g,'')}`; }
async function driveUpload(blob, name, mime, v){
  const r = await driveCall({action:'upload', date: v.claimDate||v.visitDate||todayISO(), folder: visitFolder(v), name, mime, data: await blobToB64(blob)});
  return r; // {id, url}
}
const driveCache = {};
async function driveBlob(id, share){
  if (driveCache[id]) return driveCache[id];
  const r = await driveCall(share ? {action:'get', id, share} : {action:'get', id});
  const bin = atob(r.data), u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return driveCache[id] = new Blob([u], {type: r.mime||'image/jpeg'});
}

/* ---------- fingerprint from a screenshot (on-device OCR, no API key) ---------- */
let fpOcr = null, fpBlob = null, fpGuess = null;
function loadTesseract(){
  if (window.Tesseract) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل قارئ الصور')); document.head.appendChild(s); });
}
async function ocrText(blob){
  await loadTesseract();
  if (!fpOcr) fpOcr = Tesseract.createWorker(['ara','eng']);
  const w = await fpOcr;
  const r = await w.recognize(blob);
  return r.data.text || '';
}
// pure parser, also used by tests
function parseFpText(txt){
  const t = String(txt).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const dm = t.match(/(20\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/) || null;
  const date = dm ? `${dm[1]}-${pad(+dm[2])}-${pad(+dm[3])}` : '';
  let time = '', sec = '';
  const tms = [...t.matchAll(/\b(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\b/g)].filter(m => +m[1] < 24 && +m[2] < 60);
  if (tms.length) { const m = tms[tms.length-1]; time = `${pad(+m[1])}:${m[2]}`; sec = m[3] || ''; }
  const out = /خروج|الخروج|انصراف/.test(t), inn = /دخول|الدخول|دخولك|حضور/.test(t);
  const kind = out && !inn ? 'out' : inn && !out ? 'in' : out ? 'out' : '';
  const approvals = parseDiwan(t);
  const isDiwanApp = /الحضور\s*والانصراف|راحة\s*بين\s*النوبات|خروج\s*نوبة|لا\s*يوجد\s*بصمة/.test(t);
  return {date, time, sec, kind, approvals, isDiwanApp, diwan: approvals.length > 0, ex: approvals[0]?.ex || '', diwanDate: approvals[0]?.date || ''};
}
// Diwan attendance list: each approved day reads «(إعفاء جزئي في الانصراف - سبب الإعفاء/ ... - ملاحظات/ ...)» next to «اليوم - DD-MM-YYYY»
function parseDiwan(t){
  const dateRe = /(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(20\d{2})|(20\d{2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})/g;
  const iso = m => m[3] ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : `${m[4]}-${pad(+m[5])}-${pad(+m[6])}`;
  const out = [], re = /[إا]عفاء\s*جزئ[يى]/g; let m;
  while ((m = re.exec(t))) {
    const start = m.index, close = t.indexOf(')', start), end = close > 0 ? close : Math.min(t.length, start + 220);
    const block = t.slice(start, end);
    const what = (block.match(/جزئ[يى]\s*(?:في|فى)\s*([^\-–(]{2,40})/) || ['', ''])[1];
    const ex = /صراف|خروج/.test(what) ? 'out' : /دخول|حضور|تواجد/.test(what) ? 'inPres' : '';
    let dm = [...block.matchAll(dateRe)][0];
    if (!dm) dm = [...t.slice(end).matchAll(dateRe)][0];
    const station = (block.replace(/\s+/g,' ').match(/الكشف\s*على\s*(?:محطة|محطتي)?\s*(.+?)(?:\s+في\s|$)/) || ['', ''])[1].trim();
    out.push({date: dm ? iso(dm) : '', ex, station});
  }
  return out;
}
// which duty a punch at (date, time) belongs to: same day, or the previous night shift
function fpShiftDate(date, time){
  const t = parseISO(date).getTime() + mins(time)*60000;
  for (const c of [date, addDays(date,-1), addDays(date,1)]) {
    const k = shiftOf(c); if (!k) continue;
    const s0 = startMs(c,k);
    if (t >= s0 - 4*3600000 && t <= s0 + (SHIFT_H+4)*3600000) return c;
  }
  return date;
}
function fpClassify(g){
  if (!g.date || !g.time) return null;
  const d = fpShiftDate(g.date, g.time), rec = S.days[d] || {}, k = shiftOf(d);
  let f = g.kind || 'in', note = '';
  if (f === 'in') {
    const pa = +S.settings.presAfter || 120;
    if (rec.in && k) {
      const gap = rel(g.time,k,'presence') - rel(rec.in,k,'in');
      if (gap >= pa) f = 'presence';
      else note = `عندك بصمة دخول ${to12(rec.in)} في نفس الخفارة، وهذي قبل ساعتين منها. إذا حفظتها راح تستبدل الأولى.`;
    }
  }
  if (rec[f] && !note) note = `فيه بصمة ${FPN[f]} مسجلة ${to12(rec[f])}، وراح تستبدلها.`;
  if (!k) note = (note ? note + ' ' : '') + 'هذا اليوم راحة في جدولك.';
  return {date: d, f, note};
}
function diwanVisit(d){ return S.visits.find(v => claimOf(v)===d); }
function fpMode(){
  const dw = $('fpType').value === 'diwan';
  $('fpExWrap').hidden = !dw; $('fpTimeWrap').hidden = dw; $('fpTime').required = !dw;
  $('fpDateL').textContent = dw ? 'تاريخ الإعفاء' : 'التاريخ في الصورة';
  $('fpSave').textContent = dw ? 'سجّل موافقة الديوان' : 'سجّل البصمة';
  return dw;
}
function fpRefresh(){
  if (fpMode()) {
    const d = $('fpDate').value; if (!d) { $('fpNote').textContent = ''; $('fpSave').disabled = true; return; }
    const v = diwanVisit(d), k = shiftOf(d);
    $('fpNote').textContent = `إعفاء ${$('fpEx').value==='out' ? 'الانصراف' : 'الحضور والتواجد'} على ${k ? SHIFT[k].long : 'يوم'} ${fmtDate(d)}. ` +
      (v ? `ينربط بزيارة ${vNames(v)} وتصير موافقة الديوان مكتملة. ` : 'ما في زيارة بهالتاريخ، فينسجل كإعفاء بصمة. ') +
      'مع البصمة الثانية يصير يوم عمل كامل.';
    $('fpSave').disabled = false; return;
  }
  const g = {date:$('fpDate').value, time:$('fpTime').value, kind: $('fpType').dataset.kind || ''};
  const c = fpClassify({...g, kind: $('fpType').value === 'out' ? 'out' : 'in'});
  if (!c) { $('fpNote').textContent = ''; $('fpSave').disabled = true; return; }
  const k = shiftOf(c.date);
  $('fpNote').textContent = `تنحسب على ${k ? SHIFT[k].long : 'يوم'} ${fmtDate(c.date)}.` + (c.note ? ' ' + c.note : '');
  $('fpSave').disabled = false;
}
document.addEventListener('click', ev => { if (ev.target.closest('[data-fpup]')) $('fpFile').click(); });
$('fpFile').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) openFpFile(file); };
async function openFpFile(file){
  fpBlob = file;
  $('fpImg').src = URL.createObjectURL(file);
  $('fpDate').value = ''; $('fpTime').value = ''; $('fpNote').textContent = ''; $('fpSave').disabled = true; $('fpType').value = 'in'; fpMode();
  $('fpSub').textContent = 'نقرأ الصورة على جهازك…';
  $('fpSheet').hidden = false;
  try {
    const g = parseFpText(await ocrText(file));
    fpGuess = g;
    $('fpDate').value = g.date; $('fpTime').value = g.time;
    if (g.diwan) {
      // several approved days can be on one screenshot: take the newest one not recorded yet
      const list = g.approvals.filter(a => a.date).sort((a,b) => a.date < b.date ? 1 : -1);
      const pick = list.find(a => !(S.days[a.date]||{}).diwan) || list[0] || g.approvals[0];
      $('fpType').value = 'diwan'; $('fpDate').value = pick.date || '';
      if (pick.ex) $('fpEx').value = pick.ex;
      else { const v = pick.date && diwanVisit(pick.date); if (v && v.exemption && v.exemption !== 'none') $('fpEx').value = v.exemption; }
      $('fpSub').textContent = !pick.date ? 'هذي موافقة الديوان. ما قدرت أقرأ التاريخ، اختاره بنفسك.'
        : (list.length > 1 ? `لقيت ${list.length} موافقات بالصورة، اخترت ${fmtDate(pick.date,{weekday:'long',day:'numeric',month:'short'})}. ` : 'هذي موافقة الديوان. ') + 'تأكد من التاريخ ونوع الإعفاء واضغط سجّل.';
      fpRefresh(); return;
    }
    if (g.isDiwanApp) { $('fpSub').textContent = 'هذي صورة من الديوان بس ما فيها «إعفاء جزئي» للحين. ارفعها بعد ما تطلع الموافقة.'; $('fpDate').value = ''; $('fpTime').value = ''; fpRefresh(); return; }
    const c = fpClassify(g);
    if (c) $('fpType').value = c.f; else $('fpType').value = g.kind === 'out' ? 'out' : 'in';
    const miss = [!g.date && 'التاريخ', !g.time && 'الوقت', !g.kind && 'النوع'].filter(Boolean);
    $('fpSub').textContent = miss.length ? `ما قدرت أقرأ ${miss.join(' و')}، عدّلها بنفسك.` : 'تأكد من البيانات واضغط سجّل.';
    fpRefresh();
  } catch (err) {
    $('fpSub').textContent = 'تعذرت قراءة الصورة، اكتب البيانات بنفسك.';
  }
}
['fpDate','fpTime'].forEach(id => $(id).addEventListener('change', () => { if (fpMode()) { fpRefresh(); return; } const c = fpClassify({date:$('fpDate').value, time:$('fpTime').value, kind: $('fpType').value==='out'?'out':(fpGuess?.kind||'in')}); if (c) $('fpType').value = c.f; fpRefresh(); }));
$('fpType').addEventListener('change', fpRefresh);
$('fpEx').addEventListener('change', fpRefresh);
async function saveDiwan(){
  const d = $('fpDate').value, ex = $('fpEx').value; if (!d) return;
  $('fpSave').disabled = true;
  const v = diwanVisit(d), today = todayISO();
  const ok = await write(async () => {
    if (v) {
      const steps = {...(v.steps||{})}; for (const k of ['visited','photo','sent','mgmt','diwan']) if (!steps[k]) steps[k] = today; steps.diwanOk = steps.diwanOk || today;
      await S.db.doc('visits/'+v.id).update({steps, exemption: ex});
    } else if (!S.leaves.some(l => l.kind==='exemption' && l.from===d && l.diwan)) {
      await S.db.collection('leaves').add({kind:'exemption', from:d, to:d, covers: ex==='out' ? ['out'] : ['in','presence'], diwan:true, note:'موافقة الديوان', createdAt:new Date().toISOString()});
    }
    const r = recFor(d); r.diwan = ex; r.updatedAt = new Date().toISOString(); r.src = {...(r.src||{}), diwan:'screenshot'};
    await S.db.doc('days/'+d).set(r);
  }, 'تم تسجيل موافقة الديوان');
  if (!ok) { $('fpSave').disabled = false; return; }
  $('fpSheet').hidden = true;
  if (fpBlob) {
    blobToB64(fpBlob).then(data => driveCall({action:'upload', date: d, folder: 'البصمات', name: `${d} موافقة الديوان.jpg`, mime: fpBlob.type || 'image/jpeg', data}))
      .then(res => { if (res && res.id) { const r2 = recFor(d); r2.proof = {...(r2.proof||{}), diwan: res.id}; S.db.doc('days/'+d).set(r2).catch(()=>{}); if (v) S.db.doc('visits/'+v.id).update({diwanProof: res.id}).catch(()=>{}); toast('انحفظت صورة الموافقة في الدرايف'); } })
      .catch(() => toast('انحفظت الموافقة، بس الصورة ما انحفظت في الدرايف'));
  }
}
$('fpF').onsubmit = async e => {
  e.preventDefault();
  if ($('fpType').value === 'diwan') return saveDiwan();
  const date = $('fpDate').value, time = $('fpTime').value, f = $('fpType').value;
  if (!date || !time) return;
  const d = fpShiftDate(date, time);
  const r = recFor(d); r[f] = time; r.updatedAt = new Date().toISOString();
  r.src = {...(r.src||{}), [f]: 'screenshot'};
  $('fpSave').disabled = true;
  if (!await write(() => S.db.doc('days/'+d).set(r), 'تم تسجيل بصمة '+FPN[f]+' '+to12(time))) { $('fpSave').disabled = false; return; }
  $('fpSheet').hidden = true;
  if (fpBlob) {
    const name = `${date} ${time.replace(':','-')} ${FPN[f]}.jpg`;
    blobToB64(fpBlob).then(data => driveCall({action:'upload', date: d, folder: 'البصمات', name, mime: fpBlob.type || 'image/jpeg', data}))
      .then(res => { if (res && res.id) { const r2 = recFor(d); r2.proof = {...(r2.proof||{}), [f]: res.id}; S.db.doc('days/'+d).set(r2).catch(()=>{}); toast('انحفظت الصورة في الدرايف'); } })
      .catch(() => toast('انحفظت البصمة، بس الصورة ما انحفظت في الدرايف'));
  }
};
window.__fp = {sb, exifGps, ensureStations, parseFpText, fpShiftDate, fpClassify, ocrText, mergeSettings, S, render, takeSharedImage, renderInstallTip, setTP: v => { teamProg = v; }, renderShareBox, sendShare, drawReport};

S.assets = {
  async upload(blob){ const v = visitFromForm(); const r = await driveUpload(blob, `صورة ${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`, 'image/jpeg', v); driveCache[r.id] = blob; return {id:r.id, url:r.url}; },
  async delete(id){ try { await driveCall({action:'delete', id}); } catch(e){} }
};
async function hydratePhotos(){
  for (const p of vPhotos) if (!p.blob && p.id) { try { p.blob = await driveBlob(p.id); p.url = URL.createObjectURL(p.blob); renderPhotos(); } catch(e){} }
}

/* file hand-off: share sheet on phones, download elsewhere */
let pendingFile = null;
S.dl = {
  async save({filename, data}){
    const type = filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    const file = new File([data], filename, {type});
    if (filename.endsWith('.pdf') && reportVisit) {
      driveUpload(file, filename, type, reportVisit).then(r => { toast('انحفظ التقرير في الدرايف'); if (editingVisit && r && r.id) S.db.doc('visits/'+editingVisit).update({reportFile: r.id}).catch(()=>{}); }).catch(() => toast('التقرير ما انحفظ بالدرايف'));
    }
    pendingFile = file;
    showReady(file);
    return {status:'saved'};
  }
};
function showReady(file){
  const b = $('shareBtn'); b.hidden = false; b.disabled = false; b.textContent = navigator.canShare && navigator.canShare({files:[file]}) ? 'مشاركة التقرير (التراسل، واتساب…)' : 'تنزيل التقرير';
}
async function handOff(){
  const file = pendingFile; if (!file) return;
  if (navigator.canShare && navigator.canShare({files:[file]})) { try { await navigator.share({files:[file], title:file.name}); return; } catch(e) { if (e && e.name==='AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- team members (admin) ---------- */
function renderMembers(){
  const el = $('stTeam'); if (!el) return;
  el.innerHTML = S.members.map(m => `<div class="mrow"><div><b>${esc(memberLabel(m))}</b> <span class="xs muted">· ${m.username?esc(m.username):'ما دخل للحين'}${m.role==='admin'?' · مدير':''}</span></div>
    ${S.isAdmin ? `<div class="mbtns"><label class="mallow" title="بدل الموقع الشهري">بدل <input type="number" inputmode="numeric" min="0" step="10" data-mallow="${m.idx}" value="${allowanceOf(m.idx)}"> د.ك</label><button type="button" class="btn sm" data-mreset="${m.idx}">رمز جديد</button>${m.role!=='admin'?`<button type="button" class="btn sm danger" data-mdel="${m.idx}">حذف</button>`:''}</div>` : ''}</div>`).join('')
    + (S.isAdmin ? `<div class="madd"><input id="mEmail" type="email" dir="ltr" placeholder="إيميل الزميل"><button type="button" class="btn sm primary" id="mAdd">إضافة</button></div><p class="xs muted">بعد الإضافة يطلع لك رمز دخول مبدئي ترسله له. يدخل فيه بإيميله، ويختار اسمه وكلمة سر جديدة أول مرة.</p><p class="xs muted" id="mCode" role="status"></p>` : '');
}
const allowanceOf = idx => { const al = S.rules && S.rules.allowances; return al && al[String(idx)] != null ? +al[String(idx)] : (+(S.rules||{}).siteAllowance || 200); };
document.addEventListener('change', async ev => {
  const t = ev.target.closest('[data-mallow]'); if (!t || !S.isAdmin) return;
  const v = Math.max(0, +t.value || 0), r = {...(S.rules||{})}; r.allowances = {...(r.allowances||{}), [t.dataset.mallow]: v}; r.updatedAt = new Date().toISOString();
  await write(() => S.db.doc('config/rules').set(r), 'تم حفظ بدل ' + memberLabel(S.members.find(m => m.idx===+t.dataset.mallow) || {}));
});
async function membersCall(body){
  const {data, error} = await sb.functions.invoke('members', {body});
  if (error) { let m = ''; try { m = (await error.context.json()).error; } catch(e){} throw new Error(m || error.message); }
  return data;
}
async function reloadMembers(){ const {data} = await sb.from('members').select('*').order('idx'); S.members = data||[]; S.settings.team = teamNames(); renderMembers(); render(); }
function showCode(name, user, code){ $('mCode').innerHTML = `رمز <b>${esc(name)}</b>: <b dir="ltr" style="font-size:1.1rem;letter-spacing:2px">${code}</b><br>يدخل بـ «${esc(user)}» وهذا الرمز، ويختار كلمة سر جديدة أول ما يدخل.`; }
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-mreset],[data-mdel],#mAdd'); if (!t || !S.isAdmin) return;
  try {
    if (t.id==='mAdd') {
      const email = $('mEmail').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('اكتب إيميل صحيح'); return; }
      const idx = S.members.reduce((a,m)=>Math.max(a,m.idx),-1)+1;
      t.disabled = true; const r = await membersCall({action:'invite', idx, email});
      await reloadMembers(); if (r.code) showCode(email, email, r.code); else toast('تمت إضافة '+email);
    } else if (t.dataset.mreset) {
      const m = S.members.find(x=>x.idx===+t.dataset.mreset); t.disabled = true;
      const r = await membersCall({action:'upsert', idx:m.idx, reset:true}); renderMembers(); showCode(m.name||m.email, m.username||m.email, r.code);
    } else if (t.dataset.mdel) {
      const m = S.members.find(x=>x.idx===+t.dataset.mdel);
      if (t.dataset.sure!=='1') { t.dataset.sure='1'; t.textContent='متأكد؟'; return; }
      await membersCall({action:'remove', idx:m.idx}); await reloadMembers(); toast('تم حذف '+m.name);
    }
  } catch(e) { toast(e.message==='username_taken' ? 'اسم العائلة مستخدم لعضو ثاني' : 'ما تمت العملية'); t.disabled = false; }
});

/* ---------- auth ---------- */
function authView(state, msg){
  const el = $('auth'); el.hidden = state==='in';
  document.body.classList.toggle('locked', state!=='in');
  if (state==='in') return;
  $('authMsg').textContent = msg||'';
}
async function afterLogin(session){
  S.uid = session.user.id;
  const email = (session.user.email||'').toLowerCase();
  const {data: mem, error: me} = await sb.from('members').select('*').order('idx');
  if (me) { banner('تعذّر تحميل بيانات الفريق.'); return; }
  S.members = mem||[];
  const mine = S.members.find(m => (m.email||'').toLowerCase()===email);
  if (!mine) { await sb.auth.signOut(); authView('out', 'حسابك غير مسجل في الفريق. كلّم محمد يضيفك.'); return; }
  S.isAdmin = mine.role==='admin'; S.myIndex = mine.idx; S.me = mine;
  if (openSetup(session)) { authView('out'); $('auth').hidden = true; return; }
  document.body.classList.toggle('is-admin', S.isAdmin);
  const {data: rows, error} = await sb.from('docs').select('scope,coll,id,data').or(`scope.eq.${S.uid},scope.eq.team`);
  if (error) { banner('تعذّر تحميل البيانات. تأكد من الاتصال وافتح الداشبورد من جديد.'); return; }
  S.days = {}; S.leaves = []; S.visits = []; S.stations = []; S.plans = {}; S.rules = null;
  let settings = null;
  for (const r of rows) {
    if (r.coll==='settings') settings = r.data;
    else if (r.coll==='config' && r.id==='rules') S.rules = r.data;
    else if (r.coll==='days') S.days[r.id] = r.data;
    else if (r.coll==='plans') S.plans[r.id] = r.data;
    else if (S[r.coll] && Array.isArray(S[r.coll])) S[r.coll].push({id:r.id, ...(r.coll==='visits' ? normVisit(r.data) : r.coll==='stations' ? normSt(r.data) : r.data)});
  }
  S.settings = mergeSettings({name: mine.name, fullName: mine.full_name||'', ...(settings||{})});
  S.canWrite = true;
  authView('in'); banner('');
  render();
  renderInstallTip();
  refreshTeamData(true);
  takeSharedImage();
  offerPasskey();
}
async function offerPasskey(){
  if (!window.PublicKeyCredential) return;
  let has = false;
  try { const {data} = await sb.auth.passkey.list(); has = (data||[]).length > 0; } catch(e) { return; }
  let skipped = false; try { skipped = localStorage.getItem('mew.pkSkip')==='1'; } catch(e){}
  $('pkOffer').hidden = has || skipped;
}
$('pkYes').onclick = async () => {
  try { const {error} = await sb.auth.registerPasskey(); if (error) throw error; $('pkOffer').hidden = true; try { localStorage.setItem('mew.pkReg','1'); } catch(e){} toast('تم. المرة الجاية ادخل ببصمة الوجه أو الإصبع'); }
  catch(e) { toast('ما تم التفعيل. جرّب مرة ثانية'); }
};
$('pkNo').onclick = () => { $('pkOffer').hidden = true; try { localStorage.setItem('mew.pkSkip','1'); } catch(e){} };
$('authPasskey').onclick = async () => {
  $('authMsg').textContent = '';
  try { const {error} = await sb.auth.signInWithPasskey(); if (error) throw error; }
  catch(e) { $('authMsg').textContent = 'ما قدرنا ندخلك بالبصمة. ادخل بالإيميل وكلمة السر.'; }
};
{ let pk = false; try { pk = localStorage.getItem('mew.pkReg')==='1'; } catch(e){}
  if (pk && window.PublicKeyCredential) { $('authPasskey').hidden = false; $('authOr').hidden = false; } }
$('authForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const user = $('authUser').value.trim(), code = $('authCode').value.trim(); if (!user || !code) return;
  $('authGo').disabled = true; $('authMsg').textContent = '';
  try {
    const {data: email, error: e1} = await sb.rpc('login_email', {u: user});
    if (e1) throw e1;
    if (!email) { $('authMsg').textContent = 'هذا الاسم أو الإيميل غير مسجل بالفريق.'; return; }
    const {error} = await sb.auth.signInWithPassword({email, password: code});
    if (error) { $('authMsg').textContent = /invalid/i.test(error.message) ? 'كلمة السر غير صحيحة. إذا ما عندك كلمة سر، ادخل برمز على إيميلك.' : 'ما قدرنا ندخلك، حاول بعد دقيقة.'; return; }
    try { localStorage.setItem('mew.user', user); } catch(e){}
  } catch(e) { $('authMsg').textContent = 'تعذّر الاتصال، تأكد من الإنترنت.'; }
  finally { $('authGo').disabled = false; }
});

/* passwordless: 6-digit code by email, then pick a password */
const showOtp = on => { $('authEmailBox').hidden = on; $('authOtpBox').hidden = !on; $('authMsg').textContent = ''; if (on) { $('otpForm').hidden = false; $('otpVerify').hidden = true; const u = $('authUser').value.trim(); if (u.includes('@')) $('otpEmail').value = u; } };
$('authOtpOpen').onclick = () => showOtp(true);
$('authOtpBack').onclick = () => showOtp(false);
let otpEmail = '';
$('otpForm').addEventListener('submit', async ev => {
  ev.preventDefault(); otpEmail = $('otpEmail').value.trim().toLowerCase(); if (!otpEmail) return;
  $('otpSend').disabled = true; $('authMsg').textContent = '';
  const {error} = await sb.auth.signInWithOtp({email: otpEmail, options: {shouldCreateUser: true}});
  $('otpSend').disabled = false;
  if (error) { $('authMsg').textContent = /not allowed|Database error|signups/i.test(error.message) ? 'هذا الإيميل غير مسجل بالفريق. كلّم محمد.' : /rate|seconds/i.test(error.message) ? 'انتظر دقيقة وجرب مرة ثانية.' : 'ما قدرنا نرسل الرمز، حاول بعد شوي.'; return; }
  $('otpForm').hidden = true; $('otpVerify').hidden = false; $('otpSentTo').textContent = 'أرسلنا رمز إلى ' + otpEmail + '. شيك البريد الوارد والـ Junk.'; $('otpCode').focus();
});
$('otpVerify').addEventListener('submit', async ev => {
  ev.preventDefault(); const token = $('otpCode').value.replace(/\s/g,''); if (!token) return;
  $('otpGo').disabled = true; $('authMsg').textContent = '';
  const {error} = await sb.auth.verifyOtp({email: otpEmail, token, type: 'email'});
  $('otpGo').disabled = false;
  if (error) { $('authMsg').textContent = 'الرمز غير صحيح أو انتهى. اطلب رمز جديد.'; return; }
  try { localStorage.setItem('mew.user', otpEmail); } catch(e){}
});

/* first sign-in: profile (if missing) + own password */
function needsSetup(session){ const noProfile = !S.me || !S.me.name || !S.me.username; const noPw = !(session.user.user_metadata||{}).pw_set; return {noProfile, noPw, any: noProfile || noPw}; }
function openSetup(session){
  const n = needsSetup(session); if (!n.any) return false;
  $('setupProfile').hidden = !n.noProfile; $('setupPw').hidden = !n.noPw;
  $('suName').required = $('suUser').required = n.noProfile; $('suPw').required = n.noPw;
  $('setupHint').textContent = n.noProfile && n.noPw ? 'عرّفنا عليك واختر كلمة سر، والمرات الجاية تدخل باسم عائلتك وكلمة السر أو بالبصمة.' : n.noPw ? 'اختر كلمة سر خاصة فيك، والمرات الجاية تدخل فيها أو بالبصمة.' : 'عرّفنا عليك عشان يطلع اسمك للفريق.';
  $('setup').hidden = false; return true;
}
$('setupForm').addEventListener('submit', async ev => {
  ev.preventDefault(); $('suGo').disabled = true; $('suMsg').textContent = '';
  try {
    if (!$('setupProfile').hidden) {
      const {error} = await sb.rpc('set_my_profile', {p_name: $('suName').value, p_full_name: $('suFull').value, p_username: $('suUser').value});
      if (error) throw new Error(/login_key|unique/i.test(error.message) ? 'اسم العائلة هذا مستخدم لعضو ثاني. أضف حرف أو الاسم الثاني.' : 'ما انحفظت البيانات.');
    }
    if (!$('setupPw').hidden) {
      if (['123456','12345678','000000','111111'].includes($('suPw').value)) throw new Error('اختر كلمة سر غير الرمز المبدئي.');
      const {error} = await sb.auth.updateUser({password: $('suPw').value, data: {pw_set: true}});
      if (error) throw new Error(/weak|short|6/i.test(error.message) ? 'كلمة السر قصيرة.' : /same/i.test(error.message) ? 'اختر كلمة سر غير القديمة.' : 'ما انحفظت كلمة السر.');
    }
    $('setup').hidden = true; booted = false; const {data} = await sb.auth.getSession(); if (data.session) { booted = true; afterLogin(data.session); }
  } catch(e) { $('suMsg').textContent = e.message; }
  finally { $('suGo').disabled = false; }
});

$('signOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
try { $('authUser').value = localStorage.getItem('mew.user')||''; } catch(e){}
$('shareBtn').onclick = handOff;

let booted = false;
sb.auth.onAuthStateChange((ev, session) => {
  if (session && !booted) { booted = true; if (/access_token|error_description/.test(location.hash)) history.replaceState(null,'',location.pathname+'#home'); afterLogin(session); }
  if (!session && ev==='SIGNED_OUT') { booted = false; authView('out'); }
});
sb.auth.getSession().then(({data}) => { if (!data.session) authView('out'); });

})();
