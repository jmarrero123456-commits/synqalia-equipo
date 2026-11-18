/* Synqalia · Microsoft 365 en directo
   - Sincroniza al abrir Synqalia y al volver a la pestaña (además de los avisos al instante de Microsoft).
   - «Teams · sin leer» en Hoy, con «Abrir en Teams ↗» que lleva a ese chat.
   - «Unirse a Teams ↗» en la sala de cada reunión de Teams. */
(async () => {
  if (!document.getElementById('view-hoy') || window.__sqGraphLive) return;
  window.__sqGraphLive = true;
  await window.__sqReady;
  const sb = window.__sb;
  if (!sb || window.__sqOffline) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const call = async (action, extra = {}) => {
    const { data, error } = await sb.functions.invoke('graph', { body: { action, ...extra } });
    if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
    return data;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // solo enlaces https a dominios de Microsoft (Outlook, Teams)
  const safeUrl = (u) => {
    try { const x = new URL(String(u || '')); return x.protocol === 'https:' && /(^|\.)(microsoft\.com|cloud\.microsoft|office\.com|live\.com|teams\.microsoft\.com)$/i.test(x.hostname) ? x.href : null; }
    catch { return null; }
  };

  /* ---------- estilos ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .sq-teams .item{grid-template-columns:1fr auto}
  .sq-teams .who{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
  .sq-teams .hora{color:var(--muted);font-size:12px}
  .sq-teams .pide{font-size:11px;font-weight:700;color:var(--warn);text-transform:uppercase;letter-spacing:.04em}
  .sq-teams .ult{color:var(--muted);font-size:13px;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .sq-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ok);font-weight:600}
  .sq-live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)}
  a.btn.sq-join{background:#4b53bc;border-color:#4b53bc;color:#fff}
  a.btn.sq-join:hover{filter:brightness(1.08);color:#fff}`;
  document.head.appendChild(css);

  /* ---------- estado de la conexión ---------- */
  let st = null, lastQuick = 0, running = false;
  async function status() { try { st = await call('status'); } catch { st = null; } return st; }
  async function quick(reason) {
    if (running || !st?.connected) return;
    const last = Math.max(lastQuick, st.last_ok ? new Date(st.last_ok).getTime() : 0);
    if (Date.now() - last < 60000) return; // ya está al día
    running = true; lastQuick = Date.now();
    try { await call('sync', { quick: true, reason }); } catch { /* el respaldo de 10 min lo cubre */ }
    running = false; status().then(paintLive);
  }

  /* ---------- datos (teams y agenda) con cambios en vivo ---------- */
  const data = { teams: new Map(), agenda: new Map(), teams_visto: new Map() };
  // Misma regla que Mensajes (mensajes.js): abierta en Synqalia desde su último mensaje = vista
  const normV = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
  const firmaV = (d) => [d.fecha || '', d.hora || '', normV(d.ultimo)].join('|');
  const sinLeer = (id, d) => d && (d.noLeido === true || d.noLeido === 'true') && data.teams_visto.get(id)?.firma !== firmaV(d);
  async function load(col) {
    const { data: rows } = await sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', col);
    data[col] = new Map((rows || []).map((r) => [r.id, r.data]));
  }
  sb.channel('sq-graph-live-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row || !data[row.col]) return;
    if (p.eventType === 'DELETE') data[row.col].delete(row.id); else data[row.col].set(row.id, row.data);
    if (row.col === 'teams' || row.col === 'teams_visto') paintTeams();
    if (row.col === 'agenda') addJoin();
  }).subscribe();

  /* ---------- Hoy · Teams sin leer ---------- */
  const hoy = document.getElementById('view-hoy');
  const card = document.createElement('section');
  card.className = 'card sq-teams'; card.hidden = true;
  card.innerHTML = `<div class="row-between"><h2>Teams · sin leer</h2><span class="sq-live" hidden>Al instante</span></div><div class="list"></div>`;
  const mailCard = document.getElementById('hoy-mail')?.closest('section');
  if (mailCard) mailCard.after(card); else hoy.appendChild(card);

  function paintTeams() {
    if (!st?.connected) { card.hidden = true; return; }
    card.hidden = false;
    const list = card.querySelector('.list');
    const items = [...data.teams.entries()].filter(([id, d]) => sinLeer(id, d))
      .sort((a, b) => (b[1].pide ? 1 : 0) - (a[1].pide ? 1 : 0) || String(b[1].fecha || b[1].capturado || '').localeCompare(String(a[1].fecha || a[1].capturado || '')));
    if (!items.length) { list.innerHTML = `<p class="note">Nada pendiente en Teams.</p>`; return; }
    list.innerHTML = items.slice(0, 8).map(([, d]) => {
      const url = safeUrl(d.enlace);
      return `<div class="item"><div><div class="who"><span class="title">${esc(d.nombre)}</span><span class="hora">${esc(d.hora || '')}</span>${d.pide ? '<span class="pide">Te piden algo</span>' : ''}</div>
        <div class="detail">${esc(d.accion || '')}</div><div class="ult">${esc(d.ultimo || '')}</div></div>
        <div class="actions">${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" title="Abre este chat en Teams">Abrir en Teams ↗</a>` : ''}</div></div>`;
    }).join('') + (items.length > 8 ? `<p class="note">Y ${items.length - 8} chats más sin leer.</p>` : '');
  }
  function paintLive() {
    const live = card.querySelector('.sq-live');
    if (live) { live.hidden = !(st?.directo || []).length; live.title = 'Microsoft avisa a Synqalia en cuanto llega algo nuevo'; }
    paintTeams();
  }

  /* ---------- Sala de reunión · Unirse a Teams ---------- */
  function findEvent(href) {
    for (const d of data.agenda.values()) for (const e of (d?.eventos || [])) if (e.enlace && e.enlace === href) return e;
    return null;
  }
  function addJoin() {
    const room = document.getElementById('meet-room');
    if (!room || room.hidden) return;
    const ol = [...room.querySelectorAll('.mt-head a.btn')].find((a) => /\/calendar\/item\//.test(a.href));
    if (!ol || room.querySelector('.sq-join')) return;
    const ev = findEvent(ol.getAttribute('href'));
    const url = safeUrl(ev?.unirse);
    if (!url) return;
    const j = document.createElement('a');
    j.className = 'btn sq-join'; j.href = url; j.target = '_blank'; j.rel = 'noopener';
    j.textContent = 'Unirse a Teams ↗'; j.title = 'Entra en la reunión de Teams';
    ol.before(j);
  }
  const room = document.getElementById('meet-room');
  if (room) new MutationObserver(addJoin).observe(room, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

  /* ---------- texto de la ventanita de Microsoft 365 ---------- */
  new MutationObserver(() => {
    const pop = document.querySelector('.ms-pop');
    if (!pop || pop.dataset.sqLive) return;
    pop.dataset.sqLive = '1';
    for (const p of pop.querySelectorAll('p')) if (/cada 10 minutos/.test(p.textContent)) {
      p.textContent = (st?.directo || []).length
        ? 'Al instante: Microsoft avisa a Synqalia en cuanto llega un correo, cambia una reunión o te escriben en Teams. También se actualiza al abrir Synqalia.'
        : 'Se actualiza al abrir Synqalia y cada 10 minutos.';
    }
  }).observe(document.body, { childList: true });

  /* ---------- arranque ---------- */
  await Promise.all([load('teams'), load('teams_visto'), load('agenda'), status()]);
  paintLive(); addJoin();
  quick('abrir');
  document.addEventListener('visibilitychange', () => { if (!document.hidden) quick('volver'); });
  window.addEventListener('focus', () => quick('foco'));
  window.addEventListener('online', () => quick('red'));
  setInterval(() => status().then(paintLive), 120000);
})();
