const CACHE_NAME = 'pracht-tech-shell-v2';
const APP_SHELL = [
  '/tech/',
  '/tech/index.html',
  '/tech/tech.js',
  '/tech/app.js',
  '/tech/styles.css',
  '/manifest.webmanifest',
  '/tech/icons/icon-192.png',
  '/tech/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

const isSupabaseRequest = (request) => request.url.includes('supabase.co');

const isStaticAsset = (request) => {
  if (['style', 'script', 'image'].includes(request.destination)) {
    return true;
  }

  return ['.css', '.js', '.png', '.webmanifest'].some((ext) => request.url.endsWith(ext));
};

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (isSupabaseRequest(request)) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/tech/index.html'))
    );
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return response;
        })
      )
    );
  }
});
