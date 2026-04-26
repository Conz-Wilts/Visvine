// Minimal service worker for web push.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = data.title || 'New message';
  const options = {
    body: data.body || '',
    tag: data.tag,
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus().then(() => client.navigate?.(url));
      }
      return clients.openWindow?.(url);
    }),
  );
});
