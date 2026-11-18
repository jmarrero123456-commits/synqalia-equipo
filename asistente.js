/* synqalia · Asistente — pregunta lo que quieras sobre lo que pasa por synqalia
   (correo, Teams, reuniones y catch-ups, tareas, notas, agenda y fichas de Equipo).
   La función «asistente» busca y lee los datos con la sesión del usuario y responde con las fuentes.
   Conversaciones guardadas en personal_docs, col «asistente» (privadas). */
(async () => {
  const view = document.getElementById('view-asistente');
  if (!view || window.__sqAsistente) return;
  window.__sqAsistente = true;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const newId = () => 'ia' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nowIso = () => new Date().toISOString();
  const IC = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-2.5-6.5z"/><path d="m11.5 13.5 3-3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 3.5v5h-5"/></svg>',
  };
  const COL_LABEL = { correos: 'Correo', teams: 'Teams', catchups: 'Reunión', tareas: 'Tarea', agenda: 'Agenda', lb_notas: 'Nota', respuestas: 'Respuesta', decisiones: 'Decisión', equipo: 'Equipo', brief: 'Resumen del día', invitaciones: 'Convocatoria', ficha: 'Ficha' };
  const SUGG = [
    { t: 'Zona centro', q: 'Cuéntame cómo van los salones de la zona centro de OMC: un breve resumen con lo que ha puesto Ana Revilla.' },
    { t: 'Impagos · Roberto Nieto', q: 'Búscame todos los correos sobre impagos en los que está Roberto Nieto y dame un resumen por fecha.' },
    { t: 'Reclamaciones 10 días', q: 'En los últimos 10 días, ¿cuántas reclamaciones de deuda o impagos he hecho y qué importe se está reclamando en total? Desglósamelo.' },
    { t: 'Lo urgente hoy', q: '¿Qué tengo hoy urgente o pendiente de decidir? Ordénamelo por importancia.' },
    { t: 'Ayer en reuniones', q: 'Resúmeme las reuniones y catch-ups de ayer: acuerdos y tareas para mí.' },
    { t: 'Pendiente con Frederic', q: '¿Qué tengo pendiente con Frederic o qué me ha pedido esta semana?' },
  ];
  const WAIT = ['Buscando en tu correo…', 'Revisando Teams y reuniones…', 'Leyendo los hilos que encajan…', 'Cruzando fechas e importes…', 'Preparando el resumen…'];

  view.removeAttribute('style');
  view.classList.add('sqa');
  view.innerHTML = '<p class="note">Cargando el asistente…</p>';

  /* ---------- botón flotante (móvil) ---------- */
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'sqa-fab'; fab.title = 'Pregúntale al asistente'; fab.setAttribute('aria-label', 'Asistente');
  fab.innerHTML = IC.spark;
  fab.addEventListener('click', () => { location.hash = '#asistente'; setTimeout(() => S.inp && S.inp.focus(), 60); });
  document.body.appendChild(fab);
  const syncFab = () => { fab.hidden = location.hash === '#asistente' || !!document.querySelector('.login'); };
  addEventListener('hashchange', syncFab); syncFab();

  await window.__sqReady;
  const sb = window.__sb;
  if (!sb) { view.innerHTML = '<p class="note">Sin conexión: el asistente necesita red.</p>'; return; }
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const S = { chats: [], cur: null, busy: false, showList: false, inp: null, rec: null };

  /* ---------- datos ---------- */
  async function loadChats() {
    const { data } = await sb.from('personal_docs').select('id,data,updated_at').eq('col', 'asistente').order('updated_at', { ascending: false }).limit(60);
    S.chats = (data || []).map((r) => ({ id: r.id, ...r.data }));
  }
  async function saveChat(c) {
    c.actualizada = nowIso();
    const data = { titulo: c.titulo, creada: c.creada, actualizada: c.actualizada, mensajes: c.mensajes.slice(-40) };
    const { error } = await sb.from('personal_docs').upsert({ owner: uid, col: 'asistente', id: c.id, data }, { onConflict: 'owner,col,id' });
    if (error) console.warn('asistente: no se pudo guardar', error.message);
  }
  async function delChat(id) {
    await sb.from('personal_docs').delete().eq('col', 'asistente').eq('id', id);
    S.chats = S.chats.filter((c) => c.id !== id);
    if (S.cur && S.cur.id === id) S.cur = null;
    render();
  }

  /* ---------- Markdown sencillo + fuentes ---------- */
  function inline(s, cites) {
    let t = esc(s);
    t = t.replace(/\[\[([a-z_]+):([^\]\s]+)\]\]/g, (_, col, id) => {
      const k = col + ':' + id; let n = cites.order.indexOf(k);
      if (n < 0) { cites.order.push(k); n = cites.order.length - 1; }
      return '<button type="button" class="sqa-cite" data-col="' + esc(col) + '" data-id="' + esc(id) + '" title="' + esc((cites.map[k] || {}).titulo || COL_LABEL[col] || col) + '">' + (n + 1) + '</button>';
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }
  function md(text, fuentes) {
    const cites = { order: [], map: Object.fromEntries((fuentes || []).map((f) => [f.col + ':' + f.id, f])) };
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html += '<pre class="sqa-pre">' + esc(buf.join('\n')) + '</pre>'; continue; }
      const h = l.match(/^(#{1,4})\s+(.*)/);
      if (h) { html += '<h' + (h[1].length <= 2 ? 3 : 4) + '>' + inline(h[2], cites) + '</h' + (h[1].length <= 2 ? 3 : 4) + '>'; i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        html += '<div class="sqa-tw"><table><thead><tr>' + head.map((c) => '<th>' + inline(c, cites) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c, cites) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        const ordered = /^\s*\d+[.)]/.test(l); const items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          let it = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''); const sub = /^\s{2,}/.test(lines[i]); i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) it += ' ' + lines[i++].trim();
          items.push({ it, sub });
        }
        html += (ordered ? '<ol>' : '<ul>') + items.map((x) => '<li' + (x.sub ? ' class="sub"' : '') + '>' + inline(x.it, cites) + '</li>').join('') + (ordered ? '</ol>' : '</ul>');
        continue;
      }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); html += '<blockquote>' + buf.map((b) => inline(b, cites)).join('<br>') + '</blockquote>'; continue; }
      if (/^---+\s*$/.test(l)) { html += '<hr>'; i++; continue; }
      const buf = [l]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s|>|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
      html += '<p>' + buf.map((b) => inline(b, cites)).join('<br>') + '</p>';
    }
    const list = cites.order.map((k, n) => { const f = cites.map[k] || { col: k.split(':')[0], id: k.split(':').slice(1).join(':') }; return { n: n + 1, ...f }; });
    return { html, list };
  }
  const plain = (t) => String(t || '').replace(/\s*\[\[[a-z_]+:[^\]\s]+\]\]/g, '').replace(/\*\*([^*]+)\*\*/g, '$1');
  const fdate = (s) => { if (!s) return ''; const d = new Date(String(s).length <= 10 ? s + 'T12:00' : s); return isNaN(d) ? String(s) : d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''); };

  function openSource(col, id) {
    if (col === 'correos' && window.__sqOpenMail) { window.__sqOpenMail(id); return; }
    if (col === 'ficha') { location.href = './?z=equipo&item=' + encodeURIComponent(id); return; }
    const go = { tareas: 'tareas', catchups: 'catchups', agenda: 'reuniones', invitaciones: 'reuniones', lb_notas: 'notas', teams: 'mensajes', respuestas: 'correo', decisiones: 'correo', equipo: 'catchups', brief: 'hoy' }[col] || 'hoy';
    location.hash = '#' + go;
  }

  /* ---------- dictado ---------- */
  function toggleMic(btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (S.rec) { S.rec.want = false; try { S.rec.r.stop(); } catch (e) {} return; }
    if (window.__sqRecording) { alert('Hay una grabación en marcha en Reuniones o Catch-ups.'); return; }
    const r = new SR(); r.lang = 'es-ES'; r.continuous = true; r.interimResults = true;
    const base = S.inp.value.trim() ? S.inp.value.trim() + ' ' : '';
    let fin = '';
    S.rec = { r, want: true };
    r.onresult = (e) => { let inter = ''; for (let k = e.resultIndex; k < e.results.length; k++) { const t = e.results[k][0].transcript; if (e.results[k].isFinal) fin += t + ' '; else inter += t; } S.inp.value = (base + fin + inter).replace(/\s+/g, ' ').trimStart(); grow(); };
    r.onend = () => { if (S.rec && S.rec.want) { try { r.start(); return; } catch (e) {} } S.rec = null; window.__sqRecording = false; const b = view.querySelector('.sqa-mic'); if (b) { b.classList.remove('on'); b.innerHTML = IC.mic; } S.inp && S.inp.focus(); };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.rec && (S.rec.want = false); } };
    window.__sqRecording = true; btn.classList.add('on'); btn.innerHTML = IC.stop;
    try { r.start(); } catch (e) { S.rec = null; window.__sqRecording = false; btn.classList.remove('on'); btn.innerHTML = IC.mic; }
  }
  const grow = () => { const t = S.inp; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; };

  /* ---------- preguntar ---------- */
  async function ask(q) {
    q = String(q || '').trim(); if (!q || S.busy) return;
    if (S.rec) { S.rec.want = false; try { S.rec.r.stop(); } catch (e) {} }
    if (!S.cur) { S.cur = { id: newId(), titulo: q.slice(0, 80), creada: nowIso(), mensajes: [] }; S.chats.unshift(S.cur); }
    S.cur.mensajes.push({ rol: 'user', texto: q, en: nowIso() });
    S.busy = true; S.showList = false; if (S.inp) S.inp.value = '';
    render(); scrollEnd();
    let w = 0; const tick = setInterval(() => { const el = view.querySelector('.sqa-wait span'); if (el) el.textContent = WAIT[++w % WAIT.length]; }, 3200);
    let msg;
    try {
      const messages = S.cur.mensajes.filter((m) => !m.error).map((m) => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto }));
      const { data, error } = await sb.functions.invoke('asistente', { body: { messages } });
      if (error) { let t = error.message; try { const b = await error.context.json(); t = b.error || t; } catch (e) {} throw new Error(t); }
      msg = { rol: 'ia', texto: data.answer, fuentes: data.fuentes || [], pasos: data.pasos || [], en: nowIso() };
    } catch (e) {
      msg = { rol: 'ia', error: true, texto: 'No he podido responder: ' + (e.message || e) + '. Vuelve a intentarlo.', en: nowIso() };
    }
    clearInterval(tick);
    S.cur.mensajes.push(msg);
    S.busy = false;
    if (!msg.error) saveChat(S.cur);
    render(); scrollEnd(true);
  }
  const scrollEnd = (toAnswer) => requestAnimationFrame(() => {
    const box = view.querySelector('.sqa-thread'); if (!box) return;
    const last = box.querySelector('.sqa-msg.ia:last-child');
    if (toAnswer && last) last.scrollIntoView({ block: 'start', behavior: 'smooth' }); else window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  /* ---------- pintar ---------- */
  function render() {
    const c = S.cur;
    const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const draft = S.inp ? S.inp.value : '';
    view.innerHTML = '';
    const root = document.createElement('div'); root.className = 'sqa-root' + (S.showList ? ' list-open' : '');
    root.innerHTML =
      '<aside class="sqa-hist"><div class="sqa-hist-top"><b>Consultas</b><button type="button" class="btn sqa-new">' + IC.plus + 'Nueva</button></div>' +
      (S.chats.length ? '<div class="sqa-hist-list">' + S.chats.map((h) => '<div class="sqa-h' + (c && c.id === h.id ? ' on' : '') + '" data-id="' + esc(h.id) + '"><button type="button" class="sqa-h-open"><span>' + esc(h.titulo || 'Consulta') + '</span><small>' + esc(fdate(h.actualizada || h.creada)) + ' · ' + ((h.mensajes || []).filter((m) => m.rol === 'user').length) + ' preg.</small></button><button type="button" class="sqa-h-del" title="Borrar consulta" aria-label="Borrar consulta">' + IC.trash + '</button></div>').join('') + '</div>'
        : '<p class="note">Aquí quedarán tus consultas.</p>') + '</aside>' +
      '<section class="sqa-main">' +
        '<div class="sqa-head"><button type="button" class="sqa-hbtn sqa-toggle" title="Consultas anteriores">' + IC.list + '<span>Consultas</span></button>' +
        '<div class="sqa-title">' + IC.spark + '<b>' + esc(c ? c.titulo : 'Asistente') + '</b></div>' +
        (c ? '<button type="button" class="sqa-hbtn sqa-new">' + IC.plus + '<span>Nueva</span></button>' : '') + '</div>' +
        '<div class="sqa-thread">' + (c ? c.mensajes.map(msgHtml).join('') : intro()) + (S.busy ? '<div class="sqa-msg ia"><div class="sqa-wait"><i></i><i></i><i></i><span>' + WAIT[0] + '</span></div></div>' : '') + '</div>' +
        '<form class="sqa-ask"><textarea rows="1" placeholder="Pregunta o dicta: «resúmeme los correos de impagos con Roberto Nieto»" aria-label="Tu pregunta"></textarea>' +
        (hasSR ? '<button type="button" class="sqa-mic" title="Dictar" aria-label="Dictar">' + IC.mic + '</button>' : '') +
        '<button type="submit" class="sqa-send" title="Preguntar" aria-label="Preguntar"' + (S.busy ? ' disabled' : '') + '>' + IC.send + '</button></form>' +
        '<p class="sqa-foot">Responde con lo que ha pasado por synqalia: correo, Teams, reuniones, catch-ups, tareas, notas y Equipo. Revisa las cifras en las fuentes.</p>' +
      '</section>';
    view.appendChild(root);
    S.inp = root.querySelector('textarea'); S.inp.value = draft; grow();
    S.inp.addEventListener('input', grow);
    S.inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); ask(S.inp.value); } });
    root.querySelector('.sqa-ask').addEventListener('submit', (e) => { e.preventDefault(); ask(S.inp.value); });
    const mic = root.querySelector('.sqa-mic'); if (mic) { if (S.rec) { mic.classList.add('on'); mic.innerHTML = IC.stop; } mic.addEventListener('click', () => toggleMic(mic)); }
    root.querySelectorAll('.sqa-new').forEach((b) => b.addEventListener('click', () => { if (S.busy) return; S.cur = null; S.showList = false; render(); S.inp.focus(); }));
    root.querySelector('.sqa-toggle').addEventListener('click', () => { S.showList = !S.showList; root.classList.toggle('list-open', S.showList); });
    root.querySelectorAll('.sqa-h').forEach((el) => {
      el.querySelector('.sqa-h-open').addEventListener('click', () => { if (S.busy) return; S.cur = S.chats.find((h) => h.id === el.dataset.id) || null; S.showList = false; render(); scrollEnd(); });
      el.querySelector('.sqa-h-del').addEventListener('click', () => { if (confirm('¿Borrar esta consulta?')) delChat(el.dataset.id); });
    });
    root.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
    root.querySelectorAll('.sqa-cite, .sqa-src').forEach((b) => b.addEventListener('click', () => openSource(b.dataset.col, b.dataset.id)));
    root.querySelectorAll('.sqa-copy').forEach((b) => b.addEventListener('click', async () => {
      const m = c && c.mensajes[Number(b.dataset.i)]; if (!m) return;
      try { await navigator.clipboard.writeText(plain(m.texto)); b.textContent = '✓ Copiado'; setTimeout(() => { b.innerHTML = IC.copy + 'Copiar'; }, 1600); } catch (e) {}
    }));
    root.querySelectorAll('.sqa-retry').forEach((b) => b.addEventListener('click', () => {
      const ms = c.mensajes; const lastQ = [...ms].reverse().find((m) => m.rol === 'user');
      while (ms.length && ms[ms.length - 1].rol !== 'user') ms.pop(); if (ms.length) ms.pop();
      if (lastQ) ask(lastQ.texto);
    }));
  }
  function intro() {
    return '<div class="sqa-intro"><div class="sqa-orb">' + IC.spark + '</div><h3>¿Qué quieres saber?</h3>' +
      '<p>Pregúntame por cualquier cosa que haya pasado por tu correo, Teams, reuniones, tareas, notas o los tableros de Equipo. Te lo resumo, te digo de dónde sale cada dato y te preparo el texto si lo necesitas.</p>' +
      '<div class="sqa-sugg">' + SUGG.map((s) => '<button type="button" class="sqa-chip" data-q="' + esc(s.q) + '"><b>' + esc(s.t) + '</b><span>' + esc(s.q) + '</span></button>').join('') + '</div></div>';
  }
  function msgHtml(m, i) {
    if (m.rol === 'user') return '<div class="sqa-msg user"><div class="sqa-bub">' + esc(m.texto).replace(/\n/g, '<br>') + '</div></div>';
    if (m.error) return '<div class="sqa-msg ia err"><div class="sqa-ans"><p>' + esc(m.texto) + '</p><div class="sqa-acts"><button type="button" class="btn sqa-retry">' + IC.retry + 'Reintentar</button></div></div></div>';
    const r = md(m.texto, m.fuentes);
    const src = r.list.length ? '<div class="sqa-srcs"><span class="sqa-srcs-l">Fuentes</span>' + r.list.map((f) => '<button type="button" class="sqa-src" data-col="' + esc(f.col) + '" data-id="' + esc(f.id) + '"><em>' + f.n + '</em><span class="k">' + esc(COL_LABEL[f.col] || f.col) + '</span><span class="t">' + esc(f.titulo || f.id) + '</span>' + (f.fecha ? '<span class="d">' + esc(fdate(f.fecha)) + '</span>' : '') + '</button>').join('') + '</div>' : '';
    const pasos = (m.pasos || []).length ? '<details class="sqa-steps"><summary>Cómo lo he buscado · ' + m.pasos.length + ' pasos</summary><ol>' + m.pasos.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ol></details>' : '';
    return '<div class="sqa-msg ia"><div class="sqa-ans">' + r.html + src + '<div class="sqa-acts"><button type="button" class="btn sqa-copy" data-i="' + i + '">' + IC.copy + 'Copiar</button>' + pasos + '</div></div></div>';
  }

  await loadChats();
  render();
  addEventListener('hashchange', () => { if (location.hash === '#asistente' && S.inp && matchMedia('(pointer: fine)').matches) setTimeout(() => S.inp.focus(), 50); });
})();
