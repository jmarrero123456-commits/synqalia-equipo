// synqalia · service worker: guarda la app en el dispositivo para poder abrirla sin conexión.
// - Páginas y archivos propios: primero la red (para recibir siempre la última versión); sin red, la copia guardada.
// - Librerías y tipografías externas: la copia guardada al momento y se refresca en segundo plano.
// - Nunca guarda datos ni llamadas a Supabase (las notas offline viven en IndexedDB, dentro de la app).
const CACHE = 'sq-app-v87';
const SHELL = ['/', '/mi.html', '/synqalia.css', '/notas.css', '/notas.js', '/lista.js', '/lista.css', '/mensajes.js', '/correo.js', '/buzon.js', '/buzon.css', '/graph-live.js', '/aviso-reunion.js', '/nueva-reunion.js', '/plaud.js', '/resumen.js', '/asistente.js', '/asistente.css', '/ia-saldo.js', '/ia-saldo.css', '/inicio.css', '/voz.js', '/compartir.js', '/compartir.css', '/manifest.webmanifest', '/icons/icon-192-r.png', '/icons/icon-512-r.png'];
const LIBS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all([...SHELL, ...LIBS].map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const EXTERNAL = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 5000))]);
    if (res && res.ok) c.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const page = await c.match(new URL(req.url).pathname.endsWith('/') ? '/' : '/mi.html'); if (page) return page; }
    throw e;
  }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

// Compartir desde el móvil (menú «Compartir» de Android → Synqalia): se guardan los archivos en el dispositivo
// (caché «sq-share», nunca en el servidor) y se abre Mi trabajo, que pregunta a qué tarea van.
const SHARE = 'sq-share';
async function recibirCompartido(req) {
  try {
    const fd = await req.formData();
    const c = await caches.open(SHARE);
    for (const k of await c.keys()) await c.delete(k);
    const files = fd.getAll('archivos').filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, 10);
    const meta = { fecha: Date.now(), title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), url: String(fd.get('url') || ''), files: [] };
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await c.put('/__share/f' + i, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
      meta.files.push({ k: '/__share/f' + i, nombre: f.name || ('archivo-' + (i + 1)), tipo: f.type || 'application/octet-stream', tam: f.size });
    }
    await c.put('/__share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) { /* si falla, se abre igualmente Mi trabajo */ }
  return Response.redirect('/mi.html#compartir', 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname === '/compartir') { e.respondWith(recibirCompartido(req)); return; }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (EXTERNAL.test(req.url)) e.respondWith(staleWhileRevalidate(req));
});

// Aviso de reunión: al tocar la notificación, trae Synqalia al frente (o la abre) y abre las notas de esa reunión
self.addEventListener('notificationclick', (e) => {
  const key = e.notification.data && e.notification.data.key;
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all.find((w) => /\/mi\.html/.test(new URL(w.url).pathname)) || all[0];
    if (c) { await c.focus(); if (key) c.postMessage({ type: 'sq-meet', key }); return; }
    await self.clients.openWindow('/mi.html#reuniones');
  })());
});
