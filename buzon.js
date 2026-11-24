/* Synqalia · Correo · Bandeja completa (24/11/2026)
   Todo el buzón de Outlook sin entrar en Outlook, en directo contra Microsoft Graph (función «buzon» de Supabase):
   carpetas, últimos 90 días (la búsqueda va a todo el buzón), leído / no leído, bandera, mover, archivar, eliminar,
   adjuntos, Responder · Responder a todos · Reenviar y Correo nuevo.
   Arriba: Todas · Outlook · Gmail (Gmail se conecta más adelante) y el cambio Bandeja ↔ Pendientes (la vista de siempre).
   Si el correo está en Pendientes, se ve su resumen, lo que te piden y la respuesta sugerida.
   Como en Mensajes (24/11): una fila por conversación; tocar abre y tocar otra vez (✕, Esc o Volver) cierra; abrir no
   la quita de la lista (solo deja de estar en negrita); con «No leídos» se queda mientras está abierta y sale al cerrarla.
   Se ve el hilo completo (todas las carpetas, también tus respuestas), el más reciente arriba y abierto, los anteriores
   plegados y el texto citado oculto en «Mostrar texto citado».
   Diseño: PC = carpetas · lista · correo; Z Fold abierto = lo mismo más estrecho (opción A);
   Z Fold cerrado = lista y el correo a pantalla completa con «‹ Volver». */
