import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // who is calling? an admin member, or nobody yet (first-time setup only)
  const { count: admins } = await admin.from("members").select("idx", { count: "exact", head: true }).eq("role", "admin");
  if ((admins ?? 0) > 0) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user?.email) return json({ error: "unauthorized" }, 401);
    const { data: me } = await admin.from("members").select("role").ilike("email", user.email).maybeSingle();
    if (me?.role !== "admin") return json({ error: "forbidden" }, 403);
  }

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const idx = Number(b.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 50) return json({ error: "bad_idx" }, 400);
  const { data: cur } = await admin.from("members").select("*").eq("idx", idx).maybeSingle();
  const findUser = async (email: string) => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    return data?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
  };

  if (b.action === "remove") {
    if (!cur) return json({ ok: true });
    const u = await findUser(cur.email); if (u) await admin.auth.admin.deleteUser(u.id);
    await admin.from("members").delete().eq("idx", idx);
    return json({ ok: true });
  }
  if (b.action !== "upsert") return json({ error: "bad_action" }, 400);

  const row = {
    idx,
    name: String(b.name ?? cur?.name ?? "").trim().slice(0, 40),
    full_name: String(b.full_name ?? cur?.full_name ?? "").trim().slice(0, 80),
    username: String(b.username ?? cur?.username ?? "").trim().slice(0, 40),
    role: b.role === "admin" || (b.role === undefined && cur?.role === "admin") ? "admin" : "member",
    email: cur?.email ?? `m${idx}-${crypto.randomUUID().slice(0, 8)}@mew-team.app`,
  };
  if (!row.name || !row.username) return json({ error: "name_and_username_required" }, 400);
  const { error } = await admin.from("members").upsert(row);
  if (error) return json({ error: /login_key/.test(error.message) ? "username_taken" : error.message }, 400);

  let code: string | undefined;
  const u = await findUser(row.email);
  if (!u || b.reset) {
    code = newCode();
    const r = u ? await admin.auth.admin.updateUserById(u.id, { password: code })
                : await admin.auth.admin.createUser({ email: row.email, password: code, email_confirm: true });
    if (r.error) return json({ error: r.error.message }, 400);
  }
  return json({ ok: true, code });
});
