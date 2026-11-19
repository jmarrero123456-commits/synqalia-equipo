/* Synqalia · Listas — listas de la compra (y de lo que sea) dictadas por voz.
   «Nueva lista» → se abre y empieza a escuchar. Hablas libremente (incluso pensando en voz alta:
   «a ver si queda leche…», «no sé si pedir pan»). Al pulsar «Terminar», la IA saca solo lo que es de la
   compra, con cantidades, ordenado por pasillos del súper; lo dudoso queda marcado para decidir.
   En el súper: tocar un producto lo pasa al carro.
   Datos privados en personal_docs, col «listas». Copia en el dispositivo (localStorage) para abrir sin conexión. */
(() => {
  const root = document.getElementById('view-lista');
  if (!root) return;
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
    return e;
  };
  const svg = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const I = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    cart: '<path d="M3 4h2.2l2.2 11h10.4l2-8H6.3"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  };
  const SECCIONES = ['Fruta y verdura', 'Panadería', 'Carne', 'Pescado', 'Charcutería y quesos', 'Lácteos y huevos', 'Despensa', 'Conservas y salsas', 'Desayuno y dulces', 'Congelados', 'Bebidas', 'Limpieza', 'Higiene y cuidado', 'Bebé y mascotas', 'Otros'];
  const secIdx = (s) => { const i = SECCIONES.indexOf(s); return i < 0 ? SECCIONES.length : i; };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nowIso = () => new Date().toISOString();
  const fmtD = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  const userId = (() => { try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^sb-.*-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k)); const u = v && (v.user || (v.currentSession && v.currentSession.user)); if (u && u.id) return u.id; } } } catch (e) {} return 'anon'; })();
  const LS = 'sq-listas-' + userId;
  const S = { lists: new Map(), dirty: new Set(), open: null, db: null, ai: null, rec: null, live: '', heard: '', busy: false, showClosed: false };

  /* ---------- datos ---------- */
  const persistLocal = () => { try { localStorage.setItem(LS, JSON.stringify({ lists: [...S.lists.values()], dirty: [...S.dirty] })); } catch (e) {} };
  try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); if (c) { c.lists.forEach((l) => S.lists.set(l.id, l)); (c.dirty || []).forEach((id) => S.dirty.add(id)); } } catch (e) {}
  const online = () => navigator.onLine && !!S.db && !window.__sqOffline;
  async function push(id) {
    if (!online()) return;
    const l = S.lists.get(id);
    try { if (l) await S.db.collection('listas').doc(id).set(l); else await S.db.collection('listas').doc(id).delete(); S.dirty.delete(id); persistLocal(); }
    catch (e) { /* se reintenta al volver la red */ }
  }
  function save(l) { l.editada = nowIso(); S.lists.set(l.id, l); S.dirty.add(l.id); persistLocal(); push(l.id); }
  function removeList(id) { S.lists.delete(id); S.dirty.add(id); persistLocal(); push(id); }
  const flush = () => [...S.dirty].forEach(push);
  function applyRemote(docs) {
    const seen = new Set();
    for (const d of docs) {
      const data = d.data(); if (!data) continue; seen.add(d.id);
      const loc = S.lists.get(d.id);
      if (S.dirty.has(d.id) && loc && String(loc.editada || '') >= String(data.editada || '')) continue;
      S.lists.set(d.id, { ...data, id: d.id }); S.dirty.delete(d.id);
    }
    for (const id of [...S.lists.keys()]) if (!seen.has(id) && !S.dirty.has(id)) S.lists.delete(id);
    persistLocal();
  }

  /* ---------- IA: de lo dicho a productos ---------- */
  function fallbackParse(text) {
    return String(text || '').split(/,|;|\.|\by\b|\bmás\b/i).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 60)
      .map((s) => ({ nombre: s.replace(/^./, (c) => c.toUpperCase()), cantidad: '', seccion: 'Otros', estado: 'comprar', nota: '' }));
  }
  async function interpret(l, text) {
    const actual = (l.items || []).map((it) => '- ' + it.nombre + (it.cantidad ? ' (' + it.cantidad + ')' : '') + (it.estado !== 'comprar' ? ' [' + it.estado + ']' : '')).join('\n') || '(vacía)';
    const prompt = 'Eres el asistente de una persona que dicta su lista de la compra en voz alta, en español, mientras revisa la nevera y la despensa. Lo que dice es un texto de dictado sin puntuación, con errores de reconocimiento de voz, muletillas, pensamientos en voz alta y a veces conversación que no tiene nada que ver (con otra persona, por teléfono…).\n'
      + 'Tu trabajo: sacar SOLO lo que hay que comprar y devolver los cambios sobre la lista.\n'
      + 'Reglas:\n'
      + '- Ignora todo lo que no sea de la compra.\n'
      + '- Corrige errores evidentes del dictado («yogurt»→«Yogur», «250 de chorizo»→ Chorizo, cantidad «250 g»). Nombre corto, en singular o como se diga en el súper, con mayúscula inicial.\n'
      + '- Cantidad: tal como la diga («2 kg», «250 g», «una docena», «3», «un paquete»); vacía si no la dice. Si dice algo como «de los de siempre», «del bueno» o una marca, ponlo en "nota".\n'
      + '- estado: "comprar" si lo pide claro; "mirar" si duda si lo tiene en casa («a ver si tengo…», «creo que queda…», «mira si hay…») y no llega a decidir; "duda" si duda si comprarlo («no sé si pedir…», «igual…», «¿cojo…?») y no decide. Si después decide («sí, apúntalo», «no, sí que hay»), aplica lo que decida: compra, o no lo pongas / quítalo.\n'
      + '- Si pide quitar o cambiar algo de la lista actual («quita el queso», «el chorizo mejor 500»), devuélvelo en "quitar" o vuelve a darlo en "items" con el mismo nombre y los datos nuevos.\n'
      + '- No repitas lo que ya está en la lista salvo para cambiarlo.\n'
      + '- seccion: una de ' + SECCIONES.join(', ') + '.\n'
      + '- Si en lo dicho hay una pregunta para ti sobre la lista, contéstala en "comentario" (una frase); si no, deja "comentario" vacío.\n'
      + 'Devuelve SOLO JSON: {"titulo": nombre corto de la lista si lo dice («para la barbacoa», «Mercadona»), si no "", "items": [{"nombre", "cantidad", "nota", "seccion", "estado"}], "quitar": [nombres], "comentario": ""}\n\n'
      + 'LISTA ACTUAL:\n' + actual + '\n\nLO QUE HA DICHO:\n' + text;
    const out = await S.ai.json(prompt);
    return typeof out === 'string' ? JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]) : (out || {});
  }
  function merge(l, res) {
    l.items = l.items || [];
    const find = (n) => l.items.find((it) => norm(it.nombre) === norm(n));
    let add = 0, chg = 0;
    (res.quitar || []).forEach((n) => { const it = find(n); if (it) { l.items = l.items.filter((x) => x !== it); chg++; } });
    (res.items || []).forEach((r) => {
      if (!r || !r.nombre) return;
      const estado = ['comprar', 'mirar', 'duda'].includes(r.estado) ? r.estado : 'comprar';
      const seccion = SECCIONES.includes(r.seccion) ? r.seccion : 'Otros';
      const ex = find(r.nombre);
      if (ex) { Object.assign(ex, { cantidad: r.cantidad || ex.cantidad || '', nota: r.nota || ex.nota || '', seccion, estado }); chg++; }
      else { l.items.push({ id: newId('i'), nombre: String(r.nombre).slice(0, 80), cantidad: String(r.cantidad || ''), nota: String(r.nota || ''), seccion, estado, hecho: false, creado: nowIso() }); add++; }
    });
    if (res.titulo && /^Compra/.test(l.titulo || '')) l.titulo = String(res.titulo).replace(/^./, (c) => c.toUpperCase()).slice(0, 50);
    return { add, chg };
  }
  async function processText(l, text) {
    text = String(text || '').trim();
    if (!text) { toast('No he oído nada. Pulsa el micro y vuelve a probar.'); return; }
    (l.dictados = l.dictados || []).push({ fecha: nowIso(), texto: text, pendiente: true });
    save(l);
    if (!S.ai || !navigator.onLine) {
      toast(navigator.onLine ? 'La IA no está disponible: lo guardo y lo ordeno en cuanto se pueda.' : 'Sin conexión: guardo lo dictado y hago la lista al volver la red.');
      render(); return;
    }
    await runPending(l);
  }
  async function runPending(l) {
    const pend = (l.dictados || []).filter((d) => d.pendiente);
    if (!pend.length || S.busy || !S.ai || !navigator.onLine) return;
    S.busy = true; render();
    try {
      const res = await interpret(l, pend.map((d) => d.texto).join('\n'));
      const { add, chg } = merge(l, res);
      pend.forEach((d) => { delete d.pendiente; });
      l.comentario = res.comentario || '';
      save(l);
      const dudas = l.items.filter((it) => !it.hecho && it.estado !== 'comprar').length;
      toast((add ? add + (add === 1 ? ' producto añadido' : ' productos añadidos') : chg ? 'Lista actualizada' : 'No he encontrado nada nuevo para la compra') + (dudas ? ' · ' + dudas + ' por decidir' : ''));
    } catch (e) {
      toast('No he podido ordenarlo (' + (e.message || e) + '). Lo apunto tal cual.');
      merge(l, { items: fallbackParse(pend.map((d) => d.texto).join(', ')) });
      pend.forEach((d) => { delete d.pendiente; }); save(l);
    } finally { S.busy = false; render(); }
  }

  /* ---------- dictado ---------- */
  function startRec(l) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Este navegador no permite dictar aquí. Usa el micrófono del teclado en «Añadir».'); return; }
    if (window.__sqRecording) { toast('Hay otra grabación en marcha (Reuniones, Catch-ups o Notas): párala primero.'); return; }
    let want = true, r;
    S.heard = ''; S.live = '';
    const go = () => {
      r = new SR(); r.lang = 'es-ES'; r.continuous = true; r.interimResults = true;
      r.onresult = (ev) => { let p = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) S.heard += (S.heard ? ' ' : '') + t.trim(); else p += t; } S.live = p; paintLive(); };
      r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; toast('Permite el micrófono para dictar la lista.'); } };
      r.onend = () => { if (want) { try { go(); } catch (e) { finish(); } } else done(); };
      try { r.start(); } catch (e) { want = false; done(); }
    };
    const done = () => { window.__sqRecording = false; const txt = (S.heard + ' ' + S.live).trim(); S.rec = null; S.live = ''; S.heard = ''; render(); processText(l, txt); };
    const finish = () => { if (!want) return; want = false; try { r && r.stop(); } catch (e) { done(); } };
    window.__sqRecording = true; S.rec = { stop: finish, list: l.id }; go(); render();
    try { navigator.wakeLock && navigator.wakeLock.request('screen').then((w) => { S.wake = w; }).catch(() => {}); } catch (e) {}
  }
  function stopRec() { if (S.rec) S.rec.stop(); try { S.wake && S.wake.release(); } catch (e) {} S.wake = null; }
  function paintLive() { const b = root.querySelector('.ls-heard'); if (b) { b.textContent = ''; b.append(S.heard ? h('span', { text: S.heard + ' ' }) : '', h('i', { text: S.live || (S.heard ? '' : 'Te escucho… di lo que necesitas, puedes pensar en voz alta.') })); b.scrollTop = b.scrollHeight; } }

  /* ---------- interfaz ---------- */
  function toast(msg) {
    document.querySelectorAll('.ls-toast').forEach((t) => t.remove());
    const t = h('div', { class: 'ls-toast', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), 3800);
  }
  const counts = (l) => { const it = (l.items || []); return { total: it.length, hechos: it.filter((x) => x.hecho).length, dudas: it.filter((x) => !x.hecho && x.estado !== 'comprar').length }; };
  function newList() {
    const d = new Date();
    const l = { id: newId('ls'), titulo: 'Compra ' + fmtD.format(d).replace(/\./g, ''), creada: nowIso(), items: [], dictados: [] };
    save(l); S.open = l.id; render(); startRec(l);
  }

  /* cerrar = la doy por terminada (sale de las abiertas, queda en «Cerradas» por si acaso); borrar = desaparece */
  const isEmpty = (l) => !(l.items || []).length && !(l.dictados || []).length;
  function closeList(l) {
    if (S.rec && S.rec.list === l.id) stopRec();
    if (isEmpty(l)) { removeList(l.id); S.open = null; render(); toast('Lista vacía descartada'); return; }
    l.cerrada = nowIso(); save(l); S.open = null; render(); window.scrollTo(0, 0);
    toastAction('«' + (l.titulo || 'Lista') + '» cerrada', 'Deshacer', () => { delete l.cerrada; save(l); render(); });
  }
  function reopenList(l) { delete l.cerrada; save(l); S.open = l.id; render(); window.scrollTo(0, 0); }
  function deleteList(l) {
    if (S.rec && S.rec.list === l.id) stopRec();
    const copy = JSON.parse(JSON.stringify(l));
    removeList(l.id); if (S.open === l.id) S.open = null; render();
    toastAction('«' + (l.titulo || 'Lista') + '» borrada', 'Deshacer', () => { save(copy); render(); });
  }
  // listas que se quedaron vacías (se abrió «Nueva lista» y no se dictó nada): fuera
  function pruneEmpty() {
    const lim = Date.now() - 2 * 60 * 1000;
    for (const l of [...S.lists.values()]) if (l.id !== S.open && isEmpty(l) && new Date(l.creada || 0).getTime() < lim) removeList(l.id);
  }

  function listCard(l) {
    const c = counts(l); const pct = c.total ? Math.round(c.hechos / c.total * 100) : 0;
    const closed = !!l.cerrada;
    const open = () => { S.open = l.id; render(); window.scrollTo(0, 0); };
    const sub = closed ? 'Cerrada el ' + fmtD.format(new Date(l.cerrada)).replace(/\./g, '') + (c.total ? ' · ' + c.hechos + ' de ' + c.total + ' comprados' : '')
      : c.total ? (c.hechos ? c.hechos + ' de ' + c.total + ' en el carro' : c.total + (c.total === 1 ? ' producto' : ' productos')) + (c.dudas ? ' · ' + c.dudas + ' por decidir' : '') : 'Vacía';
    return h('div', { class: 'ls-card' + (closed ? ' closed' : '') + (c.total && c.hechos === c.total ? ' done' : '') },
      h('button', { type: 'button', class: 'ls-card-open', onclick: open, 'aria-label': 'Abrir ' + (l.titulo || 'lista') },
        h('span', { class: 'ls-card-ic', html: svg(I.cart) }),
        h('span', { class: 'ls-card-main' }, h('b', { text: l.titulo || 'Lista' }), h('small', { text: sub }),
          c.total && !closed ? h('span', { class: 'ls-bar' }, h('i', { style: 'width:' + pct + '%' })) : null)),
      closed
        ? h('button', { type: 'button', class: 'ls-card-act', title: 'Volver a abrirla', 'aria-label': 'Volver a abrir ' + (l.titulo || 'lista'), html: svg(I.undo), onclick: () => reopenList(l) })
        : h('button', { type: 'button', class: 'ls-card-act ok', title: 'Cerrar (ya está)', 'aria-label': 'Cerrar ' + (l.titulo || 'lista'), html: svg(I.check), onclick: () => closeList(l) }),
      h('button', { type: 'button', class: 'ls-card-act bad', title: 'Borrar', 'aria-label': 'Borrar ' + (l.titulo || 'lista'), html: svg(I.trash), onclick: () => deleteList(l) }));
  }

  function renderHome() {
    pruneEmpty();
    const by = (a, b) => String(b.cerrada || b.editada || b.creada).localeCompare(String(a.cerrada || a.editada || a.creada));
    const all = [...S.lists.values()];
    const abiertas = all.filter((l) => !l.cerrada).sort(by), cerradas = all.filter((l) => l.cerrada).sort(by);
    const wrap = h('div', { class: 'ls-home' },
      h('button', { type: 'button', class: 'ls-new', onclick: newList, html: '<span class="ls-new-ic">' + svg(I.mic) + '</span><span><b>Nueva lista</b><small>Pulsa y dímela en voz alta</small></span>' }));
    if (!abiertas.length) wrap.append(h('p', { class: 'ls-empty', text: cerradas.length ? 'No tienes listas abiertas.' : 'Aún no tienes listas. Pulsa «Nueva lista», di lo que necesitas («plátanos, yogures, 250 de chorizo… a ver si queda leche») y pulsa «Terminar».' }));
    abiertas.forEach((l) => wrap.append(listCard(l)));
    if (cerradas.length) {
      wrap.append(h('button', { type: 'button', class: 'ls-closed-t', onclick: () => { S.showClosed = !S.showClosed; render(); }, text: 'Cerradas · ' + cerradas.length + (S.showClosed ? ' ▴' : ' ▾') }));
      if (S.showClosed) cerradas.forEach((l) => wrap.append(listCard(l)));
    }
    return wrap;
  }

  function itemRow(l, it) {
    const row = h('div', { class: 'ls-it ' + it.estado + (it.hecho ? ' hecho' : '') });
    const toggle = () => { it.hecho = !it.hecho; if (it.hecho && it.estado !== 'comprar') it.estado = 'comprar'; save(l); render(); };
    row.append(h('button', { type: 'button', class: 'ls-ck', 'aria-label': it.hecho ? 'Sacar del carro' : 'Al carro', 'aria-pressed': String(!!it.hecho), onclick: toggle }));
    const main = h('button', { type: 'button', class: 'ls-it-main', onclick: () => (it.estado === 'comprar' || it.hecho ? toggle() : null) },
      h('span', { class: 'ls-nm', text: it.nombre }),
      it.cantidad ? h('span', { class: 'ls-qty', text: it.cantidad }) : null,
      it.nota ? h('span', { class: 'ls-note', text: it.nota }) : null);
    row.append(main);
    row.append(h('button', { type: 'button', class: 'ls-del', 'aria-label': 'Quitar ' + it.nombre, title: 'Quitar', html: svg(I.x), onclick: () => { l.items = l.items.filter((x) => x !== it); save(l); render(); toastUndo(l, it); } }));
    if (!it.hecho && it.estado !== 'comprar') {
      row.append(h('span', { class: 'ls-ask' },
        h('span', { class: 'ls-q', text: it.estado === 'mirar' ? '¿Lo tienes en casa?' : '¿Lo compras?' }),
        h('button', { type: 'button', class: 'ls-yes', text: it.estado === 'mirar' ? 'No, comprar' : 'Sí', onclick: () => { it.estado = 'comprar'; save(l); render(); } }),
        h('button', { type: 'button', class: 'ls-no', text: it.estado === 'mirar' ? 'Sí, hay' : 'No', onclick: () => { l.items = l.items.filter((x) => x !== it); save(l); render(); } })));
    }
    return row;
  }
  function toastAction(msg, label, fn) {
    document.querySelectorAll('.ls-toast').forEach((t) => t.remove());
    const t = h('div', { class: 'ls-toast', role: 'status' }, h('span', { text: msg }), h('button', { type: 'button', text: label, onclick: () => { t.remove(); fn(); } }));
    document.body.append(t); setTimeout(() => t.remove(), 6000);
  }
  function toastUndo(l, it) {
    document.querySelectorAll('.ls-toast').forEach((t) => t.remove());
    const t = h('div', { class: 'ls-toast', role: 'status' }, h('span', { text: it.nombre + ' quitado' }), h('button', { type: 'button', text: 'Deshacer', onclick: () => { l.items.push(it); save(l); render(); t.remove(); } }));
    document.body.append(t); setTimeout(() => t.remove(), 6000);
  }

  function renderList(l) {
    const c = counts(l);
    const recOn = S.rec && S.rec.list === l.id;
    const wrap = h('div', { class: 'ls-list' });
    // cabecera
    const title = h('input', { class: 'ls-title', value: l.titulo || '', 'aria-label': 'Nombre de la lista' });
    title.addEventListener('change', () => { l.titulo = title.value.trim() || 'Lista'; save(l); });
    const menu = h('div', { class: 'ls-menu', hidden: true });
    const mi = (txt, fn, cls) => h('button', { type: 'button', class: cls || '', text: txt, onclick: () => { menu.hidden = true; fn(); } });
    menu.append(
      mi('Compartir / copiar', async () => {
        const txt = (l.titulo || 'Lista') + '\n' + sorted(l).filter((it) => !it.hecho).map((it) => '• ' + it.nombre + (it.cantidad ? ' — ' + it.cantidad : '') + (it.nota ? ' (' + it.nota + ')' : '') + (it.estado !== 'comprar' ? ' ¿?' : '')).join('\n');
        try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } } catch (e) {}
      }),
      mi('Vaciar el carro (desmarcar todo)', () => { l.items.forEach((it) => { it.hecho = false; }); save(l); render(); }),
      mi('Quitar lo que ya está en el carro', () => { l.items = l.items.filter((it) => !it.hecho); save(l); render(); }),
      mi('Duplicar para otra compra', () => { const n = { ...JSON.parse(JSON.stringify(l)), id: newId('ls'), titulo: (l.titulo || 'Lista') + ' (copia)', creada: nowIso(), dictados: [] }; n.items.forEach((it) => { it.hecho = false; it.id = newId('i'); }); save(n); S.open = n.id; render(); }),
      mi('Ver lo que dicté', () => { const d = (l.dictados || []).map((x) => '— ' + new Date(x.fecha).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) + ':\n' + x.texto).join('\n\n'); alert(d || 'No hay dictados en esta lista.'); }),
      l.cerrada ? mi('Volver a abrirla', () => reopenList(l)) : mi('Cerrar la lista (ya está)', () => closeList(l)),
      mi('Borrar la lista', () => deleteList(l), 'bad'));
    wrap.append(h('div', { class: 'ls-head' },
      h('button', { type: 'button', class: 'ls-back', 'aria-label': 'Volver a las listas', html: svg(I.back), onclick: () => { if (recOn) stopRec(); if (isEmpty(l) && !recOn) removeList(l.id); S.open = null; render(); } }),
      title,
      h('button', { type: 'button', class: 'ls-more', 'aria-label': 'Opciones', html: svg(I.more), onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }),
      menu));
    if (l.cerrada) wrap.append(h('div', { class: 'ls-closed-note', text: 'Lista cerrada el ' + fmtD.format(new Date(l.cerrada)).replace(/\./g, '') + '. Puedes volver a abrirla o borrarla abajo.' }));
    if (c.total) wrap.append(h('div', { class: 'ls-prog' }, h('span', { class: 'ls-bar' }, h('i', { style: 'width:' + Math.round(c.hechos / c.total * 100) + '%' })), h('small', { text: c.hechos + ' de ' + c.total + ' en el carro' })));

    // micrófono
    const pend = (l.dictados || []).some((d) => d.pendiente);
    const mic = h('div', { class: 'ls-mic' + (recOn ? ' on' : '') });
    if (recOn) {
      mic.append(h('div', { class: 'ls-heard', 'aria-live': 'polite' }),
        h('button', { type: 'button', class: 'ls-micbtn on', onclick: stopRec, html: '<span class="ls-pulse"></span>' + svg(I.stop) + '<b>Terminar</b>' }));
    } else if (S.busy) {
      mic.append(h('div', { class: 'ls-busy' }, h('span', { class: 'ls-spin' }), 'Preparando la lista…'));
    } else {
      mic.append(h('button', { type: 'button', class: 'ls-micbtn', onclick: () => startRec(l), html: svg(I.mic) + '<b>' + (c.total ? 'Dictar más' : 'Pulsa y habla') + '</b>' }));
      if (pend) mic.append(h('button', { type: 'button', class: 'btn', text: navigator.onLine ? 'Ordenar lo dictado' : 'Lo dictado se ordenará al volver la red', disabled: !navigator.onLine || !S.ai, onclick: () => runPending(l) }));
    }
    wrap.append(mic);
    if (recOn) setTimeout(paintLive, 0);
    if (l.comentario && !recOn) wrap.append(h('div', { class: 'ls-comment' }, h('span', { text: '✨ ' + l.comentario }), h('button', { type: 'button', 'aria-label': 'Cerrar', html: svg(I.x), onclick: () => { l.comentario = ''; save(l); render(); } })));

    // añadir a mano
    const inp = h('input', { class: 'ls-add-in', placeholder: 'Añadir a mano (p. ej. «2 kg de naranjas»)', enterkeyhint: 'done', 'aria-label': 'Añadir producto' });
    const addF = h('form', { class: 'ls-add' }, inp, h('button', { type: 'submit', class: 'btn', 'aria-label': 'Añadir', html: svg(I.plus) }));
    addF.addEventListener('submit', (e) => {
      e.preventDefault(); const v = inp.value.trim(); if (!v) return; inp.value = '';
      if (S.ai && navigator.onLine && /,|\by\b|\d/.test(v)) processText(l, v);
      else { merge(l, { items: [{ nombre: v.replace(/^./, (x) => x.toUpperCase()), seccion: 'Otros', estado: 'comprar' }] }); save(l); render(); }
    });
    wrap.append(addF);

    // productos
    const items = sorted(l);
    const decide = items.filter((it) => !it.hecho && it.estado !== 'comprar');
    const buy = items.filter((it) => it.hecho || it.estado === 'comprar');
    const pendientes = items.filter((it) => !it.hecho && it.estado === 'comprar');
    if (!items.length && !recOn && !S.busy) wrap.append(h('p', { class: 'ls-empty', text: 'Lista vacía. Pulsa el micro y di lo que necesitas; cuando acabes, «Terminar».' }));
    if (decide.length) { const g = h('section', { class: 'ls-grp ask' }, h('h3', { text: 'Por decidir · ' + decide.length })); decide.forEach((it) => g.append(itemRow(l, it))); wrap.append(g); }
    let sec = null, g = null;
    buy.forEach((it) => { if (it.seccion !== sec) { sec = it.seccion; g = h('section', { class: 'ls-grp' }, h('h3', { text: sec })); wrap.append(g); } g.append(itemRow(l, it)); });
    if (c.total && !pendientes.length && !decide.length && !l.cerrada) wrap.append(h('p', { class: 'ls-empty ok', text: '¡Todo en el carro! 🛒 Ya puedes cerrarla.' }));
    // cerrar o borrar desde la propia lista (aunque no esté todo marcado)
    if (!recOn) wrap.append(h('div', { class: 'ls-foot' },
      l.cerrada
        ? h('button', { type: 'button', class: 'ls-foot-main', html: svg(I.undo) + '<b>Volver a abrirla</b>', onclick: () => reopenList(l) })
        : h('button', { type: 'button', class: 'ls-foot-main' + (c.total && !pendientes.length && !decide.length ? ' ready' : ''), html: svg(I.check) + '<b>Cerrar lista</b>', onclick: () => closeList(l) }),
      h('button', { type: 'button', class: 'ls-foot-del', 'aria-label': 'Borrar la lista', title: 'Borrar la lista', html: svg(I.trash), onclick: () => deleteList(l) })));
    return wrap;
  }
  const sorted = (l) => [...(l.items || [])].sort((a, b) => secIdx(a.seccion) - secIdx(b.seccion) || String(a.creado || '').localeCompare(String(b.creado || '')));

  function render() {
    const l = S.open && S.lists.get(S.open);
    if (S.open && !l) S.open = null;
    const ae = document.activeElement; const keep = ae && root.contains(ae) && ae.classList.contains('ls-add-in');
    root.textContent = '';
    root.append(l ? renderList(l) : renderHome());
    if (keep) { const i = root.querySelector('.ls-add-in'); if (i) i.focus(); }
  }
  document.addEventListener('click', (e) => { const m = root.querySelector('.ls-menu'); if (m && !m.hidden && !m.contains(e.target)) m.hidden = true; });
  render();

  /* ---------- arranque ---------- */
  addEventListener('online', () => { setTimeout(() => { flush(); const l = S.open && S.lists.get(S.open); if (l) runPending(l); else render(); }, 1500); });
  addEventListener('offline', render);
  (async () => {
    const use = () => (window.claude && window.claude.use ? Promise.resolve() : new Promise((r) => setTimeout(r, 200)).then(use));
    await use();
    window.claude.use('sample').then((s) => { S.ai = s; render(); }).catch(() => {});
    const db = await window.claude.use('db');
    const connect = async () => {
      try {
        const snap = await db.collection('listas').get(); S.db = db; applyRemote(snap.docs); flush(); if (!S.rec) render();
        db.collection('listas').onSnapshot((s) => { applyRemote(s.docs); if (!S.rec && !(document.activeElement && root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) render(); });
      } catch (e) { addEventListener('online', () => setTimeout(connect, 1500), { once: true }); }
    };
    connect();
  })();
})();