(async () => {
  const view = document.getElementById('view-correo');
  if (!view || window.__sqBuzon) return;
  window.__sqBuzon = true;
  await window.__sqReady;
  const sb = window.__sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const card = view.querySelector('section.card');
  if (!card) return;

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = {
    reply: '<path d="M10 9V5l-7 7 7 7v-4c5 0 8.5 1.5 11 5-1-5-4-10-11-11z"/>',
    replyall: '<path d="M7 8V5l-5 7 5 7v-3"/><path d="M13 9V5l-6 7 6 7v-4c4.5 0 7.5 1.5 9 5-.8-5-3.5-10-9-11z"/>',
    fwd: '<path d="M14 9V5l7 7-7 7v-4c-5 0-8.5 1.5-11 5 1-5 4-10 11-11z"/>',
    arch: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
    del: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    unread: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/><circle cx="19" cy="5" r="3" fill="currentColor"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    move: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>',
    task: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/>',
    clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const svg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ico[k]}</svg>`;
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const hhmm = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const dayKey = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  function corto(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const k = dayKey(d), today = dayKey(now), ayer = dayKey(new Date(now.getTime() - 864e5));
    if (k === today) return hhmm(d);
    if (k === ayer) return 'Ayer';
    if (now - d < 6 * 864e5) return DOW[d.getDay()];
    return `${d.getDate()} ${MES[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
  }
  const largo = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} · ${hhmm(d)}`; };
  const nombres = (l) => (l || []).map((p) => p.nombre || p.mail).filter(Boolean).join(', ');
  const mails = (l) => (l || []).map((p) => p.mail).filter(Boolean).join('; ');
  const mqNarrow = window.matchMedia('(max-width: 599px)');

  async function call(op, extra = {}) {
    const { data, error } = await sb.functions.invoke('buzon', { body: { op, ...extra } });
    if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  /* ---------- Pendientes de Synqalia (para el resumen y la respuesta sugerida) ---------- */
  const smart = new Map(); // conversationId → correo de Pendientes
  async function loadSmart() {
    const { data: rows } = await sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', 'correos');
    smart.clear();
    for (const r of rows || []) if (r.data?.conv && r.data.estado !== 'gestionado') smart.set(r.data.conv, { id: r.id, ...r.data });
  }

  /* ---------- estado ---------- */
  const st = {
    modo: (() => { try { return localStorage.getItem('sq-correo-modo') || 'bandeja'; } catch { return 'bandeja'; } })(),
    cuenta: 'todas', ver: 'todos', bandera: false, adjuntos: false, q: '', carpeta: 'inbox',
    carpetas: [], items: [], next: null, sel: null, hilo: null, cargando: false, fopen: false, err: '', compose: null,
  };

  /* ---------- Bandeja ↔ Pendientes ---------- */
  const head = card.querySelector('.row-between');
  const modes = document.createElement('div');
  modes.className = 'bz-modes'; modes.setAttribute('role', 'tablist'); modes.setAttribute('aria-label', 'Vista del correo');
  modes.innerHTML = `<button type="button" role="tab" data-m="bandeja">Bandeja</button><button type="button" role="tab" data-m="pend">Pendientes <span class="bz-cnt" id="bz-cnt-pend"></span></button>`;
  // barra propia arriba de la tarjeta (en el móvil la cabecera del Correo está oculta)
  const modebar = document.createElement('div');
  modebar.className = 'bz-modebar';
  modebar.appendChild(modes);
  card.insertBefore(modebar, card.firstChild);
  const root = document.createElement('div');
  root.className = 'bz';
  card.appendChild(root);
  function setModo(m) {
    st.modo = m;
    try { localStorage.setItem('sq-correo-modo', m); } catch {}
    card.classList.toggle('bz-on', m === 'bandeja');
    modes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === m)));
    if (m === 'bandeja' && !st.carpetas.length && !st.cargando) start();
  }
  modes.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) setModo(b.dataset.m); });

  // contadores de Pendientes (los pinta la vista de siempre)
  const cnt = (id) => (document.getElementById(id)?.textContent || '').trim();
  function syncCounts() {
    const p = cnt('count-mias');
    const a = document.getElementById('bz-cnt-pend'); if (a) a.textContent = p;
    root.querySelectorAll('[data-cnt]').forEach((x) => { x.textContent = cnt(x.dataset.cnt); });
  }
  ['count-mias', 'count-urg'].forEach((id) => { const n = document.getElementById(id); if (n) new MutationObserver(syncCounts).observe(n, { childList: true, characterData: true, subtree: true }); });
  const goPend = (c) => { setModo('pend'); document.querySelector(`#mail-filter [data-c="${c}"]`)?.click(); };

  /* ---------- esqueleto ---------- */
  root.innerHTML = `
  <div class="bz-top">
    <div class="bz-seg bz-acc" role="tablist" aria-label="Cuenta">
      <button type="button" role="tab" data-acc="todas" aria-selected="true">Todas</button>
      <button type="button" role="tab" data-acc="outlook" aria-selected="false">Outlook</button>
      <button type="button" role="tab" data-acc="gmail" aria-selected="false">Gmail</button>
    </div>
    <div class="bz-row">
      <label class="bz-fsel"><span class="bz-sr">Carpeta</span><select id="bz-fsel"><option value="inbox">Bandeja</option></select></label>
      <button type="button" class="bz-chip bz-only-s" data-quick="noleidos" aria-pressed="false">No leídos</button>
      <button type="button" class="bz-chip bz-only-s" data-goto="mias">Te piden <span data-cnt="count-mias"></span></button>
      <button type="button" class="bz-ibtn bz-only-s" id="bz-fbtn" aria-label="Más filtros" aria-expanded="false">${svg('filter', 16)}</button>
      <div class="bz-more">
        <div class="bz-seg bz-ver" role="tablist" aria-label="Leídos">
          <button type="button" role="tab" data-ver="todos" aria-selected="true">Todos</button>
          <button type="button" role="tab" data-ver="noleidos" aria-selected="false">No leídos</button>
          <button type="button" role="tab" data-ver="leidos" aria-selected="false">Leídos</button>
        </div>
        <button type="button" class="bz-chip bz-urg" data-goto="urgente" title="Abre Pendientes · Urgente">Urgente <span data-cnt="count-urg"></span></button>
        <button type="button" class="bz-chip bz-only-l" data-goto="mias" title="Abre Pendientes · Te piden algo">Te piden algo <span data-cnt="count-mias"></span></button>
        <button type="button" class="bz-chip" data-tg="bandera" aria-pressed="false">Con bandera</button>
        <button type="button" class="bz-chip" data-tg="adjuntos" aria-pressed="false">Con adjuntos</button>
      </div>
      <label class="bz-search">${svg('search', 16)}<span class="bz-sr">Buscar en todo el buzón</span><input type="search" id="bz-q" placeholder="Buscar en todo el buzón" enterkeyhint="search"></label>
    </div>
  </div>
  <div class="bz-body">
    <nav class="bz-folders" aria-label="Carpetas"></nav>
    <div class="bz-col"><div class="bz-status" aria-live="polite"></div><ul class="bz-list" aria-label="Correos"></ul><div class="bz-foot"></div></div>
    <article class="bz-pane" aria-live="polite"></article>
  </div>`;
  const $ = (s) => root.querySelector(s);
  modebar.appendChild(root.querySelector('.bz-acc'));
  const newBtn = document.createElement('button');
  newBtn.type = 'button'; newBtn.className = 'bz-new'; newBtn.id = 'bz-new';
  newBtn.innerHTML = `${svg('pen', 15)}<span>Nuevo correo</span>`;
  newBtn.setAttribute('aria-label', 'Nuevo correo');
  modebar.appendChild(newBtn);
  // PC ancho (≥1100 px): los filtros de Pendientes y el «Último barrido» suben a esta barra, sin dejar hueco (24/11)
  const mfilt = document.getElementById('mail-filter'), mupd = document.getElementById('mail-updated');
  if (mfilt && mupd) {
    const ph1 = document.createComment('mail-filter'), ph2 = document.createComment('mail-updated');
    mfilt.before(ph1); mupd.before(ph2);
    const wideMQ = matchMedia('(min-width: 1100px)');
    const placeTop = () => {
      if (wideMQ.matches) { modes.after(mfilt); modebar.insertBefore(mupd, newBtn); modebar.classList.add('bz-wide'); }
      else { ph1.after(mfilt); ph2.after(mupd); modebar.classList.remove('bz-wide'); }
    };
    placeTop(); wideMQ.addEventListener('change', placeTop);
  }
  const list = $('.bz-list'), pane = $('.bz-pane'), statusEl = $('.bz-status'), foot = $('.bz-foot'), folders = $('.bz-folders'), fsel = $('#bz-fsel');

  /* ---------- filtros ---------- */
  modebar.querySelector('.bz-acc').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    st.cuenta = b.dataset.acc;
    modebar.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    reload();
  });
  root.querySelector('.bz-ver').addEventListener('click', (e) => { const b = e.target.closest('[data-ver]'); if (b) { st.ver = b.dataset.ver; paintFilters(); reload(); } });
  root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => { st.ver = st.ver === 'noleidos' ? 'todos' : 'noleidos'; paintFilters(); reload(); }));
  root.querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => { st[b.dataset.tg] = !st[b.dataset.tg]; paintFilters(); reload(); }));
  root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => goPend(b.dataset.goto)));
  $('#bz-fbtn').addEventListener('click', () => { st.fopen = !st.fopen; paintFilters(); });
  fsel.addEventListener('change', () => openFolder(fsel.value));
  let qT = null;
  $('#bz-q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value.trim(); reload(); }, 450); });
  $('#bz-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qT); st.q = e.target.value.trim(); reload(); } });
  newBtn.addEventListener('click', () => { if (st.modo !== 'bandeja') setModo('bandeja'); openCompose({ tipo: 'nuevo' }); });
  function paintFilters() {
    root.querySelectorAll('[data-ver]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.ver === st.ver)));
    root.querySelectorAll('[data-quick]').forEach((x) => x.setAttribute('aria-pressed', String(st.ver === 'noleidos')));
    root.querySelectorAll('[data-tg]').forEach((x) => x.setAttribute('aria-pressed', String(!!st[x.dataset.tg])));
    root.classList.toggle('bz-fopen', st.fopen);
    $('#bz-fbtn').setAttribute('aria-expanded', String(st.fopen));
    $('#bz-fbtn').classList.toggle('on', st.ver !== 'todos' || st.bandera || st.adjuntos);
  }

  /* ---------- carpetas ---------- */
  const WKN = { inbox: 'Bandeja', drafts: 'Borradores', sentitems: 'Enviados', archive: 'Archivo', deleteditems: 'Eliminados', junkemail: 'Correo no deseado' };
  const fname = (f) => WKN[f.wk] || f.nombre;
  function paintFolders() {
    const main = st.carpetas.filter((f) => f.wk), mine = st.carpetas.filter((f) => !f.wk);
    const li = (f) => `<button type="button" data-f="${esc(f.wk || f.id)}" aria-current="${(f.wk || f.id) === st.carpeta ? 'true' : 'false'}" class="${f.dentro ? 'in' : ''}"><span>${esc(fname(f))}</span>${f.noLeidos ? `<b>${f.noLeidos}</b>` : (f.wk === 'drafts' && f.total ? `<i>${f.total}</i>` : '')}</button>`;
    folders.innerHTML = main.map(li).join('') + (mine.length ? `<div class="bz-flbl">Mis carpetas</div>` + mine.map(li).join('') : '');
    fsel.innerHTML = st.carpetas.map((f) => `<option value="${esc(f.wk || f.id)}"${(f.wk || f.id) === st.carpeta ? ' selected' : ''}>${esc(fname(f))}</option>`).join('');
  }
  folders.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) openFolder(b.dataset.f); });
  function openFolder(f) { st.carpeta = f; st.q = ''; $('#bz-q').value = ''; paintFolders(); reload(); }
  const moveOptions = () => st.carpetas.filter((f) => f.wk !== 'drafts' && (f.wk || f.id) !== st.carpeta).map((f) => `<option value="${esc(f.wk || f.id)}">${esc(fname(f))}</option>`).join('');

  /* ---------- lista (una fila por conversación, como en Mensajes) ---------- */
  function threads() {
    const map = new Map();
    for (const m of st.items) {
      const k = m.conv || m.id;
      let t = map.get(k);
      if (!t) { t = { conv: k, msgs: [], latest: m }; map.set(k, t); }
      t.msgs.push(m);
      if (String(m.fecha) > String(t.latest.fecha)) t.latest = m;
    }
    return [...map.values()].map((t) => ({ ...t, ids: t.msgs.map((x) => x.id), unread: t.msgs.some((x) => !x.leido), adj: t.msgs.some((x) => x.adj), bandera: t.msgs.some((x) => x.bandera), n: t.msgs.length }))
      .sort((a, b) => String(b.latest.fecha).localeCompare(String(a.latest.fecha)));
  }
  const threadOf = (conv) => threads().find((t) => t.conv === conv);
  function rowHtml(t) {
    const m = t.latest, s = smart.get(t.conv);
    const nivel = s?.nivel === 'bloquea' ? '<span class="bz-tag urg">Urgente</span>' : s?.nivel === 'pide' ? '<span class="bz-tag pide">Te piden</span>' : '';
    const enviados = st.carpeta === 'sentitems' || st.carpeta === 'drafts';
    const quien = enviados ? ('Para: ' + (nombres(m.para) || '—')) : [...new Set(t.msgs.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((x) => x.de?.nombre || x.de?.mail).filter(Boolean))].slice(0, 3).join(', ') || '—';
    return `<li class="bz-item${t.unread ? ' unread' : ''}${st.sel === t.conv ? ' sel' : ''}" data-conv="${esc(t.conv)}"><button type="button" class="bz-rowbtn" aria-expanded="${st.sel === t.conv}">
      <span class="r1"><span class="dot" aria-hidden="true"></span><span class="acc o" title="Outlook">O</span><b class="from">${esc(quien)}</b>${t.n > 1 ? `<span class="bz-n" title="${t.n} mensajes">${t.n}</span>` : ''}<span class="ics">${t.bandera ? svg('flag', 13) : ''}${t.adj ? svg('clip', 13) : ''}</span><span class="when">${esc(corto(m.fecha))}</span></span>
      <span class="r2">${nivel}<span class="subj">${esc(m.asunto)}</span></span>
      <span class="r3">${esc(m.prev)}</span>
      ${t.unread ? '<span class="bz-sr">Sin leer</span>' : ''}
    </button></li>`;
  }
  function paintList() {
    if (st.cuenta === 'gmail') {
      list.innerHTML = '';
      statusEl.innerHTML = `<div class="bz-empty"><b>Gmail todavía no está conectado.</b><br>Lo conectamos en el siguiente paso; de momento aquí ves Outlook.</div>`;
      foot.innerHTML = '';
      return;
    }
    const ts = threads();
    statusEl.innerHTML = st.err ? `<div class="bz-empty err">${esc(st.err)} <button type="button" class="bz-link" data-retry>Reintentar</button></div>`
      : st.cargando && !ts.length ? '<div class="bz-empty">Cargando correos…</div>'
      : !ts.length ? `<div class="bz-empty">${st.q ? 'No hay correos que coincidan con la búsqueda.' : st.ver === 'noleidos' ? 'No tienes correos sin leer aquí. 👌' : 'No hay correos con estos filtros en los últimos 90 días.'}</div>`
      : st.q ? `<div class="bz-hint">Resultados en todo el buzón para «${esc(st.q)}»</div>` : '';
    list.innerHTML = ts.map(rowHtml).join('');
    foot.innerHTML = st.next ? `<button type="button" class="bz-more-btn" data-more>${st.cargando ? 'Cargando…' : 'Cargar más'}</button>`
      : (ts.length && !st.q ? '<p class="bz-hint">Aquí se ven los últimos 90 días. Para algo más antiguo, usa el buscador.</p>' : '');
  }
  statusEl.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) reload(); });
  foot.addEventListener('click', (e) => { if (e.target.closest('[data-more]')) more(); });
  // tocar abre; tocar otra vez el mismo, cierra
  list.addEventListener('click', (e) => { const li = e.target.closest('.bz-item'); if (!li) return; if (st.sel === li.dataset.conv) closeMsg(); else openThread(li.dataset.conv); });

  // Con «No leídos», la conversación abierta se queda en la lista hasta que la cierras o pasas a otra
  function dropIfRead(conv) {
    if (!conv || st.ver !== 'noleidos') return;
    st.items = st.items.filter((x) => x.conv !== conv || !x.leido);
  }
  function keepOpen(fresh) {
    if (!st.sel) return fresh;
    const mine = st.items.filter((x) => x.conv === st.sel && !fresh.some((y) => y.id === x.id));
    return [...fresh, ...mine];
  }

  let reqN = 0;
  async function reload() {
    st.err = ''; st.items = []; st.next = null;
    if (st.sel) closeMsg(true);
    if (st.cuenta === 'gmail') { paintList(); return; }
    const n = ++reqN; st.cargando = true; paintList();
    try {
      const [r] = await Promise.all([call('lista', { carpeta: st.carpeta, ver: st.ver, bandera: st.bandera, adjuntos: st.adjuntos, q: st.q }), loadSmart().catch(() => null)]);
      if (n !== reqN) return;
      st.items = r.items || []; st.next = r.next;
    } catch (e) { if (n === reqN) st.err = 'No se pudo cargar el correo: ' + e.message; }
    if (n === reqN) { st.cargando = false; paintList(); }
  }
  async function more() {
    if (!st.next || st.cargando) return;
    st.cargando = true; paintList();
    try { const r = await call('lista', { next: st.next }); st.items.push(...(r.items || []).filter((x) => !st.items.some((y) => y.id === x.id))); st.next = r.next; }
    catch (e) { st.err = e.message; }
    st.cargando = false; paintList();
  }
  // actualización silenciosa (sin perder lo abierto)
  async function refreshQuiet() {
    if (st.modo !== 'bandeja' || view.hidden || document.hidden || st.cargando || st.q || st.cuenta === 'gmail' || st.compose) return;
    try {
      const r = await call('lista', { carpeta: st.carpeta, ver: st.ver, bandera: st.bandera, adjuntos: st.adjuntos });
      const fresh = r.items || [];
      const extra = st.items.slice(fresh.length).filter((x) => !fresh.some((y) => y.id === x.id));
      st.items = keepOpen([...fresh, ...extra]);
      paintList();
      call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch { /* la próxima vez */ }
  }

  /* ---------- conversación abierta (hilo completo, el más reciente arriba) ---------- */
  // enlaces clicables (se buscan en el texto original y luego se escapa; antes «<https://…>» se rompía)
  const URL_RE = /\bhttps?:\/\/[^\s<>"'()\[\]{}]+/g;
  const linkify = (t) => {
    t = String(t || ''); let out = '', last = 0, mm;
    URL_RE.lastIndex = 0;
    while ((mm = URL_RE.exec(t))) {
      let u = mm[0]; while (/[.,;:!?]$/.test(u)) u = u.slice(0, -1);
      out += esc(t.slice(last, mm.index)) + `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.length > 70 ? u.slice(0, 67) + '…' : u)}</a>`;
      last = mm.index + u.length; URL_RE.lastIndex = last;
    }
    return out + esc(t.slice(last));
  };
  function reading(on) {
    root.classList.toggle('bz-reading', on);
    if (on && mqNarrow.matches) { try { if (!history.state?.bz) history.pushState({ bz: 1 }, ''); } catch {} window.scrollTo({ top: 0 }); }
  }
  window.addEventListener('popstate', () => { if (root.classList.contains('bz-reading')) closeMsg(false, true); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || st.modo !== 'bandeja' || view.hidden || !st.sel || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    closeMsg();
  });
  function closeMsg(quiet, fromPop) {
    const conv = st.sel;
    st.sel = null; st.hilo = null; st.compose = null; pane.innerHTML = '';
    if (root.classList.contains('bz-reading')) {
      root.classList.remove('bz-reading');
      if (!fromPop && mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} }
    }
    dropIfRead(conv);
    if (quiet) return;
    paintList();
    const li = conv && [...list.querySelectorAll('.bz-item')].find((x) => x.dataset.conv === conv);
    if (li && mqNarrow.matches) li.scrollIntoView({ block: 'center' });
  }
  let openN = 0;
  async function openThread(conv) {
    const prev = st.sel;
    st.sel = conv; st.compose = null; st.hilo = null;
    dropIfRead(prev);
    const t = threadOf(conv);
    paintList();
    reading(true);
    pane.innerHTML = `<div class="bz-loading">Abriendo${t ? ' «' + esc(t.latest.asunto) + '»' : ''}…</div>`;
    const n = ++openN;
    try {
      const r = await call('hilo', { conv });
      if (n !== openN) return;
      st.hilo = r.mensajes || [];
      if (!st.hilo.length) throw new Error('Esta conversación ya no está en tu buzón.');
      const hadUnread = t?.unread;
      for (const x of st.items) if (x.conv === conv) x.leido = true;
      paintList(); paintThread();
      if (hadUnread) call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch (e) { if (n === openN) pane.innerHTML = `<div class="bz-empty err">${esc(e.message)}</div>`; }
  }
  const lastIn = (h = st.hilo) => (h || []).find((x) => !x.mio) || (h || [])[0];
  const safeOutlook = (u) => { try { const x = new URL(u || ''); return x.protocol === 'https:' && /(^|\.)(office\.com|outlook\.com|cloud\.microsoft|office365\.com|live\.com)$/i.test(x.hostname) ? x.href : ''; } catch { return ''; } };
  function msgHtml(x, i) {
    const open = i === 0;
    const de = x.mio ? 'Tú' : (x.de?.nombre || x.de?.mail || '');
    return `<section class="bz-m${open ? ' open' : ''}${x.mio ? ' mio' : ''}" data-mid="${esc(x.id)}">
      <button type="button" class="bz-mh" aria-expanded="${open}">
        <span class="who"><b>${esc(de)}</b>${!x.mio && x.de?.mail && x.de?.nombre ? `<small>&lt;${esc(x.de.mail)}&gt;</small>` : ''}</span>
        <span class="ics">${x.adj ? svg('clip', 13) : ''}</span>
        <span class="when">${esc(open ? largo(x.fecha) : corto(x.fecha))}</span>
        <span class="pv">${esc(x.prev)}</span>
      </button>
      <div class="bz-mb">
        <div class="bz-meta">Para: ${esc(nombres(x.para) || '—')}${x.cc?.length ? ' · CC: ' + esc(nombres(x.cc)) : ''}</div>
        ${x.adjuntos?.length ? `<div class="bz-adj">${x.adjuntos.map((a) => `<button type="button" class="bz-att" data-att="${esc(a.id)}" data-mid="${esc(x.id)}">${svg('clip', 15)}<span><b>${esc(a.nombre)}</b><small>${esc(tam(a.tam))} · Ver o descargar</small></span></button>`).join('')}</div>` : ''}
        <div class="bz-text">${linkify(x.cuerpo || x.prev || '')}</div>
        ${x.citado ? `<button type="button" class="bz-link bz-qt" aria-expanded="false">Mostrar texto citado</button><div class="bz-text bz-quoted" hidden>${linkify(x.citado)}</div>` : ''}
      </div>
    </section>`;
  }
  function paintThread() {
    const h = st.hilo; if (!h?.length) return;
    const top = h[0], s = smart.get(top.conv);
    const t = threadOf(top.conv);
    const flagged = t ? t.bandera : h.some((x) => x.bandera);
    const enlace = safeOutlook(top.enlace);
    const sum = s && (s.resumen || s.peticion) ? `<div class="bz-sum">
        ${s.resumen ? `<div class="r"><span>Resumen</span><p>${esc(s.resumen)}</p></div>` : ''}
        ${s.peticion ? `<div class="r pide"><span>Te piden</span><p><b>${esc(s.peticion)}</b></p></div>` : ''}
      </div>` : '';
    pane.innerHTML = `
      <div class="bz-phead">
        <div class="bz-ptools">
          <button type="button" class="bz-back" data-a="volver">${svg('back', 20)}<span>Volver</span></button>
          <span class="bz-tools">
            <button type="button" class="bz-ibtn" data-a="archivar" title="Archivar" aria-label="Archivar">${svg('arch')}</button>
            <button type="button" class="bz-ibtn" data-a="eliminar" title="Eliminar" aria-label="Eliminar">${svg('del')}</button>
            <button type="button" class="bz-ibtn" data-a="noleido" title="Marcar como no leído" aria-label="Marcar como no leído">${svg('unread')}</button>
            <button type="button" class="bz-ibtn${flagged ? ' on' : ''}" data-a="bandera" title="${flagged ? 'Quitar bandera' : 'Marcar con bandera'}" aria-label="${flagged ? 'Quitar bandera' : 'Marcar con bandera'}" aria-pressed="${flagged}">${svg('flag')}</button>
            <label class="bz-ibtn bz-movew" title="Mover a carpeta">${svg('move')}<span class="bz-sr">Mover a carpeta</span><select data-a="mover"><option value="">Mover a…</option>${moveOptions()}</select></label>
            <button type="button" class="bz-ibtn" data-a="tarea" title="Pasar a tarea" aria-label="Pasar a tarea">${svg('task')}</button>
            ${enlace ? `<a class="bz-ibtn" href="${esc(enlace)}" target="_blank" rel="noopener" title="Abrir en Outlook" aria-label="Abrir en Outlook">${svg('ext')}</a>` : ''}
            <button type="button" class="bz-ibtn bz-close" data-a="volver" title="Cerrar (Esc)" aria-label="Cerrar">✕</button>
          </span>
        </div>
        <h3><span class="acc o" title="Outlook">O</span>${esc(top.asunto)}</h3>
        <div class="bz-meta">${h.length > 1 ? `${h.length} mensajes · ` : ''}último: ${esc(largo(top.fecha))}</div>
      </div>
      <div class="bz-reply">
        <button type="button" class="bz-btn pri" data-a="responder">${svg('reply', 16)}<span>Responder</span></button>
        <button type="button" class="bz-btn" data-a="todos">${svg('replyall', 16)}<span>Responder a todos</span></button>
        <button type="button" class="bz-btn" data-a="reenviar">${svg('fwd', 16)}<span>Reenviar</span></button>
      </div>
      <p class="bz-msgst" aria-live="polite"></p>
      ${sum}
      <div class="bz-compose-slot"></div>
      <div class="bz-thread">${h.map(msgHtml).join('')}</div>`;
    // respuesta sugerida: si en Pendientes te piden algo, la caja de respuesta ya viene abierta con la propuesta
    if (s && s.sugerida && (s.nivel === 'pide' || s.nivel === 'bloquea' || s.peticion)) openCompose({ tipo: 'responder', texto: s.sugerida, sugerida: true });
  }
  const tam = (b) => !b ? '' : b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const msgStatus = (t, bad) => { const p = pane.querySelector('.bz-msgst'); if (p) { p.textContent = t; p.classList.toggle('bad', !!bad); } };

  pane.addEventListener('click', async (e) => {
    const att = e.target.closest('[data-att]');
    if (att) return download(att.dataset.mid, att.dataset.att, att);
    const mh = e.target.closest('.bz-mh');
    if (mh) { const sec = mh.parentElement; const on = !sec.classList.contains('open'); sec.classList.toggle('open', on); mh.setAttribute('aria-expanded', String(on)); const x = st.hilo?.find((y) => y.id === sec.dataset.mid); const w = mh.querySelector('.when'); if (x && w) w.textContent = on ? largo(x.fecha) : corto(x.fecha); return; }
    const qt = e.target.closest('.bz-qt');
    if (qt) { const q = qt.nextElementSibling; q.hidden = !q.hidden; qt.setAttribute('aria-expanded', String(!q.hidden)); qt.textContent = q.hidden ? 'Mostrar texto citado' : 'Ocultar texto citado'; return; }
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'volver') return closeMsg();
    if (!st.hilo?.length) return;
    const conv = st.sel, t = threadOf(conv), last = lastIn();
    if (a === 'responder' || a === 'todos' || a === 'reenviar') return openCompose({ tipo: a });
    if (a === 'noleido') {
      b.disabled = true;
      try {
        await call('leido', { id: last.id, valor: false });
        for (const x of st.items) if (x.id === last.id) x.leido = false;
        toast('Marcado como no leído');
        closeMsg();
        call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
      } catch (err) { msgStatus(err.message, true); b.disabled = false; }
      return;
    }
    if (a === 'bandera') {
      const v = !(t ? t.bandera : st.hilo.some((x) => x.bandera));
      const ids = v ? [last.id] : st.items.filter((x) => x.conv === conv && x.bandera).map((x) => x.id).concat(st.hilo.filter((x) => x.bandera).map((x) => x.id));
      b.disabled = true;
      try {
        await Promise.all([...new Set(ids.length ? ids : [last.id])].map((id) => call('bandera', { id, valor: v })));
        for (const x of st.items) if (x.conv === conv) x.bandera = v ? x.id === last.id || x.bandera : false;
        for (const x of st.hilo) x.bandera = v ? x.id === last.id : false;
        paintList(); paintThread();
      } catch (err) { msgStatus(err.message, true); b.disabled = false; }
      return;
    }
    if (a === 'archivar' || a === 'eliminar') return quitar(a === 'archivar' ? 'archive' : 'deleteditems', a === 'archivar' ? 'Archivado' : 'Enviado a Elementos eliminados');
    if (a === 'tarea') {
      if (typeof window.__sqAddTask !== 'function') return msgStatus('No se pudo crear la tarea desde aquí.', true);
      const s = smart.get(conv);
      b.disabled = true;
      const id = await window.__sqAddTask({ titulo: (s?.peticion || last.asunto).slice(0, 300), detalle: `Correo de ${last.de?.nombre || last.de?.mail || ''} · ${last.asunto}`, prioridad: s?.nivel === 'bloquea' ? 'Alta' : 'Media', origen: 'correo', ref: s?.id || null, persona: last.mio ? null : (last.de?.nombre || null), extra: { enlace: last.enlace || null } });
      b.disabled = false;
      msgStatus(id ? 'Tarea creada: la tienes en Tareas.' : 'No se pudo crear la tarea.', !id);
    }
  });
  pane.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-a="mover"]');
    if (!sel || !sel.value) return;
    const f = st.carpetas.find((x) => (x.wk || x.id) === sel.value);
    quitar(sel.value, 'Movido a ' + (f ? fname(f) : 'otra carpeta'));
  });
  // archivar, eliminar o mover: la conversación entera de esta carpeta (como Outlook)
  async function quitar(destino, txt) {
    const conv = st.sel; if (!conv) return;
    const ts = threads(), i = ts.findIndex((x) => x.conv === conv);
    const ids = st.items.filter((x) => x.conv === conv).map((x) => x.id);
    if (!ids.length) return;
    msgStatus('Un momento…');
    try {
      await call('mover', { ids, destino });
      st.items = st.items.filter((x) => x.conv !== conv);
      toast(txt);
      closeMsg(true);
      paintList();
      const nx = threads()[Math.min(i, threads().length - 1)];
      if (!mqNarrow.matches && nx) openThread(nx.conv);
      call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch (err) { msgStatus(err.message, true); }
  }
  async function download(mid, aid, btn) {
    btn.disabled = true; msgStatus('Descargando el adjunto…');
    try {
      const r = await call('adjunto', { id: mid, aid });
      const bin = atob(r.b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: r.tipo || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = r.nombre || 'adjunto'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msgStatus('');
    } catch (err) { msgStatus(err.message, true); }
    btn.disabled = false;
  }


  /* ---------- sugerencias de personas en «Para» y «CC» (como Outlook) ---------- */
  const localPeople = () => {
    const m = new Map();
    const add = (n, a) => { a = String(a || '').toLowerCase().trim(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) && !m.has(a)) m.set(a, { nombre: n || a, mail: a }); };
    try { JSON.parse(localStorage.getItem('sq-cc-hist') || '[]').forEach((a) => add('', a)); } catch {}
    for (const x of [...st.items, ...(st.hilo || [])]) [x.de, ...(x.para || []), ...(x.cc || [])].forEach((p) => p && add(p.nombre, p.mail));
    return [...m.values()];
  };
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function peopleAC(input) {
    if (!input || input.dataset.ac) return;
    input.dataset.ac = '1';
    input.setAttribute('autocomplete', 'off'); input.removeAttribute('list');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    const box = document.createElement('ul');
    box.className = 'bz-ac'; box.setAttribute('role', 'listbox'); box.hidden = true;
    box.id = 'bz-ac-' + Math.random().toString(36).slice(2, 8);
    input.setAttribute('aria-controls', box.id);
    const wrap = input.parentElement; wrap.classList.add('bz-acw'); wrap.appendChild(box);
    let items = [], act = -1, timer = null, seq = 0;
    const token = () => { const v = input.value; const i = Math.max(v.lastIndexOf(';'), v.lastIndexOf(',')); return v.slice(i + 1).trim(); };
    const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); act = -1; };
    const paint = () => {
      if (!items.length) { close(); return; }
      box.innerHTML = items.map((p, i) => `<li role="option" id="${box.id}-${i}" aria-selected="${i === act}" data-i="${i}"><b>${esc(p.nombre)}</b><small>${esc(p.mail)}</small></li>`).join('');
      box.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (act >= 0) input.setAttribute('aria-activedescendant', `${box.id}-${act}`); else input.removeAttribute('aria-activedescendant');
    };
    const pick = (p) => {
      if (input.dataset.chips) { input.value = ''; close(); input.dispatchEvent(new CustomEvent('bz-pick', { detail: p })); input.focus(); return; }
      const v = input.value; const i = Math.max(v.lastIndexOf(';'), v.lastIndexOf(','));
      input.value = (i >= 0 ? v.slice(0, i + 1) + ' ' : '') + p.mail + '; ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      close(); input.focus();
    };
    const search = () => {
      const q = token();
      if (q.length < 2) { items = []; close(); return; }
      const fq = fold(q);
      const yo = String(st.outlook || '').toLowerCase();
      const already = new Set([...input.value.toLowerCase().split(/[;,\s]+/), ...(typeof input._exclude === 'function' ? input._exclude() : [])]);
      const loc = localPeople().filter((p) => p.mail !== yo && !already.has(p.mail) && (fold(p.nombre).includes(fq) || fold(p.mail).includes(fq)));
      items = loc.slice(0, 8); act = items.length ? 0 : -1; paint();
      clearTimeout(timer);
      const n = ++seq;
      timer = setTimeout(async () => {
        try {
          const r = await call('personas', { q });
          if (n !== seq || token() !== q) return;
          const seen = new Set(items.map((p) => p.mail));
          for (const p of r.personas || []) if (!seen.has(p.mail) && p.mail !== yo && !already.has(p.mail)) { items.push(p); seen.add(p.mail); }
          items = items.slice(0, 10); if (act < 0 && items.length) act = 0; paint();
        } catch { /* sin sugerencias del servidor */ }
      }, 250);
    };
    input.addEventListener('input', (e) => { if (e.isTrusted === false && !e.inputType) return; search(); });
    input.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); act = (act + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = (act - 1 + items.length) % items.length; paint(); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && act >= 0) { e.preventDefault(); pick(items[act]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    box.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(items[+li.dataset.i]); } });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }
  window.__sqPeopleAC = peopleAC;
  // Pendientes: Responder a todos / Reenviar en la misma pantalla, debajo del correo (24/11)
  window.__sqInlineCompose = async (slot, conv, tipo, opt = {}) => {
    const status = opt.status || (() => {});
    slot.innerHTML = '<p class="bz-loading">Preparando…</p>';
    try {
      if (!st.outlook) { try { const c = await call('carpetas'); st.carpetas = c.carpetas || []; st.outlook = c.cuenta || ''; } catch {} }
      const r = await call('hilo', { conv, marcar: false });
      if (!r.mensajes?.length) throw new Error('No encuentro este correo en tu buzón.');
      slot.innerHTML = '';
      openCompose({ tipo, ext: { slot, hilo: r.mensajes, status, onDone: opt.onDone, onCancel: opt.onCancel } });
    } catch (e) { slot.innerHTML = ''; status('No se pudo preparar: ' + e.message, true); opt.onCancel?.(); }
  };
  // Desde Pendientes: abrir ese hilo en la Bandeja con Responder a todos o Reenviar ya preparado
  window.__sqOpenInBandeja = async (conv, tipo) => {
    if (!conv) return;
    setModo('bandeja');
    await openThread(conv);
    if (st.sel === conv && st.hilo?.length && tipo) openCompose({ tipo });
  };


  /* ---------- Para / CC en fichas: ✕ para quitar a alguien, escribir para añadir ---------- */
  const isMail = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(x || '').trim());
  function chipField(box, initial, say = msgStatus) {
    const input = box.querySelector('input'), hidden = box.parentElement.querySelector('input[type="hidden"]');
    let list = [];
    const seen = (a) => list.some((p) => p.mail.toLowerCase() === a.toLowerCase());
    const add = (p) => { if (!p?.mail || !isMail(p.mail) || seen(p.mail)) return; list.push({ nombre: p.nombre || p.mail, mail: p.mail.trim() }); paint(); };
    const paint = () => {
      box.querySelectorAll('.bz-person').forEach((x) => x.remove());
      list.forEach((p, i) => {
        const s = document.createElement('span');
        s.className = 'bz-person'; s.title = p.mail;
        s.innerHTML = `<span>${esc(p.nombre && p.nombre !== p.mail ? p.nombre : p.mail)}</span><button type="button" aria-label="Quitar a ${esc(p.nombre || p.mail)}">✕</button>`;
        s.querySelector('button').addEventListener('click', () => { list.splice(i, 1); paint(); input.focus(); });
        box.insertBefore(s, input);
      });
      hidden.value = list.map((p) => p.mail).join('; ');
      input.placeholder = list.length ? '' : (box.dataset.chips === 'para' ? 'Escribe un nombre o correo' : 'Añadir en copia');
    };
    const commit = () => {
      const parts = input.value.split(/[;,\s]+/).filter(Boolean);
      const bad = parts.find((x) => !isMail(x));
      if (bad) { say(`«${bad}» no es una dirección de correo: elige una sugerencia o escríbela completa.`, true); input.focus(); return false; }
      parts.forEach((a) => add({ mail: a })); input.value = ''; return true;
    };
    input.dataset.chips = '1';
    input._exclude = () => list.map((p) => p.mail.toLowerCase());
    peopleAC(input);
    input.addEventListener('bz-pick', (e) => add(e.detail));
    input.addEventListener('keydown', (e) => {
      if (input.getAttribute('aria-expanded') === 'true') return;
      if ((e.key === 'Enter' || e.key === ';' || e.key === ',') && input.value.trim()) { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); paint(); }
    });
    input.addEventListener('paste', (e) => { const t = e.clipboardData?.getData('text') || ''; if (/[;,]/.test(t) || isMail(t.trim())) { e.preventDefault(); t.split(/[;,\s]+/).filter(isMail).forEach((a) => add({ mail: a })); } });
    input.addEventListener('blur', () => setTimeout(() => { if (input.value.trim() && input.value.split(/[;,\s]+/).filter(Boolean).every(isMail)) commit(); }, 200));
    box.addEventListener('click', (e) => { if (e.target === box) input.focus(); });
    initial.forEach(add); paint();
    return { commit };
  }

  /* ---------- redactar: responder, a todos, reenviar, nuevo ---------- */
  const TIT = { responder: 'Responder', todos: 'Responder a todos', reenviar: 'Reenviar', nuevo: 'Correo nuevo' };
  function openCompose(o) {
    // se responde al último mensaje que te llegó (si el último es tuyo, al anterior); se reenvía el último del hilo
    const ext = o.ext || null; // redactar dentro de otra pantalla (Pendientes), sin moverse de ella
    const hilo = ext ? ext.hilo : st.hilo;
    const say = ext ? ext.status : msgStatus;
    o.say = say;
    const m = o.tipo === 'nuevo' ? null : o.tipo === 'reenviar' ? hilo?.[0] : lastIn(hilo);
    if (o.tipo !== 'nuevo' && !m) return;
    o.target = m?.id;
    if (!ext) st.compose = o;
    let slot = ext ? ext.slot : pane.querySelector('.bz-compose-slot');
    if (o.tipo === 'nuevo') {
      if (st.sel) closeMsg(true);
      st.compose = o; paintList(); reading(true);
      pane.innerHTML = `<div class="bz-phead"><div class="bz-ptools"><button type="button" class="bz-back" data-cl>${svg('back', 20)}<span>Volver</span></button></div><h3>Correo nuevo</h3></div><p class="bz-msgst" aria-live="polite"></p><div class="bz-compose-slot"></div>`;
      slot = pane.querySelector('.bz-compose-slot');
    }
    const yo = String(st.outlook || '').toLowerCase();
    const notMe = (l) => (l || []).filter((p) => p && p.mail && String(p.mail).toLowerCase() !== yo);
    // destinatarios de partida: se pueden quitar (✕) o añadir
    const ini = o.tipo === 'responder' ? { para: notMe([m.de]), cc: [] }
      : o.tipo === 'todos' ? { para: notMe([m.de, ...(m.para || [])]), cc: notMe(m.cc) }
      : { para: [], cc: [] };
    slot.innerHTML = `<form class="bz-compose" novalidate>
      <div class="bz-ctit"><b>${o.sugerida ? 'Respuesta sugerida' : TIT[o.tipo]}</b></div>
      ${o.tipo === 'nuevo' ? `<label class="bz-f"><span>De</span><select name="cuenta" required>
        ${st.cuenta === 'todas' ? '<option value="" selected disabled>¿Desde qué cuenta?</option>' : ''}
        <option value="outlook"${st.cuenta === 'outlook' ? ' selected' : ''}>Outlook · ${esc(st.outlook || 'cuenta de trabajo')}</option>
        <option value="gmail" disabled>Gmail · todavía sin conectar</option>
      </select></label>` : ''}
      <div class="bz-f"><span>Para</span><div class="bz-chips" data-chips="para"><input type="text" inputmode="email" aria-label="Para" placeholder="Escribe un nombre o correo"></div><input type="hidden" name="para"></div>
      <div class="bz-f"><span>CC</span><div class="bz-chips" data-chips="cc"><input type="text" inputmode="email" aria-label="CC" placeholder="Añadir en copia"></div><input type="hidden" name="cc"></div>
      ${o.tipo === 'nuevo' ? `<label class="bz-f"><span>Asunto</span><input name="asunto" type="text"></label>` : ''}
      <label class="bz-ta"><span class="bz-sr">Texto del correo</span>
      <textarea name="texto" rows="${o.tipo === 'nuevo' ? 12 : 8}" placeholder="${o.tipo === 'reenviar' ? 'Añade un comentario (opcional)' : o.tipo === 'nuevo' ? 'Escribe el correo' : 'Escribe tu respuesta'}">${esc(o.texto || '')}</textarea></label>
      <div class="bz-drop" data-drop>
        <input type="file" multiple hidden data-files>
        <button type="button" class="bz-btn" data-pick>${svg('clip', 15)}<span>Adjuntar</span></button>
        <span class="bz-drophint">o arrastra aquí archivos y fotos (también puedes pegarlos)</span>
        <ul class="bz-files" aria-label="Adjuntos"></ul>
      </div>
      <p class="bz-note">Tu firma de Outlook se añade sola al enviar${o.tipo !== 'nuevo' ? '; debajo va el correo original' : ''}. Hasta 25 MB en total.</p>
      <div class="bz-cacts">
        <button type="submit" class="bz-btn send">Enviar</button>
        <button type="button" class="bz-btn" data-draft>A Borradores</button>
        <button type="button" class="bz-link" data-cl>Cancelar</button>
      </div>
    </form>`;
    const f = slot.querySelector('form');
    o.files = o.files || [];
    const chipFields = [...f.querySelectorAll('[data-chips]')].map((box) => chipField(box, ini[box.dataset.chips] || [], say));
    o.commitChips = () => chipFields.every((c) => c.commit());
    const drop = f.querySelector('[data-drop]'), fin = f.querySelector('[data-files]'), flist = f.querySelector('.bz-files');
    const total = () => o.files.reduce((a, x) => a + x.size, 0);
    const paintFiles = () => {
      flist.innerHTML = o.files.map((x, i) => `<li><span>${svg('clip', 13)}<b>${esc(x.name)}</b><small>${esc(tam(x.size))}</small></span><button type="button" class="bz-ibtn" data-rm="${i}" aria-label="Quitar ${esc(x.name)}">✕</button></li>`).join('');
      drop.classList.toggle('has', o.files.length > 0);
    };
    const addFiles = (list) => {
      for (const x of list) {
        if (!x || !x.size) continue;
        if (total() + x.size > 25 * 1024 * 1024) { say(`«${x.name}» no cabe: el correo pasaría de 25 MB.`, true); continue; }
        const name = x.name && x.name !== 'image.png' ? x.name : `imagen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${(x.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        o.files.push(new File([x], name, { type: x.type || 'application/octet-stream' }));
      }
      paintFiles();
    };
    f.querySelector('[data-pick]').addEventListener('click', () => fin.click());
    fin.addEventListener('change', () => { addFiles([...fin.files]); fin.value = ''; });
    flist.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { o.files.splice(+r.dataset.rm, 1); paintFiles(); } });
    ['dragenter', 'dragover'].forEach((ev) => f.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); f.classList.add('bz-dragging'); } }));
    ['dragleave', 'dragend'].forEach((ev) => f.addEventListener(ev, (e) => { if (!f.contains(e.relatedTarget)) f.classList.remove('bz-dragging'); }));
    f.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); f.classList.remove('bz-dragging'); addFiles([...e.dataTransfer.files]); });
    f.querySelector('textarea').addEventListener('paste', (e) => { const fl = [...(e.clipboardData?.files || [])]; if (fl.length) { e.preventDefault(); addFiles(fl); } });
    paintFiles();
    f.addEventListener('submit', (e) => { e.preventDefault(); send(f, o, true); });
    f.querySelector('[data-draft]').addEventListener('click', () => send(f, o, false));
    (ext ? slot : pane).querySelectorAll('[data-cl]').forEach((x) => x.addEventListener('click', () => {
      if (ext) { slot.innerHTML = ''; ext.onCancel?.(); return; }
      st.compose = null;
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      slot.innerHTML = '';
    }));
    if (!o.sugerida) { const first = f.querySelector(o.tipo === 'nuevo' && !f.querySelector('select[name="cuenta"]').value ? 'select[name="cuenta"]' : o.tipo === 'nuevo' || o.tipo === 'reenviar' ? '[data-chips="para"] input' : 'textarea'); first?.focus({ preventScroll: false }); slot.scrollIntoView({ block: 'nearest' }); }
  }
  async function send(f, o, enviar) {
    const say = o.say || msgStatus;
    if (o.commitChips && !o.commitChips()) return;
    const fd = new FormData(f);
    if (o.tipo === 'nuevo' && !fd.get('cuenta')) { say('Elige desde qué cuenta lo envías («De»).', true); f.querySelector('select[name="cuenta"]')?.focus(); return; }
    const body = { cuenta: fd.get('cuenta') || 'outlook', destinatarios: o.tipo === 'responder' || o.tipo === 'todos', tipo: o.tipo, id: o.target, texto: String(fd.get('texto') || ''), para: fd.get('para') || '', cc: fd.get('cc') || '', asunto: fd.get('asunto') || '', enviar };
    if (enviar && !/[^@\s]+@[^@\s]+\.[^@\s]+/.test(body.para)) { say('Falta al menos un destinatario en «Para».', true); f.querySelector('[data-chips="para"] input')?.focus(); return; }
    const badCc = String(body.cc || '').split(/[;,\s]+/).filter(Boolean).find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (badCc) { say(`Revisa la copia (CC): «${badCc}» no es una dirección de correo.`, true); f.querySelector('[data-chips="cc"] input')?.focus(); return; }
    if (enviar && o.tipo !== 'reenviar' && !body.texto.trim()) { say('El correo está vacío.', true); f.querySelector('textarea')?.focus(); return; }
    f.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    say(enviar ? 'Enviando…' : 'Guardando en Borradores…');
    try {
      if (o.files?.length) {
        // 1) borrador preparado, 2) se suben los adjuntos, 3) se envía (o se queda en Borradores)
        const { draft } = await call('redactar', { ...body, preparar: true });
        for (let i = 0; i < o.files.length; i++) {
          const x = o.files[i];
          say(`Subiendo adjuntos ${i + 1} de ${o.files.length}: ${x.name}…`);
          if (x.size <= 3 * 1024 * 1024) await call('adjuntar', { draft, nombre: x.name, tipo: x.type, size: x.size, b64: await b64Of(x) });
          else {
            const { url } = await call('adjuntar', { draft, nombre: x.name, tipo: x.type, size: x.size });
            const CH = 9 * 327680;
            for (let s0 = 0; s0 < x.size; s0 += CH) {
              say(`Subiendo ${x.name}: ${Math.round((s0 / x.size) * 100)} %…`);
              await call('trozo', { url, start: s0, total: x.size, b64: await b64Of(x.slice(s0, s0 + CH)) });
            }
          }
        }
        if (enviar) { say('Enviando…'); await call('enviarBorrador', { draft, tipo: o.tipo }); }
      } else await call('redactar', body);
      if (body.cc && typeof window.__sqRememberCc === 'function') window.__sqRememberCc(body.cc);
      toast(enviar ? 'Enviado ✓' : 'Guardado en Borradores de Outlook');
      if (o.ext) { o.ext.slot.innerHTML = ''; o.ext.onDone?.(enviar); return; }
      st.compose = null;
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      f.parentElement.innerHTML = '';
      say(enviar ? 'Enviado ✓' : 'Guardado en Borradores de Outlook.');
      if (enviar) { loadSmart().catch(() => null); const c = st.sel; if (c) setTimeout(() => { if (st.sel === c && !st.compose) openThread(c); }, 2500); }
    } catch (err) {
      say('No se pudo ' + (enviar ? 'enviar' : 'guardar') + ': ' + err.message, true);
      f.querySelectorAll('button').forEach((x) => { x.disabled = false; });
    }
  }

  const b64Of = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('No se pudo leer el archivo')); r.readAsDataURL(blob); });

  /* ---------- aviso corto ---------- */
  let toastEl = null, toastT = null;
  function toast(t) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'bz-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = t; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }

  /* ---------- arranque ---------- */
  async function start() {
    st.cargando = true; paintList();
    try { const c = await call('carpetas'); st.carpetas = c.carpetas || []; st.outlook = c.cuenta || ''; paintFolders(); }
    catch (e) {
      st.cargando = false;
      st.err = /no está conectado/i.test(e.message) ? 'Conecta Microsoft 365 para ver aquí todo tu correo.' : 'No se pudo abrir el buzón: ' + e.message;
      paintList(); return;
    }
    st.cargando = false;
    reload();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuiet(); });
  setInterval(refreshQuiet, 90000);
  paintFilters(); syncCounts();
  setModo(st.modo);
})();
