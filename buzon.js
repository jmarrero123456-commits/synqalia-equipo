/* Synqalia · Correo (v4, 25/11/2026): una sola pantalla, como Outlook
   Todo el buzón de Outlook en directo contra Microsoft Graph (función «buzon» de Supabase) y, encima, la capa de Synqalia.
   Ya no hay cambio Bandeja ↔ Pendientes: «Urgente», «Te piden algo» y «Para otro día» son filtros de la misma lista.
   - Barra de arriba en una línea: buscador · Todos · No leídos · Urgente · Te piden algo · Para otro día · bandera · anclados ·
     Todas/Outlook/Gmail · Nuevo correo.
   - Carpetas a la izquierda (se recogen con «, y se recuerda).
   - Lista como Outlook: «Anclado» arriba, luego por días (Hoy, Ayer…). Cada conversación con iniciales, remitente, asunto,
     resumen e iconos (adjunto, respondido, reenviado, bandera, anclado). La flecha despliega el hilo: un mensaje por fila.
     Al pasar el ratón: marcar como no leído, bandera, anclar y eliminar.
   - Correo abierto: Responder · Responder a todos · Reenviar + iconos (no leído, bandera, anclar, archivar, eliminar, mover,
     tarea, más). Si está en Pendientes, recuadro Synqalia: resumen, lo que te piden, «Responder con» (respuesta sugerida con la
     caja de siempre: IA, pulir, CC, programar, adjuntos…) y Gestionado / Para mañana. Debajo, los mensajes anteriores.
   - Anclar se guarda en Synqalia (Outlook no deja anclar desde fuera); la bandera va y vuelve con Outlook.
   - Z Fold cerrado: lista a todo el ancho y el correo a pantalla completa con «‹ Volver» y Responder abajo. */
