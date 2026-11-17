/* synqalia · Notas — libretas personales tipo OneNote.
   Libretas → secciones → notas. Cada nota puede tener texto (tecleado, dictado o pegado, que la IA ordena)
   y páginas escritas a mano (lápiz o dedo) que la IA puede transcribir.
   Datos privados en personal_docs: col «lb_libretas» y «lb_notas». */
(() => {
  const root = document.getElementById('view-notas');
  if (!root) return;
  const $ = (s, r = root) => r.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
    return e;
  };
  const ic = (d) => '<svg class="lb-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const I = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    paste: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3.5h6v1M9 10h6M9 14h6M9 18h3"/>',
    key: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    pen: '<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 6.5l3 3"/>',
    marker: '<path d="M9 15l-4 4h5l2-2M9 15l7.5-9.5a2 2 0 0 1 3 3L12 17z"/>',
    eraser: '<path d="M8 20h12M5.5 15.5l9-9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L11 18H8z"/>',
    undo: '<path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/>',
    redo: '<path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.7 0-4.2-1.4-5.6-3.6L4 13.5a1.5 1.5 0 0 1 2.4-1.7L8 13.5"/>',
    sparkle: '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    book: '<path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h11"/>',
    page: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  };
  const COLORS = ['#2340d0', '#7a3fd1', '#c4307a', '#d9772b', '#1f8a5b', '#0f8fa6', '#5d6680'];
  const DEFAULT_BOOKS = [
    { id: 'lb-pensamientos', nombre: 'Pensamientos', color: '#7a3fd1', secciones: ['General', 'Personal'], orden: 1 },
    { id: 'lb-trabajo', nombre: 'Trabajo', color: '#2340d0', secciones: ['General', 'Reuniones', 'Equipo'], orden: 2 },
    { id: 'lb-ideas', nombre: 'Ideas y proyectos', color: '#d9772b', secciones: ['General', 'synqalia', 'Zottelo'], orden: 3 },
  ];
  const fmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtD = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nowIso = () => new Date().toISOString();

  const S = { books: new Map(), notes: new Map(), book: 'all', sec: '', q: '', note: null, readMode: true, db: null, ai: null, ready: false };

  /* ---------- datos ---------- */
  const booksSorted = () => [...S.books.values()].sort((a, b) => (a.orden || 99) - (b.orden || 99) || a.nombre.localeCompare(b.nombre));
  const bookOf = (n) => S.books.get(n && n.libreta) || null;
  const colorOf = (n) => (bookOf(n) || {}).color || '#5d6680';
  async function saveNote(n) { n.editada = nowIso(); S.notes.set(n.id, n); try { await S.db.collection('lb_notas').doc(n.id).set(n); status('Guardado'); } catch (e) { status('No se pudo guardar: ' + e.message, true); } }
  async function saveBook(b) { S.books.set(b.id, b); await S.db.collection('lb_libretas').doc(b.id).set(b); }
  const saveLater = (() => { const t = {}; return (n, ms = 900) => { status('Guardando…'); clearTimeout(t[n.id]); t[n.id] = setTimeout(() => saveNote(n), ms); }; })();

  function status(msg, bad) { const s = $('#lb-status'); if (s) { s.textContent = msg; s.style.color = bad ? 'var(--bad)' : ''; } }
  function toast(msg, action, fn) {
    document.querySelectorAll('.lb-toast').forEach((t) => t.remove());
    const t = h('div', { class: 'lb-toast', role: 'status' }, h('span', { text: msg }));
    if (action) t.append(h('button', { type: 'button', text: action, onclick: () => { t.remove(); fn(); } }));
    document.body.append(t); setTimeout(() => t.remove(), action ? 7000 : 3200);
  }

  /* ---------- IA ---------- */
  async function aiJson(prompt, images) {
    if (!S.ai) throw new Error('La IA no está disponible ahora');
    let out = await S.ai.json(prompt, images ? { images } : undefined);
    if (typeof out === 'string') { const m = out.match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : { cuerpo: out }; }
    return out || {};
  }
  function booksForPrompt() { return booksSorted().map((b) => `- id "${b.id}": ${b.nombre} (secciones: ${(b.secciones || []).join(', ')})`).join('\n'); }
  async function organize(raw, opts = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = 'Eres el asistente personal de Jaime Marrero (director de salones de Provalliance España; también NEUPAREDIS, MSH, MIG y sus proyectos de software synqalia, Zottelo, etc.). Hoy es ' + today + '.\n' +
      'Jaime ha capturado esta nota (dictada, pegada o tecleada; puede tener errores de dictado, muletillas y estar desordenada). Ordénala SIN inventar nada y sin perder ninguna idea: corrige errores evidentes de dictado, quita repeticiones y muletillas, agrupa por temas y redacta en español claro, en primera persona como si la escribiera él.\n' +
      'Formato del cuerpo (texto plano): títulos de bloque con "## ", viñetas con "- ", cosas por hacer con "[ ] ". Párrafos cortos. Si es un pensamiento o reflexión, respeta su tono y no lo conviertas en lista si no hace falta.\n' +
      (opts.keepBook ? '' : 'Elige la libreta y sección más adecuadas de estas (usa el id exacto; si ninguna encaja usa la primera):\n' + booksForPrompt() + '\n') +
      'Devuelve SOLO JSON: {"titulo": máx. 70 caracteres, "cuerpo": "...", ' + (opts.keepBook ? '' : '"libreta": "id", "seccion": "nombre de sección existente", ') + '"etiquetas": [hasta 4 palabras clave cortas en minúscula], "acciones": [frases cortas de cosas que hacer, si las hay]}\n\nNOTA:\n' + raw;
    return aiJson(prompt);
  }

  /* ---------- dictado propio (independiente del de Reuniones/Catch-ups) ---------- */
  function dictation(onFinal, onPartial, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Este navegador no permite dictar. Usa el micrófono del teclado del móvil.'); return null; }
    if (window.__sqRecording) { toast('Ya hay una grabación en marcha en Reuniones o Catch-ups.'); return null; }
    let want = true, r;
    const start = () => {
      r = new SR(); r.lang = 'es-ES'; r.continuous = true; r.interimResults = true;
      r.onresult = (ev) => { let p = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) onFinal(t.trim()); else p += t; } onPartial(p); };
      r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; toast('Permite el micrófono para dictar.'); } };
      r.onend = () => { if (want) { try { start(); } catch (e) { stop(); } } else { window.__sqRecording = false; onEnd && onEnd(); } };
      try { r.start(); } catch (e) { want = false; onEnd && onEnd(); }
    };
    const stop = () => { want = false; window.__sqRecording = false; try { r && r.stop(); } catch (e) {} onPartial(''); };
    window.__sqRecording = true; start();
    return { stop };
  }
  const joinText = (a, b) => (a && b ? (/[\s\n]$/.test(a) ? a : a + ' ') + b : a || b);

  /* ---------- texto con formato ligero ---------- */
  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = (s) => escH(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>');
  function renderRich(text) {
    const lines = String(text || '').split('\n'); let html = '', ul = false;
    const close = () => { if (ul) { html += '</ul>'; ul = false; } };
    lines.forEach((ln, i) => {
      const t = ln.trimEnd(); let m;
      if ((m = t.match(/^\s*\[( |x|X)\]\s?(.*)$/))) { close(); html += `<label class="ck${m[1] !== ' ' ? ' done' : ''}"><input type="checkbox" data-line="${i}"${m[1] !== ' ' ? ' checked' : ''}><span>${inline(m[2])}</span></label>`; }
      else if ((m = t.match(/^#{3,}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
      else if ((m = t.match(/^#{1,2}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; }
      else if ((m = t.match(/^\s*[-•*]\s+(.*)/))) { if (!ul) { html += '<ul>'; ul = true; } html += `<li>${inline(m[1])}</li>`; }
      else if (!t.trim()) { close(); }
      else { close(); html += `<p>${inline(t)}</p>`; }
    });
    close(); return html || '<p style="color:var(--muted)">Toca para escribir…</p>';
  }
  const plain = (n) => String(n.cuerpo || n.textoMano || '').replace(/^#+\s*|^\s*[-•*]\s+|\[[ xX]\]\s?|\*\*/gm, '').replace(/\s+/g, ' ').trim();

  /* ---------- tinta: dibujo de trazos ---------- */
  const PW = 1000, PH = 1414; // página en unidades lógicas (proporción A4)
  function strokeWidth(s, p) { return s.t === 'm' ? s.w * 4 : s.w * (0.45 + (p / 100) * 0.9); }
  function drawStroke(ctx, s, k) {
    const p = s.p; if (!p || p.length < 3) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = s.c;
    if (s.t === 'm') { ctx.globalAlpha = 0.32; ctx.globalCompositeOperation = 'multiply'; }
    if (p.length === 3) { ctx.beginPath(); ctx.fillStyle = s.c; ctx.arc(p[0] * k, p[1] * k, strokeWidth(s, p[2]) * k / 2, 0, 7); ctx.fill(); ctx.restore(); return; }
    if (s.t === 'm') { ctx.lineWidth = strokeWidth(s, 50) * k; ctx.beginPath(); ctx.moveTo(p[0] * k, p[1] * k); for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * k, p[i + 1] * k); ctx.stroke(); ctx.restore(); return; }
    for (let i = 3; i < p.length; i += 3) {
      const x0 = p[i - 3], y0 = p[i - 2], x1 = p[i], y1 = p[i + 1];
      const xm0 = i >= 6 ? (p[i - 6] + x0) / 2 : x0, ym0 = i >= 6 ? (p[i - 5] + y0) / 2 : y0;
      const xm1 = (x0 + x1) / 2, ym1 = (y0 + y1) / 2;
      ctx.lineWidth = strokeWidth(s, (p[i - 1] + p[i + 2]) / 2) * k;
      ctx.beginPath(); ctx.moveTo(xm0 * k, ym0 * k); ctx.quadraticCurveTo(x0 * k, y0 * k, xm1 * k, ym1 * k);
      if (i + 3 >= p.length) ctx.lineTo(x1 * k, y1 * k);
      ctx.stroke();
    }
    ctx.restore();
  }
  function inkSvg(ink, maxH) {
    const tr = (ink && ink.trazos) || []; if (!tr.length) return '';
    let maxY = 0; tr.forEach((s) => { for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]); });
    const H = Math.min(Math.max(maxY + 60, 300), maxH || 1e9);
    const paths = tr.map((s) => {
      const p = s.p; let d = 'M' + p[0] + ' ' + p[1];
      for (let i = 3; i < p.length; i += 3) d += 'L' + p[i] + ' ' + p[i + 1];
      if (p.length === 3) d += 'l0.1 0';
      let avg = 0, c = 0; for (let i = 2; i < p.length; i += 3) { avg += p[i]; c++; }
      return `<path d="${d}" stroke="${s.c}" stroke-width="${strokeWidth(s, avg / c).toFixed(1)}"${s.t === 'm' ? ' opacity=".32"' : ''}/>`;
    }).join('');
    return `<svg viewBox="0 0 ${PW} ${H}" preserveAspectRatio="xMidYMin meet" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  /* ---------- editor de escritura a mano (pantalla completa) ---------- */
  function openInk(n) {
    const ink = n.tinta ? JSON.parse(JSON.stringify(n.tinta)) : { papel: 'rayas', paginas: 1, trazos: [] };
    document.querySelectorAll('.lb-toast').forEach((t) => t.remove());
    let tool = 'p', color = '#141a2e', width = 3, pan = false, penSeen = false, zoom = innerWidth < 700 ? 1.8 : 1;
    const undo = [], redo = [];
    const wrap = h('div', { class: 'lb-inkx', role: 'dialog', 'aria-label': 'Escribir a mano' });
    const bar = h('div', { class: 'lb-inkbar' });
    const scroller = h('div', { class: 'lb-inkscroll' });
    const paper = h('div', { class: 'lb-paper' });
    const cv = h('canvas'); paper.append(cv); scroller.append(paper);
    const ctx = cv.getContext('2d');
    let k = 1, dpr = 1;
    const btn = (label, svg, on, title) => h('button', { type: 'button', title: title || label, 'aria-label': title || label, html: (svg ? ic(svg) : '') + (label && !svg ? label : ''), onclick: on });
    const done = h('button', { type: 'button', class: 'done', text: 'Hecho', onclick: () => close() });
    const bP = btn('', I.pen, () => setTool('p'), 'Bolígrafo'), bM = btn('', I.marker, () => setTool('m'), 'Rotulador'), bE = btn('', I.eraser, () => setTool('e'), 'Borrar trazos');
    const bU = btn('', I.undo, () => doUndo(), 'Deshacer'), bR = btn('', I.redo, () => doRedo(), 'Rehacer');
    const bPan = btn('', I.hand, () => { pan = !pan; sync(); }, 'Mover la página con el dedo');
    const colorBtns = ['#141a2e', '#2340d0', '#c62f3b', '#1f8a5b', '#d9a400'].map((c) => { const b = h('button', { type: 'button', title: 'Color', 'aria-label': 'Color', html: `<span class="dot" style="background:${c}"></span>` }); b.onclick = () => { color = c; if (tool === 'e') tool = 'p'; sync(); }; b._c = c; return b; });
    const widthBtns = [[2, 'Fino'], [3, 'Medio'], [6, 'Grueso']].map(([w, l]) => { const b = h('button', { type: 'button', text: l[0], title: l, 'aria-label': 'Trazo ' + l.toLowerCase() }); b.onclick = () => { width = w; sync(); }; b._w = w; return b; });
    const paperBtn = h('button', { type: 'button', title: 'Tipo de hoja', onclick: () => { ink.papel = { rayas: 'cuadros', cuadros: 'lisa', lisa: 'rayas' }[ink.papel] || 'rayas'; layout(); sync(); } });
    const addPage = h('button', { type: 'button', title: 'Añadir página', html: ic(I.plus) + 'Página', onclick: () => { ink.paginas++; layout(); scroller.scrollTo({ top: paper.offsetHeight, behavior: 'smooth' }); } });
    const zoomB = h('button', { type: 'button', title: 'Tamaño de la hoja', onclick: () => { const r = scroller.scrollTop / Math.max(1, paper.offsetHeight); zoom = zoom >= 2.4 ? 1 : zoom >= 1.8 ? 2.4 : 1.8; layout(); sync(); scroller.scrollTop = r * paper.offsetHeight; } });
    const trans = h('button', { type: 'button', title: 'Pasar a texto con IA', html: ic(I.sparkle) + 'A texto', onclick: () => transcribe() });
    bar.append(done, h('span', { class: 'gap' }), bP, bM, bE, h('span', { class: 'gap' }), ...colorBtns, h('span', { class: 'gap' }), ...widthBtns, h('span', { class: 'gap' }), bU, bR, bPan, zoomB, paperBtn, addPage, trans);
    wrap.append(bar, scroller); document.body.append(wrap);
    document.documentElement.style.overflow = 'hidden';

    function setTool(t) { tool = t; sync(); }
    function sync() {
      bP.setAttribute('aria-pressed', tool === 'p'); bM.setAttribute('aria-pressed', tool === 'm'); bE.setAttribute('aria-pressed', tool === 'e');
      colorBtns.forEach((b) => b.setAttribute('aria-pressed', tool !== 'e' && b._c === color));
      widthBtns.forEach((b) => b.setAttribute('aria-pressed', b._w === width));
      bPan.setAttribute('aria-pressed', pan); bU.disabled = !undo.length; bR.disabled = !redo.length;
      paperBtn.textContent = { rayas: 'Rayas', cuadros: 'Cuadros', lisa: 'Lisa' }[ink.papel] || 'Rayas';
      trans.disabled = !ink.trazos.length || !S.ai; zoomB.textContent = zoom === 1 ? 'Hoja entera' : 'Zoom ×' + String(zoom).replace('.', ',');
    }
    function layout() {
      let maxY = 0; ink.trazos.forEach((s) => { for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]); });
      ink.paginas = Math.max(ink.paginas || 1, Math.ceil((maxY + 40) / PH));
      paper.style.width = zoom > 1 ? Math.round((scroller.clientWidth - 20) * zoom) + 'px' : ''; paper.style.maxWidth = zoom > 1 ? 'none' : '';
      const w = paper.clientWidth || Math.min(900, innerWidth - 20); k = w / PW; dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const hpx = PH * ink.paginas * k; dpr = Math.min(dpr, 15000 / hpx, Math.sqrt(16e6 / (w * hpx))); cv.style.height = hpx + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(hpx * dpr);
      const L = 40 * k, line = 'rgba(80,110,170,.22)';
      paper.style.backgroundImage = ink.papel === 'rayas' ? `repeating-linear-gradient(transparent 0 ${L - 1}px, ${line} ${L - 1}px ${L}px), repeating-linear-gradient(transparent 0 ${PH * k - 2}px, rgba(13,27,51,.25) ${PH * k - 2}px ${PH * k}px)`
        : ink.papel === 'cuadros' ? `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px), repeating-linear-gradient(transparent 0 ${PH * k - 2}px, rgba(13,27,51,.25) ${PH * k - 2}px ${PH * k}px)` : `repeating-linear-gradient(transparent 0 ${PH * k - 2}px, rgba(13,27,51,.25) ${PH * k - 2}px ${PH * k}px)`;
      paper.style.backgroundSize = ink.papel === 'cuadros' ? `${L}px ${L}px, ${L}px ${L}px, 100% 100%` : '';
      paper.style.backgroundPosition = ink.papel === 'rayas' ? `0 ${L * 2}px, 0 0` : '';
      redraw();
    }
    function redraw() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ink.trazos.forEach((s) => drawStroke(ctx, s, k)); }
    const ro = new ResizeObserver(() => layout()); ro.observe(scroller);

    // entrada: lápiz siempre escribe; con lápiz detectado, el dedo mueve la página (ignora la palma)
    let cur = null, pid = null, panY = null; const touches = new Set();
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k), Math.round((e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5) * 100)]; };
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen') penSeen = true;
      if (e.pointerType === 'touch') touches.add(e.pointerId);
      const fingerPans = e.pointerType === 'touch' && (pan || penSeen || touches.size > 1);
      if (fingerPans || (e.pointerType === 'mouse' && e.button !== 0)) {
        if (cur && touches.size > 1) { cur = null; pid = null; redraw(); }
        panY = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, id: e.pointerId }; return;
      }
      if (cur) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); pid = e.pointerId;
      if (tool === 'e') { cur = { erase: true, removed: [] }; eraseAt(pt(e)); return; }
      cur = { c: color, w: width, t: tool, p: pt(e) };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawStroke(ctx, cur, k);
    });
    cv.addEventListener('pointermove', (e) => {
      if (panY && e.pointerId === panY.id) { scroller.scrollTop = panY.top - (e.clientY - panY.y); scroller.scrollLeft = panY.left - (e.clientX - panY.x); return; }
      if (!cur || e.pointerId !== pid) return; e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const q = pt(ev);
        if (cur.erase) { eraseAt(q); continue; }
        const L = cur.p.length, dx = q[0] - cur.p[L - 3], dy = q[1] - cur.p[L - 2];
        if (dx * dx + dy * dy < 4) continue;
        cur.p.push(...q);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (cur.t === 'm') { redraw(); drawStroke(ctx, cur, k); } else drawStroke(ctx, { ...cur, p: cur.p.slice(-9) }, k);
      }
    });
    const end = (e) => {
      if (e.pointerType === 'touch') touches.delete(e.pointerId);
      if (panY && e.pointerId === panY.id) { panY = null; return; }
      if (!cur || e.pointerId !== pid) return;
      if (cur.erase) { if (cur.removed.length) { undo.push({ del: cur.removed }); redo.length = 0; } }
      else { ink.trazos.push(cur); undo.push({ add: cur }); redo.length = 0; redraw(); const bottom = cur.p.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), 0); if (bottom > PH * ink.paginas - 120) { ink.paginas++; layout(); } }
      cur = null; pid = null; sync(); autosave();
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    function eraseAt(q) {
      const R = 14; let hit = false;
      for (let j = ink.trazos.length - 1; j >= 0; j--) {
        const s = ink.trazos[j], rr = R + strokeWidth(s, 50) / 2;
        for (let i = 0; i < s.p.length; i += 3) { const dx = s.p[i] - q[0], dy = s.p[i + 1] - q[1]; if (dx * dx + dy * dy < rr * rr) { cur.removed.push({ s, i: j }); ink.trazos.splice(j, 1); hit = true; break; } }
      }
      if (hit) redraw();
    }
    function doUndo() { const a = undo.pop(); if (!a) return; if (a.add) ink.trazos.splice(ink.trazos.lastIndexOf(a.add), 1); else a.del.slice().reverse().forEach(({ s, i }) => ink.trazos.splice(i, 0, s)); redo.push(a); redraw(); sync(); autosave(); }
    function doRedo() { const a = redo.pop(); if (!a) return; if (a.add) ink.trazos.push(a.add); else a.del.forEach(({ s }) => { const i = ink.trazos.indexOf(s); if (i >= 0) ink.trazos.splice(i, 1); }); undo.push(a); redraw(); sync(); autosave(); }
    let saveT = null; const autosave = () => { clearTimeout(saveT); saveT = setTimeout(commit, 1500); };
    function commit() { clearTimeout(saveT); n.tinta = ink; if (n.tipo !== 'mano' && !n.cuerpo) n.tipo = 'mano'; saveNote(n); }
    async function transcribe() {
      if (!ink.trazos.length) return;
      const msg = h('div', { class: 'lb-inkmsg', text: 'Leyendo tu letra…' }); document.body.append(msg); trans.disabled = true;
      try {
        const images = [];
        let maxY = 0; ink.trazos.forEach((s) => { for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]); });
        const pages = Math.ceil((maxY + 30) / PH);
        for (let pg = 0; pg < Math.min(pages, 5); pg++) {
          const c2 = document.createElement('canvas'), sc = 0.9; c2.width = PW * sc; c2.height = PH * sc; const x = c2.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height); x.translate(0, -pg * PH * sc);
          ink.trazos.forEach((s) => drawStroke(x, s, sc));
          images.push(await new Promise((r) => c2.toBlob(r, 'image/jpeg', 0.85)));
        }
        const out = await aiJson('Transcribe fielmente el texto manuscrito de estas páginas de la libreta de Jaime (español). Respeta el orden y los saltos de línea; usa "- " si escribió viñetas y "## " para lo que sea claramente un título. Si hay dibujos o esquemas, descríbelos entre corchetes en una línea, p. ej. [esquema: …]. No añadas nada que no esté escrito. Devuelve SOLO JSON {"texto": "...", "titulo": título breve (máx. 60 caracteres) que resuma la página}', images);
        n.textoMano = String(out.texto || '').trim(); if (!n.titulo && out.titulo) n.titulo = out.titulo;
        commit(); msg.textContent = 'Listo: el texto aparece debajo del dibujo en la nota'; setTimeout(() => msg.remove(), 2600);
      } catch (e) { msg.textContent = 'No se pudo transcribir: ' + e.message; setTimeout(() => msg.remove(), 3500); }
      sync();
    }
    function close() { ro.disconnect(); commit(); wrap.remove(); document.documentElement.style.overflow = ''; renderAll(); }
    const onKey = (e) => { if (!document.body.contains(wrap)) return document.removeEventListener('keydown', onKey); if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); } if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { layout(); sync(); });
  }

  /* ---------- captura rápida (dictar, pegar, teclear) ---------- */
  function capture(mode) {
    if (mode === 'mano') { const n = newNote({ tipo: 'mano', origen: 'mano' }); saveNote(n); openNote(n.id); openInk(n); return; }
    const modal = h('div', { class: 'lb-modal' });
    const ta = h('textarea', { placeholder: mode === 'dictar' ? 'Habla y lo escribo aquí…' : mode === 'pegar' ? 'Pega aquí el texto…' : 'Escribe lo que tengas en la cabeza…', 'aria-label': 'Texto de la nota' });
    const live = h('div', { class: 'lb-live' });
    const sel = h('select', { 'aria-label': 'Libreta' }, h('option', { value: 'auto', text: S.ai ? 'Que la IA elija la libreta' : 'Libreta…' }), ...booksSorted().map((b) => h('option', { value: b.id, text: b.nombre })));
    if (S.book !== 'all' && S.book !== 'arch') sel.value = S.book; else if (!S.ai) sel.value = (booksSorted()[0] || {}).id || 'auto';
    let rec = null;
    const micB = h('button', { type: 'button', class: 'btn', html: ic(I.mic) + '<span>Dictar</span>' });
    const setMic = (on) => { micB.classList.toggle('rec', on); micB.lastChild.textContent = on ? 'Parar' : 'Dictar'; };
    micB.onclick = () => { if (rec) { rec.stop(); rec = null; setMic(false); return; } rec = dictation((t) => { ta.value = joinText(ta.value, t); ta.scrollTop = ta.scrollHeight; }, (p) => { live.textContent = p; }, () => { rec = null; setMic(false); }); if (rec) setMic(true); };
    const pasteB = h('button', { type: 'button', class: 'btn', html: ic(I.paste) + '<span>Pegar</span>', onclick: () => doPaste() });
    async function doPaste() { try { const t = await navigator.clipboard.readText(); if (t) ta.value = joinText(ta.value, t); else toast('El portapapeles está vacío'); } catch (e) { ta.focus(); toast('Mantén pulsado el cuadro y elige «Pegar»'); } }
    const st = h('div', { class: 'lb-status' });
    const close = () => { if (rec) rec.stop(); modal.remove(); };
    const go = async (order) => {
      const raw = ta.value.trim(); if (!raw) { ta.focus(); return; }
      if (rec) { rec.stop(); rec = null; setMic(false); }
      const book = sel.value === 'auto' ? (S.book !== 'all' && S.book !== 'arch' ? S.book : (booksSorted()[0] || {}).id) : sel.value;
      const n = newNote({ libreta: book, cuerpo: raw, origen: mode === 'dictar' ? 'dictado' : mode === 'pegar' ? 'pegado' : 'teclado' });
      if (order && S.ai) {
        st.textContent = 'Ordenando con IA…'; modal.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try { applyOrganized(n, await organize(raw, { keepBook: sel.value !== 'auto' }), raw); } catch (e) { toast('No se pudo ordenar; la guardo tal cual'); }
      } else if (!n.titulo) n.titulo = raw.split('\n')[0].slice(0, 60);
      await saveNote(n); close(); S.book = 'all'; S.sec = ''; openNote(n.id);
      if (order && n.original) toast('Nota ordenada', 'Ver original', () => { n.cuerpo = n.original; saveNote(n); renderAll(); });
    };
    modal.append(h('div', { class: 'lb-sheet', role: 'dialog', 'aria-label': 'Nueva nota' },
      h('h3', { text: 'Nueva nota' }), ta, live,
      h('div', { class: 'row' }, micB, pasteB, sel),
      st,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: close }), h('button', { type: 'button', class: 'btn', text: 'Guardar tal cual', onclick: () => go(false) }), S.ai ? h('button', { type: 'button', class: 'btn primary', html: 'Guardar y ordenar', onclick: () => go(true) }) : null)));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(modal);
    if (mode === 'dictar') micB.click(); else if (mode === 'pegar') doPaste(); else ta.focus();
  }
  function applyOrganized(n, o, raw) {
    if (!o) return;
    n.original = raw; if (o.titulo) n.titulo = String(o.titulo).slice(0, 90); if (o.cuerpo) n.cuerpo = String(o.cuerpo).trim();
    if (o.libreta && S.books.has(o.libreta)) n.libreta = o.libreta;
    const b = bookOf(n); if (o.seccion && b && (b.secciones || []).includes(o.seccion)) n.seccion = o.seccion;
    if (Array.isArray(o.etiquetas)) n.etiquetas = o.etiquetas.slice(0, 4).map(String);
    if (Array.isArray(o.acciones) && o.acciones.length) n.acciones = o.acciones.map(String);
    n.ordenada = nowIso();
  }
  function newNote(p) {
    const b = S.books.get(p.libreta) || S.books.get(S.book) || booksSorted()[0];
    const n = { id: newId('n'), titulo: '', cuerpo: '', tipo: 'texto', libreta: b ? b.id : null, seccion: (S.sec && b && b.id === S.book) ? S.sec : ((b && b.secciones && b.secciones[0]) || 'General'), creada: nowIso(), editada: nowIso(), ...p };
    if (p.libreta && p.libreta !== S.book && b && !p.seccion) n.seccion = (b.secciones || ['General'])[0];
    S.notes.set(n.id, n); return n;
  }

  /* ---------- libretas ---------- */
  function editBook(b) {
    const isNew = !b; b = b ? { ...b, secciones: [...(b.secciones || [])] } : { id: newId('lb-'), nombre: '', color: COLORS[S.books.size % COLORS.length], secciones: ['General'], orden: S.books.size + 1 };
    const modal = h('div', { class: 'lb-modal' });
    const name = h('input', { type: 'text', value: b.nombre, placeholder: 'Ej.: Pensamientos, Lecturas, Familia…', 'aria-label': 'Nombre de la libreta' });
    const secs = h('input', { type: 'text', value: b.secciones.join(', '), placeholder: 'General, Ideas, …', 'aria-label': 'Secciones' });
    const cols = h('div', { class: 'lb-colors' }, ...COLORS.map((c) => h('button', { type: 'button', style: 'background:' + c, 'aria-label': 'Color', 'aria-pressed': String(c === b.color), onclick: (e) => { b.color = c; cols.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget))); } })));
    const count = [...S.notes.values()].filter((n) => n.libreta === b.id).length;
    const close = () => modal.remove();
    const del = !isNew ? h('button', { type: 'button', class: 'btn ghost', style: 'color:var(--bad);margin-right:auto', text: 'Eliminar libreta', onclick: async () => {
      if (count) { alert('Esta libreta tiene ' + count + ' notas. Muévelas a otra libreta antes de eliminarla.'); return; }
      if (!confirm('¿Eliminar la libreta «' + b.nombre + '»?')) return;
      S.books.delete(b.id); await S.db.collection('lb_libretas').doc(b.id).delete(); if (S.book === b.id) S.book = 'all'; close(); renderAll();
    } }) : null;
    modal.append(h('div', { class: 'lb-sheet', role: 'dialog', 'aria-label': 'Libreta' },
      h('h3', { text: isNew ? 'Nueva libreta' : 'Editar libreta' }),
      h('div', { class: 'field' }, h('label', { text: 'Nombre' }), name),
      h('div', { class: 'field' }, h('label', { text: 'Secciones (separadas por comas), como las pestañas de OneNote' }), secs),
      h('div', { class: 'field' }, h('label', { text: 'Color' }), cols),
      h('div', { class: 'row end' }, del, h('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: close }), h('button', { type: 'button', class: 'btn primary', text: 'Guardar', onclick: async () => {
        b.nombre = name.value.trim(); if (!b.nombre) { name.focus(); return; }
        const list = secs.value.split(',').map((s) => s.trim()).filter(Boolean); b.secciones = list.length ? [...new Set(list)] : ['General'];
        await saveBook(b); S.book = b.id; S.sec = ''; close(); renderAll();
      } }))));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.body.append(modal); name.focus();
  }

  /* ---------- pintado ---------- */
  root.innerHTML = '';
  const layoutEl = h('div', { class: 'lb' });
  const rail = h('nav', { class: 'lb-pane lb-rail', 'aria-label': 'Libretas' });
  const list = h('section', { class: 'lb-pane lb-list', 'aria-label': 'Notas' });
  const page = h('section', { class: 'lb-pane lb-page', 'aria-label': 'Nota' });
  layoutEl.append(rail, list, page); root.append(layoutEl);
  const search = h('input', { class: 'lb-search', type: 'search', placeholder: 'Buscar en todas las notas…', 'aria-label': 'Buscar notas' });
  search.addEventListener('input', () => { S.q = search.value.trim().toLowerCase(); renderList(); });
  const listHead = h('div', { class: 'lb-list-head' });
  const chips = h('div', { class: 'lb-chips' });
  const capBar = h('div', { class: 'lb-cap' },
    h('button', { type: 'button', html: ic(I.mic) + 'Dictar', onclick: () => capture('dictar') }),
    h('button', { type: 'button', html: ic(I.paste) + 'Pegar', onclick: () => capture('pegar') }),
    h('button', { type: 'button', html: ic(I.key) + 'Escribir', onclick: () => capture('teclado') }),
    h('button', { type: 'button', html: ic(I.pen) + 'A mano', onclick: () => capture('mano') }));
  const items = h('div', { class: 'lb-items' });
  list.append(listHead, chips, capBar, search, items);

  function visibleNotes() {
    let arr = [...S.notes.values()];
    if (S.q) return arr.filter((n) => (n.titulo + ' ' + (n.cuerpo || '') + ' ' + (n.textoMano || '') + ' ' + (n.etiquetas || []).join(' ')).toLowerCase().includes(S.q)).sort((a, b) => String(b.editada).localeCompare(String(a.editada)));
    if (S.book === 'arch') arr = arr.filter((n) => n.archivada);
    else { arr = arr.filter((n) => !n.archivada); if (S.book !== 'all') arr = arr.filter((n) => n.libreta === S.book && (!S.sec || n.seccion === S.sec)); }
    return arr.sort((a, b) => (b.fijada ? 1 : 0) - (a.fijada ? 1 : 0) || String(b.editada).localeCompare(String(a.editada)));
  }
  function renderRail() {
    rail.innerHTML = ''; rail.append(h('h3', { text: 'Libretas' }));
    const active = [...S.notes.values()].filter((n) => !n.archivada);
    const bk = (id, label, color, count) => h('button', { type: 'button', class: 'lb-bk', 'aria-current': String(S.book === id && !S.sec), onclick: () => { S.book = id; S.sec = ''; S.q = ''; search.value = ''; renderAll(); } }, color ? h('span', { class: 'sw', style: 'background:' + color }) : h('span', { class: 'sw', style: 'background:var(--line)' }), label, h('span', { class: 'n', text: count || '' }));
    rail.append(bk('all', 'Todas las notas', null, active.length));
    booksSorted().forEach((b) => {
      const own = active.filter((n) => n.libreta === b.id);
      const row = bk(b.id, b.nombre, b.color, own.length);
      row.addEventListener('dblclick', () => editBook(b)); row.title = 'Doble clic para editar';
      rail.append(row);
      if (S.book === b.id) {
        (b.secciones || []).forEach((s) => rail.append(h('button', { type: 'button', class: 'lb-bk sec', 'aria-current': String(S.sec === s), onclick: () => { S.sec = s; renderAll(); } }, s, h('span', { class: 'n', text: own.filter((n) => n.seccion === s).length || '' }))));
        rail.append(h('button', { type: 'button', class: 'lb-bk sec', text: 'Editar libreta…', onclick: () => editBook(b) }));
      }
    });
    rail.append(h('button', { type: 'button', class: 'lb-bk lb-addbk', html: ic(I.plus) + ' Nueva libreta', onclick: () => editBook() }));
    rail.append(h('div', { class: 'lb-sep' }));
    rail.append(bk('arch', 'Archivo', '#98a1bb', [...S.notes.values()].filter((n) => n.archivada).length));
  }
  function renderChips() {
    chips.innerHTML = '';
    const chip = (id, label, color, sec) => h('button', { type: 'button', class: 'lb-chip', 'aria-pressed': String(sec != null ? S.sec === sec : S.book === id && !S.sec), onclick: () => { if (sec != null) S.sec = S.sec === sec ? '' : sec; else { S.book = id; S.sec = ''; } renderAll(); } }, color ? h('i', { style: 'background:' + color }) : null, label);
    chips.append(chip('all', 'Todas'));
    booksSorted().forEach((b) => chips.append(chip(b.id, b.nombre, b.color)));
    chips.append(chip('arch', 'Archivo', '#98a1bb'), h('button', { type: 'button', class: 'lb-chip', text: '+ Libreta', onclick: () => editBook() }));
    const b = S.books.get(S.book);
    if (b && (b.secciones || []).length > 1) { const row2 = h('div', { class: 'lb-chips', style: 'display:flex' }); (b.secciones || []).forEach((s) => row2.append(chip(null, s, null, s))); row2.append(h('button', { type: 'button', class: 'lb-chip', text: 'Editar', onclick: () => editBook(b) })); chips.after(row2); chips._row2 && chips._row2.remove(); chips._row2 = row2; }
    else if (chips._row2) { chips._row2.remove(); chips._row2 = null; }
    if (getComputedStyle(chips).display === 'none' && chips._row2) chips._row2.style.display = 'none';
  }
  function renderList() {
    const b = S.books.get(S.book);
    listHead.innerHTML = ''; listHead.append(h('h2', { text: S.q ? 'Resultados' : S.book === 'all' ? 'Todas las notas' : S.book === 'arch' ? 'Archivo' : (b ? b.nombre + (S.sec ? ' · ' + S.sec : '') : 'Notas') }));
    if (b) listHead.append(h('button', { type: 'button', class: 'btn ghost', title: 'Editar libreta', 'aria-label': 'Editar libreta', html: ic(I.more), onclick: () => editBook(b) }));
    items.innerHTML = '';
    const arr = visibleNotes();
    if (!S.ready) { items.append(h('div', { class: 'lb-empty', text: 'Cargando tus libretas…' })); return; }
    if (!arr.length) { items.append(h('div', { class: 'lb-empty', text: S.q ? 'Nada coincide con la búsqueda.' : S.book === 'arch' ? 'No hay notas archivadas.' : 'Aún no hay notas aquí. Dicta, pega, escribe o toma una nota a mano.' })); return; }
    let lastG = '';
    arr.forEach((n) => {
      const g = n.fijada && S.book !== 'arch' && !S.q ? 'Fijadas' : (() => { const d = new Date(n.editada), t = new Date(); const days = Math.floor((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5); return days <= 0 ? 'Hoy' : days === 1 ? 'Ayer' : days < 7 ? 'Esta semana' : d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()); })();
      if (g !== lastG) { items.append(h('div', { class: 'lb-group', text: g })); lastG = g; }
      const bk = bookOf(n);
      const kind = n.tinta && n.tinta.trazos && n.tinta.trazos.length ? '✍️ ' : n.origen === 'dictado' ? '🎙 ' : '';
      items.append(h('button', { type: 'button', class: 'lb-it', style: '--c:' + colorOf(n), 'aria-current': String(S.note === n.id), onclick: () => openNote(n.id) },
        h('b', {}, n.fijada ? h('span', { class: 'pin', text: '★' }) : null, h('span', { text: kind + (n.titulo || 'Sin título') })),
        plain(n) ? h('span', { class: 'sn', text: plain(n).slice(0, 180) }) : null,
        h('span', { class: 'mt' }, h('span', { text: fmt.format(new Date(n.editada)) }), S.book === 'all' || S.q ? h('span', { text: (bk ? bk.nombre : '') + (n.seccion ? ' · ' + n.seccion : '') }) : n.seccion && !S.sec ? h('span', { text: n.seccion }) : null)));
    });
  }
  let dict = null;
  function renderPage() {
    const n = S.notes.get(S.note);
    layoutEl.classList.toggle('has-note', !!n);
    if (dict && (!n || dict.noteId !== n.id)) { dict.stop(); dict = null; }
    page.innerHTML = '';
    if (!n) { page.append(h('div', { class: 'lb-blank', html: '<svg viewBox="0 0 24 24">' + I.book + '</svg><div>Elige una nota o crea una nueva.<br>Puedes dictarla, pegarla, escribirla o hacerla a mano.</div>' })); return; }
    const top = h('div', { class: 'lb-page-top' },
      h('button', { type: 'button', class: 'btn ghost lb-back', html: ic(I.back) + ' Notas', onclick: () => { S.note = null; renderAll(); window.scrollTo(0, 0); } }));
    const title = h('input', { class: 'lb-title', value: n.titulo || '', placeholder: 'Título', 'aria-label': 'Título' });
    title.addEventListener('input', () => { n.titulo = title.value; saveLater(n); });
    title.addEventListener('blur', () => renderList());
    const bookSel = h('select', { 'aria-label': 'Libreta' }, ...booksSorted().map((b) => h('option', { value: b.id, text: b.nombre, selected: b.id === n.libreta })));
    const secSel = h('select', { 'aria-label': 'Sección' });
    const fillSecs = () => { const b = bookOf(n); secSel.innerHTML = ''; ((b && b.secciones) || ['General']).forEach((s) => secSel.append(h('option', { value: s, text: s, selected: s === n.seccion }))); if (b && !(b.secciones || []).includes(n.seccion)) n.seccion = (b.secciones || ['General'])[0]; };
    fillSecs();
    bookSel.onchange = () => { n.libreta = bookSel.value; fillSecs(); n.seccion = secSel.value; saveNote(n); renderList(); renderRail(); };
    secSel.onchange = () => { n.seccion = secSel.value; saveNote(n); renderList(); renderRail(); };
    const meta = h('div', { class: 'lb-meta' }, bookSel, secSel, h('span', { text: 'Creada ' + fmtD.format(new Date(n.creada)) + (n.origen ? ' · ' + n.origen : '') }), h('span', { id: 'lb-status', class: 'lb-status', style: 'margin-left:auto' }));

    // texto
    const body = h('textarea', { class: 'lb-body', placeholder: 'Escribe, dicta o pega aquí…', 'aria-label': 'Texto de la nota' }); body.value = n.cuerpo || '';
    const fit = () => { body.style.height = 'auto'; body.style.height = Math.max(body.scrollHeight + 4, innerWidth < 700 ? innerHeight * 0.5 : 260) + 'px'; };
    body.addEventListener('input', () => { n.cuerpo = body.value; saveLater(n); fit(); });
    const read = h('div', { class: 'lb-read', html: renderRich(n.cuerpo) });
    read.addEventListener('click', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (cb) { const lines = (n.cuerpo || '').split('\n'); const i = +cb.dataset.line; lines[i] = lines[i].replace(/\[( |x|X)\]/, cb.checked ? '[x]' : '[ ]'); n.cuerpo = lines.join('\n'); saveNote(n); read.innerHTML = renderRich(n.cuerpo); return; }
      S.readMode = false; swap(true);
    });
    const hasText = () => !!(n.cuerpo || '').trim();
    const swap = (focus) => { const reading = S.readMode && hasText(); read.hidden = !reading; body.hidden = reading; modeB.lastChild.textContent = reading ? 'Editar' : 'Leer'; modeB.hidden = !hasText(); if (!reading) { fit(); if (focus) body.focus(); } else read.innerHTML = renderRich(n.cuerpo); };

    // herramientas
    const tbtn = (svg, label, on, cls) => h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), title: label, html: ic(svg) + '<span class="lb-tl">' + label + '</span>', onclick: on });
    const modeB = tbtn(I.text, 'Editar', () => { S.readMode = !S.readMode; swap(!S.readMode); });
    const micB = tbtn(I.mic, 'Dictar', () => {
      if (dict) { dict.stop(); dict = null; micB.classList.remove('rec'); micB.lastChild.textContent = 'Dictar'; return; }
      S.readMode = false; swap(false);
      const d = dictation((t) => { n.cuerpo = joinText(n.cuerpo || '', t); body.value = n.cuerpo; fit(); saveLater(n, 1500); }, (p) => status(p ? '🎙 ' + p : 'Escuchando…'), () => { dict = null; micB.classList.remove('rec'); micB.lastChild.textContent = 'Dictar'; status(''); });
      if (d) { dict = { ...d, noteId: n.id }; micB.classList.add('rec'); micB.lastChild.textContent = 'Parar'; status('Escuchando…'); }
    });
    const inkB = tbtn(I.pen, 'A mano', () => openInk(n));
    const ordB = tbtn(I.sparkle, 'Ordenar con IA', async () => {
      const raw = (n.cuerpo || '').trim() || (n.textoMano || '').trim(); if (!raw) { toast('No hay texto que ordenar'); return; }
      const prev = { ...n }; ordB.disabled = true; status('Ordenando con IA…');
      try { applyOrganized(n, await organize(raw, { keepBook: true }), raw); await saveNote(n); S.readMode = true; renderAll(); toast('Nota ordenada', 'Deshacer', () => { S.notes.set(n.id, prev); saveNote(prev); renderAll(); }); }
      catch (e) { status('No se pudo ordenar: ' + e.message, true); ordB.disabled = false; }
    });
    ordB.hidden = !S.ai;
    const menu = h('select', { class: 'btn', 'aria-label': 'Más acciones', style: 'width:auto' },
      h('option', { value: '', text: 'Más…' }),
      h('option', { value: 'pin', text: n.fijada ? 'Quitar de fijadas' : 'Fijar arriba' }),
      h('option', { value: 'arch', text: n.archivada ? 'Sacar del archivo' : 'Archivar' }),
      h('option', { value: 'copy', text: 'Copiar texto' }),
      h('option', { value: 'dup', text: 'Duplicar' }),
      h('option', { value: 'del', text: 'Eliminar nota' }));
    menu.onchange = async () => {
      const a = menu.value; menu.value = '';
      if (a === 'pin') { n.fijada = !n.fijada; await saveNote(n); renderAll(); }
      else if (a === 'arch') { n.archivada = !n.archivada; await saveNote(n); toast(n.archivada ? 'Nota archivada' : 'Nota recuperada del archivo', 'Deshacer', () => { n.archivada = !n.archivada; saveNote(n); renderAll(); }); if (n.archivada && S.book !== 'arch') S.note = null; renderAll(); }
      else if (a === 'copy') { try { await navigator.clipboard.writeText((n.titulo ? n.titulo + '\n\n' : '') + (n.cuerpo || n.textoMano || '')); toast('Texto copiado'); } catch (e) { toast('No se pudo copiar'); } }
      else if (a === 'dup') { const c = { ...JSON.parse(JSON.stringify(n)), id: newId('n'), titulo: (n.titulo || 'Nota') + ' (copia)', fijada: false, creada: nowIso() }; await saveNote(c); openNote(c.id); }
      else if (a === 'del') { if (!confirm('¿Eliminar esta nota? No se puede deshacer.')) return; S.notes.delete(n.id); S.note = null; renderAll(); try { await S.db.collection('lb_notas').doc(n.id).delete(); } catch (e) { toast('No se pudo eliminar: ' + e.message); } }
    };
    const tools = h('div', { class: 'lb-tools' }, modeB, micB, inkB, ordB, menu);

    page.append(top, title, meta, tools);
    if (n.etiquetas && n.etiquetas.length) page.append(h('div', { class: 'lb-tags' }, ...n.etiquetas.map((t) => h('span', { class: 'lb-tag', text: '#' + t }))));
    page.append(read, body);
    if (n.tinta && n.tinta.trazos && n.tinta.trazos.length) {
      page.append(h('div', { class: 'lb-sub', text: 'Escrito a mano' }), h('div', { class: 'lb-ink', role: 'button', tabindex: '0', 'aria-label': 'Abrir la página escrita a mano', onclick: () => openInk(n), html: inkSvg(n.tinta) + '<span class="hint">Toca para seguir escribiendo</span>' }));
      if (n.textoMano) page.append(h('div', { class: 'lb-sub', text: 'Transcripción' }), h('div', { class: 'lb-read lb-mini', html: renderRich(n.textoMano) }), h('div', {}, h('button', { type: 'button', class: 'btn', text: 'Pasar la transcripción al texto de la nota', onclick: () => { n.cuerpo = joinText(n.cuerpo ? n.cuerpo + '\n\n' : '', n.textoMano); saveNote(n); renderPage(); } })));
    }
    if (n.acciones && n.acciones.length) page.append(h('div', { class: 'lb-sub', text: 'Cosas por hacer que detecté' }), h('div', { class: 'lb-read lb-mini', html: '<ul>' + n.acciones.map((a) => '<li>' + escH(a) + '</li>').join('') + '</ul>' }));
    if (n.original && n.original !== n.cuerpo) { const det = h('details', {}, h('summary', { class: 'lb-sub', style: 'cursor:pointer', text: 'Texto original (antes de ordenar)' }), h('div', { class: 'lb-orig', text: n.original }), h('button', { type: 'button', class: 'btn ghost', text: 'Volver al original', onclick: () => { n.cuerpo = n.original; saveNote(n); renderPage(); } })); page.append(det); }
    swap(false);
    if (!hasText() && !(n.tinta && n.tinta.trazos && n.tinta.trazos.length) && !n.titulo) setTimeout(() => title.focus(), 30);
  }
  function openNote(id) { S.note = id; S.readMode = true; const n = S.notes.get(id); if (n && !n.archivada && S.book === 'arch') S.book = 'all'; renderAll(); if (innerWidth < 700) window.scrollTo(0, 0); }
  function renderAll() { renderRail(); renderChips(); renderList(); renderPage(); }
  renderAll();

  /* ---------- arranque ---------- */
  (async () => {
    const use = () => (window.claude && window.claude.use ? Promise.resolve() : new Promise((r) => setTimeout(r, 200)).then(use));
    await use();
    S.db = await window.claude.use('db');
    window.claude.use('sample').then((s) => { S.ai = s; if (S.note) renderPage(); }).catch(() => {});
    const bs = await S.db.collection('lb_libretas').get();
    if (bs.empty) { for (const b of DEFAULT_BOOKS) await saveBook({ ...b }); } else bs.docs.forEach((d) => S.books.set(d.id, d.data()));
    const ns = await S.db.collection('lb_notas').get(); ns.docs.forEach((d) => S.notes.set(d.id, d.data()));
    S.ready = true; renderAll();
    // cambios desde otro dispositivo
    const editing = () => { const a = document.activeElement; return a && page.contains(a) && /TEXTAREA|INPUT/.test(a.tagName); };
    S.db.collection('lb_libretas').onSnapshot((s) => { S.books = new Map(s.docs.map((d) => [d.id, d.data()])); if (!S.books.size) return; renderRail(); renderChips(); });
    S.db.collection('lb_notas').onSnapshot((s) => {
      const m = new Map(s.docs.map((d) => [d.id, d.data()]));
      const cur = S.note && S.notes.get(S.note), remote = S.note && m.get(S.note);
      let repaint = !!S.note && !remote;
      if (cur && remote) {
        const newer = String(remote.editada || '') > String(cur.editada || '');
        if (newer && !editing() && !dict && !document.querySelector('.lb-inkx')) repaint = true; else m.set(S.note, cur);
      }
      S.notes = m; if (repaint && !S.notes.get(S.note)) S.note = null;
      renderRail(); renderList(); if (repaint) renderPage();
    });
  })().catch((e) => { items.innerHTML = ''; items.append(h('div', { class: 'lb-empty', text: 'No se pudieron cargar las notas: ' + (e.message || e) })); });
})();
