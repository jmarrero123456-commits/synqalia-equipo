/* Synqalia · Correo · Bandeja completa (24/11/2026)
   Todo el buzón de Outlook sin entrar en Outlook, en directo contra Microsoft Graph (función «buzon» de Supabase):
   carpetas, últimos 90 días (la búsqueda va a todo el buzón), leído / no leído, bandera, mover, archivar, eliminar,
   adjuntos, Responder · Responder a todos · Reenviar y Correo nuevo.
   Arriba: Todas · Outlook · Gmail (Gmail se conecta más adelante) y el cambio Bandeja ↔ Pendientes (la vista de siempre).
   Si el correo está en Pendientes, se ve su resumen, lo que te piden y la respuesta sugerida.
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
  const mqNarrow = window.matchMedia('(max-width: 759px)');

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
    carpetas: [], items: [], next: null, sel: null, msg: null, cargando: false, fopen: false, err: '', compose: null,
  };

  /* ---------- Bandeja ↔ Pendientes ---------- */
  const head = card.querySelector('.row-between');
  const modes = document.createElement('div');
  modes.className = 'bz-modes'; modes.setAttribute('role', 'tablist'); modes.setAttribute('aria-label', 'Vista del correo');
  modes.innerHTML = `<button type="button" role="tab" data-m="bandeja">Bandeja</button><button type="button" role="tab" data-m="pend">Pendientes <span class="bz-cnt" id="bz-cnt-pend"></span></button>`;
  head.querySelector('h2').after(modes);
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
      <button type="button" class="bz-new" id="bz-new">${svg('pen', 15)}<span>Nuevo</span></button>
    </div>
  </div>
  <div class="bz-body">
    <nav class="bz-folders" aria-label="Carpetas"></nav>
    <div class="bz-col"><div class="bz-status" aria-live="polite"></div><ul class="bz-list" aria-label="Correos"></ul><div class="bz-foot"></div></div>
    <article class="bz-pane" aria-live="polite"></article>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const list = $('.bz-list'), pane = $('.bz-pane'), statusEl = $('.bz-status'), foot = $('.bz-foot'), folders = $('.bz-folders'), fsel = $('#bz-fsel');

  /* ---------- filtros ---------- */
  root.querySelector('.bz-acc').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    st.cuenta = b.dataset.acc;
    root.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
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
  $('#bz-new').addEventListener('click', () => openCompose({ tipo: 'nuevo' }));
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

  /* ---------- lista ---------- */
  function rowHtml(m) {
    const s = smart.get(m.conv);
    const nivel = s?.nivel === 'bloquea' ? '<span class="bz-tag urg">Urgente</span>' : s?.nivel === 'pide' ? '<span class="bz-tag pide">Te piden</span>' : '';
    const quien = st.carpeta === 'sentitems' || st.carpeta === 'drafts' ? ('Para: ' + (nombres(m.para) || '—')) : (m.de?.nombre || m.de?.mail || '—');
    return `<li class="bz-item${m.leido ? '' : ' unread'}${st.sel === m.id ? ' sel' : ''}" data-id="${esc(m.id)}"><button type="button" class="bz-rowbtn">
      <span class="r1"><span class="dot" aria-hidden="true"></span><span class="acc o" title="Outlook">O</span><b class="from">${esc(quien)}</b><span class="ics">${m.bandera ? svg('flag', 13) : ''}${m.adj ? svg('clip', 13) : ''}</span><span class="when">${esc(corto(m.fecha))}</span></span>
      <span class="r2">${nivel}<span class="subj">${esc(m.asunto)}</span></span>
      <span class="r3">${esc(m.prev)}</span>
      ${m.leido ? '' : '<span class="bz-sr">No leído</span>'}
    </button></li>`;
  }
  function paintList() {
    if (st.cuenta === 'gmail') {
      list.innerHTML = '';
      statusEl.innerHTML = `<div class="bz-empty"><b>Gmail todavía no está conectado.</b><br>Lo conectamos en el siguiente paso; de momento aquí ves Outlook.</div>`;
      foot.innerHTML = '';
      return;
    }
    statusEl.innerHTML = st.err ? `<div class="bz-empty err">${esc(st.err)} <button type="button" class="bz-link" data-retry>Reintentar</button></div>`
      : st.cargando && !st.items.length ? '<div class="bz-empty">Cargando correos…</div>'
      : !st.items.length ? `<div class="bz-empty">${st.q ? 'No hay correos que coincidan con la búsqueda.' : 'No hay correos con estos filtros en los últimos 90 días.'}</div>`
      : st.q ? `<div class="bz-hint">Resultados en todo el buzón para «${esc(st.q)}»</div>` : '';
    list.innerHTML = st.items.map(rowHtml).join('');
    foot.innerHTML = st.next ? `<button type="button" class="bz-more-btn" data-more>${st.cargando ? 'Cargando…' : 'Cargar más'}</button>`
      : (st.items.length && !st.q ? '<p class="bz-hint">Aquí se ven los últimos 90 días. Para algo más antiguo, usa el buscador.</p>' : '');
  }
  statusEl.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) reload(); });
  foot.addEventListener('click', (e) => { if (e.target.closest('[data-more]')) more(); });
  list.addEventListener('click', (e) => { const li = e.target.closest('.bz-item'); if (li) openMsg(li.dataset.id); });

  let reqN = 0;
  async function reload() {
    st.err = ''; st.items = []; st.next = null;
    if (st.cuenta === 'gmail') { paintList(); return; }
    const n = ++reqN; st.cargando = true; paintList();
    try {
      const [r] = await Promise.all([call('lista', { carpeta: st.carpeta, ver: st.ver, bandera: st.bandera, adjuntos: st.adjuntos, q: st.q }), loadSmart().catch(() => null)]);
      if (n !== reqN) return;
      st.items = r.items || []; st.next = r.next;
    } catch (e) { if (n === reqN) st.err = 'No se pudo cargar el correo: ' + e.message; }
    if (n === reqN) { st.cargando = false; paintList(); if (!mqNarrow.matches && !st.sel && st.items[0]) openMsg(st.items[0].id, { marcar: false }); }
  }
  async function more() {
    if (!st.next || st.cargando) return;
    st.cargando = true; paintList();
    try { const r = await call('lista', { next: st.next }); st.items.push(...(r.items || [])); st.next = r.next; }
    catch (e) { st.err = e.message; }
    st.cargando = false; paintList();
  }
  // actualización silenciosa (sin perder lo abierto)
  async function refreshQuiet() {
    if (st.modo !== 'bandeja' || view.hidden || document.hidden || st.cargando || st.q || st.cuenta === 'gmail' || st.compose) return;
    try {
      const r = await call('lista', { carpeta: st.carpeta, ver: st.ver, bandera: st.bandera, adjuntos: st.adjuntos });
      const extra = st.items.slice((r.items || []).length);
      st.items = [...(r.items || []), ...extra.filter((x) => !(r.items || []).some((y) => y.id === x.id))];
      paintList();
      call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch { /* la próxima vez */ }
  }

  /* ---------- correo abierto ---------- */
  const linkify = (t) => esc(t).replace(/\bhttps?:\/\/[^\s<>"')\]]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 70 ? u.slice(0, 67) + '…' : u}</a>`);
  function setItem(id, patch) { const m = st.items.find((x) => x.id === id); if (m) Object.assign(m, patch); }
  function reading(on) {
    root.classList.toggle('bz-reading', on);
    if (on && mqNarrow.matches) { try { history.pushState({ bz: 1 }, ''); } catch {} window.scrollTo({ top: 0 }); }
  }
  window.addEventListener('popstate', () => { if (root.classList.contains('bz-reading')) closeMsg(true); });
  function closeMsg(fromPop) {
    const id = st.sel;
    st.sel = null; st.msg = null; st.compose = null; pane.innerHTML = '';
    root.classList.remove('bz-reading');
    if (!fromPop && mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} }
    paintList();
    const li = id && [...list.querySelectorAll('.bz-item')].find((x) => x.dataset.id === id);
    if (li) li.scrollIntoView({ block: 'center' });
  }
  let openN = 0;
  async function openMsg(id, o = {}) {
    st.sel = id; st.compose = null;
    const base = st.items.find((x) => x.id === id);
    paintList();
    reading(true);
    pane.innerHTML = `<div class="bz-loading">Abriendo${base ? ' «' + esc(base.asunto) + '»' : ''}…</div>`;
    const n = ++openN;
    try {
      const m = await call('abrir', { id, marcar: o.marcar !== false });
      if (n !== openN) return;
      st.msg = m;
      setItem(id, { leido: m.leido });
      paintList(); paintMsg();
      if (o.marcar !== false && base && !base.leido) call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch (e) { if (n === openN) pane.innerHTML = `<div class="bz-empty err">${esc(e.message)}</div>`; }
  }
  function paintMsg() {
    const m = st.msg; if (!m) return;
    const s = smart.get(m.conv);
    const enlace = (() => { try { const u = new URL(m.enlace || ''); return u.protocol === 'https:' && /(^|\.)(office\.com|outlook\.com|cloud\.microsoft|office365\.com|live\.com)$/i.test(u.hostname) ? u.href : ''; } catch { return ''; } })();
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
            <button type="button" class="bz-ibtn${m.bandera ? ' on' : ''}" data-a="bandera" title="${m.bandera ? 'Quitar bandera' : 'Marcar con bandera'}" aria-label="${m.bandera ? 'Quitar bandera' : 'Marcar con bandera'}" aria-pressed="${m.bandera}">${svg('flag')}</button>
            <label class="bz-ibtn bz-movew" title="Mover a carpeta">${svg('move')}<span class="bz-sr">Mover a carpeta</span><select data-a="mover"><option value="">Mover a…</option>${moveOptions()}</select></label>
            <button type="button" class="bz-ibtn" data-a="tarea" title="Pasar a tarea" aria-label="Pasar a tarea">${svg('task')}</button>
            ${enlace ? `<a class="bz-ibtn" href="${esc(enlace)}" target="_blank" rel="noopener" title="Abrir en Outlook" aria-label="Abrir en Outlook">${svg('ext')}</a>` : ''}
          </span>
        </div>
        <h3><span class="acc o" title="Outlook">O</span>${esc(m.asunto)}</h3>
        <div class="bz-meta"><b>${esc(m.de?.nombre || m.de?.mail || '')}</b>${m.de?.mail && m.de?.nombre ? ` &lt;${esc(m.de.mail)}&gt;` : ''} · ${esc(largo(m.fecha))}</div>
        <div class="bz-meta">Para: ${esc(nombres(m.para) || '—')}${m.cc?.length ? ' · CC: ' + esc(nombres(m.cc)) : ''}</div>
      </div>
      <div class="bz-reply">
        <button type="button" class="bz-btn pri" data-a="responder">${svg('reply', 16)}<span>Responder</span></button>
        <button type="button" class="bz-btn" data-a="todos">${svg('replyall', 16)}<span>Responder a todos</span></button>
        <button type="button" class="bz-btn" data-a="reenviar">${svg('fwd', 16)}<span>Reenviar</span></button>
      </div>
      <p class="bz-msgst" aria-live="polite"></p>
      ${sum}
      <div class="bz-compose-slot"></div>
      ${m.adjuntos?.length ? `<div class="bz-adj">${m.adjuntos.map((a) => `<button type="button" class="bz-att" data-att="${esc(a.id)}">${svg('clip', 15)}<span><b>${esc(a.nombre)}</b><small>${esc(tam(a.tam))} · Ver o descargar</small></span></button>`).join('')}</div>` : ''}
      <div class="bz-text">${linkify(m.cuerpo || m.prev || '')}</div>`;
    // respuesta sugerida: si en Pendientes te piden algo, la caja de respuesta ya viene abierta con la propuesta
    if (s && s.sugerida && (s.nivel === 'pide' || s.nivel === 'bloquea' || s.peticion)) openCompose({ tipo: 'responder', texto: s.sugerida, sugerida: true });
  }
  const tam = (b) => !b ? '' : b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const msgStatus = (t, bad) => { const p = pane.querySelector('.bz-msgst'); if (p) { p.textContent = t; p.classList.toggle('bad', !!bad); } };

  pane.addEventListener('click', async (e) => {
    const att = e.target.closest('[data-att]');
    if (att) return download(att.dataset.att, att);
    const b = e.target.closest('button[data-a]');
    if (!b || !st.msg) return;
    const m = st.msg, a = b.dataset.a;
    if (a === 'volver') return closeMsg();
    if (a === 'responder' || a === 'todos' || a === 'reenviar') return openCompose({ tipo: a });
    if (a === 'noleido') {
      b.disabled = true;
      try { await call('leido', { id: m.id, valor: false }); setItem(m.id, { leido: false }); m.leido = false; msgStatus('Marcado como no leído.'); if (mqNarrow.matches) closeMsg(); else paintList(); }
      catch (err) { msgStatus(err.message, true); }
      b.disabled = false; return;
    }
    if (a === 'bandera') {
      const v = !m.bandera; b.disabled = true;
      try { await call('bandera', { id: m.id, valor: v }); m.bandera = v; setItem(m.id, { bandera: v }); paintList(); paintMsg(); }
      catch (err) { msgStatus(err.message, true); b.disabled = false; }
      return;
    }
    if (a === 'archivar' || a === 'eliminar') return quitar(a === 'archivar' ? 'archive' : 'deleteditems', a === 'archivar' ? 'Archivado' : 'Enviado a Elementos eliminados');
    if (a === 'tarea') {
      if (typeof window.__sqAddTask !== 'function') return msgStatus('No se pudo crear la tarea desde aquí.', true);
      const s = smart.get(m.conv);
      b.disabled = true;
      const id = await window.__sqAddTask({ titulo: (s?.peticion || m.asunto).slice(0, 300), detalle: `Correo de ${m.de?.nombre || m.de?.mail || ''} · ${m.asunto}`, prioridad: s?.nivel === 'bloquea' ? 'Alta' : 'Media', origen: 'correo', ref: s?.id || null, persona: m.de?.nombre || null, extra: { enlace: m.enlace || null } });
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
  async function quitar(destino, txt) {
    const m = st.msg; if (!m) return;
    const i = st.items.findIndex((x) => x.id === m.id);
    msgStatus('Un momento…');
    try {
      await call('mover', { id: m.id, destino });
      st.items = st.items.filter((x) => x.id !== m.id);
      toast(txt);
      const nx = st.items[Math.min(i, st.items.length - 1)];
      if (!mqNarrow.matches && nx) openMsg(nx.id, { marcar: false }); else closeMsg();
      call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
    } catch (err) { msgStatus(err.message, true); }
  }
  async function download(aid, btn) {
    const m = st.msg; if (!m) return;
    btn.disabled = true; msgStatus('Descargando el adjunto…');
    try {
      const r = await call('adjunto', { id: m.id, aid });
      const bin = atob(r.b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: r.tipo || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.download = r.nombre || 'adjunto'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msgStatus('');
    } catch (err) { msgStatus(err.message, true); }
    btn.disabled = false;
  }

  /* ---------- redactar: responder, a todos, reenviar, nuevo ---------- */
  const TIT = { responder: 'Responder', todos: 'Responder a todos', reenviar: 'Reenviar', nuevo: 'Correo nuevo' };
  function openCompose(o) {
    const m = st.msg;
    if (o.tipo !== 'nuevo' && !m) return;
    st.compose = o;
    let slot = pane.querySelector('.bz-compose-slot');
    if (o.tipo === 'nuevo') {
      st.sel = null; st.msg = null; paintList(); reading(true);
      pane.innerHTML = `<div class="bz-phead"><div class="bz-ptools"><button type="button" class="bz-back" data-cl>${svg('back', 20)}<span>Volver</span></button></div><h3>Correo nuevo</h3></div><p class="bz-msgst" aria-live="polite"></p><div class="bz-compose-slot"></div>`;
      slot = pane.querySelector('.bz-compose-slot');
    }
    const quien = o.tipo === 'todos' ? [m.de?.nombre || m.de?.mail, ...(m.para || []).map((p) => p.nombre || p.mail), ...(m.cc || []).map((p) => p.nombre || p.mail)].filter(Boolean).join(', ')
      : o.tipo === 'responder' ? (m.de?.nombre || m.de?.mail || '') : '';
    slot.innerHTML = `<form class="bz-compose" novalidate>
      <div class="bz-ctit"><b>${o.sugerida ? 'Respuesta sugerida' : TIT[o.tipo]}</b>${quien ? `<span>a ${esc(quien)}</span>` : ''}</div>
      ${o.tipo === 'nuevo' || o.tipo === 'reenviar' ? `<label class="bz-f"><span>Para</span><input name="para" type="text" inputmode="email" autocomplete="email" placeholder="correo@ejemplo.com; otro@ejemplo.com" required></label>` : ''}
      ${o.tipo === 'nuevo' || o.tipo === 'reenviar' ? `<label class="bz-f"><span>CC</span><input name="cc" type="text" inputmode="email" placeholder="Opcional"></label>` : ''}
      ${o.tipo === 'nuevo' ? `<label class="bz-f"><span>Asunto</span><input name="asunto" type="text"></label>` : ''}
      <label class="bz-sr" for="bz-txt">Texto del correo</label>
      <textarea id="bz-txt" name="texto" rows="${o.tipo === 'nuevo' ? 12 : 8}" placeholder="${o.tipo === 'reenviar' ? 'Añade un comentario (opcional)' : 'Escribe tu respuesta'}">${esc(o.texto || '')}</textarea>
      <p class="bz-note">Tu firma de Outlook se añade sola al enviar${o.tipo !== 'nuevo' ? '; debajo va el correo original' : ''}.</p>
      <div class="bz-cacts">
        <button type="submit" class="bz-btn send">Enviar</button>
        <button type="button" class="bz-btn" data-draft>A Borradores</button>
        <button type="button" class="bz-link" data-cl>Cancelar</button>
      </div>
    </form>`;
    const f = slot.querySelector('form');
    f.addEventListener('submit', (e) => { e.preventDefault(); send(f, o, true); });
    f.querySelector('[data-draft]').addEventListener('click', () => send(f, o, false));
    pane.querySelectorAll('[data-cl]').forEach((x) => x.addEventListener('click', () => {
      st.compose = null;
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      slot.innerHTML = '';
    }));
    if (!o.sugerida) { const first = f.querySelector(o.tipo === 'nuevo' || o.tipo === 'reenviar' ? 'input[name="para"]' : 'textarea'); first?.focus({ preventScroll: false }); slot.scrollIntoView({ block: 'nearest' }); }
  }
  async function send(f, o, enviar) {
    const fd = new FormData(f);
    const body = { tipo: o.tipo, id: st.msg?.id, texto: String(fd.get('texto') || ''), para: fd.get('para') || '', cc: fd.get('cc') || '', asunto: fd.get('asunto') || '', enviar };
    if (enviar && (o.tipo === 'nuevo' || o.tipo === 'reenviar') && !/[^@\s]+@[^@\s]+\.[^@\s]+/.test(body.para)) { msgStatus('Escribe al menos una dirección de correo en «Para».', true); f.querySelector('input[name="para"]')?.focus(); return; }
    if (enviar && o.tipo !== 'reenviar' && !body.texto.trim()) { msgStatus('El correo está vacío.', true); f.querySelector('textarea')?.focus(); return; }
    f.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    msgStatus(enviar ? 'Enviando…' : 'Guardando en Borradores…');
    try {
      await call('redactar', body);
      st.compose = null;
      toast(enviar ? 'Enviado ✓' : 'Guardado en Borradores de Outlook');
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      f.parentElement.innerHTML = '';
      msgStatus(enviar ? 'Enviado ✓' : 'Guardado en Borradores de Outlook.');
      if (enviar) loadSmart().catch(() => null);
    } catch (err) {
      msgStatus('No se pudo ' + (enviar ? 'enviar' : 'guardar') + ': ' + err.message, true);
      f.querySelectorAll('button').forEach((x) => { x.disabled = false; });
    }
  }

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
    try { const c = await call('carpetas'); st.carpetas = c.carpetas || []; paintFolders(); }
    catch (e) {
      st.cargando = false;
      st.err = /no está conectado/i.test(e.message) ? 'Conecta Microsoft 365 para ver aquí todo tu correo.' : 'No se pudo abrir el buzón: ' + e.message;
      paintList(); return;
    }
    st.cargando = false;
    reload();
  }
  mqNarrow.addEventListener('change', () => { if (!mqNarrow.matches && !st.sel && st.items[0]) openMsg(st.items[0].id, { marcar: false }); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuiet(); });
  setInterval(refreshQuiet, 90000);
  paintFilters(); syncCounts();
  setModo(st.modo);
})();
