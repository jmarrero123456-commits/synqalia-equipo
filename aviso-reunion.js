/* Synqalia · Aviso de reunión con «Unirse»
   - Unos minutos antes de cada reunión de hoy (y hasta 10 min después de empezar) sale un aviso abajo a la derecha
     con «Unirse»: abre Teams en esa reunión (app de escritorio; en el móvil, la app de Teams) y a la vez la sala
     de la reunión en Synqalia para tomar notas o grabar.
   - Si se permite, también como notificación del sistema (con Synqalia abierto, aunque esté en otra pestaña).
   - Lee la agenda de Microsoft 365 (personal_docs col «agenda»); el enlace de Teams viene en «unirse». */
(async () => {
  if (!document.getElementById('view-hoy') || window.__sqMeetAlert) return;
  window.__sqMeetAlert = true;
  await window.__sqReady;
  const sb = window.__sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const ANTES = 5;     // minutos antes de empezar
  const DESPUES = 10;  // sigue visible hasta 10 min después de la hora de inicio (si no se cierra)
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (t) => String(t || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  // solo enlaces https de Teams
  const teamsUrl = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && /(^|\.)teams\.microsoft\.com$|(^|\.)teams\.live\.com$/i.test(x.hostname) ? x.href : null; } catch { return null; } };
  // en el ordenador, abre directamente la app de Teams (msteams:); en el móvil, el enlace normal ya abre la app
  const appUrl = (u) => (isMobile ? u : u.replace(/^https:\/\/teams\.microsoft\.com\//i, 'msteams:/'));

  /* ---------- estilos ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .sq-meetalert{position:fixed;right:18px;bottom:18px;z-index:90;display:grid;gap:8px;width:min(380px,calc(100vw - 24px))}
  .sq-ma{background:#151a22;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px 14px;box-shadow:0 12px 34px rgba(0,0,0,.28);display:grid;gap:8px;animation:sqMaIn .25s ease-out}
  @keyframes sqMaIn{from{transform:translateY(10px);opacity:0}}
  .sq-ma .k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#5fe0cf}
  .sq-ma .k.now{color:#ffb35c}
  .sq-ma .t{font-weight:650;font-size:15px;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .sq-ma .s{font-size:12.5px;color:rgba(255,255,255,.62)}
  .sq-ma .b{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .sq-ma button,.sq-ma a{font:inherit;font-size:13px;font-weight:650;border-radius:9px;padding:7px 13px;cursor:pointer;text-decoration:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff}
  .sq-ma .join{background:#4b53bc;border-color:#4b53bc}
  .sq-ma .join:hover{filter:brightness(1.1)}
  .sq-ma .x{margin-left:auto;background:transparent;border:0;color:rgba(255,255,255,.55);padding:4px 6px;font-size:18px;line-height:1}
  .sq-ma .web{background:transparent;border:0;padding:4px 2px;color:rgba(255,255,255,.55);font-weight:500;font-size:12px;text-decoration:underline}
  .sq-ma .ntf{background:transparent;border:0;padding:0;color:#5fe0cf;font-weight:600;font-size:12px;text-align:left}
  @media (max-width:560px){.sq-meetalert{left:12px;right:12px;width:auto;bottom:calc(var(--sq-tabbar,62px) + 14px + env(safe-area-inset-bottom,0px))}}`;
  document.head.appendChild(css);
  const box = document.createElement('div'); box.className = 'sq-meetalert'; box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);

  /* ---------- agenda en vivo ---------- */
  const agenda = new Map();
  const { data: rows } = await sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', 'agenda').gte('id', isoDay(new Date()));
  (rows || []).forEach((r) => agenda.set(r.id, r.data));
  sb.channel('sq-meet-alert-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row || row.col !== 'agenda') return;
    if (p.eventType === 'DELETE') agenda.delete(row.id); else agenda.set(row.id, row.data);
    tick();
  }).subscribe();

  /* ---------- cerrados / avisados (se recuerdan en este dispositivo durante el día) ---------- */
  const KEY = 'sq-meetalert';
  const mem = (() => { try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); return m.dia === isoDay(new Date()) ? m : { dia: isoDay(new Date()), cerradas: [], notificadas: [] }; } catch { return { dia: isoDay(new Date()), cerradas: [], notificadas: [] }; } })();
  const saveMem = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} };
  const keyOf = (f, e) => f + '|' + e.inicio + '|' + clean(e.titulo).slice(0, 40);

  const proximas = () => {
    const now = new Date(); const f = isoDay(now);
    if (mem.dia !== f) { mem.dia = f; mem.cerradas = []; mem.notificadas = []; saveMem(); }
    const evs = (agenda.get(f)?.eventos || []);
    return evs.filter((e) => !e.todoElDia && e.inicio && !/cancelad|rechazad/i.test(e.estado || '') && (e.unirse || /teams/i.test(e.lugar || '')))
      .map((e) => { const [h, m] = e.inicio.split(':').map(Number); const t0 = new Date(now); t0.setHours(h, m, 0, 0); return { e, f, key: keyOf(f, e), min: Math.round((t0 - now) / 60000) }; })
      .filter((x) => x.min <= ANTES && x.min >= -DESPUES && !mem.cerradas.includes(x.key));
  };

  const join = (x) => {
    const u = teamsUrl(x.e.unirse);
    if (u) {
      if (isMobile) window.open(u, '_blank', 'noopener');
      else { const a = document.createElement('a'); a.href = appUrl(u); a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
    }
    openRoom(x);
    if (!mem.cerradas.includes(x.key)) mem.cerradas.push(x.key); saveMem(); paint(proximas());
  };
  const openRoom = (x) => {
    const e = x.e;
    const ev = { fecha: x.f, inicio: e.inicio, fin: e.fin || null, titulo: e.titulo, organiza: e.organiza || null, lugar: e.lugar || null, enlace: e.enlace || null };
    if (typeof window.__sqOpenMeet === 'function') window.__sqOpenMeet(ev);
  };

  /* ---------- pintar ---------- */
  function paint(list) {
    box.replaceChildren();
    list.slice(0, 3).forEach((x) => {
      const u = teamsUrl(x.e.unirse);
      const card = document.createElement('div'); card.className = 'sq-ma'; card.setAttribute('role', 'alert');
      const k = x.min > 1 ? `Empieza en ${x.min} min` : x.min >= 0 ? 'Empieza ahora' : `Empezó hace ${-x.min} min`;
      card.innerHTML = `<div class="b"><span class="k${x.min <= 0 ? ' now' : ''}">${esc(k)}</span><button type="button" class="x" title="Cerrar el aviso" aria-label="Cerrar el aviso">×</button></div>
        <div class="t">${esc(clean(x.e.titulo))}</div>
        <div class="s">${esc(x.e.inicio + (x.e.fin ? '–' + x.e.fin : '') + (x.e.lugar ? ' · ' + x.e.lugar : '') + (x.e.organiza ? ' · convoca ' + x.e.organiza : ''))}</div>
        <div class="b">${u ? '<button type="button" class="join" title="Abre Teams en esta reunión y sus notas en Synqalia">Unirse</button>' : ''}<button type="button" class="notes">Abrir notas</button>${u && !isMobile ? `<a class="web" href="${esc(u)}" target="_blank" rel="noopener" title="Por si no tienes la app de Teams">en el navegador</a>` : ''}</div>`;
      card.querySelector('.x').addEventListener('click', () => { if (!mem.cerradas.includes(x.key)) mem.cerradas.push(x.key); saveMem(); paint(proximas()); });
      card.querySelector('.join')?.addEventListener('click', () => join(x));
      card.querySelector('.notes').addEventListener('click', () => openRoom(x));
      card.querySelector('.web')?.addEventListener('click', () => { openRoom(x); if (!mem.cerradas.includes(x.key)) mem.cerradas.push(x.key); saveMem(); setTimeout(() => paint(proximas()), 50); });
      if ('Notification' in window && Notification.permission === 'default') {
        const n = document.createElement('button'); n.type = 'button'; n.className = 'ntf'; n.textContent = '🔔 Avisarme también con una notificación';
        n.addEventListener('click', async () => { try { await Notification.requestPermission(); } catch {} paint(proximas()); });
        card.appendChild(n);
      }
      box.appendChild(card);
    });
  }

  /* ---------- notificación del sistema (una vez por reunión) ---------- */
  const lastList = new Map();
  async function notify(x) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || mem.notificadas.includes(x.key)) return;
    mem.notificadas.push(x.key); saveMem();
    lastList.set(x.key, x);
    const title = x.min > 1 ? `Reunión en ${x.min} min` : 'La reunión empieza ahora';
    const opts = { body: clean(x.e.titulo) + ' · ' + x.e.inicio + '\nToca para unirte desde Synqalia', tag: 'sq-meet-' + x.key, icon: '/icons/icon-192-r.png', badge: '/icons/icon-192-r.png', data: { key: x.key }, requireInteraction: true };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return; }
    } catch {}
    try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); n.close(); }; } catch {}
  }
  // al tocar la notificación, el service worker trae Synqalia al frente y avisa aquí
  navigator.serviceWorker?.addEventListener('message', (m) => {
    if (m.data?.type !== 'sq-meet') return;
    window.focus();
    const x = proximas().find((y) => y.key === m.data.key) || lastList.get(m.data.key);
    if (x) openRoom(x);
  });

  function tick() {
    const list = proximas();
    paint(list);
    list.forEach((x) => { if (x.min >= -2) notify(x); });
  }
  tick();
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
