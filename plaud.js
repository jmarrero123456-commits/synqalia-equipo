/* Synqalia · Grabaciones del Plaud en las reuniones (24/11/2026)
   - Se conecta una vez la cuenta Plaud (función «plaud», OAuth con Plaud). Cada 5 minutos el servidor trae las grabaciones
     nuevas (personal_docs col «plaud»: hora de inicio y fin, transcripción y resumen de Plaud).
   - Aquí se empareja cada grabación con la reunión de la agenda que más coincide en hora y se añade sola a sus notas
     (mismo sitio que «Grabar y transcribir»). Aviso abajo con «Abrir», «Otra reunión» y «Deshacer».
   - Lo que no encaja (sin reunión a esa hora, o Plaud aún sin transcribir) queda en «Grabaciones del Plaud», en Agenda,
     para ponerlo en una reunión con un toque o dejarlo sin reunión. */
(async () => {
  if (!document.getElementById('view-reuniones') || window.__sqPlaud) return;
  window.__sqPlaud = true;
  await window.__sqReady;
  const sb = window.__sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hoy = () => isoDay(new Date());
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mins = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const clean = (t) => String(t || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const diaTxt = (f) => {
    const t = hoy(); const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - 1);
    if (f === t) return 'Hoy'; if (f === isoDay(d)) return 'Ayer';
    const s = new Date(f + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const call = async (action, extra) => {
    const { data, error } = await sb.functions.invoke('plaud', { body: Object.assign({ action }, extra || {}) });
    if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (_) { /* sin cuerpo */ } throw new Error(m); }
    return data;
  };
  const M = () => window.__sqMeet;

  /* ---------- estilos ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .pl-card{display:grid;gap:10px}
  .pl-card .pl-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pl-card h2{margin:0;font-size:16px}
  .pl-card .pl-st{font-size:12.5px;color:var(--muted,#6b7280)}
  .pl-card .pl-st.err{color:#b42318}
  .pl-card .pl-sp{flex:1}
  .pl-list{display:grid;gap:8px}
  .pl-it{display:grid;gap:6px;border:1px solid var(--line,#e5e7eb);border-radius:12px;padding:10px 12px}
  .pl-it .t{font-weight:650;font-size:14px}
  .pl-it .s{font-size:12.5px;color:var(--muted,#6b7280)}
  .pl-it .b{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .pl-it select{font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid var(--line,#e5e7eb);max-width:100%}
  .pl-it.ok{background:color-mix(in srgb,var(--accent,#0f766e) 6%,transparent)}
  .pl-btn{font:inherit;font-size:13px;font-weight:600;border-radius:9px;padding:6px 12px;cursor:pointer;border:1px solid var(--line,#e5e7eb);background:transparent;color:inherit}
  .pl-btn.pri{background:var(--accent,#0f766e);border-color:var(--accent,#0f766e);color:#fff}
  .pl-btn.lnk{border:0;padding:4px 2px;text-decoration:underline;color:var(--muted,#6b7280);font-weight:500}
  .pl-toast{position:fixed;left:18px;bottom:18px;z-index:91;width:min(400px,calc(100vw - 24px));background:#151a22;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px 14px;box-shadow:0 12px 34px rgba(0,0,0,.28);display:grid;gap:8px;animation:plIn .25s ease-out}
  @keyframes plIn{from{transform:translateY(10px);opacity:0}}
  .pl-toast .k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#5fe0cf}
  .pl-toast .t{font-weight:650;font-size:14.5px;line-height:1.3}
  .pl-toast .s{font-size:12.5px;color:rgba(255,255,255,.65)}
  .pl-toast .b{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .pl-toast button{font:inherit;font-size:13px;font-weight:650;border-radius:9px;padding:6px 12px;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff}
  .pl-toast .x{margin-left:auto;background:transparent;border:0;color:rgba(255,255,255,.55);padding:4px 6px;font-size:18px;line-height:1}
  .pl-toast select{font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;background:#222833;color:#fff;border:1px solid rgba(255,255,255,.2);max-width:100%}
  @media (max-width:560px){.pl-toast{left:12px;right:12px;width:auto;bottom:calc(var(--sq-tabbar,62px) + 14px + env(safe-area-inset-bottom,0px))}}`;
  document.head.appendChild(css);

  /* ---------- tarjeta en Agenda ---------- */
  const card = document.createElement('section');
  card.className = 'card pl-card'; card.id = 'plaud-card';
  const ag = document.getElementById('agenda-card');
  if (ag && ag.parentNode) ag.parentNode.insertBefore(card, ag.nextSibling); else document.getElementById('view-reuniones').appendChild(card);

  let estado = { conectado: false };
  const recs = new Map(); // grabaciones (personal_docs col «plaud»)
  let busy = false;

  async function loadRecs() {
    const { data } = await sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', 'plaud');
    recs.clear(); (data || []).forEach((r) => recs.set(r.id, r.data));
  }
  async function saveRec(id, patch) {
    const cur = recs.get(id) || {};
    const next = Object.assign({}, cur, patch);
    recs.set(id, next);
    const { error } = await sb.from('personal_docs').upsert({ owner: uid, col: 'plaud', id, data: next }, { onConflict: 'owner,col,id' });
    if (error) throw error;
  }

  /* ---------- emparejar con la agenda ---------- */
  const eventosDe = (fecha) => {
    const a = M() && M().agenda()[fecha];
    return ((a && a.eventos) || []).filter((e) => e && e.inicio && mins(e.inicio) != null).map((e) => Object.assign({}, e, { fecha }));
  };
  function candidatos(g) {
    const gi = mins(g.hIni), gf = mins(g.hFin) != null && mins(g.hFin) > gi ? mins(g.hFin) : gi + (g.minutos || 1);
    return eventosDe(g.fecha).map((e) => {
      const ei = mins(e.inicio); let ef = mins(e.fin); if (ef == null || ef <= ei) ef = ei + 30;
      const solape = Math.max(0, Math.min(gf, ef) - Math.max(gi, ei));
      return { e, solape, dur: ef - ei };
    }).filter((c) => c.solape > 0 && c.dur < 10 * 60).sort((a, b) => b.solape - a.solape || a.dur - b.dur);
  }
  // la reunión «buena»: la que más coincide, con al menos 10 min (o un tercio de la grabación si es corta)
  function mejor(g) {
    const c = candidatos(g); if (!c.length) return null;
    const need = Math.min(10, Math.max(2, Math.round((g.minutos || 0) / 3)));
    if (c[0].solape < need) return null;
    return { ev: c[0].e, dudosa: c.length > 1 && c[1].solape >= c[0].solape * 0.6 };
  }

  async function asignar(g, ev, auto) {
    const m = M(); if (!m) return null;
    const id = await m.attach(ev, g);
    if (!id) throw new Error('No se ha podido guardar en la reunión');
    await saveRec(g.id, { asignado: { cu: id, fecha: ev.fecha, inicio: ev.inicio, fin: ev.fin || null, titulo: clean(ev.titulo), auto: !!auto, cuando: new Date().toISOString() }, descartado: false });
    return id;
  }
  async function quitar(g) {
    const a = g.asignado; if (!a) return;
    await M().detach(a.cu, g);
    await saveRec(g.id, { asignado: null });
  }

  // reparto automático: solo grabaciones transcritas, sin asignar, de los últimos días y desde que se conectó Plaud
  async function auto() {
    if (busy || !estado.conectado || !M()) return;
    busy = true;
    try {
      const desde = estado.desde ? isoDay(new Date(new Date(estado.desde).getTime() - 3 * 864e5)) : hoy();
      const lim = isoDay(new Date(Date.now() - 10 * 864e5));
      const lista = [...recs.values()].filter((g) => !g.asignado && !g.descartado && !g.autoVisto && g.estadoTx === 'lista' && g.fecha >= desde && g.fecha >= lim)
        .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
      for (const g of lista) {
        if (!M().agenda()[g.fecha]) continue; // aún sin agenda de ese día
        // otra pestaña (o el móvil) puede haberla puesto ya
        const { data: fresh } = await sb.from('personal_docs').select('data').eq('owner', uid).eq('col', 'plaud').eq('id', g.id).maybeSingle();
        if (fresh && fresh.data && (fresh.data.asignado || fresh.data.descartado || fresh.data.autoVisto)) { recs.set(g.id, fresh.data); continue; }
        const b = mejor(g);
        if (!b) { await saveRec(g.id, { autoVisto: true }); toastSuelta(g); continue; }
        await asignar(g, b.ev, true);
        toastHecha(recs.get(g.id), b.dudosa);
      }
    } catch (e) { console.error('plaud', e); }
    finally { busy = false; paint(); }
  }

  /* ---------- avisos ---------- */
  let toastEl = null;
  const cerrarToast = () => { if (toastEl) { toastEl.remove(); toastEl = null; } };
  function toast(html, wire, ms) {
    cerrarToast();
    const t = document.createElement('div'); t.className = 'pl-toast'; t.setAttribute('role', 'status'); t.innerHTML = html;
    document.body.appendChild(t); toastEl = t;
    t.querySelector('.x')?.addEventListener('click', cerrarToast);
    if (wire) wire(t);
    if (ms) setTimeout(() => { if (toastEl === t) cerrarToast(); }, ms);
  }
  const evDe = (a) => Object.assign({}, (eventosDe(a.fecha).find((e) => e.inicio === a.inicio && clean(e.titulo) === a.titulo)) || { inicio: a.inicio, fin: a.fin, titulo: a.titulo }, { fecha: a.fecha });
  function selectEventos(g, excluir) {
    const evs = eventosDe(g.fecha).filter((e) => !(excluir && e.inicio === excluir.inicio && clean(e.titulo) === excluir.titulo));
    if (!evs.length) return null;
    const s = document.createElement('select'); s.setAttribute('aria-label', 'Elegir reunión');
    s.innerHTML = '<option value="">Elegir reunión de ese día…</option>' + evs.map((e, i) => `<option value="${i}">${esc(e.inicio)}${e.fin ? '–' + esc(e.fin) : ''} · ${esc(clean(e.titulo))}</option>`).join('');
    s._evs = evs; return s;
  }
  async function mover(g, ev) {
    try { await quitar(g); await asignar(recs.get(g.id), ev, false); toastHecha(recs.get(g.id), false); }
    catch (e) { toast(`<div class="b"><span class="t">No se ha podido cambiar: ${esc(e.message)}</span><button class="x" aria-label="Cerrar">×</button></div>`, null, 6000); }
    paint();
  }
  function toastHecha(g, dudosa) {
    const a = g.asignado; if (!a) return;
    toast(`<div class="b"><span class="k">🎙️ Plaud</span><button class="x" aria-label="Cerrar">×</button></div>
      <div class="t">Grabación añadida a «${esc(a.titulo)}»</div>
      <div class="s">${esc(diaTxt(g.fecha))} · grabación ${esc(g.hIni)}–${esc(g.hFin)} · reunión ${esc(a.inicio)}${a.fin ? '–' + esc(a.fin) : ''}${dudosa ? ' · había otra reunión a la vez' : ''}</div>
      <div class="b"><button class="op">Abrir</button><button class="ot">Otra reunión</button><button class="un">Deshacer</button></div>`, (t) => {
      t.querySelector('.op').onclick = () => { cerrarToast(); M().open(evDe(a)); };
      t.querySelector('.un').onclick = async () => { cerrarToast(); await quitar(g); await saveRec(g.id, { autoVisto: true }); paint(); };
      t.querySelector('.ot').onclick = (ev) => {
        const s = selectEventos(g, a);
        if (!s) { ev.target.textContent = 'No hay otras ese día'; ev.target.disabled = true; return; }
        ev.target.replaceWith(s);
        s.onchange = () => { if (s.value !== '') { cerrarToast(); mover(g, s._evs[+s.value]); } };
      };
    }, dudosa ? 0 : 20000);
  }
  function toastSuelta(g) {
    toast(`<div class="b"><span class="k">🎙️ Plaud</span><button class="x" aria-label="Cerrar">×</button></div>
      <div class="t">Grabación sin reunión en la agenda</div>
      <div class="s">${esc(diaTxt(g.fecha))} · ${esc(g.hIni)}–${esc(g.hFin)} · ${g.minutos || 0} min. Está en «Grabaciones del Plaud», en Agenda.</div>
      <div class="b"><button class="ver">Ver</button></div>`, (t) => {
      t.querySelector('.ver').onclick = () => { cerrarToast(); const tab = document.getElementById('tab-reuniones'); if (tab) tab.click(); setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
    }, 15000);
  }

  /* ---------- pintar la tarjeta ---------- */
  function paint() {
    card.replaceChildren();
    const h = document.createElement('div'); h.className = 'pl-h';
    h.innerHTML = '<h2>🎙️ Grabaciones del Plaud</h2><span class="pl-sp"></span>';
    card.appendChild(h);
    const st = document.createElement('div'); st.className = 'pl-st';
    if (!estado.conectado) {
      st.textContent = estado.error ? estado.error + '.' : 'Graba con tu Plaud y la grabación se añade sola a la reunión de tu agenda que coincide en hora.';
      if (estado.error) st.classList.add('err');
      const b = document.createElement('button'); b.className = 'pl-btn pri'; b.type = 'button'; b.textContent = 'Conectar Plaud';
      b.onclick = async () => { b.disabled = true; b.textContent = 'Abriendo Plaud…'; try { const r = await call('conectar'); location.href = r.url; } catch (e) { b.disabled = false; b.textContent = 'Conectar Plaud'; st.textContent = 'No se ha podido conectar: ' + e.message; st.classList.add('err'); } };
      h.appendChild(b); card.appendChild(st);
      return;
    }
    const rv = document.createElement('button'); rv.className = 'pl-btn'; rv.type = 'button'; rv.textContent = 'Revisar ahora';
    rv.onclick = async () => { rv.disabled = true; rv.textContent = 'Revisando…'; await sincronizar(); };
    const dc = document.createElement('button'); dc.className = 'pl-btn lnk'; dc.type = 'button'; dc.textContent = 'Desconectar';
    dc.onclick = async () => { if (!confirm('¿Desconectar tu Plaud de Synqalia? Las grabaciones ya añadidas a tus reuniones se quedan.')) return; await call('desconectar').catch(() => {}); estado = { conectado: false }; paint(); };
    h.appendChild(rv); h.appendChild(dc);
    st.textContent = estado.error ? 'Último aviso: ' + estado.error : estado.ultimo_sync ? 'Conectado · revisado ' + new Date(estado.ultimo_sync).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '. Se revisa cada 5 minutos; la grabación llega cuando el Plaud se sincroniza con la app del móvil.' : 'Conectado · trayendo tus grabaciones…';
    if (estado.error) st.classList.add('err');
    card.appendChild(st);

    const lim = isoDay(new Date(Date.now() - 10 * 864e5));
    const todas = [...recs.values()].filter((g) => g.fecha >= lim).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
    const sueltas = todas.filter((g) => !g.asignado && !g.descartado);
    const puestas = todas.filter((g) => g.asignado).slice(0, 4);
    const list = document.createElement('div'); list.className = 'pl-list';
    sueltas.forEach((g) => {
      const it = document.createElement('div'); it.className = 'pl-it';
      const b = g.estadoTx === 'lista' ? mejor(g) : null;
      const sub = g.estadoTx !== 'lista' ? 'Plaud aún no la ha transcrito: en la app de Plaud, abre la grabación y pulsa «Generar» (o activa la transcripción automática). Se añade sola cuando esté.'
        : !eventosDe(g.fecha).length ? 'No hay reuniones ese día en tu agenda.' : b ? 'Coincide con «' + clean(b.ev.titulo) + '».' : 'No coincide con ninguna reunión de tu agenda.';
      it.innerHTML = `<div class="t">${esc(diaTxt(g.fecha))} · ${esc(g.hIni)}–${esc(g.hFin)} · ${g.minutos || 0} min</div><div class="s">${esc(sub)}</div><div class="b"></div>`;
      const bx = it.querySelector('.b');
      if (g.estadoTx === 'lista') {
        if (b) { const p = document.createElement('button'); p.className = 'pl-btn pri'; p.type = 'button'; p.textContent = 'Poner en «' + clean(b.ev.titulo).slice(0, 40) + '»'; p.onclick = async () => { p.disabled = true; await asignar(g, b.ev, false).catch((e) => alert(e.message)); toastHecha(recs.get(g.id), false); paint(); }; bx.appendChild(p); }
        const s = selectEventos(g, b ? { inicio: b.ev.inicio, titulo: clean(b.ev.titulo) } : null);
        if (s) { s.onchange = async () => { if (s.value === '') return; s.disabled = true; await asignar(g, s._evs[+s.value], false).catch((e) => alert(e.message)); toastHecha(recs.get(g.id), false); paint(); }; bx.appendChild(s); }
      }
      const d = document.createElement('button'); d.className = 'pl-btn lnk'; d.type = 'button'; d.textContent = 'Dejar sin reunión';
      d.onclick = async () => { await saveRec(g.id, { descartado: true }); paint(); };
      bx.appendChild(d);
      list.appendChild(it);
    });
    puestas.forEach((g) => {
      const a = g.asignado;
      const it = document.createElement('div'); it.className = 'pl-it ok';
      it.innerHTML = `<div class="s">${esc(diaTxt(g.fecha))} · ${esc(g.hIni)}–${esc(g.hFin)} → <b>${esc(a.titulo)}</b></div><div class="b"></div>`;
      const bx = it.querySelector('.b');
      const o = document.createElement('button'); o.className = 'pl-btn'; o.type = 'button'; o.textContent = 'Abrir'; o.onclick = () => M().open(evDe(a)); bx.appendChild(o);
      const s = selectEventos(g, a);
      if (s) { s.options[0].textContent = 'Cambiar a otra reunión…'; s.onchange = () => { if (s.value !== '') mover(g, s._evs[+s.value]); }; bx.appendChild(s); }
      const q = document.createElement('button'); q.className = 'pl-btn lnk'; q.type = 'button'; q.textContent = 'Quitar de la reunión';
      q.onclick = async () => { await quitar(g); await saveRec(g.id, { autoVisto: true }); paint(); };
      bx.appendChild(q);
      list.appendChild(it);
    });
    if (list.children.length) card.appendChild(list);
    else { const e = document.createElement('div'); e.className = 'pl-st'; e.textContent = 'Sin grabaciones en los últimos días.'; card.appendChild(e); }
  }

  async function leerEstado() { try { estado = await call('estado'); } catch (_) { /* sin conexión */ } }
  async function sincronizar() {
    try { const r = await call('sync'); if (r && r.error) estado.error = r.error; } catch (e) { estado.error = e.message; }
    await leerEstado(); await loadRecs(); paint(); auto();
  }

  /* ---------- arranque ---------- */
  const q = new URLSearchParams(location.search);
  const vuelta = q.get('plaud');
  if (vuelta) { q.delete('plaud'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
  await leerEstado(); await loadRecs(); paint();
  if (vuelta === 'conectado') {
    toast('<div class="b"><span class="k">🎙️ Plaud</span><button class="x" aria-label="Cerrar">×</button></div><div class="t">Plaud conectado</div><div class="s">Traigo tus grabaciones de los últimos días…</div>', null, 8000);
    setTimeout(sincronizar, 4000);
  } else if (vuelta === 'error' || vuelta === 'cancelado') {
    toast(`<div class="b"><span class="k">🎙️ Plaud</span><button class="x" aria-label="Cerrar">×</button></div><div class="t">${vuelta === 'cancelado' ? 'No se ha conectado Plaud' : 'No se ha podido conectar Plaud'}</div><div class="s">Puedes intentarlo otra vez desde Agenda.</div>`, null, 10000);
  }

  // en vivo: grabaciones nuevas que trae el servidor
  sb.channel('sq-plaud-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row || row.col !== 'plaud') return;
    if (p.eventType === 'DELETE') recs.delete(row.id); else recs.set(row.id, row.data);
    paint(); setTimeout(auto, 800 + Math.random() * 2500);
  }).subscribe();
  // la agenda tarda en cargar: primer reparto a los pocos segundos y luego cada minuto
  setTimeout(auto, 6000);
  setInterval(() => { auto(); }, 60000);
  setInterval(async () => { if (estado.conectado && document.visibilityState === 'visible') { await leerEstado(); paint(); } }, 5 * 60000);
})();
