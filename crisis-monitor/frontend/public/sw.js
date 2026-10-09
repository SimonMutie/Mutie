/* The Lens — shows escalation alerts as device notifications, even when the site is closed or the device was asleep. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data ? event.data.text() : "" }; }
  const title = m.title || "The Lens — escalation alert";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: m.body || "A conflict escalation was flagged.",
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: m.tag || "escalation-alert",
      renotify: true,
      requireInteraction: true,
      data: { url: m.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});
