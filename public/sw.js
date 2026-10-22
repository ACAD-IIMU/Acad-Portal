// ACAD portal service worker — shows "class alerts" (Web Push) on the student's phone or
// laptop when a class in the next 48 hours is added, moved, changes room or is cancelled.
// The portal server sends { title, body, tag, url } as JSON (lib/pushNotify.ts).
// Nothing else is cached or intercepted: the portal works exactly as before.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ACAD timetable update';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/acad-logo.png',
      badge: '/acad-logo.png',
      tag: data.tag || 'acad',
      renotify: true,
      data: { url: data.url || '/home' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/home';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
