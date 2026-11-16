import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("APPS_SCRIPT_URL"), secret = Deno.env.get("APPS_SCRIPT_SECRET");
  if (!url || !secret) return json({ error: "drive_not_configured" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return json({ error: "unauthorized" }, 401);
  const { data: me } = await sb.from("members").select("name").ilike("email", user.email).maybeSingle();
  if (!me) return json({ error: "not_member" }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const member = String(me.name).replace(/[\\/:*?"<>|]/g, "").trim() || "عضو";
  let payload: Record<string, unknown>;
  if (body.action === "upload") {
    if (!body.data || !body.name) return json({ error: "missing" }, 400);
    if (body.data.length > 14_000_000) return json({ error: "too_large" }, 413);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date : new Date().toISOString().slice(0, 10);
    const month = `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
    payload = { action: "upload", month, member, sub: String(body.folder ?? "").slice(0, 120), name: String(body.name).slice(0, 150), mime: body.mime || "application/octet-stream", data: body.data };
  } else if (body.action === "get" || body.action === "delete") {
    if (!/^[\w-]{10,}$/.test(body.id ?? "")) return json({ error: "bad_id" }, 400);
    let owner = member;
    if (body.action === "get" && body.share) { // a photo from a visit shared with me: read it from the sender's folder
      if (!/^[0-9a-f-]{36}$/.test(body.share)) return json({ error: "bad_share" }, 400);
      const { data: from } = await sb.rpc("share_owner", { p_share: body.share, p_file: body.id });
      if (!from) return json({ error: "not_shared" }, 403);
      owner = String(from).replace(/[\\/:*?"<>|]/g, "").trim() || "عضو";
    }
    payload = { action: body.action, id: body.id, member: owner };
  } else return json({ error: "bad_action" }, 400);

  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...payload, secret }), redirect: "follow" });
  const text = await r.text();
  try { return json(JSON.parse(text), r.ok ? 200 : 502); } catch { return json({ error: "drive_bad_response" }, 502); }
});
