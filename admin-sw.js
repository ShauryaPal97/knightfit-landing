/* Knight Fit admin service worker: push notifications only (no offline cache; admin data is no-store).
   Lives at the site root so its scope can cover /admin. Registered by admin/admin.js. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  // iOS revokes push for a site that receives one without showing a notification, so always show one.
  e.waitUntil(self.registration.showNotification(d.title || 'Knight Fit', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/admin/icons/icon-192.png',
    badge: '/admin/icons/icon-192.png',
    data: { url: d.url || '/admin' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/admin', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var open = list.filter(function (c) { return new URL(c.url).pathname.indexOf('/admin') === 0; })[0];
    if (!open) return self.clients.openWindow(url);
    // The admin is already open: bring it forward and let it switch pages (hash routing).
    open.postMessage({ type: 'open', url: url });
    return open.focus();
  }));
});
