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
    llenarSlots();
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

  /* ---------- «🎙️ Plaud» dentro de cada reunión: lo que da Plaud, tal cual ---------- */
  const css2 = document.createElement('style');
  css2.textContent = `
  .pl-slot:empty{display:none}
  .pl-pan{margin-top:12px;border:1px solid var(--line,#e5e7eb);border-radius:14px;overflow:hidden;background:var(--panel,#fff)}
  .pl-pan>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;background:color-mix(in srgb,var(--accent,#0f766e) 7%,transparent)}
  .pl-pan>summary::-webkit-details-marker{display:none}
  .pl-pan>summary b{font-size:14.5px}
  .pl-pan>summary .s{font-size:12.5px;color:var(--muted,#6b7280)}
  .pl-pan>summary .ch{margin-left:auto;font-size:12px;color:var(--muted,#6b7280)}
  .pl-pan[open]>summary .ch{transform:rotate(180deg)}
  .pl-tabs{display:flex;gap:4px;padding:8px 10px 0;border-bottom:1px solid var(--line,#e5e7eb);flex-wrap:wrap}
  .pl-tabs button{font:inherit;font-size:13px;font-weight:650;border:0;background:transparent;padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer;color:var(--muted,#6b7280)}
  .pl-tabs button.on{color:inherit;border-bottom-color:var(--accent,#0f766e)}
  .pl-tabs .sp{flex:1}
  .pl-body{padding:12px 16px 16px;max-height:70vh;overflow:auto;font-size:14px;line-height:1.55}
  .pl-md h3{font-size:15.5px;margin:16px 0 6px}.pl-md h4{font-size:14.5px;margin:12px 0 4px}.pl-md h3:first-child{margin-top:2px}
  .pl-md ul{margin:4px 0 8px;padding-left:20px}.pl-md li{margin:3px 0}
  .pl-md li.todo{list-style:none;margin-left:-18px}.pl-md li.todo::before{content:"☐ ";color:var(--accent,#0f766e)}
  .pl-md p{margin:6px 0}
  .pl-ix{display:grid;gap:2px}
  .pl-ix button{all:unset;cursor:pointer;display:flex;gap:12px;padding:7px 8px;border-radius:8px}
  .pl-ix button:hover{background:color-mix(in srgb,var(--accent,#0f766e) 8%,transparent)}
  .pl-t{font-variant-numeric:tabular-nums;color:var(--muted,#6b7280);font-size:12.5px;min-width:44px}
  .pl-tx{display:grid;gap:10px}
  .pl-turn{display:grid;grid-template-columns:52px 1fr;gap:8px}
  .pl-turn .w{font-weight:700;font-size:13px;cursor:pointer;border-bottom:1px dashed transparent}
  .pl-turn .w:hover{border-bottom-color:currentColor}
  .pl-turn.hl{background:color-mix(in srgb,#f5c542 22%,transparent);border-radius:8px}
  .pl-turn mark{background:#f5c542;color:inherit;border-radius:3px}
  .pl-find{width:100%;font:inherit;font-size:13.5px;padding:7px 10px;border-radius:9px;border:1px solid var(--line,#e5e7eb);margin-bottom:10px;background:transparent;color:inherit}
  .pl-audio{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px 2px}
  .pl-audio audio{flex:1 1 260px;min-width:0;height:36px}
  .pl-audio .m{font-size:12.5px;color:var(--muted,#6b7280)}
  .pl-audio .m.err{color:#b42318}
  .pl-turn .pl-t{cursor:pointer}.pl-turn .pl-t:hover{color:var(--accent,#0f766e);text-decoration:underline}
  .pl-fi{--r:#fdecea;--rb:#f3c9c4;--rt:#a3291f;--a:#fdf3e1;--ab:#efd9ad;--at:#9a5b00;--v:#e8f5ec;--vb:#c3e3cd;--vt:#137a4b;--z:#eaf2fd;--zb:#c9dcf5;--zt:#2350a8;--q:#e6f6f5;--qb:#bfe5e1;--qt:#0f766e;--l:#f1ecfb;--lb:#d9cdf2;--lt:#6b3fb8;--n:#f5f4f1;--nb:#e3e0d8;--nt:#4b4a45;color:#1d1d1b}
  .pl-fi .cat{display:inline-block;font-size:12px;font-weight:650;padding:4px 10px;border-radius:999px;background:#efe8d8;color:#4a4130}
  .pl-fi h2{font-size:clamp(19px,2.6vw,26px);line-height:1.15;margin:8px 0 4px;letter-spacing:-.01em}
  .pl-fi .sub{font-size:13.5px;color:#4b4a45;font-weight:600;margin:0 0 14px}
  .pl-fi .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .pl-fi .b{border-radius:14px;border:1px solid var(--nb);background:var(--n);padding:14px;display:grid;gap:10px;align-content:start;min-width:0}
  .pl-fi .b.w2{grid-column:span 2}.pl-fi .b.w3{grid-column:span 3}
  .pl-fi .b.t-rojo{background:var(--r);border-color:var(--rb)}.pl-fi .b.t-ambar{background:var(--a);border-color:var(--ab)}.pl-fi .b.t-verde{background:var(--v);border-color:var(--vb)}.pl-fi .b.t-azul{background:var(--z);border-color:var(--zb)}.pl-fi .b.t-turquesa{background:var(--q);border-color:var(--qb)}.pl-fi .b.t-violeta{background:var(--l);border-color:var(--lb)}
  .pl-fi .bh{display:flex;align-items:center;gap:8px}.pl-fi .bh svg{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
  .pl-fi .bh b{font-size:15.5px;line-height:1.2}
  .pl-fi .est{justify-self:start;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:650;padding:3px 10px;border-radius:999px;border:1px solid currentColor;background:#fff8}
  .pl-fi .est::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
  .pl-fi .c-rojo{color:var(--rt)}.pl-fi .c-ambar{color:var(--at)}.pl-fi .c-verde{color:var(--vt)}.pl-fi .c-azul{color:var(--zt)}.pl-fi .c-turquesa{color:var(--qt)}.pl-fi .c-violeta{color:var(--lt)}.pl-fi .c-neutro{color:var(--nt)}
  .pl-fi .tx{font-size:13.5px;line-height:1.5;color:#33322e;margin:0}
  .pl-fi .cifs{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
  .pl-fi .cif{background:#fff;border:1px solid #0000000f;border-radius:10px;padding:10px;text-align:center}
  .pl-fi .cif .v{font-size:clamp(20px,2.4vw,26px);font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
  .pl-fi .cif .l{font-size:12px;color:#55534d;margin-top:4px}
  .pl-fi .pro .t{display:flex;justify-content:space-between;font-size:12.5px;color:#4b4a45;margin-bottom:5px}
  .pl-fi .pro .bar{height:7px;border-radius:9px;background:#fff;border:1px solid #0000000f;overflow:hidden}.pl-fi .pro .bar i{display:block;height:100%;background:#5b8fd4;border-radius:9px}
  .pl-fi .caja{background:#fff;border:1px solid #0000000f;border-radius:10px;padding:10px 12px;display:grid;gap:4px}
  .pl-fi .caja .h{font-size:12.5px;color:#55534d;font-weight:650}.pl-fi .caja .p{font-size:13.5px;line-height:1.45}
  .pl-fi .caja .tag{justify-self:start;font-size:11.5px;padding:2px 8px;border:1px dashed #0003;border-radius:999px;margin-top:2px}
  .pl-fi .subs{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
  .pl-fi .st{background:#fff;border:1px solid #0000000f;border-radius:10px;padding:10px 12px;display:grid;gap:5px;align-content:start}
  .pl-fi .st .h{display:flex;justify-content:space-between;align-items:flex-start;gap:6px;flex-wrap:wrap}.pl-fi .st .h b{font-size:14px}
  .pl-fi .st .big{font-size:clamp(22px,3vw,32px);font-weight:800;line-height:1.05}
  .pl-fi .cro{display:grid;gap:0;margin:0;padding:0;list-style:none}
  .pl-fi .cro li{display:grid;grid-template-columns:14px 1fr;gap:10px;padding-bottom:10px;position:relative}
  .pl-fi .cro li::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--qt);margin-top:4px;opacity:.8}
  .pl-fi .cro li:not(:last-child)::after{content:"";position:absolute;left:4.5px;top:16px;bottom:0;width:1px;background:#0002}
  .pl-fi .cro .w{font-weight:700;font-size:13.5px;color:var(--qt)}.pl-fi .cro .q{font-size:13.5px}
  .pl-fi .chips{display:flex;gap:6px;flex-wrap:wrap}.pl-fi .chips span{font-size:12px;background:#fff;border:1px solid #0000001a;border-radius:7px;padding:3px 8px}
  .pl-fi .pie{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid #0000001a;padding-top:8px;font-size:13px}.pl-fi .pie .d{font-weight:650}
  .pl-fi .tar{margin-top:12px;border-radius:14px;border:1px solid var(--zb);background:var(--z);padding:14px}
  .pl-fi .tar .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:10px}
  .pl-fi .per{display:grid;grid-template-columns:34px 1fr;gap:10px}
  .pl-fi .per .av{width:34px;height:34px;border-radius:50%;background:#fff;border:1px solid var(--zb);display:grid;place-items:center;font-weight:700;font-size:14px;color:var(--zt)}
  .pl-fi .per b{font-size:14px}.pl-fi .per ul{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:5px}
  .pl-fi .per li{font-size:13.5px;display:grid;grid-template-columns:16px 1fr;gap:6px}.pl-fi .per li::before{content:"○";color:var(--zt)}
  .pl-fi .pf{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#6b6a63}
  @media (max-width:760px){.pl-fi .grid{grid-template-columns:1fr}.pl-fi .b.w2,.pl-fi .b.w3{grid-column:auto}}
  .pl-sp0{color:#0f766e}.pl-sp1{color:#7c3aed}.pl-sp2{color:#c2410c}.pl-sp3{color:#2563eb}.pl-sp4{color:#be185d}`;
  document.head.appendChild(css2);
  const mmss = (ms) => { const s = Math.floor((Number(ms) || 0) / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(x); };
  const inl = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  function mdHtml(md) {
    const out = []; let list = false;
    const close = () => { if (list) { out.push('</ul>'); list = false; } };
    String(md || '').split('\n').forEach((raw) => {
      const l = raw.replace(/\s+$/, '');
      let m;
      if (!l.trim()) { close(); return; }
      if ((m = /^#{1,2}\s+(.*)$/.exec(l))) { close(); out.push('<h3>' + inl(m[1]) + '</h3>'); return; }
      if ((m = /^#{3,6}\s+(.*)$/.exec(l))) { close(); out.push('<h4>' + inl(m[1]) + '</h4>'); return; }
      if ((m = /^\s*[-*•]\s+\[[ xX]?\]\s+(.*)$/.exec(l))) { if (!list) { out.push('<ul>'); list = true; } out.push('<li class="todo">' + inl(m[1]) + '</li>'); return; }
      if ((m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l))) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inl(m[1]) + '</li>'); return; }
      close(); out.push('<p>' + inl(l) + '</p>');
    });
    close(); return out.join('');
  }
  const ICO = {alerta:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',tendencia:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',personas:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14.5c2 .6 3 2.6 3 5"/>',edificio:'<rect x="4" y="3" width="11" height="18" rx="1"/><path d="M15 9h5v12h-5M8 7h3M8 11h3M8 15h3"/>',calendario:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',tareas:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',euro:'<path d="M17 6a7 7 0 1 0 0 12"/><path d="M4 10h9M4 14h9"/>',idea:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',objetivo:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',documento:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',tienda:'<path d="M4 9h16l-1-5H5z"/><path d="M5 9v11h14V9M10 20v-5h4v5"/>',camion:'<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'};
  const TONOS = ['rojo', 'ambar', 'verde', 'azul', 'turquesa', 'violeta', 'neutro'];
  const tono = (t) => (TONOS.includes(t) ? t : 'neutro');
  const estH = (e) => e && e.texto ? `<span class="est c-${tono(e.tono)}">${esc(e.texto)}</span>` : '';
  function fichaHtml(f) {
    const bl = (Array.isArray(f.bloques) ? f.bloques : []).map((b) => {
      const w = Math.max(1, Math.min(3, Number(b.ancho) || 1));
      let h = `<div class="b t-${tono(b.tono)}${w > 1 ? ' w' + w : ''}"><div class="bh c-${tono(b.tono)}"><svg viewBox="0 0 24 24">${ICO[b.icono] || ICO.documento}</svg><b style="color:#1d1d1b">${esc(b.titulo)}</b></div>`;
      if (b.estado) h += estH(b.estado);
      if (b.texto) h += `<p class="tx">${esc(b.texto)}</p>`;
      if (Array.isArray(b.cifras) && b.cifras.length) h += '<div class="cifs">' + b.cifras.slice(0, 3).map((c) => `<div class="cif"><div class="v c-${tono(c.tono || b.tono)}">${esc(c.valor)}</div><div class="l">${esc(c.texto)}</div></div>`).join('') + '</div>';
      if (b.progreso && b.progreso.texto) h += `<div class="pro"><div class="t"><span>${esc(b.progreso.texto)}</span><span>${esc(b.progreso.derecha || '')}</span></div><div class="bar"><i style="width:${Math.max(2, Math.min(100, Number(b.progreso.valor) || 0))}%"></i></div></div>`;
      if (b.caja && (b.caja.titulo || b.caja.texto)) h += `<div class="caja">${b.caja.titulo ? '<span class="h">' + esc(b.caja.titulo) + '</span>' : ''}${b.caja.texto ? '<span class="p">' + esc(b.caja.texto) + '</span>' : ''}${b.caja.estado ? '<span class="tag">' + esc(b.caja.estado) + '</span>' : ''}</div>`;
      if (Array.isArray(b.subtarjetas) && b.subtarjetas.length) h += '<div class="subs">' + b.subtarjetas.slice(0, 3).map((x) => `<div class="st"><div class="h"><b>${esc(x.titulo)}</b>${estH(x.estado)}</div>${x.cifra ? `<div class="big c-${tono((x.estado && x.estado.tono) || b.tono)}">${esc(x.cifra)}</div>` : ''}${x.texto ? '<p class="tx">' + esc(x.texto) + '</p>' : ''}</div>`).join('') + '</div>';
      if (Array.isArray(b.cronologia) && b.cronologia.length) h += '<ul class="cro">' + b.cronologia.slice(0, 6).map((x) => `<li><div><div class="w">${esc(x.cuando)}</div><div class="q">${esc(x.que)}</div></div></li>`).join('') + '</ul>';
      if (Array.isArray(b.chips) && b.chips.length) h += '<div class="chips">' + b.chips.slice(0, 5).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>';
      if (b.pie && (b.pie.izq || b.pie.der)) h += `<div class="pie"><span>${esc(b.pie.izq || '')}</span><span class="d">${esc(b.pie.der || '')}</span></div>`;
      return h + '</div>';
    }).join('');
    const ta = (Array.isArray(f.tareas) ? f.tareas : []).filter((t) => t && Array.isArray(t.items) && t.items.length);
    const tar = ta.length ? `<div class="tar"><div class="bh c-azul"><svg viewBox="0 0 24 24">${ICO.tareas}</svg><b style="color:#1d1d1b">Plan de acción y tareas pendientes</b></div><div class="cols">` + ta.map((t) => `<div class="per"><span class="av">${esc(String(t.quien || '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(t.quien)}</b><ul>${t.items.slice(0, 6).map((i) => '<li><span>' + esc(i) + '</span></li>').join('')}</ul></div></div>`).join('') + '</div></div>' : '';
    return `<div class="pl-fi">${f.categoria ? '<span class="cat">' + esc(f.categoria) + '</span>' : ''}<h2>${esc(f.titulo || '')}</h2>${f.subtitulo ? '<p class="sub">' + esc(f.subtitulo) + '</p>' : ''}<div class="grid">${bl}</div>${tar}</div>`;
  }
  const nombreDe = (g, w) => (g.nombres && g.nombres[w]) || w || 'Sin nombre';
  const recsDe = (cu) => [...recs.values()].filter((g) => g.asignado && g.asignado.cu === cu).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  // texto para la IA (🔎 y «Terminar reunión»): resumen, índice y transcripción de Plaud
  window.__sqPlaudTexto = (cu, max) => {
    const gs = recsDe(cu); if (!gs.length) return '';
    const t = gs.map((g) => '\n\nGRABACIÓN DEL PLAUD ' + g.hIni + '–' + g.hFin + ':\n'
      + (g.resumenPlaud ? 'RESUMEN DE PLAUD:\n' + g.resumenPlaud + '\n\n' : '')
      + (Array.isArray(g.turnos) && g.turnos.length ? 'TRANSCRIPCIÓN:\n' + g.turnos.map((x) => nombreDe(g, x[1]) + ': ' + x[2]).join('\n') : (g.transcripcion ? 'TRANSCRIPCIÓN:\n' + g.transcripcion : ''))).join('');
    return t.slice(0, max || 60000);
  };
  const panelState = {}; // por reunión: pestaña y búsqueda
  function panel(g) {
    const ps = panelState[g.id] || (panelState[g.id] = { tab: g.ficha ? 'fi' : g.resumenPlaud ? 'res' : 'tx', q: '', open: true });
    const d = document.createElement('details'); d.className = 'pl-pan'; d.open = ps.open;
    d.addEventListener('toggle', () => { ps.open = d.open; });
    const sm = document.createElement('summary');
    sm.innerHTML = `<b>🎙️ Plaud</b><span class="s">${esc(g.nombre || 'Grabación')} · ${esc(g.hIni)}–${esc(g.hFin)} · ${g.minutos || 0} min</span><span class="ch">▾</span>`;
    d.appendChild(sm);
    // audio: el enlace de Plaud caduca en minutos, así que se pide al darle a escuchar (y otra vez si caduca)
    const bar = document.createElement('div'); bar.className = 'pl-audio';
    const msg = document.createElement('span'); msg.className = 'm';
    const ponMsg = (t, err) => { msg.textContent = t || ''; msg.classList.toggle('err', !!err); };
    async function enlace() { const r = await call('audio', { fileId: g.id }); if (!r || !r.url) throw new Error((r && r.error) || 'Sin audio'); return r.url; }
    async function escuchar(ms) {
      try {
        if (!ps.audio) {
          ponMsg('Pidiendo el audio a Plaud…');
          const a = document.createElement('audio'); a.controls = true; a.preload = 'auto'; a.src = await enlace();
          let reintento = 0;
          a.addEventListener('error', async () => { if (reintento++ > 2) { ponMsg('No se ha podido cargar el audio.', true); return; } const t = a.currentTime; try { a.src = await enlace(); a.currentTime = t; a.play().catch(() => {}); } catch (e) { ponMsg(e.message, true); } });
          a.addEventListener('playing', () => ponMsg(''));
          ps.audio = a;
        }
        if (!bar.contains(ps.audio)) { bar.replaceChildren(ps.audio, msg); }
        if (ms != null) { const go = () => { ps.audio.currentTime = Math.max(0, ms / 1000 - 1); ps.audio.play().catch(() => {}); }; if (ps.audio.readyState >= 1) go(); else ps.audio.addEventListener('loadedmetadata', go, { once: true }); }
        else ps.audio.play().catch(() => {});
      } catch (e) { ponMsg(e.message || 'No se ha podido pedir el audio', true); }
    }
    if (ps.audio) bar.append(ps.audio, msg);
    else { const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'pl-btn'; pb.textContent = '▶ Escuchar el audio'; pb.onclick = () => escuchar(); bar.append(pb, msg); }
    d.appendChild(bar);
    const tabs = document.createElement('div'); tabs.className = 'pl-tabs';
    const body = document.createElement('div'); body.className = 'pl-body';
    const turns = Array.isArray(g.turnos) ? g.turnos : [];
    const T = [['fi', 'Ficha'], ['res', 'Resumen'], ['ix', 'Índice'], ['tx', 'Transcripción']].filter(([k]) => k !== 'fi' || g.ficha || g.resumenPlaud).filter(([k]) => k !== 'res' || g.resumenPlaud).filter(([k]) => k !== 'ix' || (g.indice && g.indice.length));
    const spk = [...new Set(turns.map((x) => x[1]))];
    const draw = (jump) => {
      tabs.replaceChildren();
      T.forEach(([k, n]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; if (ps.tab === k) b.className = 'on'; b.onclick = () => { ps.tab = k; draw(); }; tabs.appendChild(b); });
      const sp = document.createElement('span'); sp.className = 'sp'; tabs.appendChild(sp);
      const cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'Copiar';
      cp.title = ps.tab === 'tx' || ps.tab === 'ix' ? 'Copiar la transcripción' : 'Copiar el resumen';
      cp.onclick = async () => { const txt = ps.tab === 'res' || ps.tab === 'fi' ? g.resumenPlaud : turns.length ? turns.map((x) => '[' + mmss(x[0]) + '] ' + nombreDe(g, x[1]) + ': ' + x[2]).join('\n') : g.transcripcion; try { await navigator.clipboard.writeText(txt || ''); cp.textContent = 'Copiado ✓'; } catch (_) { cp.textContent = 'No se pudo copiar'; } setTimeout(() => { cp.textContent = 'Copiar'; }, 1800); };
      tabs.appendChild(cp);
      body.replaceChildren();
      if (ps.tab === 'fi') {
        if (g.ficha) {
          const w = document.createElement('div'); w.innerHTML = fichaHtml(g.ficha); body.appendChild(w);
          const pf = document.createElement('div'); pf.className = 'pl-fi'; pf.innerHTML = '<div class="pf"><span>Ficha hecha por Claude a partir del resumen de Plaud</span></div>';
          const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'pl-btn lnk'; rb.textContent = 'Rehacer ficha';
          rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Rehaciendo… (unos segundos)'; try { const r = await call('ficha', { fileId: g.id }); if (r && r.ficha) { g.ficha = r.ficha; recs.set(g.id, Object.assign({}, recs.get(g.id), { ficha: r.ficha })); draw(); } } catch (err) { rb.textContent = 'No se ha podido: ' + err.message; } };
          pf.firstChild.appendChild(rb); body.appendChild(pf);
        } else {
          const p = document.createElement('div'); p.className = 'pl-st';
          p.textContent = g.fichaError ? 'No se pudo hacer la ficha: ' + g.fichaError : 'La ficha se está preparando a partir del resumen de Plaud (tarda unos minutos).';
          const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'pl-btn'; rb.textContent = 'Hacer la ficha ahora';
          rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Preparando… (unos segundos)'; try { const r = await call('ficha', { fileId: g.id }); if (r && r.ficha) { g.ficha = r.ficha; draw(); } } catch (err) { rb.disabled = false; rb.textContent = 'Reintentar'; p.textContent = 'No se pudo: ' + err.message; } };
          body.append(p, rb);
        }
      } else if (ps.tab === 'res') { const m = document.createElement('div'); m.className = 'pl-md'; m.innerHTML = mdHtml(g.resumenPlaud); body.appendChild(m); }
      else if (ps.tab === 'ix') {
        const ix = document.createElement('div'); ix.className = 'pl-ix';
        g.indice.forEach((o) => { const b = document.createElement('button'); b.innerHTML = `<span class="pl-t">${mmss(o.t)}</span><span>${esc(o.tema)}</span>`; b.onclick = () => { ps.tab = 'tx'; ps.q = ''; draw(o.t); }; ix.appendChild(b); });
        body.appendChild(ix);
      } else {
        const f = document.createElement('input'); f.type = 'search'; f.className = 'pl-find'; f.placeholder = 'Buscar en la transcripción…'; f.value = ps.q;
        f.oninput = () => { ps.q = f.value; paintTx(); };
        body.appendChild(f);
        const tx = document.createElement('div'); tx.className = 'pl-tx'; body.appendChild(tx);
        const paintTx = () => {
          tx.replaceChildren();
          if (!turns.length) { const p = document.createElement('div'); p.className = 'pl-md'; p.innerHTML = '<p>' + esc(g.transcripcion || 'Plaud aún no ha transcrito esta grabación.').replace(/\n/g, '<br>') + '</p>'; tx.appendChild(p); return; }
          const q = ps.q.trim().toLowerCase(); let n = 0;
          turns.forEach((x, i) => {
            if (q && !String(x[2]).toLowerCase().includes(q)) return; n++;
            const r = document.createElement('div'); r.className = 'pl-turn'; r.dataset.t = x[0];
            const txt = q ? esc(x[2]).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (z) => '<mark>' + z + '</mark>') : esc(x[2]);
            r.innerHTML = `<span class="pl-t">${mmss(x[0])}</span><div><span class="w pl-sp${spk.indexOf(x[1]) % 5}" title="Toca para poner el nombre">${esc(nombreDe(g, x[1]))}</span><div>${txt}</div></div>`;
            const tl = r.querySelector('.pl-t'); tl.title = 'Escuchar desde aquí'; tl.onclick = () => escuchar(x[0]);
            r.querySelector('.w').onclick = async () => {
              const nv = prompt('¿Quién es «' + nombreDe(g, x[1]) + '»? (se cambia en toda la transcripción)', nombreDe(g, x[1]) === x[1] ? '' : nombreDe(g, x[1]));
              if (nv == null) return;
              const nombres = Object.assign({}, g.nombres || {}); if (nv.trim()) nombres[x[1]] = nv.trim(); else delete nombres[x[1]];
              await saveRec(g.id, { nombres }).catch(() => {}); g.nombres = nombres; paintTx();
            };
            tx.appendChild(r);
          });
          if (q && !n) { const e = document.createElement('div'); e.className = 'pl-st'; e.textContent = 'Nada coincide con «' + ps.q + '».'; tx.appendChild(e); }
        };
        paintTx();
        if (jump != null) setTimeout(() => {
          const rows = [...tx.querySelectorAll('.pl-turn')]; const r = rows.find((z, i) => Number(z.dataset.t) >= jump - 1500) || rows[rows.length - 1];
          if (r) { r.classList.add('hl'); body.scrollTop = r.offsetTop - body.offsetTop - 8; setTimeout(() => r.classList.remove('hl'), 2500); }
        }, 30);
      }
    };
    draw();
    d.append(tabs, body);
    return d;
  }
  function llenarSlots() {
    document.querySelectorAll('.pl-slot').forEach((s) => {
      const gs = recsDe(s.dataset.cu);
      const firma = gs.map((g) => g.id + ':' + (g.actualizado || '') + ':' + (g.ficha ? g.ficha.creada : '') + ':' + JSON.stringify(g.nombres || {})).join('|');
      if (s.dataset.firma === firma) return;
      s.dataset.firma = firma; s.replaceChildren(...gs.map(panel));
    });
  }
  new MutationObserver(() => { if (document.querySelector('.pl-slot:not([data-firma])')) llenarSlots(); }).observe(document.body, { childList: true, subtree: true });

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
