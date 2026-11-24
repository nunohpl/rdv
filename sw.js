// Guarda os arquivos do app no celular para funcionar sem internet.
const CACHE = 'rdv-v1.6.0';
const RUNTIME = 'rdv-runtime'; // peças do Whisper baixadas sob demanda (cdn.jsdelivr.net)
const FILES = ['./', './index.html', './styles.css', './app.js', './relatorio.js', './transcricao.js', './whisper-worker.js',
  './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './vendor/xlsx.full.min.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Cabeçalhos que liberam o Whisper a usar vários núcleos do processador (fica mais rápido).
function isolar(r) {
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    let r = await caches.match(req, { ignoreSearch: true });
    if (!r) r = await fetch(req).catch(() => null);
    if (!r && req.mode === 'navigate') r = await caches.match('./index.html');
    if (!r) return Response.error();
    if (req.mode === 'navigate' || req.destination === 'worker') return isolar(r);
    return r;
  })());
});
