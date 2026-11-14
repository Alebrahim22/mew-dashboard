// دوامي وبصماتي — service worker
// No offline caching of the app itself (so a new version always loads). It only:
//  1) receives images shared to the app (Android "Share" → دوامي) and hands them to the page
//  2) shows push notifications (presence window / exit reminders)
const SHARE_CACHE = 'mew-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('image');
        if (file && file.size) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put('shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } }));
        }
      } catch (err) {}
      return Response.redirect(new URL('./?share=1#home', self.registration.scope).href, 303);
    })());
  }
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'دوامي وبصماتي', {
    body: d.body || '', tag: d.tag || 'mew', renotify: true, dir: 'rtl', lang: 'ar',
    icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './#home' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || './#home', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) { await c.focus(); if ('navigate' in c) c.navigate(target); return; } }
    return self.clients.openWindow(target);
  })());
});
