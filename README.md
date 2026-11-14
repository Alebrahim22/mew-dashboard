# دوامي وبصماتي — نسخة الفريق

Static web app (no build step). Data/auth: Supabase project `mew-dashboard`. Photos and reports: Google Drive via the `drive` edge function and `apps-script.gs`.

- `index.html`, `app.js`, `app.css` — the app
- `config.js` — Supabase URL + publishable key (public by design; access is enforced by RLS)
- `supabase/functions/drive` — forwards uploads to the Apps Script web app (secrets `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`)
- `supabase/functions/members` — admin-only: add members, reset login codes
- Login: last name + 6-digit code, then passkey (Face ID / fingerprint)