(async () => {
  const view = document.getElementById('view-correo');
  if (!view || window.__sqBuzon) return;
  window.__sqBuzon = true;
  window.__sqUnified = true;
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
    unread: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    read: '<path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 10l9 6 9-6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    pin: '<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 12v8"/>',
    move: '<path d="M3 7h6l2 2h10v10H3z"/><path d="M12 13h5M15 11l2 2-2 2"/>',
    task: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/>',
    clip: '<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    spark: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/>',
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
    if (now - d < 6 * 864e5) return DOW[d.getDay()].toLowerCase() + ' ' + d.getDate();
    return `${d.getDate()} ${MES[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
  }
  const largo = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${DOW[d.getDay()].toLowerCase()} ${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} · ${hhmm(d)}`; };
  const nombres = (l) => (l || []).map((p) => p.nombre || p.mail).filter(Boolean).join('; ');
  const mqNarrow = window.matchMedia('(max-width: 599px)');
  // iniciales y color estable por persona (como Outlook)
  const PAL = ['#f2c1d6', '#d0e4f5', '#e6dccb', '#cfe3f7', '#f3e3b5', '#d7ecd3', '#e5cdf0', '#f6d6c9', '#d9ccf0'];
  const ini = (n) => { const w = String(n || '?').replace(/[<(].*$/, '').replace(/[^\p{L}\s.'-]/gu, ' ').trim().split(/[\s.]+/).filter(Boolean); return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : (w[0]?.[1] || ''))).toUpperCase(); };
  const colorOf = (n) => { let h = 0; for (const c of String(n || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };
  const avatar = (n) => `<span class="bz-av" style="background:${colorOf(n)}" aria-hidden="true">${esc(ini(n))}</span>`;

  async function call(op, extra = {}) {
    const { data, error } = await sb.functions.invoke('buzon', { body: { op, ...extra } });
    if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  /* ---------- capa de Synqalia (Pendientes de mi.html) ---------- */
  const P = () => window.__sqPend || null;
  const pendOf = (conv) => (conv && P() ? P().byConv(conv) : null);
  const isPend = (m) => !!(m && P()?.pendiente(m));
  const nivelOf = (m) => (isPend(m) ? P().nivel(m) : null);

  /* ---------- anclados (se guardan en Synqalia: Outlook no deja anclar desde fuera) ---------- */
  const pins = new Map(); // conv → {conv, asunto, de, prev, fecha, at}
  async function loadPins() {
    const { data: rows } = await sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', 'fijados');
    pins.clear();
    for (const r of rows || []) if (r.data?.conv) pins.set(r.data.conv, r.data);
  }
  async function togglePin(conv, base) {
    if (!conv) return;
    const on = !pins.has(conv);
    const prev = pins.get(conv);
    if (on) {
      const m = base || {};
      pins.set(conv, { conv, asunto: m.asunto || '', de: m.de || null, prev: m.prev || '', fecha: m.fecha || null, at: new Date().toISOString() });
    } else pins.delete(conv);
    repaint();
    try {
      const q = on
        ? sb.from('personal_docs').upsert({ owner: uid, col: 'fijados', id: conv, data: pins.get(conv) })
        : sb.from('personal_docs').delete().eq('owner', uid).eq('col', 'fijados').eq('id', conv);
      const { error } = await q;
      if (error) throw error;
      toast(on ? 'Anclado arriba' : 'Ya no está anclado');
    } catch (e) {
      if (on) pins.delete(conv); else pins.set(conv, prev);
      repaint(); toast('No se pudo ' + (on ? 'anclar' : 'desanclar'));
    }
  }

  /* ---------- estado ---------- */
  const FILTROS = [
    { k: 'todos', t: 'Todos' },
    { k: 'noleidos', t: 'No leídos', s: 'No leídos' },
    { k: 'urgente', t: 'Urgente', urg: true },
    { k: 'pide', t: 'Te piden algo', s: 'Te piden' },
    { k: 'otro', t: 'Para otro día', s: 'Otro día' },
    { k: 'bandera', icon: 'flag', t: 'Con bandera' },
    { k: 'anclados', icon: 'pin', t: 'Anclados' },
  ];
  const PEND_F = ['urgente', 'pide', 'otro'];
  const st = {
    modo: 'bandeja', cuenta: 'todas', filtro: 'todos', q: '', carpeta: 'inbox',
    carpetas: [], items: [], next: null, sel: null, selMid: null, hilo: null, cargando: false, err: '', compose: null,
    exp: new Set(), hcache: new Map(), outlook: '',
    // Prioritarios / Otros, como la Bandeja de entrada de Outlook (por defecto, Prioritarios; se recuerda)
    foco: (() => { try { return localStorage.getItem('sq-bz-foco') || 'prioritarios'; } catch { return 'prioritarios'; } })(),
  };
  const usaFoco = () => st.carpeta === 'inbox' && !st.q && !isPF() && !st.sinFoco;
  const isPF = () => PEND_F.includes(st.filtro) || st.filtro === 'anclados';

  /* ---------- esqueleto ---------- */
  const root = document.createElement('div');
  root.className = 'bz';
  card.appendChild(root);
  card.classList.add('bz-on');
  // vista clásica de Pendientes solo como último recurso (menú «más» → «Ver en Pendientes»), con vuelta al correo
  const classicBar = document.createElement('div');
  classicBar.className = 'bz-classicbar';
  classicBar.innerHTML = `<button type="button" class="bz-btn">${svg('back', 16)}<span>Volver al correo</span></button><span>Vista clásica de Pendientes</span>`;
  card.insertBefore(classicBar, card.firstChild);
  classicBar.querySelector('button').addEventListener('click', () => setModo('bandeja'));
  function setModo(m) {
    st.modo = m === 'pend' ? 'pend' : 'bandeja';
    card.classList.toggle('bz-on', st.modo === 'bandeja');
    if (st.modo === 'bandeja' && !st.carpetas.length && !st.cargando) start();
  }
  window.__sqBzModo = setModo;

  root.innerHTML = `
  <div class="bz-top">
    <label class="bz-search">${svg('search', 15)}<span class="bz-sr">Buscar en todo el buzón</span><input type="search" id="bz-q" placeholder="Buscar en todo el buzón" enterkeyhint="search"></label>
    <label class="bz-fsel"><span class="bz-sr">Carpeta</span><select id="bz-fsel"><option value="inbox">Bandeja</option></select></label>
    <div class="bz-filters" role="tablist" aria-label="Filtros">
      ${FILTROS.map((f) => `<button type="button" role="tab" class="bz-chip${f.urg ? ' bz-urg' : ''}${f.icon ? ' bz-ichip' : ''}" data-fil="${f.k}" aria-selected="${f.k === 'todos'}" title="${esc(f.t)}">${f.icon ? svg(f.icon, 14) + `<span class="bz-sr">${esc(f.t)}</span>` : `<span class="l">${esc(f.t)}</span>${f.s ? `<span class="s">${esc(f.s)}</span>` : ''}`}<i data-n="${f.k}"></i></button>`).join('')}
    </div>
    <div class="bz-right">
      <div class="bz-seg bz-acc" role="tablist" aria-label="Cuenta">
        <button type="button" role="tab" data-acc="todas" aria-selected="true">Todas</button>
        <button type="button" role="tab" data-acc="outlook" aria-selected="false">Outlook</button>
        <button type="button" role="tab" data-acc="gmail" aria-selected="false">Gmail</button>
      </div>
      <button type="button" class="bz-new" id="bz-new" aria-label="Nuevo correo">${svg('pen', 15)}<span>Nuevo correo</span></button>
    </div>
  </div>
  <div class="bz-body">
    <nav class="bz-folders" aria-label="Carpetas"></nav>
    <div class="bz-col"><div class="bz-status" aria-live="polite"></div><ul class="bz-list" aria-label="Correos"></ul><div class="bz-foot"></div></div>
    <article class="bz-pane" aria-live="polite"></article>
  </div>`;
  const $ = (s) => root.querySelector(s);
  /* ---------- ancho de la lista: se arrastra el borde, como en Outlook (se recuerda; doble clic, ancho normal) ---------- */
  {
    const body = $('.bz-body'), col = $('.bz-col');
    const grip = document.createElement('div');
    grip.className = 'bz-grip'; grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', 'Ancho de la lista de correos'); grip.tabIndex = 0; grip.title = 'Arrastra para estrechar o ensanchar la lista · doble clic: ancho normal';
    body.insertBefore(grip, $('.bz-pane'));
    const MIN = 220;
    const maxW = () => Math.max(MIN, Math.round(body.clientWidth * 0.62));
    const setW = (w, save) => {
      if (w == null) { body.style.removeProperty('--bz-lw'); root.classList.remove('bz-lnarrow'); if (save) { try { localStorage.removeItem('sq-bz-lw'); } catch {} } return; }
      w = Math.max(MIN, Math.min(maxW(), Math.round(w)));
      body.style.setProperty('--bz-lw', w + 'px');
      root.classList.toggle('bz-lnarrow', w < 300);
      if (save) { try { localStorage.setItem('sq-bz-lw', String(w)); } catch {} }
    };
    try { const v = +localStorage.getItem('sq-bz-lw'); if (v) setW(v); } catch {}
    let x0 = 0, w0 = 0;
    const move = (e) => setW(w0 + (e.clientX - x0));
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); root.classList.remove('bz-dragw'); setW(col.getBoundingClientRect().width, true); };
    grip.addEventListener('pointerdown', (e) => { e.preventDefault(); x0 = e.clientX; w0 = col.getBoundingClientRect().width; root.classList.add('bz-dragw'); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); });
    grip.addEventListener('dblclick', () => setW(null, true));
    grip.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setW(col.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -24 : 24), true); } });
  }
  const list = $('.bz-list'), pane = $('.bz-pane'), statusEl = $('.bz-status'), foot = $('.bz-foot'), folders = $('.bz-folders'), fsel = $('#bz-fsel');

  /* ---------- filtros ---------- */
  $('.bz-acc').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    st.cuenta = b.dataset.acc;
    root.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    reload();
  });
  $('.bz-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fil]'); if (!b) return;
    // volver a pulsar «No leídos» la refresca (quita los ya leídos); en los demás filtros, volver a pulsar lo quita
    if (b.dataset.fil === 'noleidos' && st.filtro === 'noleidos') { reload(); return; }
    setFiltro(st.filtro === b.dataset.fil && b.dataset.fil !== 'todos' ? 'todos' : b.dataset.fil);
  });
  function setFiltro(f) {
    st.filtro = f;
    root.querySelectorAll('[data-fil]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.fil === f)));
    root.classList.toggle('bz-pf', isPF());
    if (isPF()) { if (st.sel) closeMsg(true); st.err = ''; paintList(); }
    else reload();
  }
  fsel.addEventListener('change', () => openFolder(fsel.value));
  let qT = null;
  $('#bz-q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value.trim(); afterSearch(); }, 450); });
  $('#bz-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qT); st.q = e.target.value.trim(); afterSearch(); } });
  // buscar siempre va al buzón entero (sale de los filtros de Pendientes)
  function afterSearch() { if (st.q && isPF()) { st.filtro = 'todos'; root.querySelectorAll('[data-fil]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.fil === 'todos'))); root.classList.remove('bz-pf'); } reload(); }
  $('#bz-new').addEventListener('click', () => { if (st.modo !== 'bandeja') setModo('bandeja'); openCompose({ tipo: 'nuevo' }); });

  // contadores de los filtros (los de Pendientes salen de mi.html; los de Outlook, de las carpetas)
  function paintCounts() {
    const n = (k) => { try { return P() ? P().list(k).length : 0; } catch { return 0; } };
    const inbox = st.carpetas.find((f) => f.wk === 'inbox');
    const vals = { noleidos: inbox?.noLeidos || '', urgente: n('urgente') || '', pide: n('pide') || '', otro: n('otro') || '', anclados: pins.size || '' };
    root.querySelectorAll('[data-n]').forEach((x) => { x.textContent = vals[x.dataset.n] ?? ''; });
  }
  window.addEventListener('sq-mails', () => {
    // contestado o gestionado desde la caja de respuesta: en los filtros de Pendientes se pasa al siguiente
    if (st.sel && PEND_F.includes(st.filtro) && st.adv !== st.sel && P() && !pendThreads(st.filtro).some((x) => x.conv === st.sel)) { afterHandled('Gestionado ✓'); return; }
    paintCounts();
    if (isPF()) paintList(); else paintListSoft();
    if (st.hilo?.length) { paintSyn(); if (!pane.querySelector('[data-a="tarea"]:focus')) paintTools(); }
  });

  /* ---------- carpetas ---------- */
  const WKN = { inbox: 'Bandeja', drafts: 'Borradores', sentitems: 'Enviados', archive: 'Archivo', deleteditems: 'Eliminados', junkemail: 'Correo no deseado', outbox: 'Programados y salida' };
  const fname = (f) => WKN[f.wk] || f.nombre;
  function paintFolders() {
    const main = st.carpetas.filter((f) => f.wk), mine = st.carpetas.filter((f) => !f.wk);
    const cur = isPF() ? null : (f) => (f.wk || f.id) === st.carpeta;
    const li = (f) => `<button type="button" data-f="${esc(f.wk || f.id)}" aria-current="${cur && cur(f) ? 'true' : 'false'}" class="${f.dentro ? 'in' : ''}"><span>${esc(fname(f))}</span>${f.noLeidos ? `<b>${f.noLeidos}</b>` : (f.wk === 'drafts' && f.total ? `<i>${f.total}</i>` : '')}</button>`;
    const fcol = root.classList.contains('bz-fcol');
    const curF = st.carpetas.find((f) => (f.wk || f.id) === st.carpeta);
    folders.innerHTML = `<button type="button" class="bz-fold" data-fold aria-expanded="${!fcol}" title="${fcol ? 'Mostrar carpetas' : 'Recoger carpetas'}" aria-label="${fcol ? 'Mostrar carpetas' : 'Recoger carpetas'}">${fcol ? '»' : '«'}</button><span class="bz-fmini">${esc(curF ? fname(curF) : '')}</span>`
      + main.map(li).join('') + `<div class="bz-flbl">Mis carpetas</div>` + mine.map(li).join('') + `<button type="button" class="bz-fnew" data-fnew>+ Nueva carpeta</button><button type="button" class="bz-fnew bz-fread" data-fread>✓ Marcar leídos hasta…</button>`;
    fsel.innerHTML = st.carpetas.map((f) => `<option value="${esc(f.wk || f.id)}"${(f.wk || f.id) === st.carpeta ? ' selected' : ''}>${esc(fname(f))}</option>`).join('');
    if (!st.carpetas.some((f) => (f.wk || f.id) === st.carpeta)) fsel.insertAdjacentHTML('afterbegin', `<option value="${esc(st.carpeta)}">${esc(WKN[st.carpeta] || 'Carpeta')}</option>`);
    fsel.value = st.carpeta;
    paintCounts();
  }
  folders.addEventListener('click', (e) => {
    if (e.target.closest('[data-fold]')) { setFcol(!root.classList.contains('bz-fcol')); return; }
    if (e.target.closest('[data-fnew]')) { askFolder(); return; }
    if (e.target.closest('[data-fread]')) { askReadUntil(); return; }
    const b = e.target.closest('[data-f]'); if (b) openFolder(b.dataset.f);
  });
  function setFcol(on) { root.classList.toggle('bz-fcol', on); try { localStorage.setItem('sq-bz-fcol', on ? '1' : ''); } catch {} paintFolders(); }
  try { if (localStorage.getItem('sq-bz-fcol')) root.classList.add('bz-fcol'); } catch {}
  function openFolder(f) {
    st.carpeta = f; st.q = ''; $('#bz-q').value = '';
    if (isPF()) { st.filtro = 'todos'; root.querySelectorAll('[data-fil]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.fil === 'todos'))); root.classList.remove('bz-pf'); }
    paintFolders(); reload();
  }
  const refreshFolders = () => call('carpetas').then((c) => { st.carpetas = c.carpetas || []; paintFolders(); }).catch(() => null);
  const moveOptions = () => st.carpetas.filter((f) => f.wk !== 'drafts' && f.wk !== 'outbox' && (f.wk || f.id) !== st.carpeta).map((f) => `<option value="${esc(f.wk || f.id)}">${f.dentro ? '  ' : ''}${esc(fname(f))}</option>`).join('') + '<option value="__nueva">+ Nueva carpeta…</option>';

  /* ---------- carpeta nueva (25/11): se crea en Outlook; desde «Mover a…» se crea y se mueve ahí ---------- */
  function askFolder(onDone) {
    document.querySelector('.bz-fdlg')?.remove();
    const d = document.createElement('div');
    d.className = 'bz-viewer bz-fdlg'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Nueva carpeta');
    d.innerHTML = `<form class="bz-fbox" novalidate>
      <div class="bz-poph">${svg('move', 18)}<b>Nueva carpeta</b><button type="button" class="bz-ibtn" data-x aria-label="Cerrar">✕</button></div>
      <label class="bz-tkf"><span>Nombre</span><input name="nombre" type="text" maxlength="120" autocomplete="off" placeholder="Por ejemplo: Obras 2027" required></label>
      <label class="bz-fchk"><input type="checkbox" name="dentro"> Dentro de la Bandeja de entrada</label>
      <p class="bz-msgst" aria-live="polite"></p>
      <div class="bz-tkacts"><button type="submit" class="bz-btn gest">${svg('check', 15)}<span>${onDone ? 'Crear y mover aquí' : 'Crear carpeta'}</span></button><button type="button" class="bz-link" data-x>Cancelar</button></div>
      <p class="bz-popnote">Se crea también en Outlook.</p>
    </form>`;
    document.body.appendChild(d);
    const f = d.querySelector('form'), inp = f.querySelector('input[name="nombre"]'), say = (t, bad) => { const p = f.querySelector('.bz-msgst'); p.textContent = t; p.classList.toggle('bad', !!bad); };
    const close = () => d.remove();
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-x]')) close(); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = inp.value.trim();
      if (!nombre) { say('Pon un nombre a la carpeta.', true); inp.focus(); return; }
      f.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      say('Creando en Outlook…');
      try {
        const r = await call('carpetaNueva', { nombre, dentro: f.dentro.checked ? 'inbox' : null });
        close();
        st.carpetas.push({ id: r.id, nombre: r.nombre, noLeidos: 0, total: 0, ...(f.dentro.checked ? { dentro: 'inbox' } : {}) });
        paintFolders(); refreshFolders();
        toast(`Carpeta «${r.nombre}» creada`);
        onDone?.(r);
      } catch (err) { say(err.message, true); f.querySelectorAll('button').forEach((x) => { x.disabled = false; }); inp.focus(); }
    });
    inp.focus();
  }
  /* ---------- marcar como leído todo lo anterior a un día (25/11): en todo el buzón, también en Outlook ---------- */
  function askReadUntil() {
    document.querySelector('.bz-fdlg')?.remove();
    const d0 = new Date(); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7) - 7); // el lunes de la semana pasada (hoy, 16 de noviembre)
    const def = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const d = document.createElement('div');
    d.className = 'bz-viewer bz-fdlg'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Marcar como leídos');
    d.innerHTML = `<form class="bz-fbox" novalidate>
      <div class="bz-poph">${svg('read', 18)}<b>Marcar como leídos</b><button type="button" class="bz-ibtn" data-x aria-label="Cerrar">✕</button></div>
      <label class="bz-tkf"><span>Todo lo que llegó hasta el día (incluido)</span><input name="hasta" type="date" value="${def}" max="${new Date().toISOString().slice(0, 10)}" required></label>
      <p class="bz-popnote">Se marcan como leídos en todo el buzón (todas las carpetas) y también en Outlook. Lo de después de ese día no se toca.</p>
      <div class="bz-rprog" hidden><div class="bar"><i></i></div><span></span></div>
      <p class="bz-msgst" aria-live="polite"></p>
      <div class="bz-tkacts"><button type="submit" class="bz-btn gest">${svg('check', 15)}<span>Marcar como leídos</span></button><button type="button" class="bz-link" data-x>Cancelar</button></div>
    </form>`;
    document.body.appendChild(d);
    const f = d.querySelector('form'), say = (t, bad) => { const p = f.querySelector('.bz-msgst'); p.textContent = t; p.classList.toggle('bad', !!bad); };
    let busy = false;
    const close = () => { if (!busy) d.remove(); };
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-x]')) close(); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hasta = f.hasta.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) { say('Elige un día.', true); return; }
      busy = true; f.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
      const pr = f.querySelector('.bz-rprog'); pr.hidden = false;
      let total = 0, vueltas = 0;
      say('Marcando en Outlook… puede tardar unos minutos si hay muchos. No cierres Synqalia.');
      try {
        for (;;) {
          const r = await call('leerHasta', { hasta });
          total += r.hechos || 0; vueltas++;
          pr.querySelector('span').textContent = `${total.toLocaleString('es-ES')} marcados como leídos`;
          pr.querySelector('i').style.width = Math.min(95, 10 + vueltas * 12) + '%';
          if (!r.quedan) break;
          if (r.pausa) { say('Outlook pide una pausa; sigo en unos segundos…'); await new Promise((res) => setTimeout(res, 8000)); }
          if (vueltas > 60) throw new Error('quedan algunos; vuelve a pulsarlo dentro de un rato');
        }
        pr.querySelector('i').style.width = '100%';
        busy = false;
        say(`Hecho: ${total.toLocaleString('es-ES')} correos marcados como leídos hasta el ${hasta.split('-').reverse().join('/')}.`);
        f.querySelector('[data-x].bz-link').disabled = false; f.querySelector('[data-x].bz-link').textContent = 'Cerrar';
        f.querySelector('.bz-ibtn[data-x]').disabled = false;
        toast(`${total.toLocaleString('es-ES')} correos marcados como leídos`);
        for (const x of st.items) if (String(x.fecha).slice(0, 10) <= hasta) x.leido = true;
        full.clear(); refreshFolders(); paintListSoft(); refreshQuiet();
      } catch (err) {
        busy = false; say(`Se marcaron ${total.toLocaleString('es-ES')}, pero ${err.message}.`, true);
        f.querySelectorAll('button, input').forEach((x) => { x.disabled = false; });
      }
    });
  }
  // «Mover a…»: carpeta existente, o crear una y mover ahí
  function moverA(sel) {
    if (sel.value === '__nueva') { sel.value = ''; askFolder((r) => quitar(r.id, 'Movido a ' + r.nombre)); return; }
    const f = st.carpetas.find((x) => (x.wk || x.id) === sel.value);
    quitar(sel.value, 'Movido a ' + (f ? fname(f) : 'otra carpeta'));
  }

  /* ---------- conversaciones ---------- */
  function threads() {
    const map = new Map();
    for (const m of st.items) {
      const k = m.conv || m.id;
      let t = map.get(k);
      if (!t) { t = { conv: k, msgs: [], latest: m }; map.set(k, t); }
      t.msgs.push(m);
      if (String(m.fecha) > String(t.latest.fecha)) t.latest = m;
    }
    return [...map.values()].map((t) => {
      const ms = t.msgs.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      return { ...t, msgs: ms, ids: ms.map((x) => x.id), unread: ms.some((x) => !x.leido), adj: ms.some((x) => x.adj), bandera: ms.some((x) => x.bandera), verbo: Math.max(0, ...ms.map((x) => x.verbo || 0)), n: ms.length, pend: pendOf(t.conv) };
    }).sort((a, b) => String(b.latest.fecha).localeCompare(String(a.latest.fecha)));
  }
  const threadOf = (conv) => threads().find((t) => t.conv === conv);
  // filas de Pendientes (Urgente, Te piden algo, Para otro día) con el mismo aspecto
  function pendThreads(k) {
    const arr = (P()?.list(k) || []).map((m) => {
      const f = (() => { try { const x = P().fecha(m); return x ? new Date(x.length > 16 ? x : x + ':00').toISOString() : null; } catch { return null; } })();
      const live = m.conv ? st.items.filter((x) => x.conv === m.conv) : [];
      return {
        conv: m.conv || ('p:' + m.id), pid: m.id, pend: m, n: m.mensajes || live.length || 1,
        latest: { asunto: m.asunto || '(sin asunto)', de: { nombre: P().persona(m.de) }, prev: m.peticion || m.resumen || '', fecha: f },
        unread: live.some((x) => !x.leido), adj: !!(m.adjuntos?.length) || live.some((x) => x.adj), bandera: live.some((x) => x.bandera), verbo: 0,
      };
    });
    return arr.sort((a, b) => String(b.latest.fecha).localeCompare(String(a.latest.fecha)));
  }
  function pinThreads() {
    return [...pins.values()].map((p) => {
      const live = threadOf(p.conv);
      return live ? { ...live, pinned: true } : { conv: p.conv, n: 1, latest: { asunto: p.asunto, de: p.de, prev: p.prev, fecha: p.fecha }, pend: pendOf(p.conv), unread: false, adj: false, bandera: false, verbo: 0, pinned: true };
    }).sort((a, b) => String(b.latest.fecha).localeCompare(String(a.latest.fecha)));
  }

  /* ---------- lista (como Outlook) ---------- */
  function seccion(iso) {
    if (!iso) return 'Sin fecha';
    const d = new Date(iso), now = new Date();
    const k = dayKey(d);
    if (k === dayKey(now)) return 'Hoy';
    if (k === dayKey(new Date(now - 864e5))) return 'Ayer';
    const lunes = new Date(now); lunes.setHours(0, 0, 0, 0); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
    if (d >= lunes) return 'Esta semana';
    if (d >= new Date(lunes - 7 * 864e5)) return 'La semana pasada';
    const mm = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][d.getMonth()];
    return mm + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  const TAGS = { bloquea: '<span class="bz-tag urg">Urgente</span>', pide: '<span class="bz-tag pide">Te piden</span>' };
  function tagOf(t) {
    const m = t.pend;
    if (!m) return '';
    if (st.filtro === 'otro' || P()?.pospuesto(m)) return '<span class="bz-tag otro">Otro día</span>';
    return TAGS[nivelOf(m)] || '';
  }
  const hov = (kind, id, t) => `<span class="bz-hov" role="group" aria-label="Acciones">
      <button type="button" class="bz-ibtn" data-h="leido" data-${kind}="${esc(id)}" title="${t.unread ? 'Marcar como leído' : 'Marcar como no leído'}" aria-label="${t.unread ? 'Marcar como leído' : 'Marcar como no leído'}">${svg(t.unread ? 'read' : 'unread', 15)}</button>
      <button type="button" class="bz-ibtn${t.bandera ? ' on' : ''}" data-h="bandera" data-${kind}="${esc(id)}" title="${t.bandera ? 'Quitar bandera' : 'Marcar con bandera'}" aria-label="${t.bandera ? 'Quitar bandera' : 'Marcar con bandera'}" aria-pressed="${!!t.bandera}">${svg('flag', 15)}</button>
      <button type="button" class="bz-ibtn${t.pinned ? ' pin' : ''}" data-h="anclar" data-${kind}="${esc(id)}" title="${t.pinned ? 'Desanclar' : 'Anclar arriba'}" aria-label="${t.pinned ? 'Desanclar' : 'Anclar arriba'}" aria-pressed="${!!t.pinned}">${svg('pin', 15)}</button>
      <button type="button" class="bz-ibtn" data-h="eliminar" data-${kind}="${esc(id)}" title="Eliminar" aria-label="Eliminar">${svg('del', 15)}</button>
    </span>`;
  function rowHtml(t) {
    const m = t.latest;
    const enviados = st.carpeta === 'sentitems' || st.carpeta === 'drafts';
    const quien = enviados && !isPF() ? ('Para: ' + (nombres(m.para) || '—'))
      : (t.msgs ? [...new Set(t.msgs.map((x) => x.de?.nombre || x.de?.mail).filter(Boolean))].slice(0, 3).join('; ') : (m.de?.nombre || m.de?.mail || '')) || '—';
    const pinned = t.pinned || pins.has(t.conv);
    const open = st.exp.has(t.conv);
    const canExp = !String(t.conv).startsWith('p:') && (t.n > 1 || t.verbo > 0 || (t.pend?.mensajes > 1));
    const verb = t.verbo === 104 ? svg('fwd', 13) : t.verbo ? svg('reply', 13) : '';
    const tt = { ...t, pinned };
    const sub = open ? subRows(t) : '';
    return `<li class="bz-item${t.unread ? ' unread' : ''}${st.sel === t.conv ? ' sel' : ''}${open ? ' exp' : ''}" data-conv="${esc(t.conv)}"${t.pid ? ` data-pid="${esc(t.pid)}"` : ''}>
      <div class="bz-rowwrap">
        ${canExp ? `<button type="button" class="bz-chev" data-chev aria-expanded="${open}" aria-label="${open ? 'Plegar' : 'Desplegar'} la conversación">${svg('chev', 13)}</button>` : '<span class="bz-chev" aria-hidden="true"></span>'}
        <button type="button" class="bz-rowbtn" aria-expanded="${st.sel === t.conv}">
          ${avatar(quien.replace(/^Para: /, '').split(';')[0])}
          <span class="bz-rc">
            <span class="r1"><b class="from">${esc(quien)}</b>${t.n > 1 ? `<span class="bz-n" title="${t.n} mensajes">${t.n}</span>` : ''}<span class="ics">${t.adj ? svg('clip', 13) : ''}${verb}${t.bandera ? `<span class="fl">${svg('flag', 13)}</span>` : ''}${pinned ? `<span class="pn">${svg('pin', 13)}</span>` : ''}${!String(t.conv).startsWith('p:') && mailTasks(t.conv).length ? `<span class="tk" title="Ya está en Tareas">${svg('task', 13)}</span>` : ''}</span></span>
            <span class="r2">${tagOf(t)}<span class="subj">${esc(m.asunto)}</span><span class="when">${esc(corto(m.fecha))}</span></span>
            <span class="r3">${esc(m.prev)}</span>
          </span>
          ${t.unread ? '<span class="bz-sr">Sin leer</span>' : ''}
        </button>
        ${String(t.conv).startsWith('p:') ? '' : hov('conv', t.conv, tt)}
      </div>
      ${sub}
    </li>`;
  }
  function subRows(t) {
    const h = st.hcache.get(t.conv);
    if (!h) return `<ul class="bz-sub"><li class="bz-subload">Cargando la conversación…</li></ul>`;
    return `<ul class="bz-sub">${h.map((x) => `<li class="bz-subi${!x.leido ? ' unread' : ''}${st.sel === t.conv && (st.selMid ? st.selMid === x.id : x === h[0]) ? ' sel' : ''}" data-mid="${esc(x.id)}" data-conv="${esc(t.conv)}">
        <button type="button" class="bz-subbtn"><span class="w"><b>${esc(x.mio ? (x.de?.nombre || 'Tú') : (x.de?.nombre || x.de?.mail || ''))}</b>${x.mio ? ' <small>(tú)</small>' : ''}</span><span class="pv">${esc(x.prev)}</span><span class="when">${esc(corto(x.fecha))}</span></button>
        ${hov('mid', x.id, { unread: !x.leido, bandera: x.bandera, pinned: pins.has(t.conv) })}
      </li>`).join('')}</ul>`;
  }
  function paintList() {
    if (st.modo !== 'bandeja') return;
    root.classList.toggle('bz-pf', isPF());
    paintCounts();
    if (st.cuenta === 'gmail' && !isPF()) {
      list.innerHTML = '';
      statusEl.innerHTML = `<div class="bz-empty"><b>Gmail todavía no está conectado.</b><br>Lo conectamos en el siguiente paso; de momento aquí ves Outlook.</div>`;
      foot.innerHTML = '';
      return;
    }
    let html = '', ts = [];
    if (PEND_F.includes(st.filtro)) {
      ts = pendThreads(st.filtro);
      const tit = { urgente: 'Urgente', pide: 'Te piden algo', otro: 'Para otro día' }[st.filtro];
      statusEl.innerHTML = !P() ? '<div class="bz-empty">Cargando Pendientes…</div>' : !ts.length ? `<div class="bz-empty">${st.filtro === 'otro' ? 'No has dejado nada para otro día.' : 'Nada por aquí. 👌'}</div>` : '';
      html = ts.length ? sec(`${tit} · ${ts.length}`) + ts.map(rowHtml).join('') : '';
      foot.innerHTML = '';
    } else if (st.filtro === 'anclados') {
      ts = pinThreads();
      statusEl.innerHTML = ts.length ? '' : `<div class="bz-empty">No tienes correos anclados. Pasa el ratón por un correo y pulsa ${svg('pin', 13)} para dejarlo arriba.</div>`;
      html = ts.length ? sec(`Anclado · ${ts.length}`) + ts.map(rowHtml).join('') : '';
      foot.innerHTML = '';
    } else {
      ts = threads();
      const showPins = st.carpeta === 'inbox' && st.filtro === 'todos' && !st.q && pins.size && !(usaFoco() && st.foco === 'otros');
      const pt = showPins ? pinThreads() : [];
      const pinSet = new Set(pt.map((x) => x.conv));
      const rest = ts.filter((t) => !pinSet.has(t.conv));
      statusEl.innerHTML = st.err ? `<div class="bz-empty err">${esc(st.err)} <button type="button" class="bz-link" data-retry>Reintentar</button></div>`
        : st.cargando && !ts.length ? '<div class="bz-empty">Cargando correos…</div>'
        : !ts.length && !pt.length ? `<div class="bz-empty">${st.q ? 'No hay correos que coincidan con la búsqueda.' : st.filtro === 'noleidos' ? 'No tienes correos sin leer aquí. 👌' : st.filtro === 'bandera' ? 'No hay correos con bandera en esta carpeta.' : 'No hay correos en los últimos 90 días.'}</div>`
        : st.q ? `<div class="bz-hint">Resultados en todo el buzón para «${esc(st.q)}»</div>` : '';
      const sw = usaFoco() ? `<span class="bz-foco" role="tablist" aria-label="Bandeja de entrada"><button type="button" role="tab" data-foco="prioritarios" aria-selected="${st.foco === 'prioritarios'}">Prioritarios</button><button type="button" role="tab" data-foco="otros" aria-selected="${st.foco === 'otros'}">Otros</button></span>` : '';
      let first = true;
      const sec1 = (t) => { const h = sec(t, first ? sw : ''); first = false; return h; };
      if (pt.length) html += sec1('Anclado') + pt.map(rowHtml).join('');
      let last = null;
      for (const t of rest) { const s = seccion(t.latest.fecha); if (s !== last && !st.q) { html += sec1(s); last = s; } html += rowHtml(t); }
      if (first && sw) html = sec1(st.foco === 'otros' ? 'Otros' : 'Prioritarios') + html;
      foot.innerHTML = st.next ? `<button type="button" class="bz-more-btn" data-more>${st.cargando ? 'Cargando…' : 'Cargar más'}</button>`
        : (ts.length && !st.q ? '<p class="bz-hint">Aquí se ven los últimos 90 días. Para algo más antiguo, usa el buscador.</p>' : '');
    }
    list.innerHTML = html;
  }
  const sec = (t, extra = '') => `<li class="bz-sec${extra ? ' bz-sec1' : ''}" role="presentation"><span>${esc(t)}</span>${extra}</li>`;
  // repintado sin perder el scroll
  function paintListSoft() { const col = $('.bz-col'); const y = col.scrollTop; paintList(); col.scrollTop = y; }
  const repaint = () => { paintListSoft(); if (st.hilo?.length) paintTools(); };
  statusEl.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) reload(); });
  foot.addEventListener('click', (e) => { if (e.target.closest('[data-more]')) more(); });

  list.addEventListener('click', (e) => {
    const fo = e.target.closest('[data-foco]');
    if (fo) { if (st.foco !== fo.dataset.foco) { st.foco = fo.dataset.foco; try { localStorage.setItem('sq-bz-foco', st.foco); } catch {} reload(); } return; }
    const h = e.target.closest('[data-h]');
    if (h) { e.stopPropagation(); return rowAction(h); }
    const chev = e.target.closest('[data-chev]');
    if (chev) { const li = chev.closest('.bz-item'); return toggleExp(li.dataset.conv); }
    const sub = e.target.closest('.bz-subi');
    if (sub) return openThread(sub.dataset.conv, { mid: sub.dataset.mid });
    const li = e.target.closest('.bz-item');
    if (!li || !e.target.closest('.bz-rowbtn')) return;
    if (st.sel === li.dataset.conv) return closeMsg();
    if (li.dataset.conv.startsWith('p:')) { P()?.clasico(li.dataset.pid); return; } // sin conversación de Outlook: vista clásica
    openThread(li.dataset.conv, { pid: li.dataset.pid });
  });
  async function toggleExp(conv, force) {
    const on = force ?? !st.exp.has(conv);
    if (on) st.exp.add(conv); else st.exp.delete(conv);
    paintListSoft();
    if (on && !st.hcache.has(conv)) {
      try { const r = await call('hilo', { conv, marcar: false, ligero: true }); st.hcache.set(conv, r.mensajes || []); }
      catch { st.hcache.set(conv, []); }
      paintListSoft();
    }
  }

  // acciones al pasar el ratón (fila de conversación o mensaje suelto)
  async function rowAction(b) {
    const a = b.dataset.h, conv = b.dataset.conv || b.closest('[data-conv]')?.dataset.conv, mid = b.dataset.mid;
    const t = conv ? (threadOf(conv) || pinThreads().find((x) => x.conv === conv) || pendThreads(st.filtro).find((x) => x.conv === conv)) : null;
    const msgs = mid ? [(st.hcache.get(conv) || []).find((x) => x.id === mid)].filter(Boolean) : null;
    if (a === 'anclar') return togglePin(conv, t?.latest || (st.hcache.get(conv) || [])[0]);
    b.disabled = true;
    try {
      if (a === 'leido') {
        const unread = mid ? !msgs[0]?.leido : !!t?.unread;
        const ids = mid ? [mid] : unread ? st.items.filter((x) => x.conv === conv && !x.leido).map((x) => x.id) : [(t?.msgs || st.items.filter((x) => x.conv === conv))[0]?.id].filter(Boolean);
        if (!ids.length && !mid) { const h = st.hcache.get(conv) || (await call('hilo', { conv, marcar: false, ligero: true })).mensajes || []; const x = h.find((y) => !y.mio) || h[0]; if (x) ids.push(x.id); }
        await call('leido', { ids, valor: unread });
        for (const x of st.items) if (ids.includes(x.id)) x.leido = unread;
        for (const x of st.hcache.get(conv) || []) if (ids.includes(x.id)) x.leido = unread;
        refreshFolders();
      } else if (a === 'bandera') {
        const on = mid ? !msgs[0]?.bandera : !t?.bandera;
        const ids = mid ? [mid] : on ? [(t?.msgs || [])[0]?.id].filter(Boolean) : st.items.filter((x) => x.conv === conv && x.bandera).map((x) => x.id);
        if (!ids.length) { const h = st.hcache.get(conv) || (await call('hilo', { conv, marcar: false, ligero: true })).mensajes || []; ids.push(...(on ? [h[0]?.id] : h.filter((x) => x.bandera).map((x) => x.id)).filter(Boolean)); }
        await Promise.all(ids.map((id) => call('bandera', { id, valor: on })));
        for (const x of st.items) if (ids.includes(x.id)) x.bandera = on;
        for (const x of st.hcache.get(conv) || []) if (ids.includes(x.id)) x.bandera = on;
        if (st.hilo) for (const x of st.hilo) if (ids.includes(x.id)) x.bandera = on;
        toast(on ? 'Con bandera (también en Outlook)' : 'Bandera quitada');
      } else if (a === 'eliminar') {
        const ids = mid ? [mid] : st.items.filter((x) => x.conv === conv).map((x) => x.id);
        if (!ids.length) { const h = st.hcache.get(conv) || (await call('hilo', { conv, marcar: false, ligero: true })).mensajes || []; ids.push(...h.filter((x) => !x.mio).map((x) => x.id)); }
        await call('mover', { ids, destino: 'deleteditems' });
        st.items = st.items.filter((x) => !ids.includes(x.id));
        if (st.hcache.has(conv)) st.hcache.set(conv, st.hcache.get(conv).filter((x) => !ids.includes(x.id)));
        if (st.sel === conv && !mid) closeMsg(true);
        toast('Enviado a Elementos eliminados');
        refreshFolders();
      }
    } catch (err) { toast('No se pudo: ' + err.message); }
    b.disabled = false;
    repaint();
    if (st.sel === conv && st.hilo) paintTools();
  }

  // Con «No leídos», lo que ya has leído se queda en la lista (por si fue sin querer) hasta que vuelves a pulsar «No leídos» (25/11)
  function dropIfRead() {}
  function keepOpen(fresh) {
    if (!st.sel) return fresh;
    const mine = st.items.filter((x) => x.conv === st.sel && !fresh.some((y) => y.id === x.id));
    return [...fresh, ...mine];
  }
  const listArgs = () => ({ carpeta: st.carpeta, ver: st.filtro === 'noleidos' ? 'noleidos' : 'todos', bandera: st.filtro === 'bandera', q: st.q, foco: usaFoco() ? st.foco : null });

  /* ---------- rapidez (25/11): la lista sale al momento con lo último guardado y las conversaciones se precargan ---------- */
  const LKEY = () => `sq-bz:${uid}:${st.carpeta}:${usaFoco() ? st.foco : '-'}:${st.filtro}`;
  const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin sitio: no pasa nada */ } };
  const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const full = new Map(); // conversación → { mensajes, at } (con el texto, para abrir al instante)
  const inflight = new Map();
  const cola = [];
  let activos = 0;
  function fetchFull(conv) {
    if (inflight.has(conv)) return inflight.get(conv);
    const p = call('hilo', { conv, marcar: false }).then((r) => { const m = r.mensajes || []; full.set(conv, { mensajes: m, at: Date.now() }); if (full.size > 40) full.delete(full.keys().next().value); return m; })
      .finally(() => inflight.delete(conv));
    inflight.set(conv, p);
    return p;
  }
  function prefetch(convs, urgente) {
    for (const c of convs) {
      if (!c || String(c).startsWith('p:') || full.has(c) || inflight.has(c) || cola.includes(c)) continue;
      if (urgente) cola.unshift(c); else cola.push(c);
    }
    pump();
  }
  function pump() {
    while (activos < 2 && cola.length) {
      const c = cola.shift();
      if (full.has(c)) continue;
      activos++;
      fetchFull(c).catch(() => null).finally(() => { activos--; setTimeout(pump, 150); });
    }
  }
  // las primeras de la lista (lo que más probablemente vas a abrir)
  const prefetchTop = () => { const ts = isPF() ? pendThreads(st.filtro) : threads(); prefetch(ts.slice(0, 10).map((t) => t.conv)); };
  // al pasar el ratón por un correo, se adelanta su carga
  list.addEventListener('pointerover', (e) => { const li = e.target.closest('.bz-item'); if (li && !mqNarrow.matches) prefetch([li.dataset.conv], true); });

  let reqN = 0;
  async function reload() {
    if (isPF()) { paintList(); return; }
    st.err = ''; st.items = []; st.next = null; st.exp.clear();
    if (st.sel) closeMsg(true);
    if (st.cuenta === 'gmail') { paintList(); return; }
    const n = ++reqN; st.cargando = true;
    const key = st.q ? null : LKEY();
    const cached = key && readLocal(key);
    if (cached?.items?.length) st.items = cached.items; // lo último que viste, mientras llega lo nuevo
    paintList();
    try {
      const r = await call('lista', listArgs());
      if (n !== reqN) return;
      st.items = keepOpen(r.items || []); st.next = r.next;
      if (r.sinFoco) st.sinFoco = true; // Outlook no tiene activada la Bandeja Prioritarios: se ve todo
      if (key) saveLocal(key, { items: (r.items || []).slice(0, 60), at: Date.now() });
    } catch (e) { if (n === reqN && !st.items.length) st.err = 'No se pudo cargar el correo: ' + e.message; }
    if (n === reqN) { st.cargando = false; cached?.items?.length ? paintListSoft() : paintList(); prefetchTop(); }
  }
  async function more() {
    if (!st.next || st.cargando) return;
    st.cargando = true; paintListSoft();
    try { const r = await call('lista', { next: st.next }); st.items.push(...(r.items || []).filter((x) => !st.items.some((y) => y.id === x.id))); st.next = r.next; }
    catch (e) { st.err = e.message; }
    st.cargando = false; paintListSoft();
  }
  // actualización silenciosa (sin perder lo abierto)
  async function refreshQuiet() {
    if (st.modo !== 'bandeja' || view.hidden || document.hidden || st.cargando || st.q || st.cuenta === 'gmail' || st.compose || isPF()) return;
    try {
      const r = await call('lista', listArgs());
      const fresh = r.items || [];
      const extra = st.filtro === 'noleidos'
        ? st.items.filter((x) => !fresh.some((y) => y.id === x.id)) // los ya leídos siguen en la lista
        : st.items.slice(fresh.length).filter((x) => !fresh.some((y) => y.id === x.id));
      st.items = keepOpen([...fresh, ...extra].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))));
      saveLocal(LKEY(), { items: fresh.slice(0, 60), at: Date.now() });
      // lo que ha cambiado se vuelve a precargar
      for (const m of fresh) { const c = full.get(m.conv); if (c && !c.mensajes.some((x) => x.id === m.id)) full.delete(m.conv); }
      setTimeout(prefetchTop, 500);
      for (const c of st.exp) if (c !== st.sel) st.hcache.delete(c);
      st.exp.forEach((c) => { if (!st.hcache.has(c)) call('hilo', { conv: c, marcar: false, ligero: true }).then((x) => { st.hcache.set(c, x.mensajes || []); paintListSoft(); }).catch(() => null); });
      paintListSoft();
      refreshFolders();
    } catch { /* la próxima vez */ }
  }

  /* ---------- correo abierto ---------- */
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
  /* ---------- el correo tal cual se ve en Outlook (25/11): HTML en un marco aislado, sin scripts ---------- */
  const FRAME_CSS = `html,body{margin:0;padding:0;background:#fff}body{font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.45;color:#121821;overflow-wrap:anywhere;overflow-x:auto}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#0b6e63}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #e3e6ec}`;
  const frameHtml = (html) => `<iframe class="bz-html" title="Texto del correo" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${esc(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests; script-src 'none'"><base target="_blank"><style>${FRAME_CSS}</style></head><body>${html}</body></html>`)}"></iframe>`;
  // alto del marco = alto del correo (también cuando terminan de cargar las imágenes)
  function fitFrames(scope = pane) {
    scope.querySelectorAll('iframe.bz-html:not([data-fit])').forEach((f) => {
      f.dataset.fit = '1';
      const fit = () => { try { const d = f.contentDocument; if (!d?.body) return; f.style.height = Math.max(40, Math.ceil(d.documentElement.scrollHeight)) + 'px'; } catch { /* */ } };
      f.addEventListener('load', () => {
        fit();
        try {
          const d = f.contentDocument;
          d.querySelectorAll('img').forEach((im) => { im.addEventListener('load', fit); im.addEventListener('error', () => { im.style.display = 'none'; fit(); }); if (im.complete && !im.naturalWidth && im.getAttribute('src')) im.style.display = 'none'; });
          new ResizeObserver(fit).observe(d.body);
        } catch { /* */ }
      });
    });
  }
  const bodyOf = (x, full) => full ? (x.htmlCompleto ? frameHtml(x.htmlCompleto) : `<div class="bz-text">${linkify(x.citado)}</div>`)
    : (x.html ? frameHtml(x.html) : `<div class="bz-text">${linkify(x.cuerpo || x.prev || '')}</div>`);
  function reading(on) {
    root.classList.toggle('bz-reading', on);
    if (on && mqNarrow.matches) { try { if (!history.state?.bz) history.pushState({ bz: 1 }, ''); } catch {} window.scrollTo({ top: 0 }); }
  }
  window.addEventListener('popstate', () => { if (root.classList.contains('bz-reading')) closeMsg(false, true); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || st.modo !== 'bandeja' || view.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (menuOpen()) { closeMenu(); return; }
    if (st.sel) closeMsg();
  });
  function closeMsg(quiet, fromPop) {
    const conv = st.sel;
    st.sel = null; st.selMid = null; st.hilo = null; st.compose = null; pane.innerHTML = '';
    if (root.classList.contains('bz-reading')) {
      root.classList.remove('bz-reading');
      if (!fromPop && mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} }
    }
    dropIfRead(conv);
    if (quiet) return;
    paintListSoft();
    const li = conv && [...list.querySelectorAll('.bz-item')].find((x) => x.dataset.conv === conv);
    if (li && mqNarrow.matches) li.scrollIntoView({ block: 'center' });
  }
  let openN = 0;
  async function openThread(conv, o = {}) {
    const prev = st.sel;
    st.sel = conv; st.selMid = o.mid || null; st.compose = null;
    if (prev !== conv) st.hilo = null;
    if (prev && prev !== conv) dropIfRead(prev);
    const t = threadOf(conv) || pendThreads(st.filtro).find((x) => x.conv === conv);
    if (!mqNarrow.matches && (t?.n > 1 || t?.pend?.mensajes > 1)) st.exp.add(conv);
    paintListSoft();
    reading(true);
    if (!st.hilo) pane.innerHTML = `<div class="bz-loading">Abriendo${t ? ' «' + esc(t.latest.asunto) + '»' : ''}…</div>`;
    const n = ++openN;
    const pre = full.get(conv);
    try {
      let r;
      if (pre && Date.now() - pre.at < 10 * 60000) {
        r = { mensajes: pre.mensajes };
        // marcar como leído en Outlook sin esperar, y comprobar en segundo plano si ha llegado algo nuevo
        const unreadIds = [...st.items.filter((x) => x.conv === conv && !x.leido).map((x) => x.id), ...pre.mensajes.filter((x) => !x.leido).map((x) => x.id)];
        if (unreadIds.length) call('leido', { ids: [...new Set(unreadIds)], valor: true }).then(refreshFolders).catch(() => null);
        pre.mensajes.forEach((x) => { x.leido = true; });
        fetchFull(conv).then((m) => { if (st.sel === conv && openN === n && !st.compose && m.length !== (st.hilo || []).length) { st.hilo = m; paintThread(); } }).catch(() => null);
      } else {
        r = await call('hilo', { conv });
        full.set(conv, { mensajes: r.mensajes || [], at: Date.now() });
      }
      if (n !== openN) return;
      st.hilo = r.mensajes || [];
      if (!st.hilo.length) throw new Error('Esta conversación ya no está en tu buzón.');
      st.hcache.set(conv, st.hilo.map((x) => ({ ...x, html: '', htmlCompleto: '', cuerpo: '', citado: '', leido: true })));
      const hadUnread = t?.unread;
      for (const x of st.items) if (x.conv === conv) x.leido = true;
      paintListSoft(); paintThread();
      pane.scrollTop = 0;
      if (o.sugerida) openSuggested(!!o.auto);
      if (hadUnread) refreshFolders();
    } catch (e) {
      if (n !== openN) return;
      const pm = pendOf(conv);
      pane.innerHTML = `<div class="bz-empty err">${esc(e.message)}${pm ? ` <button type="button" class="bz-link" data-classic="${esc(pm.id)}">Verlo en Pendientes</button>` : ''}</div>`;
    }
  }
  const lastIn = (h = st.hilo) => (h || []).find((x) => !x.mio) || (h || [])[0];
  const safeOutlook = (u) => { try { const x = new URL(u || ''); return x.protocol === 'https:' && /(^|\.)(office\.com|outlook\.com|cloud\.microsoft|office365\.com|live\.com)$/i.test(x.hostname) ? x.href : ''; } catch { return ''; } };
  const tam = (b) => !b ? '' : b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const adjHtml = (x) => x.adjuntos?.length ? `<div class="bz-adj">${x.adjuntos.map((a) => `<span class="bz-attw"><button type="button" class="bz-att" data-att="${esc(a.id)}" data-mid="${esc(x.id)}" title="Ver sin descargar">${svg('clip', 15)}<span><b>${esc(a.nombre)}</b><small>${esc(tam(a.tam))} · Ver</small></span></button><button type="button" class="bz-ibtn bz-attdl" data-dl="${esc(a.id)}" data-mid="${esc(x.id)}" title="Descargar" aria-label="Descargar ${esc(a.nombre)}">${svg('down', 16)}</button></span>`).join('')}</div>` : '';
  function msgHtml(x) {
    const de = x.mio ? `${x.de?.nombre || 'Tú'} (tú)` : (x.de?.nombre || x.de?.mail || '');
    return `<section class="bz-m${x.mio ? ' mio' : ''}" data-mid="${esc(x.id)}">
      <button type="button" class="bz-mh" aria-expanded="false">
        <span class="who"><b>${esc(de)}</b></span>
        <span class="pv">${esc(x.prev)}</span>
        <span class="ics">${x.adj ? svg('clip', 13) : ''}</span>
        <span class="when">${esc(corto(x.fecha))}</span>
      </button>
      <div class="bz-mb">
        <div class="bz-meta">${esc(largo(x.fecha))} · Para: ${esc(nombres(x.para) || '—')}${x.cc?.length ? ' · CC: ' + esc(nombres(x.cc)) : ''}</div>
        ${adjHtml(x)}
        <div class="bz-hslot"></div>
        ${x.citado ? `<button type="button" class="bz-link bz-qt" aria-expanded="false" data-full="${esc(x.id)}">Mostrar texto citado</button><div class="bz-quoted" hidden></div>` : ''}
      </div>
    </section>`;
  }
  function focusMsg(mid) {
    const h = st.hilo || [];
    if (!mid || h[0]?.id === mid) return;
    const sec2 = pane.querySelector(`.bz-m[data-mid="${CSS.escape(mid)}"]`);
    if (!sec2) return;
    sec2.classList.add('open'); sec2.querySelector('.bz-mh')?.setAttribute('aria-expanded', 'true'); fillMsg(sec2);
    scrollPane(sec2);
  }

  const ICONS = (flagged, pinned, mobile) => `
    <button type="button" class="bz-ibtn" data-a="noleido" title="Marcar como no leído" aria-label="Marcar como no leído">${svg('unread', 17)}</button>
    <button type="button" class="bz-ibtn${flagged ? ' on' : ''}" data-a="bandera" title="${flagged ? 'Quitar bandera' : 'Marcar con bandera'}" aria-label="${flagged ? 'Quitar bandera' : 'Marcar con bandera'}" aria-pressed="${flagged}">${svg('flag', 17)}</button>
    <button type="button" class="bz-ibtn${pinned ? ' pin' : ''}" data-a="anclar" title="${pinned ? 'Desanclar' : 'Anclar arriba'}" aria-label="${pinned ? 'Desanclar' : 'Anclar arriba'}" aria-pressed="${pinned}">${svg('pin', 17)}</button>
    <button type="button" class="bz-ibtn" data-a="archivar" title="Archivar" aria-label="Archivar">${svg('arch', 17)}</button>
    <button type="button" class="bz-ibtn" data-a="eliminar" title="Eliminar" aria-label="Eliminar">${svg('del', 17)}</button>
    ${mobile ? '' : `<label class="bz-ibtn bz-movew" title="Mover a carpeta">${svg('move', 17)}<span class="bz-sr">Mover a carpeta</span><select data-a="mover"><option value="">Mover a…</option>${moveOptions()}</select></label>
    ${taskBtn()}`}
    <button type="button" class="bz-ibtn" data-a="mas" title="Más" aria-label="Más acciones" aria-haspopup="menu" aria-expanded="false">${svg('more', 17)}</button>`;
  function paintThread() {
    const h = st.hilo; if (!h?.length) return;
    const top = (st.selMid && h.find((x) => x.id === st.selMid)) || h[0];
    const otros = h.filter((x) => x !== top);
    const pm = pendOf(top.conv);
    const n = pm && isPend(pm) ? nivelOf(pm) : null;
    const badge = pm && P()?.pospuesto(pm) ? '<span class="bz-tag otro">Para otro día</span>' : n === 'bloquea' ? '<span class="bz-tag urg">Urgente</span>' : n === 'pide' ? '<span class="bz-tag pide">Te piden algo</span>' : '';
    const de = top.mio ? `${top.de?.nombre || 'Tú'} (tú)` : (top.de?.nombre || top.de?.mail || '');
    pane.innerHTML = `
      <div class="bz-mtop"><button type="button" class="bz-back" data-a="volver">${svg('back', 20)}<span>${esc(isPF() ? ({ urgente: 'Urgente', pide: 'Te piden', otro: 'Otro día', anclados: 'Anclados' }[st.filtro]) : 'Bandeja')}</span></button><span class="bz-tools" data-tools="m"></span></div>
      <div class="bz-phead"><h3>${esc(top.asunto)}</h3>${badge}<button type="button" class="bz-ibtn bz-close" data-a="volver" title="Cerrar (Esc)" aria-label="Cerrar">✕</button></div>
      <div class="bz-card">
        <div class="bz-acts">
          <div class="bz-reply">
            <button type="button" class="bz-btn pri" data-a="responder">${svg('reply', 15)}<span>Responder</span></button>
            <button type="button" class="bz-btn ghost" data-a="todos">${svg('replyall', 15)}<span>Responder a todos</span></button>
            <button type="button" class="bz-btn ghost" data-a="reenviar">${svg('fwd', 15)}<span>Reenviar</span></button>
          </div>
          <span class="bz-tools" data-tools="d"></span>
        </div>
        <div class="bz-from">${avatar(de)}<div class="w"><div class="l1"><b>${esc(de)}</b><span>${esc(largo(top.fecha))}</span></div><div class="bz-meta">Para: ${esc(nombres(top.para) || '—')}${top.cc?.length ? ' · CC: ' + esc(nombres(top.cc)) : ''}</div></div></div>
        <div class="bz-syn-slot"></div>
        <p class="bz-msgst" aria-live="polite"></p>
        <div class="bz-compose-slot"></div>
        ${adjHtml(top)}
        <div class="bz-body1">${bodyOf(top)}</div>
        ${top.citado ? `<button type="button" class="bz-link bz-qt" aria-expanded="false" data-full="${esc(top.id)}">Mostrar texto citado</button><div class="bz-quoted" hidden></div>` : ''}
      </div>
      ${otros.length ? `<div class="bz-prev"><div class="bz-plbl">${top === h[0] ? 'Mensajes anteriores del hilo' : 'Resto del hilo'} · ${otros.length}</div><div class="bz-thread">${otros.map(msgHtml).join('')}</div></div>` : ''}
      <div class="bz-mbot">
        <button type="button" class="bz-btn pri" data-a="responder">${svg('reply', 15)}<span>Responder</span></button>
        <button type="button" class="bz-btn" data-a="todos">${svg('replyall', 15)}<span>A todos</span></button>
        <button type="button" class="bz-btn" data-a="reenviar">${svg('fwd', 15)}<span>Reenviar</span></button>
      </div>`;
    paintTools(); paintSyn(); fitFrames();
    // los adjuntos del último mensaje se traen ya, para verlos al instante
    (top.adjuntos || []).filter((x) => (x.tam || 0) < 6 * 1024 * 1024).slice(0, 3).forEach((x) => getAtt(top.id, x.id).catch(() => null));
  }
  const fillMsg = (sec2) => { const slot = sec2.querySelector('.bz-hslot'); const x = st.hilo?.find((y) => y.id === sec2.dataset.mid); if (slot && x && !slot.firstChild) { slot.innerHTML = bodyOf(x); fitFrames(sec2); } };
  // icono de tarea: turquesa y con número cuando ese correo ya está en Tareas (25/11)
  function taskBtn() {
    const n = mailTasks().length;
    return n ? `<button type="button" class="bz-ibtn bz-tk-on" data-a="tarea" title="Ya está en Tareas" aria-label="Ya está en Tareas (${n})">${svg('task', 17)}<b>${n}</b></button>`
      : `<button type="button" class="bz-ibtn" data-a="tarea" title="Pasar a tarea" aria-label="Pasar a tarea">${svg('task', 17)}</button>`;
  }
  function paintTools() {
    const h = st.hilo; if (!h?.length) return;
    const conv = h[0].conv, t = threadOf(conv);
    const flagged = t ? t.bandera : h.some((x) => x.bandera);
    const pinned = pins.has(conv);
    pane.querySelectorAll('[data-tools]').forEach((x) => { x.innerHTML = ICONS(flagged, pinned, x.dataset.tools === 'm'); });
  }

  // recuadro Synqalia: resumen, lo que te piden, responder con…, Gestionado / Para mañana
  function paintSyn() {
    const slot = pane.querySelector('.bz-syn-slot'); if (!slot || !st.hilo?.length) return;
    const pm = pendOf(st.hilo[0].conv);
    if (!pm) { slot.innerHTML = ''; return; }
    const pend = isPend(pm), pos = P()?.pospuesto(pm), done = pm.estado === 'gestionado' || (!pend && !pos);
    if (!pm.resumen && !pm.peticion && done) { slot.innerHTML = ''; return; }
    const motivo = P()?.motivo(pm) || '';
    const hasClassic = !!slot.querySelector('.bz-classic');
    if (hasClassic && slot.dataset.pid === pm.id && !done) return; // no tocar la caja de respuesta abierta
    slot.dataset.pid = pm.id;
    slot.innerHTML = `<div class="bz-syn${done ? ' done' : ''}">
      <div class="bz-synh"><svg class="bz-logo" width="16" height="16" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#121821"/><g transform="translate(7 7)"><circle cx="21" cy="20" r="9.5" fill="none" stroke="#fff" stroke-width="6"/><path d="M30.5 20v16" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="30.5" cy="44" r="3.6" fill="#5fe0cf"/></g></svg><span>Synqalia</span>${done ? `<em>${svg('check', 13)} Gestionado${pm.cierre?.motivo ? ' · ' + esc(pm.cierre.motivo) : ''}</em>` : pos ? `<em>${svg('clock', 13)} Para otro día</em>` : ''}</div>
      ${pm.resumen ? `<p><b>Resumen:</b> ${esc(pm.resumen)}</p>` : ''}
      ${pm.peticion ? `<p class="pide"><b>Te piden:</b> ${esc(pm.peticion)}</p>` : ''}
      ${motivo && nivelOf(pm) === 'bloquea' ? `<p class="mot"><b>Por qué es urgente:</b> ${esc(motivo)}</p>` : ''}
      ${done ? '' : `<div class="bz-synr">
        <span class="lbl">Responder con:</span>
        <button type="button" class="bz-sbtn sug" data-a="sugerida">✨ Respuesta sugerida</button>
        <button type="button" class="bz-sbtn" data-a="gracias">¡Muchas gracias!</button>
        <span class="bz-synb">
          <button type="button" class="bz-btn gest" data-a="gestionado">${svg('check', 14)}<span>Gestionado</span></button>
          ${pos ? `<button type="button" class="bz-btn" data-a="reactivar">${svg('clock', 14)}<span>Volver a pendientes</span></button>` : `<button type="button" class="bz-btn" data-a="manana">${svg('clock', 14)}<span>Para mañana</span></button>`}
        </span>
      </div>`}
      <div class="bz-classic-slot"></div>
    </div>`;
  }
  // la caja de respuesta de siempre (propuesta con IA, «¿qué quieres contestar?», pulir, CC, programar, adjuntos, tareas…)
  function openSuggested(auto) {
    const pm = st.hilo?.length && pendOf(st.hilo[0].conv);
    const slot = pane.querySelector('.bz-classic-slot');
    if (!pm || !slot || !P()?.composer) return false;
    if (slot.firstChild) { scrollPane(slot); return true; }
    const box = P().composer(pm.id, auto || (!pm.sugerida));
    if (!box) return false;
    const w = document.createElement('div');
    w.className = 'bz-classic';
    w.innerHTML = `<div class="bz-classic-h"><b>Tu respuesta</b><button type="button" class="bz-link" data-a="cerrar-sug">Cerrar</button></div>`;
    w.appendChild(box);
    slot.appendChild(w);
    pane.querySelector('.bz-sbtn.sug')?.setAttribute('aria-pressed', 'true');
    scrollPane(w);
    return true;
  }

  /* ---------- menú «más» ---------- */
  let menuEl = null;
  const menuOpen = () => !!menuEl;
  function closeMenu() { menuEl?.remove(); menuEl = null; pane.querySelectorAll('[data-a="mas"]').forEach((x) => x.setAttribute('aria-expanded', 'false')); }
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-a="mas"]')) closeMenu(); });
  function openMenu(btn) {
    if (menuEl) { closeMenu(); return; }
    const h = st.hilo; if (!h?.length) return;
    const pm = pendOf(h[0].conv), enlace = safeOutlook(h[0].enlace);
    const nv = pm ? (pm.nivelManual || '') : '';
    menuEl = document.createElement('div');
    menuEl.className = 'bz-menu'; menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = `
      <button type="button" role="menuitem" data-a="tarea">${svg('task', 16)}${mailTasks().length ? 'Ya está en Tareas' : 'Pasar a tarea'}</button>
      <label class="bz-mi">${svg('move', 16)}<span>Mover a…</span><select data-a="mover"><option value="">Elegir carpeta</option>${moveOptions()}</select></label>
      <div class="bz-msep"></div>
      ${pm ? `<div class="bz-mlbl">Clasificación</div>
      <button type="button" role="menuitemradio" aria-checked="${nv === 'bloquea'}" data-cls="bloquea">Es urgente</button>
      <button type="button" role="menuitemradio" aria-checked="${nv === 'pide'}" data-cls="pide">Te piden algo</button>
      <button type="button" role="menuitemradio" aria-checked="${nv === 'no'}" data-cls="no">No me piden nada</button>
      ${nv ? '<button type="button" role="menuitem" data-cls="">Como lo clasificó la IA</button>' : ''}
      <div class="bz-msep"></div>` : ''}
      ${enlace ? `<a role="menuitem" href="${esc(enlace)}" target="_blank" rel="noopener">${svg('ext', 16)}Abrir en Outlook</a>` : ''}
      ${pm ? `<button type="button" role="menuitem" data-classic="${esc(pm.id)}">Ver en Pendientes (vista de siempre)</button>` : ''}`;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    menuEl.style.top = Math.min(r.bottom + 4, innerHeight - 20) + 'px';
    menuEl.style.right = Math.max(8, innerWidth - r.right) + 'px';
    document.body.appendChild(menuEl);
    menuEl.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cls]');
      if (c) { P()?.clasificar(pm.id, c.dataset.cls || null); closeMenu(); return; }
      const k = e.target.closest('[data-classic]');
      if (k) { closeMenu(); P()?.clasico(k.dataset.classic); return; }
      const tk = e.target.closest('[data-a="tarea"]');
      if (tk) { const anchor = pane.querySelector('[data-a="mas"]'); closeMenu(); openTaskPop(anchor); return; }
      if (e.target.closest('a')) closeMenu();
    });
    menuEl.addEventListener('change', (e) => { const s = e.target.closest('select[data-a="mover"]'); if (s?.value) { closeMenu(); moverA(s); } });
    menuEl.querySelector('button, a, select')?.focus();
  }

  function scrollPane(el) {
    if (!el) return;
    if (mqNarrow.matches) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    pane.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 8), behavior: 'smooth' });
  }
  const msgStatus = (t, bad) => { const p = pane.querySelector('.bz-msgst'); if (p) { p.textContent = t; p.classList.toggle('bad', !!bad); } };

  pane.addEventListener('click', async (e) => {
    const dl = e.target.closest('[data-dl]');
    if (dl) return download(dl.dataset.mid, dl.dataset.dl, dl);
    const att = e.target.closest('[data-att]');
    if (att) return preview(att.dataset.mid, att.dataset.att, att);
    const k = e.target.closest('[data-classic]');
    if (k) return P()?.clasico(k.dataset.classic);
    const mh = e.target.closest('.bz-mh');
    if (mh) { const sec2 = mh.parentElement; const on = !sec2.classList.contains('open'); sec2.classList.toggle('open', on); mh.setAttribute('aria-expanded', String(on)); if (on) fillMsg(sec2); return; }
    const qt = e.target.closest('.bz-qt');
    if (qt) { const q = qt.nextElementSibling; if (!q.firstChild) { const x = st.hilo?.find((y) => y.id === qt.dataset.full); if (x) { q.innerHTML = bodyOf(x, true); fitFrames(q); } } q.hidden = !q.hidden; qt.setAttribute('aria-expanded', String(!q.hidden)); qt.textContent = q.hidden ? 'Mostrar texto citado' : 'Ocultar texto citado'; return; }
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'volver') return closeMsg();
    if (!st.hilo?.length) return;
    const conv = st.sel, t = threadOf(conv), last = lastIn();
    const pm = pendOf(conv);
    if (a === 'mas') return openMenu(b);
    if (a === 'responder' || a === 'todos' || a === 'reenviar') { openCompose({ tipo: a }); scrollPane(pane.querySelector('.bz-compose-slot')); return; }
    if (a === 'gracias') { openCompose({ tipo: 'responder', texto: '¡Muchas gracias!\n\nUn saludo,' }); scrollPane(pane.querySelector('.bz-compose-slot')); return; }
    if (a === 'sugerida') { if (!openSuggested(false)) msgStatus('No encuentro la propuesta de este correo.', true); return; }
    if (a === 'cerrar-sug') { const s = pane.querySelector('.bz-classic-slot'); if (s) s.innerHTML = ''; pane.querySelector('.bz-sbtn.sug')?.setAttribute('aria-pressed', 'false'); return; }
    if (a === 'gestionado' && pm) { st.adv = conv; P().gestionado(pm.id); return afterHandled('Gestionado ✓'); }
    if (a === 'manana' && pm) { st.adv = conv; P().posponer(pm.id); return afterHandled('Lo verás mañana'); }
    if (a === 'reactivar' && pm) { P().reactivar(pm.id); return; }
    if (a === 'anclar') return togglePin(conv, t?.latest || st.hilo[0]);
    if (a === 'noleido') {
      b.disabled = true;
      try {
        await call('leido', { id: last.id, valor: false });
        for (const x of st.items) if (x.id === last.id) x.leido = false;
        toast('Marcado como no leído');
        closeMsg();
        refreshFolders();
      } catch (err) { msgStatus(err.message, true); b.disabled = false; }
      return;
    }
    if (a === 'bandera') {
      const v = !(t ? t.bandera : st.hilo.some((x) => x.bandera));
      const ids = v ? [last.id] : [...st.items.filter((x) => x.conv === conv && x.bandera).map((x) => x.id), ...st.hilo.filter((x) => x.bandera).map((x) => x.id)];
      b.disabled = true;
      try {
        await Promise.all([...new Set(ids.length ? ids : [last.id])].map((id) => call('bandera', { id, valor: v })));
        for (const x of st.items) if (x.conv === conv) x.bandera = v ? x.id === last.id || x.bandera : false;
        for (const x of st.hilo) x.bandera = v ? x.id === last.id : false;
        toast(v ? 'Con bandera (también en Outlook)' : 'Bandera quitada');
        repaint();
      } catch (err) { msgStatus(err.message, true); b.disabled = false; }
      return;
    }
    if (a === 'archivar' || a === 'eliminar') return quitar(a === 'archivar' ? 'archive' : 'deleteditems', a === 'archivar' ? 'Archivado' : 'Enviado a Elementos eliminados');
    if (a === 'tarea') return openTaskPop(b);
  });
  /* ---------- Pasar a tarea: ventanita (PC) u hoja desde abajo (móvil), sin duplicados (25/11) ---------- */
  const T = () => window.__sqTasks || null;
  function mailTasks(conv = st.sel) {
    if (!conv || !T()) return [];
    const pm = pendOf(conv);
    return T().forMail(conv, pm?.id).sort((a, b) => (a.estado === 'hecha') - (b.estado === 'hecha'));
  }
  const PRI = [['Mega', '⚡ Mega urgente'], ['Alta', 'Urgente'], ['Media', 'Normal'], ['Baja', 'Baja']];
  const priTxt = (p) => (PRI.find((x) => x[0] === p) || PRI[2])[1];
  const isoD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const viernes = () => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return isoD(d); };
  const venceTxt = (v) => {
    if (!v) return 'Sin fecha';
    if (v === T()?.hoy()) return 'Hoy';
    if (v === T()?.manana()) return 'Mañana';
    const d = new Date(v + 'T12:00:00');
    return DOW[d.getDay()].toLowerCase() + ' ' + d.getDate() + (d.getMonth() !== new Date().getMonth() ? ' ' + MES[d.getMonth()] : '');
  };
  let popEl = null, popBack = null;
  function closeTaskPop() { popEl?.remove(); popBack?.remove(); popEl = popBack = null; }
  document.addEventListener('mousedown', (e) => { if (popEl && !popEl.contains(e.target) && !e.target.closest('[data-a="tarea"], [data-a="mas"]') && !mqNarrow.matches) closeTaskPop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popEl) { e.stopPropagation(); closeTaskPop(); } }, true);
  function openTaskPop(btn, mode) {
    if (popEl && !mode) { closeTaskPop(); return; }
    closeTaskPop();
    if (!st.hilo?.length || !T()) { msgStatus('No se pudo abrir Tareas desde aquí.', true); return; }
    const list = mailTasks();
    if (!mode) mode = list.length ? { view: 'lista' } : { view: 'nueva' };
    popEl = document.createElement('div');
    popEl.className = 'bz-pop' + (mqNarrow.matches ? ' sheet' : '');
    popEl.setAttribute('role', 'dialog'); popEl.setAttribute('aria-label', 'Pasar a tarea');
    if (mqNarrow.matches) { popBack = document.createElement('div'); popBack.className = 'bz-popback'; popBack.addEventListener('click', closeTaskPop); document.body.appendChild(popBack); }
    document.body.appendChild(popEl);
    if (mode.view === 'lista') paintTaskList(list); else paintTaskForm(mode.edit || null);
    if (!mqNarrow.matches && btn) {
      const r = btn.getBoundingClientRect(), w = Math.min(400, innerWidth - 16);
      popEl.style.width = w + 'px';
      popEl.style.left = Math.max(8, Math.min(r.right + 30 - w, innerWidth - w - 8)) + 'px';
      popEl.style.top = Math.min(r.bottom + 8, innerHeight - popEl.offsetHeight - 8) + 'px';
      popEl.style.setProperty('--ax', Math.max(16, Math.min(w - 24, r.left + r.width / 2 - parseFloat(popEl.style.left) - 6)) + 'px');
    }
  }
  const popHead = (t) => `<div class="bz-poph">${svg('task', 18)}<b>${esc(t)}</b><button type="button" class="bz-ibtn" data-x aria-label="Cerrar">✕</button></div>`;
  function paintTaskList(list) {
    popEl.innerHTML = popHead('Ya está en Tareas') + list.map((t) => `<div class="bz-tkcard${t.estado === 'hecha' ? ' done' : ''}" data-id="${esc(t.id)}">
        <b>${esc(t.titulo)}</b>
        <div class="tags"><span class="p ${esc(t.prioridad || 'Media')}">${esc(priTxt(t.prioridad))}</span><span>${esc(t.estado === 'hecha' ? 'Hecha ✓' : venceTxt(t.vence))}</span>${t.verCon ? `<span>Ver con ${esc(t.verCon)}</span>` : ''}</div>
        <div class="acts"><button type="button" class="bz-link go" data-open>Abrir en Tareas ›</button>${t.estado === 'hecha' ? '' : '<button type="button" class="bz-link" data-edit>Cambiar</button><button type="button" class="bz-link" data-done>✓ Hecha</button>'}</div>
      </div>`).join('') + `<p class="bz-popnote">No se vuelve a crear al pulsar otra vez el icono. <button type="button" class="bz-link" data-new>Crear otra tarea de este correo</button></p>`;
    popEl.onclick = (e) => {
      if (e.target.closest('[data-x]')) return closeTaskPop();
      if (e.target.closest('[data-new]')) return paintTaskForm(null);
      const card = e.target.closest('[data-id]'); if (!card) return;
      const t = list.find((x) => x.id === card.dataset.id);
      if (e.target.closest('[data-open]')) { closeTaskPop(); T().open(t.id); }
      else if (e.target.closest('[data-edit]')) paintTaskForm(t);
      else if (e.target.closest('[data-done]')) { T().done(t.id); closeTaskPop(); toast('Tarea hecha ✓'); }
    };
  }
  function paintTaskForm(edit) {
    const h = st.hilo, last = lastIn(), pm = pendOf(st.sel);
    const yo = String(st.outlook || '').toLowerCase();
    // personas del hilo (sin ti), las más recientes primero
    const gente = [];
    for (const x of h) for (const p of [x.de, ...(x.para || []), ...(x.cc || [])]) {
      if (!p?.nombre || String(p.mail || '').toLowerCase() === yo || T().esMio(p.nombre) || gente.includes(p.nombre) || /@/.test(p.nombre)) continue;
      gente.push(p.nombre);
    }
    const f = {
      titulo: edit ? edit.titulo : String(pm?.peticion || last.asunto || '').replace(/\.$/, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 300),
      prioridad: edit ? (edit.prioridad || 'Media') : pm && nivelOf(pm) === 'bloquea' ? 'Alta' : 'Media',
      vence: edit ? (edit.vence || T().hoy()) : T().hoy(),
      verCon: edit ? (edit.verCon || '') : '',
    };
    if (f.verCon && !gente.includes(f.verCon)) gente.unshift(f.verCon);
    const fechas = [['Hoy', T().hoy()], ['Mañana', T().manana()], ['Viernes', viernes()]];
    popEl.innerHTML = popHead(edit ? 'Cambiar la tarea' : 'Pasar a tarea') + `
      <form class="bz-tkform" novalidate>
        <label class="bz-tkf"><span>Tarea</span><textarea name="titulo" rows="2" required>${esc(f.titulo)}</textarea></label>
        <div class="bz-tkf"><span>Prioridad</span><div class="bz-tkchips" data-g="prioridad">${PRI.map(([k, t]) => `<button type="button" class="bz-chip${k === 'Mega' ? ' bz-mega' : ''}" data-v="${k}" aria-pressed="${f.prioridad === k}">${t}</button>`).join('')}</div></div>
        <div class="bz-tkf"><span>Para cuándo</span><div class="bz-tkchips" data-g="vence">${fechas.map(([t, v]) => `<button type="button" class="bz-chip" data-v="${v}" aria-pressed="${f.vence === v}">${t}</button>`).join('')}<label class="bz-chip bz-tkdate" aria-pressed="${!fechas.some((x) => x[1] === f.vence)}">📅 <span>${fechas.some((x) => x[1] === f.vence) ? 'Otra fecha' : esc(venceTxt(f.vence))}</span><input type="date" value="${esc(f.vence)}" aria-label="Otra fecha"></label></div></div>
        <div class="bz-tkf"><span>Ver con</span><div class="bz-tkchips" data-g="verCon">${gente.slice(0, 4).map((n) => `<button type="button" class="bz-chip" data-v="${esc(n)}" aria-pressed="${f.verCon === n}">${esc(n)}</button>`).join('')}<input class="bz-tkother" type="text" list="tf-personas" placeholder="+ Otra persona" aria-label="Otra persona" value="${f.verCon && !gente.slice(0, 4).includes(f.verCon) ? esc(f.verCon) : ''}"></div><div class="bz-tkcu" aria-live="polite"></div></div>
        <p class="bz-msgst" aria-live="polite"></p>
        <div class="bz-tkacts"><button type="submit" class="bz-btn gest">${svg('check', 15)}<span>${edit ? 'Guardar cambios' : 'Crear tarea'}</span></button><button type="button" class="bz-link" data-x>Cancelar</button>${mqNarrow.matches ? '' : '<span class="kb">Intro = crear</span>'}</div>
      </form>`;
    const form = popEl.querySelector('form'), cu = popEl.querySelector('.bz-tkcu'), other = popEl.querySelector('.bz-tkother'), dateIn = popEl.querySelector('.bz-tkdate input');
    const mark = (g) => popEl.querySelectorAll(`[data-g="${g}"] [data-v]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === f[g])));
    const paintCu = () => {
      if (!f.verCon) { cu.innerHTML = ''; return; }
      const c = T().catchups([f.verCon])[0];
      cu.innerHTML = c ? `<div class="bz-tknote">${c.fecha ? `Lo tienes en el catch-up con <b>${esc(c.corto)}</b> del <b>${esc(venceTxt(c.fecha))}</b>: se añade a sus temas.` : `Se añade a los temas de tu catch-up con <b>${esc(c.corto)}</b>.`}</div>` : `<div class="bz-tknote off">Quedará como «Ver con ${esc(f.verCon)}» en Tareas.</div>`;
    };
    popEl.querySelectorAll('.bz-tkchips').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      const k = g.dataset.g;
      f[k] = k === 'verCon' && f.verCon === b.dataset.v ? '' : b.dataset.v;
      if (k === 'verCon') { other.value = ''; paintCu(); }
      if (k === 'vence') { popEl.querySelector('.bz-tkdate').setAttribute('aria-pressed', 'false'); popEl.querySelector('.bz-tkdate span').textContent = 'Otra fecha'; }
      mark(k);
    }));
    dateIn.addEventListener('change', () => { if (!dateIn.value) return; f.vence = dateIn.value; mark('vence'); const l = popEl.querySelector('.bz-tkdate'); l.setAttribute('aria-pressed', 'true'); l.querySelector('span').textContent = venceTxt(f.vence); });
    popEl.querySelector('.bz-tkdate').addEventListener('click', (e) => { if (e.target === dateIn) return; try { dateIn.showPicker(); } catch { dateIn.focus(); } });
    other.addEventListener('input', () => { f.verCon = other.value.trim(); mark('verCon'); paintCu(); });
    paintCu();
    const ta = form.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    popEl.onclick = (e) => { if (e.target.closest('[data-x]')) closeTaskPop(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titulo = ta.value.trim().replace(/\s+/g, ' ');
      const say = (t, bad) => { const p = form.querySelector('.bz-msgst'); p.textContent = t; p.classList.toggle('bad', !!bad); };
      if (!titulo) { say('Escribe qué tienes que hacer.', true); ta.focus(); return; }
      const verCon = f.verCon && !T().esMio(f.verCon) ? f.verCon : '';
      form.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      say(edit ? 'Guardando…' : 'Creando la tarea…');
      let ok;
      if (edit) ok = await T().update(edit.id, { titulo, prioridad: f.prioridad, vence: f.vence, verCon: verCon || null, ...(verCon ? { espera: 'vercon' } : {}) });
      else ok = await T().add({ titulo, detalle: `Correo de ${last.de?.nombre || last.de?.mail || ''} · ${last.asunto}`, prioridad: f.prioridad, vence: f.vence, origen: 'correo', ref: pm?.id || null, persona: last.mio ? null : (last.de?.nombre || null), ...(verCon ? { espera: 'vercon' } : {}), extra: { conv: st.sel, enlace: last.enlace || null, ...(verCon ? { verCon } : {}) } });
      if (!ok) { say('No se pudo guardar la tarea. Inténtalo otra vez.', true); form.querySelectorAll('button').forEach((x) => { x.disabled = false; }); return; }
      closeTaskPop();
      toast(edit ? 'Tarea actualizada' : `Tarea creada · ${venceTxt(f.vence)}${verCon ? ' · ver con ' + verCon : ''}`);
      setTimeout(() => { if (st.hilo?.length) paintTools(); }, 400);
    });
    if (!mqNarrow.matches) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  // tras Gestionado / Para mañana: en los filtros de Pendientes sale de la lista y se abre el siguiente
  function afterHandled(txt) {
    toast(txt);
    const conv = st.sel;
    st.adv = conv;
    if (!PEND_F.includes(st.filtro)) { setTimeout(paintSyn, 300); return; }
    const ts = pendThreads(st.filtro), i = ts.findIndex((x) => x.conv === conv);
    setTimeout(() => {
      const nts = pendThreads(st.filtro).filter((x) => x.conv !== conv);
      const nx = nts[Math.min(Math.max(i, 0), nts.length - 1)];
      closeMsg(true); paintListSoft();
      if (nx && !mqNarrow.matches && !nx.conv.startsWith('p:')) openThread(nx.conv, { pid: nx.pid });
    }, 250);
  }
  pane.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-a="mover"]');
    if (!sel || !sel.value) return;
    moverA(sel);
  });
  // archivar, eliminar o mover: la conversación entera de esta carpeta (como Outlook)
  async function quitar(destino, txt) {
    const conv = st.sel; if (!conv) return;
    const ts = threads(), i = ts.findIndex((x) => x.conv === conv);
    let ids = st.items.filter((x) => x.conv === conv).map((x) => x.id);
    if (!ids.length) ids = (st.hilo || []).filter((x) => !x.mio).map((x) => x.id); // abierto desde un filtro de Pendientes
    if (!ids.length) return;
    msgStatus('Un momento…');
    try {
      await call('mover', { ids, destino });
      st.items = st.items.filter((x) => x.conv !== conv);
      st.hcache.delete(conv); full.delete(conv);
      toast(txt);
      closeMsg(true);
      paintListSoft();
      if (!isPF()) { const nx = threads()[Math.min(i, threads().length - 1)]; if (!mqNarrow.matches && nx) openThread(nx.conv); }
      refreshFolders();
    } catch (err) { msgStatus(err.message, true); }
  }
  // adjuntos: se traen una vez y se guardan mientras dure la sesión (ver y luego descargar no lo pide dos veces)
  const attCache = new Map();
  async function getAtt(mid, aid) {
    const k = mid + '|' + aid;
    if (attCache.has(k)) return attCache.get(k);
    const p = call('adjunto', { id: mid, aid }).then((r) => {
      const bin = atob(r.b64), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return { nombre: r.nombre || 'adjunto', tipo: r.tipo || 'application/octet-stream', bytes: arr };
    });
    attCache.set(k, p); p.catch(() => attCache.delete(k));
    if (attCache.size > 12) attCache.delete(attCache.keys().next().value);
    return p;
  }
  function saveFile(f) {
    const url = URL.createObjectURL(new Blob([f.bytes], { type: f.tipo }));
    const a = document.createElement('a'); a.href = url; a.download = f.nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function download(mid, aid, btn) {
    btn.disabled = true; msgStatus('Descargando el adjunto…');
    try { saveFile(await getAtt(mid, aid)); msgStatus(''); } catch (err) { msgStatus(err.message, true); }
    btn.disabled = false;
  }

  /* ---------- ver un adjunto sin descargarlo (25/11): PDF, imágenes, Excel, Word y texto ---------- */
  let viewer = null;
  function closeViewer() { if (!viewer) return; viewer.urls.forEach((u) => URL.revokeObjectURL(u)); viewer.el.remove(); viewer = null; document.body.classList.remove('bz-noscroll'); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && viewer) { e.stopPropagation(); closeViewer(); } }, true);
  const loadScript = (src) => new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('No se pudo cargar el visor')); document.head.appendChild(sc); });
  const ext = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  async function preview(mid, aid, btn) {
    closeViewer();
    const nombre = btn.querySelector('b')?.textContent || 'Adjunto';
    const el = document.createElement('div');
    el.className = 'bz-viewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Vista previa de ' + nombre);
    el.innerHTML = `<div class="bz-vbox"><div class="bz-vhead"><b>${esc(nombre)}</b><button type="button" class="bz-btn" data-vdl disabled>${svg('down', 15)}<span>Descargar</span></button><button type="button" class="bz-ibtn" data-vx aria-label="Cerrar (Esc)" title="Cerrar (Esc)">✕</button></div><div class="bz-vbody"><p class="bz-loading">Abriendo el archivo…</p></div></div>`;
    document.body.appendChild(el); document.body.classList.add('bz-noscroll');
    viewer = { el, urls: [] };
    const me = viewer;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-vx]')) closeViewer(); });
    el.querySelector('[data-vx]').focus();
    const body = el.querySelector('.bz-vbody');
    let f;
    try { f = await getAtt(mid, aid); } catch (err) { if (viewer === me) body.innerHTML = `<p class="bz-empty err">${esc(err.message)}</p>`; return; }
    if (viewer !== me) return;
    const dlb = el.querySelector('[data-vdl]'); dlb.disabled = false; dlb.addEventListener('click', () => saveFile(f));
    const x = ext(f.nombre), t = f.tipo.toLowerCase();
    const blobUrl = (type) => { const u = URL.createObjectURL(new Blob([f.bytes], { type: type || f.tipo })); me.urls.push(u); return u; };
    try {
      if (t === 'application/pdf' || x === 'pdf') {
        if (navigator.pdfViewerEnabled && !mqNarrow.matches) { body.innerHTML = `<iframe class="bz-vpdf" title="${esc(f.nombre)}" src="${blobUrl('application/pdf')}#view=FitH"></iframe>`; return; }
        // móvil: se pinta página a página con pdf.js
        const pdfjs = await import(new URL('vendor/pdfjs/pdf.min.mjs', location.href).href);
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
        const doc = await pdfjs.getDocument({ data: f.bytes.slice(), isEvalSupported: false }).promise;
        if (viewer !== me) return;
        body.innerHTML = `<div class="bz-vpages"></div>`;
        const wrap = body.firstChild, w = Math.min(body.clientWidth - 16, 1000);
        for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
          const page = await doc.getPage(i);
          if (viewer !== me) return;
          const v0 = page.getViewport({ scale: 1 }), scale = w / v0.width, dpr = Math.min(2, window.devicePixelRatio || 1);
          const vp = page.getViewport({ scale: scale * dpr });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = Math.round(vp.width / dpr) + 'px';
          wrap.appendChild(c);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        }
        if (doc.numPages > 60) wrap.insertAdjacentHTML('beforeend', '<p class="bz-hint">Se ven las 60 primeras páginas. Descárgalo para verlo entero.</p>');
        return;
      }
      if (/^image\//.test(t) || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(x)) { body.innerHTML = `<img class="bz-vimg" alt="${esc(f.nombre)}" src="${blobUrl(x === 'svg' ? 'image/svg+xml' : '')}">`; return; }
      if (/^(xlsx|xlsm|xls|csv|ods)$/.test(x) || /spreadsheet|ms-excel/.test(t)) {
        if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
        const XLSX = window.XLSX;
        const wb = XLSX.read(f.bytes, { type: 'array' });
        if (viewer !== me) return;
        const tabs = wb.SheetNames.slice(0, 20);
        body.innerHTML = `${tabs.length > 1 ? `<div class="bz-vtabs">${tabs.map((n, i) => `<button type="button" class="bz-chip" data-sh="${i}" aria-pressed="${i === 0}">${esc(n)}</button>`).join('')}</div>` : ''}<div class="bz-vsheet"></div>`;
        const show = (i) => { const html = XLSX.utils.sheet_to_html(wb.Sheets[tabs[i]], { editable: false }).replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g, ''); body.querySelector('.bz-vsheet').innerHTML = frameHtml(`<style>table{border-collapse:collapse;font-size:12.5px}td,th{border:1px solid #d5dbe3;padding:3px 6px;white-space:nowrap}tr:first-child td{background:#f1f4f7;font-weight:700}</style>${html}`); fitFrames(body); body.querySelectorAll('[data-sh]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sh === i))); };
        body.querySelector('.bz-vtabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sh]'); if (b) show(+b.dataset.sh); });
        show(0); return;
      }
      if (x === 'docx' || /wordprocessingml/.test(t)) {
        if (!window.mammoth) await loadScript('vendor/mammoth.browser.min.js');
        const r = await window.mammoth.convertToHtml({ arrayBuffer: f.bytes.buffer.slice(0) });
        if (viewer !== me) return;
        body.innerHTML = `<div class="bz-vdoc">${frameHtml(`<style>body{max-width:780px;margin:0 auto;padding:24px;font-size:14.5px;line-height:1.55}table{border-collapse:collapse}td,th{border:1px solid #d5dbe3;padding:4px 6px}</style>${r.value}`)}</div>`;
        fitFrames(body); return;
      }
      if (/^text\//.test(t) || /^(txt|log|json|xml|md|ics|vcf)$/.test(x)) { body.innerHTML = `<pre class="bz-vtext">${esc(new TextDecoder().decode(f.bytes).slice(0, 300000))}</pre>`; return; }
      body.innerHTML = `<div class="bz-empty">Este tipo de archivo (${esc(x ? '.' + x : f.tipo)}) no se puede ver aquí. <button type="button" class="bz-link" data-vdl2>Descárgalo</button> para abrirlo.</div>`;
      body.querySelector('[data-vdl2]').addEventListener('click', () => saveFile(f));
    } catch (err) {
      if (viewer !== me) return;
      body.innerHTML = `<div class="bz-empty err">No se pudo mostrar: ${esc(err.message)}. <button type="button" class="bz-link" data-vdl2>Descargar</button></div>`;
      body.querySelector('[data-vdl2]').addEventListener('click', () => saveFile(f));
    }
  }

  // Desde Inicio, Tareas o Agenda: abrir un correo de Pendientes aquí mismo (si tiene conversación de Outlook)
  window.__sqBuzonOpenMail = (m, auto) => {
    if (!m || !m.conv || m.categoria === 'Reuniones') { if (m && m.categoria !== 'Reuniones') setModo('pend'); return false; }
    if (st.modo !== 'bandeja') setModo('bandeja');
    if (!st.carpetas.length && !st.cargando) start();
    openThread(m.conv, { pid: m.id, sugerida: auto, auto });
    return true;
  };

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
      const r = await call('hilo', { conv, marcar: false, ligero: true });
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


  /* ---------- programar el envío (24/11): para no mandar correos fuera de horas ---------- */
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fueraDeHora = (d = new Date()) => d.getDay() === 0 || d.getDay() === 6 || d.getHours() < 8 || d.getHours() >= 20;
  const at = (base, addDays, h, mi = 0) => { const d = new Date(base); d.setDate(d.getDate() + addDays); d.setHours(h, mi, 0, 0); return d; };
  function nextWorkday(h) { const now = new Date(); for (let i = 0; i < 8; i++) { const d = at(now, i, h); if (d > now && d.getDay() !== 0 && d.getDay() !== 6) return d; } return at(now, 1, h); }
  const progLabel = (d) => {
    const now = new Date(), man = at(now, 1, 0);
    const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `hoy a las ${hm}`;
    if (d.toDateString() === man.toDateString()) return `mañana a las ${hm}`;
    return `el ${DIAS[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]} a las ${hm}`;
  };
  function schedulePanel(onPick) {
    const box = document.createElement('div');
    box.className = 'bz-prog';
    const opts = [];
    const n8 = nextWorkday(8), n9 = nextWorkday(9);
    opts.push(n8, n9);
    const lunes = (() => { const now = new Date(); const add = ((8 - now.getDay()) % 7) || 7; return at(now, add, 8); })();
    if (!opts.some((x) => x.toDateString() === lunes.toDateString())) opts.push(lunes);
    const minLocal = (() => { const d = new Date(Date.now() + 5 * 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })();
    box.innerHTML = `<div class="bz-prog-t">Programar el envío</div>
      <div class="bz-prog-o">${opts.map((d, i) => `<button type="button" class="bz-chip" data-i="${i}">${esc(progLabel(d).replace(/^./, (c) => c.toUpperCase()))}</button>`).join('')}</div>
      <label class="bz-prog-c"><span>Otro día y hora</span><input type="datetime-local" min="${minLocal}" step="300"></label>
      <div class="bz-prog-a"><button type="button" class="bz-btn send" data-ok disabled>Programar</button><button type="button" class="bz-link" data-x>Cancelar</button></div>`;
    let chosen = null;
    const okBtn = box.querySelector('[data-ok]'), inp = box.querySelector('input');
    const mark = () => { box.querySelectorAll('.bz-chip').forEach((c) => c.setAttribute('aria-pressed', String(chosen && +c.dataset.i === opts.indexOf(chosen)))); okBtn.disabled = !chosen; okBtn.textContent = chosen ? 'Programar para ' + progLabel(chosen) : 'Programar'; };
    box.querySelectorAll('.bz-chip').forEach((c) => c.addEventListener('click', () => { chosen = opts[+c.dataset.i]; inp.value = ''; mark(); }));
    inp.addEventListener('input', () => { const d = inp.value ? new Date(inp.value) : null; chosen = d && d > new Date() ? d : null; if (chosen) opts.indexOf(chosen); mark(); });
    okBtn.addEventListener('click', () => { if (chosen) onPick(chosen); });
    box.querySelector('[data-x]').addEventListener('click', () => { box.remove(); onPick(null); });
    mark();
    return box;
  }
  window.__sqSchedule = { panel: schedulePanel, label: progLabel, offHours: fueraDeHora, next: nextWorkday };


  /* ---------- fechas libres de tu agenda en la respuesta sugerida (24/11) ----------
     Si la propuesta trae huecos como «[fecha 1 de enero]», se rellenan con días libres de tu calendario de Outlook. */
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const PH_RE = /\[(?:fecha|d[ií]a|hueco|opci[oó]n)[^\]]*\]/gi;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const toM = (s) => { const t = String(s || '').slice(11, 16); return t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null; };
  function franja(txt) {
    const r = /\b(?:de|entre)\s+(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\s*(?:a|y|-|–)\s*(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:h\b|horas)?/i.exec(txt || '');
    if (!r) return null;
    const a = +r[1] * 60 + +(r[2] || 0), z = +r[3] * 60 + +(r[4] || 0);
    return a >= 7 * 60 && z <= 21 * 60 && z > a ? [a, z] : null;
  }
  async function diasLibres(m, phText) {
    const src = phText + ' ' + (m.peticion || '') + ' ' + (m.resumen || '');
    const now = new Date(), man = at(now, 1, 0);
    const mes = MESES.findIndex((x) => new RegExp('\\b' + x + '\\b', 'i').test(src));
    let desde = man, hasta = at(now, 28, 0);
    if (mes >= 0) { let y = now.getFullYear(); if (mes < now.getMonth()) y++; desde = new Date(y, mes, 1); hasta = new Date(y, mes + 1, 0); if (desde < man) desde = man; }
    const win = franja((m.resumen || '') + ' ' + (m.peticion || '') + ' ' + String(m.cuerpo || '').slice(0, 3000));
    const r = await call('agenda', { desde: ymd(desde), hasta: ymd(hasta) });
    const byDay = {};
    for (const e of r.eventos || []) {
      const d0 = String(e.inicio || '').slice(0, 10), d1 = String(e.fin || '').slice(0, 10);
      for (let d = new Date(d0 + 'T12:00:00'); ymd(d) <= d1 && ymd(d) <= ymd(hasta); d.setDate(d.getDate() + 1)) {
        const k = ymd(d);
        const a = e.diaEntero || k !== d0 ? 0 : toM(e.inicio), z = e.diaEntero || k !== d1 ? 1440 : toM(e.fin);
        (byDay[k] = byDay[k] || []).push([a, z]);
        if (e.diaEntero && k === d1 && d1 !== d0) break;
      }
    }
    const cands = [];
    for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6 || festivo(d)) continue;
      const k = ymd(d), busy = byDay[k] || [];
      if (win && busy.some(([a, z]) => a < win[1] && win[0] < z)) continue;
      const ocupado = busy.reduce((s, [a, z]) => s + Math.max(0, Math.min(z, 19 * 60) - Math.max(a, 9 * 60)), 0);
      if (ocupado >= 9 * 60) continue;
      cands.push({ d: new Date(d), k, ocupado });
    }
    // primero los días más libres, y repartidos (no seguidos)
    const orden = cands.slice().sort((x, y) => x.ocupado - y.ocupado || x.d - y.d);
    const pick = [];
    for (const c of orden) { if (pick.every((p) => Math.abs(p.d - c.d) > 1.5 * 864e5)) pick.push(c); if (pick.length >= 6) break; }
    for (const c of orden) { if (pick.length >= 6) break; if (!pick.includes(c)) pick.push(c); }
    return { win, mes, todos: cands, mejores: pick };
  }
  // festivos nacionales (fijos + Jueves y Viernes Santo)
  function festivo(d) {
    const md = (d.getMonth() + 1) + '-' + d.getDate();
    if (['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'].includes(md)) return true;
    const y = d.getFullYear(), a = y % 19, b2 = Math.floor(y / 100), c = y % 100, dd = Math.floor(b2 / 4), e = b2 % 4, f = Math.floor((b2 + 8) / 25), g2 = Math.floor((b2 - f + 1) / 3), h = (19 * a + b2 - dd - g2 + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m2 = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m2 + 114) / 31), dia = ((h + l - 7 * m2 + 114) % 31) + 1;
    const pascua = new Date(y, mes - 1, dia);
    return [-3, -2].some((o) => { const x = new Date(pascua); x.setDate(x.getDate() + o); return x.toDateString() === d.toDateString(); });
  }
  const diaTxt = (d) => `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  window.__sqFillDates = async (m, ta, place, onChange) => {
    const orig = ta.value;
    const phs = orig.match(PH_RE);
    if (!phs || !phs.length) return;
    const note = document.createElement('div');
    note.className = 'bz-datefill';
    note.textContent = 'Buscando días libres en tu agenda de Outlook…';
    place(note);
    let info;
    try { info = await diasLibres(m, phs.join(' ')); }
    catch (e) { note.textContent = 'No pude mirar tu agenda: ' + e.message + '. Completa las fechas a mano.'; note.classList.add('bad'); return; }
    if (!info.mejores.length) { note.textContent = 'No encuentro días libres en tu agenda para esas fechas. Complétalas a mano.'; note.classList.add('bad'); return; }
    let elegidos = info.mejores.slice(0, phs.length).sort((a, b) => a.d - b.d);
    let last = null;
    const fill = (lista) => { let i = 0; return orig.replace(PH_RE, (x) => (lista[i] ? diaTxt(lista[i++].d) : x)); };
    const apply = () => {
      if (last != null && ta.value !== last) { note.querySelector('.st').textContent = 'Has cambiado el texto: cambia las fechas a mano.'; return; }
      ta.value = last = fill(elegidos); onChange?.();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      paint();
    };
    const franjaTxt = info.win ? ` de ${hhmm2(info.win[0])} a ${hhmm2(info.win[1])}` : '';
    function paint() {
      note.innerHTML = `<div><b>📅 Fechas de tu agenda de Outlook</b> · ${esc(elegidos.map((c) => diaTxt(c.d)).join(', '))}${info.win ? ` (libre${elegidos.length > 1 ? 's' : ''}${esc(franjaTxt)})` : ' (días con la agenda más libre)'} <button type="button" class="bz-link" data-chg>Cambiar</button></div><div class="st"></div><div class="bz-dchips" hidden></div>`;
      note.querySelector('[data-chg]').addEventListener('click', () => {
        const box = note.querySelector('.bz-dchips');
        if (!box.hidden) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = `<p>Elige ${phs.length} día${phs.length > 1 ? 's' : ''}:</p>` + info.todos.slice(0, 24).map((c, i) => `<button type="button" class="bz-chip" data-i="${i}" aria-pressed="${elegidos.some((e) => e.k === c.k)}">${esc(DIAS[c.d.getDay()].slice(0, 3) + ' ' + c.d.getDate())}${c.ocupado ? '' : ' · libre'}</button>`).join('') + '<button type="button" class="bz-btn send" data-ap>Poner estas fechas</button>';
        box.querySelectorAll('[data-i]').forEach((c) => c.addEventListener('click', () => {
          const cd = info.todos[+c.dataset.i];
          const on = c.getAttribute('aria-pressed') === 'true';
          if (!on && box.querySelectorAll('[aria-pressed="true"]').length >= phs.length) return;
          c.setAttribute('aria-pressed', String(!on));
        }));
        box.querySelector('[data-ap]').addEventListener('click', () => {
          const sel = [...box.querySelectorAll('[data-i][aria-pressed="true"]')].map((c) => info.todos[+c.dataset.i]).sort((a, b) => a.d - b.d);
          if (!sel.length) return;
          elegidos = sel; apply();
        });
      });
    }
    apply();
  };
  const hhmm2 = (mm) => Math.floor(mm / 60) + ':' + String(mm % 60).padStart(2, '0');


  /* ---------- adjuntos: botón, arrastrar o pegar; las imágenes pegadas van dentro del texto (25/11) ---------- */
  function attachBox(drop, zone, textarea, say) {
    const items = []; // { file, inline, cid, url }
    const fin = drop.querySelector('[data-files]'), flist = drop.querySelector('.bz-files');
    const total = () => items.reduce((a, x) => a + x.file.size, 0);
    const paint = () => {
      flist.innerHTML = items.map((x, i) => `<li class="${x.inline ? 'inl' : ''}">${x.url ? `<img src="${x.url}" alt="">` : svg('clip', 13)}<span><b>${esc(x.file.name)}</b><small>${esc(tam(x.file.size))}${x.inline ? ' · en el texto' : ''}</small></span><button type="button" class="bz-ibtn" data-rm="${i}" aria-label="Quitar ${esc(x.file.name)}">✕</button></li>`).join('');
      drop.classList.toggle('has', items.length > 0);
    };
    const add = (list, inline) => {
      for (const x of list) {
        if (!x || !x.size) continue;
        if (total() + x.size > 25 * 1024 * 1024) { say(`«${x.name || 'imagen'}» no cabe: el correo pasaría de 25 MB.`, true); continue; }
        const img = /^image\//.test(x.type || '');
        const name = x.name && !/^image\.(png|jpe?g|gif)$/i.test(x.name) ? x.name : `imagen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${items.length + 1}.${(x.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const file = new File([x], name, { type: x.type || 'application/octet-stream' });
        items.push({ file, inline: !!(inline && img), cid: 'img' + Date.now().toString(36) + items.length + '@synqalia', url: img ? URL.createObjectURL(file) : '' });
      }
      paint();
    };
    drop.querySelector('[data-pick]').addEventListener('click', () => fin.click());
    fin.addEventListener('change', () => { add([...fin.files], false); fin.value = ''; });
    flist.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { const [x] = items.splice(+r.dataset.rm, 1); if (x?.url) URL.revokeObjectURL(x.url); paint(); } });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('bz-dragging'); } }));
    ['dragleave', 'dragend'].forEach((ev) => zone.addEventListener(ev, (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('bz-dragging'); }));
    zone.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); zone.classList.remove('bz-dragging'); add([...e.dataTransfer.files], false); });
    // pegar (Ctrl+V o «Pegar» del móvil): imagen → dentro del texto; otros archivos → adjuntos
    textarea.addEventListener('paste', (e) => {
      const cd = e.clipboardData; if (!cd) return;
      let fl = [...(cd.files || [])];
      if (!fl.length) fl = [...(cd.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      if (!fl.length) return;
      e.preventDefault(); add(fl, true);
      if (fl.some((x) => /^image\//.test(x.type))) say('Imagen pegada: irá dentro del correo, debajo del texto.');
    });
    paint();
    return {
      count: () => items.length,
      inlineCids: () => items.filter((x) => x.inline).map((x) => x.cid),
      async upload(draft) {
        for (let i = 0; i < items.length; i++) {
          const { file: x, inline, cid } = items[i];
          say(`Subiendo ${inline ? 'imagen' : 'adjunto'} ${i + 1} de ${items.length}: ${x.name}…`);
          const extra = inline ? { inline: true, cid } : {};
          if (x.size <= 3 * 1024 * 1024) await call('adjuntar', { draft, nombre: x.name, tipo: x.type, size: x.size, b64: await b64Of(x), ...extra });
          else {
            const { url } = await call('adjuntar', { draft, nombre: x.name, tipo: x.type, size: x.size, ...extra });
            const CH = 9 * 327680;
            for (let s0 = 0; s0 < x.size; s0 += CH) {
              say(`Subiendo ${x.name}: ${Math.round((s0 / x.size) * 100)} %…`);
              await call('trozo', { url, start: s0, total: x.size, b64: await b64Of(x.slice(s0, s0 + CH)) });
            }
          }
        }
      },
      clear() { items.splice(0).forEach((x) => x.url && URL.revokeObjectURL(x.url)); paint(); },
    };
  }
  const ATTACH_HTML = () => `<div class="bz-drop" data-drop>
        <input type="file" multiple hidden data-files>
        <button type="button" class="bz-btn" data-pick>${svg('clip', 15)}<span>Adjuntar</span></button>
        <span class="bz-drophint">o arrastra aquí archivos; las imágenes también se pueden pegar en el texto</span>
        <ul class="bz-files" aria-label="Adjuntos"></ul>
      </div>`;
  // Pendientes: mismo cuadro de adjuntos debajo de su propuesta de correo
  window.__sqAttach = (textarea, say) => {
    const holder = document.createElement('div');
    holder.innerHTML = ATTACH_HTML();
    const drop = holder.firstElementChild;
    const zone = textarea.parentElement || drop;
    const api = attachBox(drop, zone, textarea, say);
    return { node: drop, ...api };
  };

  /* ---------- redactar: responder, a todos, reenviar, nuevo ---------- */
  const TIT = { responder: 'Responder', todos: 'Responder a todos', reenviar: 'Reenviar', nuevo: 'Correo nuevo' };
  function openCompose(o) {
    // se responde al último mensaje que te llegó (si el último es tuyo, al anterior); se reenvía el último del hilo
    const ext = o.ext || null; // redactar dentro de otra pantalla (Pendientes), sin moverse de ella
    const hilo = ext ? ext.hilo : st.hilo;
    const say = ext ? ext.status : msgStatus;
    o.say = say;
    const vis = !ext && st.selMid ? (hilo || []).find((x) => x.id === st.selMid) : null; // el mensaje que tienes abierto del hilo
    const m = o.tipo === 'nuevo' ? null : vis && (o.tipo === 'reenviar' || !vis.mio) ? vis : o.tipo === 'reenviar' ? hilo?.[0] : lastIn(hilo);
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
      <textarea name="texto" rows="${o.tipo === 'nuevo' ? 12 : 8}" placeholder="${o.tipo === 'reenviar' ? 'Añade un comentario (opcional)' : o.tipo === 'nuevo' ? 'Escribe o dicta el correo y pulsa «Perfeccionar»' : 'Escribe o dicta tu respuesta (aunque sea a lo bruto) y pulsa «Perfeccionar»'}">${esc(o.texto || '')}</textarea></label>
      <div class="bz-aibar"><span class="bz-aimic"></span><button type="button" class="bz-btn bz-aibtn" data-ai>✨ <span>Perfeccionar</span></button><button type="button" class="bz-link" data-undo hidden>Deshacer</button><span class="bz-aist" aria-live="polite"></span></div>
      ${ATTACH_HTML()}
      <p class="bz-note">Tu firma de Outlook se añade sola al enviar${o.tipo !== 'nuevo' ? '; debajo va el correo original' : ''}. Hasta 25 MB en total.</p>
      <div class="bz-cacts">
        <button type="submit" class="bz-btn send">Enviar</button>
        <button type="button" class="bz-btn" data-prog title="Elegir cuándo se envía">⏱ Programar</button>
        <button type="button" class="bz-btn" data-draft>A Borradores</button>
        <button type="button" class="bz-link" data-cl>Cancelar</button>
      </div>
      <div class="bz-prog-slot"></div>
      ${fueraDeHora() ? `<p class="bz-offh">Es fuera de horario: <button type="button" class="bz-link" data-prog-quick>programarlo para ${esc(progLabel(nextWorkday(8)))}</button></p>` : ''}
    </form>`;
    const f = slot.querySelector('form');
    const chipFields = [...f.querySelectorAll('[data-chips]')].map((box) => chipField(box, ini[box.dataset.chips] || [], say));
    o.commitChips = () => chipFields.every((c) => c.commit());
    o.att = attachBox(f.querySelector('[data-drop]'), f, f.querySelector('textarea'), say);
    // dictar y perfeccionar con IA (25/11): escribes o dictas a lo bruto y Synqalia lo deja listo; luego se envía tal cual
    {
      const AI = window.__sqAI, ta = f.querySelector('textarea'), bar = f.querySelector('.bz-aibar'), aiSt = bar.querySelector('.bz-aist'), aiBtn = bar.querySelector('[data-ai]'), undo = bar.querySelector('[data-undo]');
      if (!AI) bar.hidden = true;
      else {
        try { const mic = AI.mic(ta, () => { ta.dispatchEvent(new Event('input', { bubbles: true })); }); mic.classList.add('bz-btn'); bar.querySelector('.bz-aimic').appendChild(mic); } catch { /* sin micro */ }
        const paint = () => { aiBtn.querySelector('span').textContent = ta.value.trim() ? 'Perfeccionar' : (o.tipo === 'nuevo' ? 'Redactar' : 'Proponer respuesta'); };
        ta.addEventListener('input', paint); paint();
        let antes = null;
        aiBtn.addEventListener('click', async () => {
          const borrador = ta.value.trim();
          if (o.tipo === 'nuevo' && !borrador) { aiSt.textContent = 'Dicta o escribe primero qué quieres decir.'; ta.focus(); return; }
          antes = ta.value; aiBtn.disabled = true; undo.hidden = true; aiSt.textContent = 'Synqalia está redactando…';
          const fd = new FormData(f);
          try {
            const txt = await AI.redactar({ tipo: o.tipo, de: m ? (m.de?.nombre || m.de?.mail || '') : '', asunto: m ? m.asunto : String(fd.get('asunto') || ''), texto: m ? (m.citado || m.cuerpo || m.prev || '') : '', para: String(fd.get('para') || ''), borrador }, (t) => { ta.value = t; });
            if (txt) ta.value = txt;
            aiSt.textContent = /\[[^\]]+\]/.test(ta.value) ? 'Listo. Completa lo que está entre [corchetes] y envía.' : 'Listo. Cámbialo si quieres y envía.';
            undo.hidden = false; paint(); ta.focus();
          } catch (err) { ta.value = antes; aiSt.textContent = 'No se pudo: ' + err.message; }
          aiBtn.disabled = false;
        });
        undo.addEventListener('click', () => { if (antes != null) { ta.value = antes; antes = null; undo.hidden = true; aiSt.textContent = ''; paint(); } });
      }
    }
    f.addEventListener('submit', (e) => { e.preventDefault(); o.programar = null; send(f, o, true); });
    const progSlot = f.querySelector('.bz-prog-slot');
    f.querySelector('[data-prog]').addEventListener('click', () => {
      if (progSlot.firstChild) { progSlot.innerHTML = ''; return; }
      progSlot.appendChild(schedulePanel((d) => { progSlot.innerHTML = ''; if (d) { o.programar = d; send(f, o, true); } }));
    });
    f.querySelector('[data-prog-quick]')?.addEventListener('click', () => { o.programar = nextWorkday(8); send(f, o, true); });
    f.querySelector('[data-draft]').addEventListener('click', () => send(f, o, false));
    (ext ? slot : pane).querySelectorAll('[data-cl]').forEach((x) => x.addEventListener('click', () => {
      if (ext) { slot.innerHTML = ''; ext.onCancel?.(); return; }
      st.compose = null;
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      slot.innerHTML = '';
    }));
    if (!o.sugerida) { const first = f.querySelector(o.tipo === 'nuevo' && !f.querySelector('select[name="cuenta"]').value ? 'select[name="cuenta"]' : o.tipo === 'nuevo' || o.tipo === 'reenviar' ? '[data-chips="para"] input' : 'textarea'); first?.focus({ preventScroll: true }); if (!ext) scrollPane(slot); else slot.scrollIntoView({ block: 'nearest' }); }
  }
  async function send(f, o, enviar) {
    const say = o.say || msgStatus;
    if (o.commitChips && !o.commitChips()) return;
    const fd = new FormData(f);
    if (o.tipo === 'nuevo' && !fd.get('cuenta')) { say('Elige desde qué cuenta lo envías («De»).', true); f.querySelector('select[name="cuenta"]')?.focus(); return; }
    const prog = o.programar ? o.programar.toISOString() : null;
    const body = { programar: prog, cuenta: fd.get('cuenta') || 'outlook', destinatarios: o.tipo === 'responder' || o.tipo === 'todos', tipo: o.tipo, id: o.target, texto: String(fd.get('texto') || ''), para: fd.get('para') || '', cc: fd.get('cc') || '', asunto: fd.get('asunto') || '', enviar };
    if (enviar && !/[^@\s]+@[^@\s]+\.[^@\s]+/.test(body.para)) { say('Falta al menos un destinatario en «Para».', true); f.querySelector('[data-chips="para"] input')?.focus(); return; }
    const badCc = String(body.cc || '').split(/[;,\s]+/).filter(Boolean).find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (badCc) { say(`Revisa la copia (CC): «${badCc}» no es una dirección de correo.`, true); f.querySelector('[data-chips="cc"] input')?.focus(); return; }
    if (enviar && o.tipo !== 'reenviar' && !body.texto.trim()) { say('El correo está vacío.', true); f.querySelector('textarea')?.focus(); return; }
    f.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    say(enviar ? (prog ? 'Programando…' : 'Enviando…') : 'Guardando en Borradores…');
    try {
      if (o.att && o.att.count()) {
        // 1) borrador preparado, 2) se suben los adjuntos (las imágenes pegadas van dentro del texto), 3) se envía
        const { draft } = await call('redactar', { ...body, inline: o.att.inlineCids(), preparar: true });
        await o.att.upload(draft);
        if (enviar) { say(prog ? 'Programando…' : 'Enviando…'); await call('enviarBorrador', { draft, tipo: o.tipo, programar: prog }); }
      } else await call('redactar', body);
      if (body.cc && typeof window.__sqRememberCc === 'function') window.__sqRememberCc(body.cc);
      const okTxt = enviar ? (prog ? `Programado: sale ${progLabel(o.programar)} ✓` : 'Enviado ✓') : 'Guardado en Borradores de Outlook';
      toast(okTxt);
      if (o.ext) { o.ext.slot.innerHTML = ''; o.ext.onDone?.(enviar, prog ? okTxt : null); return; }
      st.compose = null;
      if (o.tipo === 'nuevo') { pane.innerHTML = ''; root.classList.remove('bz-reading'); if (mqNarrow.matches) { try { if (history.state?.bz) history.back(); } catch {} } return; }
      f.parentElement.innerHTML = '';
      say(okTxt);
      if (enviar) {
        // contestado desde aquí: si estaba en Pendientes, queda gestionado (como en la vista de siempre)
        const c = st.sel, pm = pendOf(c);
        if (pm && isPend(pm) && o.tipo !== 'nuevo') { st.adv = c; P().gestionado(pm.id); if (PEND_F.includes(st.filtro)) { afterHandled('Enviado y gestionado ✓'); return; } }
        st.hcache.delete(c); full.delete(c);
        if (c) setTimeout(() => { if (st.sel === c && !st.compose) openThread(c); }, 2500);
      }
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
    st.cargando = true;
    loadPins().then(repaint).catch(() => null);
    // carpetas guardadas al momento; las de verdad llegan a la vez que la lista (antes se esperaba una y luego la otra)
    const cf = readLocal(`sq-bz:${uid}:carpetas`);
    if (cf?.carpetas?.length) { st.carpetas = cf.carpetas; st.outlook = cf.cuenta || ''; paintFolders(); }
    const pc = call('carpetas').then((c) => { st.carpetas = c.carpetas || []; st.outlook = c.cuenta || ''; paintFolders(); saveLocal(`sq-bz:${uid}:carpetas`, { carpetas: st.carpetas, cuenta: st.outlook }); })
      .catch((e) => {
        if (!/no está conectado/i.test(e.message)) return;
        reqN++; st.cargando = false; st.items = [];
        st.err = 'Conecta Microsoft 365 para ver aquí todo tu correo.'; paintList();
      });
    reload();
    await pc;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuiet(); });
  setInterval(refreshQuiet, 90000);
  // de móvil a PC (o al revés) sin perder lo abierto
  mqNarrow.addEventListener('change', () => { if (st.hilo?.length) paintThread(); });
  setModo('bandeja');
})();
