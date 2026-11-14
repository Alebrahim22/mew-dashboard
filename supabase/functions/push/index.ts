// Push reminders for دوامي وبصماتي.
// actions: vapid (public key) · test (send to caller) · tick (cron, every 5 minutes)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://mew-dashboard-8pcx.onrender.com";

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function secret(name: string) { const { data } = await admin.from("app_secrets").select("value").eq("name", name).maybeSingle(); return data?.value as string | undefined; }
async function vapid() {
  let pub = await secret("vapid_public"), priv = await secret("vapid_private");
  if (!pub || !priv) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    pub = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
    priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
    await admin.from("app_secrets").upsert([{ name: "vapid_public", value: pub }, { name: "vapid_private", value: priv }], { onConflict: "name", ignoreDuplicates: true });
    pub = await secret("vapid_public"); priv = await secret("vapid_private"); // in case another call won the race
  }
  webpush.setVapidDetails(SITE, pub!, priv!);
  return pub!;
}
async function sendTo(userId: string, payload: Record<string, string>) {
  const { data: subs } = await admin.from("push_subs").select("endpoint,sub").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 1800, urgency: "high" }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }
  return sent;
}

// ---- roster (same rules as the app) ----
const SHIFT: Record<string, { long: string; start: number }> = { m: { long: "الخفارة الصباحية", start: 420 }, e: { long: "الخفارة المسائية", start: 900 }, n: { long: "الخفارة الليلية", start: 1380 } };
const H = 480;
const CREW_MORNING: Record<string, string> = { A: "2026-11-03", B: "2026-11-02", C: "2026-11-01", D: "2026-11-04", E: "2026-11-05" };
const PATTERN = ["m", "e", "n", null, null];
const FULLDAY = new Set(["sick", "vacation", "mission"]);
const dayNo = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const isoOf = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const mins = (t?: string) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const to12 = (m: number) => { m = ((m % 1440) + 1440) % 1440; let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, "0"); const ap = h < 12 ? "ص" : "م"; h = h % 12 || 12; return `${h}:${mm} ${ap}`; };
function rel(t: string, k: string, kind: string) {
  let r = ((((mins(t)! - SHIFT[k].start) % 1440) + 1440) % 1440);
  if (r > H + 600) r -= 1440;
  if (kind === "in" && r > 1440 - 180) r -= 1440;
  return r;
}
type Doc = Record<string, any>;

