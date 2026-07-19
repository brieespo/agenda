// Minimal service worker — just enough for PWA installability, not an
// offline-first cache. This is a live-data app (Supabase + Google
// Calendar), so every same-origin request is network-first: only fall
// back to the cached app shell when the network request fails outright
// (actually offline), never to serve stale content while online.
const CACHE_NAME = 'agenda-shell-v1';
const SHELL_ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Cross-origin requests (Supabase REST/Realtime, Google Calendar API,
  // the CDN-hosted supabase-js bundle) pass straight through, never cached
  // or intercepted — caching an API response here would be exactly the
  // "aggressive caching of live data" this is meant to avoid.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./')))
  );
});

// Morning-brief push notifications (see morning-brief Edge Function).
self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){}
  event.waitUntil(self.registration.showNotification(data.title || 'Agenda', {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: {url: data.url || './'}
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then((list) => {
      const url = event.notification.data && event.notification.data.url || './';
      for(const client of list){ if(client.url.includes(new URL(url, self.location.href).pathname) && 'focus' in client) return client.focus(); }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
