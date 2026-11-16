
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

const TPL_SRC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAWwBGYDASIAAhEBAxEB/8QAHAABAAEFAQEAAAAAAAAAAAAAAAYBBAUHCAMC/8QAZxAAAAQDAwMKDwsKBgAFAwALAAIDBAEFEQYSExQVIQcWFyIjMUFRlNIkNjdSU1VWV2Fxc4GTstMlMjNCdHaSlbPR1DQ1Q1RiY3KRorFkgqGjwfAIJoPC4UR1hEZl4vEnRcPEpLTj/8QAGgEBAQEBAQEBAAAAAAAAAAAAAAECAwUEBv/EAC4RAQABAwMEAwACAAcBAQEAAAABAgMREhRREyExYQQyQSIzI0JSYnGBoQWx8P/aAAwDAQACEQMRAD8A6pAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUFQAUAAAAAAAAAAoKCoAKAKgAoArQUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABUBQBWgAKCoAAAAAAAABAAgAqqgACIDXtrtUF3JLXo2fllmJhOnSjbKatlSEoWtPjUh/qNhDSeqLi7J73AUMkprbcUPvAM/si2l72Vo/TIc4NkW0neytF6ZDnDljU8s7PbRWYeztTVAzCwbOCIHyt6qQsTG3tMI0Gc1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvfykf1wrzg1oPe/lI/rhXnAOi9kW0neytF6ZDnBsi2k72VovTIc4c6a0Hvf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sNiaadv23onn4sN9RwbarligGV2Jpp2/beiefiw2Jpp2/beiefiw31HBtquWKAZXYmmnb9t6J5+LDYmmnb9t6J5+LDfUcG2q5YoBldiaadv23onn4sNiaadv23onn4sN9RwbarligGV2Jpp2/beiefiw2Jpp2/beiefiw31HBtquWKAZXYmmnb9t6J5+LDYmmnb9t6J5+LDfUcG2q5YoBldiaadv23onn4sNiaadv23onn4sN9RwbarligGV2Jpp2/beiefiw2Jpp2/beiefiw31HBtquWKAZXYmmnb9t6J5+LDYmmnb9t6J5+LDfUcG2q5YoBldieadv23oXn4sU2KZt2/behefig31PCbarlixZupY0du0Ha6JcpQ+DWLtTQhxVhvw8G8M/sVTTt+29C8/FCuxVNu37b0Lz8WG9pn8Xb1R4liwGT2Kpp2/behefig2Kpp2/behefig3scJt55YwBk9iqadv23oXn4oNiqadv23oXn4oN7HC7eeWMAZPYqmnb9t6F5+KDYqmnb9t6F5+KDexwm2nlg5gxbTFoo0foJuGykNsmeFYREKhqT2ZI7xUU3qJa1wyODXPFxjaWxTNu37b0Lv8UGxVNu37b0Lv8UM1fKt1eaWos1x4lhmjdJo3TQbJlIkSFCQLxD1GU2Kpt2/behd/ig2Kpp2/behd/ixve08Jt55YsBlNimadv23oXn4sV2KZt2/behd/ixN9TwbeeWKAZTYpm3b9t6F5+KDYpm3b9t6F5+KDe08G2nliwGT2KJt2/beid/ihUupTNu37b0Lv8UG+p4NtVyxYDK7E007ftvQvPxYbE007ftvRPPxYb6jg21XLFAMrsTTTt+29E8/FhsTTTt+29E8/Fi76jg21XLFAMrsTTTt+29E8/FhsTTTt+29E8/FhvqODbVcsUAyuxPNO37b0Lz8WKG1Kpp2/behefihN9TwberliwGR2Kpt2/behefihXYpm3b9t6F5+LDe08G3q5Y0Bkdiqbdv23oXn4oNiqbdv23oXn4oN9TwbarljgGR2Kpt2/behefig2Kpt2/behefig31PBtquWOAZHYqm3b9t6F5+KDYqm3b9t6F5+KDfU8G2q5Y4Bkdiqbdv23oXn4oNiqbdv23oXn4oN9TwbarljgGR2Kpt2/behefig2Kpt2/behefig31PBtquWOAZHYqm3b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kfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIQEe172V7ppHy9LnBr3sr3TSPl6XOASEBHte9le6aR8vS5wa97K900j5elzgEhAR7XvZXumkfL0ucGveyvdNI+Xpc4BIRjrSdL00+Sq+pEY/XvZXumkfL0ucMfP7Z2XPJJgRO0kliaLZSEIQfJdbH9oByLbrpA1IfJH+3HS2pv1Vbb+Ta+oObbbIqK2A1JMNNQ+5H4P3w6T1OSm2Ura+Ta+oA2oAAARAIgKoAAIgNJ6pGJsmvcBO+prbc6PON2DXlrrATKc2wQtDJ7VOpI4TbZNcRapq3i1r8fR/oA5K1O7UzCQ2UfyJ1YTP7Jy4IufKElLpTF3tECxqM7rzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmBrzQ7x8p5EpzB0drAth3z5xyFvzQ1gWw75845C35oDnHXmh3j5TyJTmCmvNDvHyvkSnMHR+sC2HfPnHIW/NDWBbDvnzjkLfmgOVLc2lmdp1bMM0rHKSFpK1LqCKKal3SeEfjFHUOppe2ULZ3tG4tPUF1rAth3z5xyFvzRkbBWGeWZnk3msztE5nbuYwJA51m5Ert3e97o/0gAngAABEAiAqgAAiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQCICq//9k=';
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
const TPL_W = 1126, TPL_H = 1456;
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
  put(fmtDMY(v.claimDate), 782, 389, 165);
  put(v.visitTime ? to12(v.visitTime) : '', 434, 389, 155);
  put(v.workType, 131, 389, 145);
  const sts = stationsOf(v);
  const put2 = (vals, cx, maxW) => { const u = vals.map(s => s||''); if (u.length < 2 || u[0]===u[1]) return put(u[0], cx, 644, maxW);
    put(u[0], cx, 627, maxW, 19); put(u[1], cx, 661, maxW, 19); };
  put2(sts.map(s => s.area), 968, 190);
  put2(sts.map(s => s.block), 777, 155);
  put2(sts.map(s => s.street), 605, 155);
  if (sts.length > 1) { put(sts[0].stationName, 434, 627, 160, 19); put(sts[1].stationName, 434, 661, 160, 19); } else put(v.stationName, 434, 644, 160);
  // top notes cell: fixed wording; any free-text notes go into the description below
  const OK_LINES = new Set([OBS[0], OBS[1], OBS[3]]);
  const extraNotes = (v.notes||'').trim();
  const issuesOf = st => (st.desc||'').split(/\n+/).map(s=>s.trim()).filter(s => s && !OK_LINES.has(s)).length > 0;
  const issues = sts.some(issuesOf) || !!extraNotes;
  put(issues ? 'يوجد ملاحظات مذكورة أدناه' : 'لا يوجد ملاحظات', 199, 644, 280, 18);
  // description on the dotted lines
  x.font = F(20); x.textAlign = 'right';
  const lines = [];
  const fixDesc = st => issues ? (st.desc||'').split('\n').map(s => s.trim()===OBS[0] ? 'المحطة سليمة خارجياً' : s).join('\n') : (st.desc||'');
  const descText = sts.length > 1 ? sts.map(st => `محطة ${st.stationName}:\n${fixDesc(st) || 'لا يوجد ملاحظات'}`).join('\n') : fixDesc(sts[0]);
  for (const para of (descText + (extraNotes ? '\n'+extraNotes : '') + (nPhotos ? '\nمرفق '+(nPhotos===1?'صورة واحدة':nPhotos+' صور')+' للموقع' : '')).split(/\n+/)) {
    let cur = '';
    for (const w of para.split(/\s+/)) { const t = cur ? cur+' '+w : w; if (x.measureText(t).width > 985 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
  }
  const y0 = 845, step = 28.4;
  lines.slice(0,12).forEach((l,i) => x.fillText(l, 1058, y0 + i*step));
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
window.__fp = {sb, exifGps, ensureStations, parseFpText, fpShiftDate, fpClassify, ocrText, mergeSettings, S, render, takeSharedImage, renderInstallTip, setTP: v => { teamProg = v; }, renderShareBox, sendShare};

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
