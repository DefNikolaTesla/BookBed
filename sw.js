const CACHE = "bookbed-v3";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./css/fonts.css",
  "./css/style.css",
  "./js/app.js",
  "./js/util.js",
  "./js/db.js",
  "./js/store.js",
  "./js/toasts.js",
  "./js/import.js",
  "./js/library.js",
  "./js/reader.js",
  "./js/epub-engine.js",
  "./js/pdf-engine.js",
  "./js/scene.js",
  "./js/spotlight.js",
  "./js/vendor/jszip.min.js",
  "./js/vendor/epub.min.js",
  "./js/vendor/dexie.min.js",
  "./js/vendor/pdf.min.mjs",
  "./js/vendor/pdf.worker.min.mjs",
  "./js/vendor/three.module.min.js",
  "./fonts/lora-latin-400-normal.woff2",
  "./fonts/lora-latin-700-normal.woff2",
  "./fonts/lora-latin-400-italic.woff2",
  "./fonts/inter-latin-400-normal.woff2",
  "./fonts/inter-latin-500-normal.woff2",
  "./fonts/inter-latin-600-normal.woff2",
  "./fonts/inter-latin-700-normal.woff2",
  "./fonts/jetbrains-mono-latin-400-normal.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./").then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});