async function tickUser(uid: string, nowAbs: number) {
  const today = Math.floor(nowAbs / 1440);
  const { data: rows } = await admin.from("docs").select("scope,coll,id,data").or(`scope.eq.${uid},and(scope.eq.team,coll.eq.config)`);
  let own: Doc = {}, rules: Doc = {}; const days: Record<string, Doc> = {}; const leaves: Doc[] = []; const visits: Doc[] = [];
  for (const r of rows ?? []) {
    if (r.coll === "settings") own = r.data ?? {};
    else if (r.coll === "config" && r.id === "rules") rules = r.data ?? {};
    else if (r.coll === "days") days[r.id] = r.data ?? {};
    else if (r.coll === "leaves") leaves.push(r.data ?? {});
    else if (r.coll === "visits") visits.push(r.data ?? {});
  }
  const st = { crew: "D", presAfter: 120, presLen: 60, ...own, ...Object.fromEntries(Object.entries(rules).filter(([k]) => ["presAfter", "presLen", "grace"].includes(k))) };
  const out: { key: string; title: string; body: string }[] = [];
  for (const dn of [today, today - 1]) {
    const date = isoOf(dn), rec = days[date] ?? {};
    const t = rec.type;
    let k: string | null;
    if (t === "off") k = null; else if (SHIFT[t]) k = t; else { const ref = CREW_MORNING[st.crew] ?? CREW_MORNING.D; k = PATTERN[(((dn - dayNo(ref)) % 5) + 5) % 5]; }
    if (!k) continue;
    const s0 = dn * 1440 + SHIFT[k].start, end = s0 + H;
    if (nowAbs < s0 - 20 || nowAbs > end + 60) continue;
    const lv = leaves.filter(l => l.from <= date && date <= (l.to || l.from));
    if (lv.some(l => FULLDAY.has(l.kind))) continue;
    const ex = new Set<string>();
    for (const l of lv) {
      if (l.kind === "exemption") for (const c of l.covers ?? []) ex.add(c);
      if (l.kind === "permission" && l.t1 && l.t2) { const a = rel(l.t1, k, "x"), b = rel(l.t2, k, "x"); if (a <= 5) ex.add("in"); if (b >= H - 5) ex.add("out"); if (a <= st.presAfter + st.presLen && b >= st.presAfter) ex.add("presence"); }
    }
    for (const v of visits) { if ((v.claimDate || v.visitDate) !== date) continue; if (v.exemption === "inPres") { ex.add("in"); ex.add("presence"); } if (v.exemption === "out") ex.add("out"); }
    const N = nowAbs;
    if (!rec.in && !ex.has("in") && N >= s0 - 15 && N < s0)
      out.push({ key: `${date}|in`, title: "بصمة الدخول", body: `${SHIFT[k].long} تبدأ الساعة ${to12(SHIFT[k].start)}. لا تنسى بصمة الدخول.` });
    const base = rec.in ? s0 + rel(rec.in, k, "in") : s0;
    const ps = base + st.presAfter, pe = ps + st.presLen;
    if (!rec.presence && !ex.has("presence")) {
      if (N >= ps && N < pe - 15) out.push({ key: `${date}|pres-open`, title: "نافذة التواجد مفتوحة", body: `سجّل بصمة التواجد الحين. النافذة لين الساعة ${to12(pe)}.` });
      else if (N >= pe - 15 && N < pe) out.push({ key: `${date}|pres-close`, title: "باقي ربع ساعة على التواجد", body: `نافذة التواجد تقفل الساعة ${to12(pe)}. سجّل البصمة قبلها.` });
    }
    if (!rec.out && !ex.has("out") && N >= end && N < end + 60)
      out.push({ key: `${date}|out`, title: "بصمة الخروج", body: `انتهت ${SHIFT[k].long}. لا تنسى بصمة الخروج.` });
  }
  let sent = 0;
  for (const n of out) {
    const { error } = await admin.from("push_log").insert({ user_id: uid, key: n.key });
    if (error) continue; // already sent
    sent += await sendTo(uid, { title: n.title, body: n.body, tag: n.key, url: "./#home" });
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  try {
    if (b.action === "vapid") return json({ key: await vapid() });
    if (b.action === "test") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "unauthorized" }, 401);
      await vapid();
      const sent = await sendTo(user.id, { title: "دوامي وبصماتي", body: "التنبيهات شغالة. بيوصلك تنبيه قبل الدخول، ووقت نافذة التواجد، وعند نهاية الخفارة.", tag: "test" });
      return json({ ok: true, sent });
    }
    if (b.action === "tick") {
      const tok = await secret("cron_token");
      if (!tok || b.token !== tok) return json({ error: "unauthorized" }, 401);
      await vapid();
      const nowAbs = typeof b.at === "string" ? Math.floor(Date.parse(b.at + "Z") / 60000) : Math.floor((Date.now() + 3 * 3600000) / 60000); // Kuwait local time in minutes since epoch (b.at = "YYYY-MM-DDTHH:MM" for tests)
      const { data: subs } = await admin.from("push_subs").select("user_id");
      const users = [...new Set((subs ?? []).map(s => s.user_id as string))].filter(u => !b.user || u === b.user);
      let sent = 0;
      for (const u of users) { try { sent += await tickUser(u, nowAbs); } catch (_) { /* next */ } }
      await admin.from("push_log").delete().lt("sent_at", new Date(Date.now() - 3 * 86400000).toISOString());
      return json({ ok: true, users: users.length, sent, log: b.at ? (await admin.from("push_log").select("key").gte("sent_at", new Date(Date.now() - 60000).toISOString())).data : undefined });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
