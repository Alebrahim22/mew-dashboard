// M.E.W — Drive bridge. Paste into script.google.com (logged in as the Drive owner).
// Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
const SECRET = 'PASTE_SECRET_HERE';
const ROOT = 'M.E.W';

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'bad_json' }); }
  if (!req || req.secret !== SECRET) return out({ error: 'unauthorized' });
  try {
    if (req.action === 'upload') {
      const folder = path([ROOT, req.month, req.member, req.sub]);
      const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime, req.name);
      const old = folder.getFilesByName(req.name);
      while (old.hasNext()) old.next().setTrashed(true);
      const f = folder.createFile(blob);
      return out({ id: f.getId(), url: f.getUrl() });
    }
    if (req.action === 'get' || req.action === 'delete') {
      const f = DriveApp.getFileById(req.id);
      if (!ownedBy(f, req.member)) return out({ error: 'forbidden' });
      if (req.action === 'get') return out({ data: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getMimeType() });
      f.setTrashed(true); return out({ ok: true });
    }
    return out({ error: 'bad_action' });
  } catch (err) { return out({ error: String(err && err.message || err) }); }
}

// file must sit under  M.E.W / <month> / <member> / ...
function ownedBy(file, member) {
  const chain = [];
  let it = file.getParents();
  while (it.hasNext()) { const p = it.next(); chain.push(p.getName()); it = p.getParents(); }
  const r = chain.lastIndexOf(ROOT);
  return r >= 2 && chain[r - 2] === member;
}
function path(parts) {
  let f = DriveApp.getRootFolder();
  for (const p of parts) { if (!p) continue; const it = f.getFoldersByName(p); f = it.hasNext() ? it.next() : f.createFolder(p); }
  return f;
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
