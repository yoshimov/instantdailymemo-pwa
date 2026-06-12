const CACHE_NAME = "instant-daily-memo-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method === "POST" && new URL(request.url).pathname.endsWith("/share-target")) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const text = [formData.get("title"), formData.get("text"), formData.get("url")]
    .filter(Boolean)
    .join("\n\n");
  const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: "share-text", text });
  }
  return Response.redirect(`./?text=${encodeURIComponent(text)}`, 303);
}
