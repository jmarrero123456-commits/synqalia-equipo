/* Synqalia · Mensajes
   Tres niveles, como en el mockup del Z Fold cerrado:
   1) «Mensajes»: una tarjeta por mensajería (Teams, Synqalia) con sus sin leer y lo que te piden.
   2) Una mensajería: sus conversaciones (Todas · Sin leer · Te piden algo, buscador) y arriba un selector para saltar a otra.
   3) Una conversación: a pantalla completa en el móvil (panel a la derecha en el PC), con el hilo y la caja de respuesta.

   Teams: personal_docs col «teams» (la escribe la sincronización). Visto en Synqalia: col «teams_visto» (firma del último mensaje);
   si llega uno nuevo, la firma cambia y vuelve a «Sin leer». Si el doc trae «mensajes» (lista), se pinta el hilo.
   Synqalia: mensajería interna propia (tablas chats, chat_members, chat_messages; funciones chat_list, chat_open_direct,
   chat_create_group, chat_mark_read, chat_people). Tiempo real con Realtime.
   WhatsApp: descartado por ahora (19/11/2026); no se muestra. */
(async () => {
  const view = document.getElementById('view-mensajes');
  if (!view || window.__sqMensajes) return;
  window.__sqMensajes = true;
  // «Más» del móvil: muestra cuántas reuniones hay pendientes dentro del menú
  (() => { const src = document.getElementById('count-reuniones'), dst = document.getElementById('more-c-reuniones'), mas = document.getElementById('count-mas');
    if (!src || !dst) return; const sync = () => { dst.textContent = src.textContent; if (mas) mas.textContent = src.textContent; };
    new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true }); sync(); })();

  view.removeAttribute('style');
  view.classList.add('sqm');
  view.innerHTML = '<div class="sqm-root"><p class="note">Cargando mensajes…</p></div>';
  const root = view.querySelector('.sqm-root');

  await window.__sqReady;
  const sb = window.__sb;
  if (!sb) { root.innerHTML = '<p class="note">Sin conexión: los mensajes se ven cuando vuelva la red.</p>'; return; }
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id, me = String(session?.user?.email || '').toLowerCase();
  if (!uid) return;

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && /(^|\.)(microsoft\.com|cloud\.microsoft|office\.com|live\.com|teams\.microsoft\.com|whatsapp\.com)$/i.test(x.hostname) ? x.href : null; } catch { return null; } };
  const isTrue = (v) => v === true || v === 'true';
  const ini = (n) => (String(n || '?').replace(/[^\p{L}\s.&]/gu, ' ').split(/[\s.&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
  const firma = (d) => [d.fecha || '', d.hora || '', norm(d.ultimo)].join('|');
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function cuando(ts) {
    if (!ts) return '';
    const d = new Date(ts); if (isNaN(d)) return String(ts);
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (sameDay(d, y)) return 'Ayer';
    if (now - d < 6 * 864e5) return d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  function diaDe(ts) {
    const d = new Date(ts), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Hoy'; if (sameDay(d, y)) return 'Ayer';
    return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7Z"/><path d="m11 13 9-9"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    q: '<svg viewBox="0 0 48 48" aria-hidden="true" class="q"><circle cx="21" cy="20" r="9.5" fill="none" stroke="currentColor" stroke-width="6"/><path d="M30.5 20v16" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="30.5" cy="44" r="3.6" class="dot"/></svg>',
  };
  const CANALES = {
    teams: { nombre: 'Teams', sub: 'Chats y grupos de Teams', letra: 'T' },
    synqalia: { nombre: 'Synqalia', sub: 'Tu equipo y grupos de trabajo', letra: '' },
  };
  const chIcon = (k, cls = '') => `<span class="sqm-ch sqm-ch-${k} ${cls}" aria-hidden="true">${k === 'synqalia' ? ICON.q : CANALES[k].letra}</span>`;
  const wide = () => matchMedia('(min-width: 1100px)').matches;

  /* ---------- estado ---------- */
  const st = {
    nivel: 'hub', canal: 'teams', f: 'todas', q: '', open: null, keep: new Set(),
    teams: new Map(), visto: new Map(), teamsAt: null,
    chats: [], people: [], msgs: new Map(), // chat id → mensajes
  };

  /* ---------- Teams ---------- */
  const teamsUnread = (id, d) => isTrue(d.noLeido) && st.visto.get(id)?.firma !== firma(d);
  async function loadTeams() {
    const [{ data: rows }, { data: vis }] = await Promise.all([
      sb.from('personal_docs').select('id,data,updated_at').eq('owner', uid).eq('col', 'teams'),
      sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', 'teams_visto'),
    ]);
    st.teams = new Map((rows || []).map((r) => [r.id, r.data || {}]));
    st.visto = new Map((vis || []).map((r) => [r.id, r.data || {}]));
    st.teamsAt = (rows || []).map((r) => r.data?.capturado || r.updated_at).filter(Boolean).sort().pop() || null;
  }
  async function setVisto(id, on) {
    const d = st.teams.get(id); if (!d) return;
    if (on) {
      const v = { firma: firma(d), en: new Date().toISOString(), canal: 'teams' };
      st.visto.set(id, v);
      await sb.from('personal_docs').upsert({ owner: uid, col: 'teams_visto', id, data: v }, { onConflict: 'owner,col,id' });
    } else {
      st.visto.delete(id);
      await sb.from('personal_docs').delete().eq('owner', uid).eq('col', 'teams_visto').eq('id', id);
    }
  }
  function teamsConvs() {
    return [...st.teams.entries()].map(([id, d]) => ({
      id, canal: 'teams', nombre: d.nombre || 'Chat de Teams', texto: d.ultimo || '', cuando: d.hora || '', orden: d.fecha || d.capturado || '',
      unread: teamsUnread(id, d) ? Math.max(1, Number(d.nuevos) || 1) : 0, pide: isTrue(d.pide) ? (d.accion || 'Te piden algo') : '', accion: d.accion || '', grupo: !!d.grupo, d,
    }));
  }

  /* ---------- Synqalia (interno) ---------- */
  const personName = (email) => st.people.find((p) => p.email === email)?.name || (email || '').split('@')[0];
  const firstName = (email) => (email === me ? 'Tú' : personName(email).split(' ')[0]);
  function chatTitle(c) {
    if (c.title) return c.title;
    const others = (c.members || []).filter((m) => m.email !== me);
    return others.map((m) => m.name).join(', ') || 'Chat';
  }
  async function loadChats() {
    const [{ data: chats, error }, { data: people }] = await Promise.all([sb.rpc('chat_list'), st.people.length ? { data: st.people } : sb.rpc('chat_people')]);
    if (error) { console.warn('chat_list', error); return; }
    st.chats = chats || []; st.people = people || [];
  }
  function synqConvs() {
    return st.chats.filter((c) => c.last_at || c.kind !== 'directo' || st.open === c.id).map((c) => ({
      id: c.id, canal: 'synqalia', nombre: chatTitle(c), grupo: c.kind !== 'directo',
      texto: c.last_text ? (c.kind !== 'directo' || c.last_from === me ? firstName(c.last_from) + ': ' : '') + c.last_text : (c.kind === 'espacio' ? 'Chat del grupo de trabajo' : 'Sin mensajes todavía'),
      cuando: cuando(c.last_at), orden: c.last_at || '', unread: c.unread || 0, pide: '', c,
    }));
  }
  async function loadMsgs(id) {
    const { data, error } = await sb.from('chat_messages').select('id,chat_id,from_email,body,ref,created_at').eq('chat_id', id).order('created_at', { ascending: false }).limit(300);
    if (error) { console.warn(error); return; }
    st.msgs.set(id, (data || []).reverse());
  }
  async function markRead(id) {
    const c = st.chats.find((x) => x.id === id); if (!c) return;
    if (c.unread) { c.unread = 0; paintCounts(); }
    await sb.rpc('chat_mark_read', { p_chat: id });
  }

  /* ---------- listas y contadores ---------- */
  const convsDe = (canal) => (canal === 'teams' ? teamsConvs() : canal === 'synqalia' ? synqConvs() : []);
  const sinLeer = (canal) => convsDe(canal).filter((c) => c.unread).length;
  const piden = (canal) => convsDe(canal).filter((c) => c.pide).length;
  function paintCounts() {
    const n = sinLeer('teams') + sinLeer('synqalia');
    const tc = document.getElementById('count-mensajes'); if (tc) tc.textContent = n ? String(n) : '';
  }

  /* ---------- pintar ---------- */
  function paint() {
    paintCounts();
    if (st.nivel === 'hub') return paintHub();
    paintCanal();
  }

  function paintHub() {
    const tot = sinLeer('teams') + sinLeer('synqalia'), pid = piden('teams') + piden('synqalia');
    const card = (k) => {
      const C = CANALES[k];
      const cs = convsDe(k).sort((a, b) => (b.unread - a.unread) || String(b.orden).localeCompare(String(a.orden)));
      const top = cs[0], n = cs.filter((c) => c.unread).length, p = cs.filter((c) => c.pide).length;
      return `<button type="button" class="sqm-card" data-canal="${k}">
        <span class="sqm-card-top">${chIcon(k, 'lg')}<span class="sqm-card-name"><b>${C.nombre}</b><span>${C.sub}</span></span>
          <span class="sqm-card-n">${n ? `<b>${n}</b><span>sin leer</span>` : '<span class="ok">Al día</span>'}</span><span class="sqm-chev">${ICON.next}</span></span>
        ${top ? `<span class="sqm-card-prev"><b>${esc(top.nombre)}:</b> ${esc(top.texto)}</span>` : `<span class="sqm-card-prev">${k === 'teams' ? 'Aún no hay chats sincronizados.' : 'Escribe a tu equipo desde aquí.'}</span>`}
        ${p ? `<span class="sqm-pide">${p} te piden algo</span>` : ''}</button>`;
    };
    root.innerHTML = `<div class="sqm-hub">
      <p class="sqm-sum">${tot ? `<b>${tot}</b> conversaciones sin leer` : 'Todo leído'}${pid ? ` · <b>${pid}</b> te piden algo` : ''}</p>
      <div class="sqm-cards">${card('teams')}${card('synqalia')}</div>
      ${st.teamsAt ? `<p class="note sqm-upd">Teams sincronizado: ${esc(new Date(st.teamsAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>` : ''}
    </div>`;
  }

  function rowsDe() {
    let rows = convsDe(st.canal);
    const pass = (c) => st.keep.has(c.id);
    if (st.f === 'sinleer') rows = rows.filter((c) => c.unread || pass(c));
    if (st.f === 'pide') rows = rows.filter((c) => c.pide || pass(c));
    const q = norm(st.q);
    if (q) rows = rows.filter((c) => norm([c.nombre, c.texto, c.accion].join(' ')).includes(q));
    return rows.sort((a, b) => ((b.unread ? 1 : 0) - (a.unread ? 1 : 0)) || String(b.orden).localeCompare(String(a.orden)));
  }

  function paintCanal() {
    const k = st.canal, C = CANALES[k];
    const sw = ['teams', 'synqalia'].map((x) => {
      const n = sinLeer(x);
      return `<button type="button" data-canal="${x}" aria-pressed="${x === k}">${CANALES[x].nombre}${n ? ` <span>${n}</span>` : ''}</button>`;
    }).join('');
    const rows = rowsDe();
    let list;
    if (!rows.length) {
      const all = convsDe(k).length;
      list = `<p class="note sqm-none">${all ? 'Nada en esta vista.' : k === 'teams' ? 'Aún no hay chats de Teams sincronizados.' : 'Todavía no tienes conversaciones. Pulsa «Nuevo» para escribir a alguien.'}</p>`;
    } else {
      list = rows.map((c) => `<button type="button" class="sqm-row${c.unread ? ' unread' : ''}${st.open === c.id ? ' sel' : ''}" data-id="${esc(c.id)}">
        <span class="sqm-av${c.grupo ? ' grp' : ''} sqm-av-${k}">${esc(ini(c.nombre))}</span>
        <span class="sqm-rmain"><span class="sqm-r1"><span class="sqm-name">${esc(c.nombre)}</span><span class="sqm-when">${esc(c.cuando)}</span></span>
          <span class="sqm-r2"><span class="sqm-txt">${esc(c.texto)}</span>${c.unread ? `<span class="sqm-badge">${c.unread}</span>` : ''}</span>
          ${c.pide ? `<span class="sqm-pide">${esc(c.pide.length > 70 ? c.pide.slice(0, 68) + '…' : c.pide)}</span>` : ''}</span></button>`).join('');
    }
    const f = (id, t) => `<button type="button" class="chip" data-f="${id}" aria-pressed="${st.f === id}">${t}</button>`;
    root.innerHTML = `<div class="sqm-canal${st.open && wide() ? ' split' : ''}">
      <div class="sqm-side">
        <div class="sqm-stick">
        <div class="sqm-head">
          <button type="button" class="sqm-ib" data-act="hub" aria-label="Volver a Mensajes">${ICON.back}</button>
          ${chIcon(k)}<h2>${C.nombre}</h2>
          ${k === 'synqalia' ? `<button type="button" class="sqm-new" data-act="nuevo">${ICON.pen}<span>Nuevo</span></button>` : ''}
        </div>
        <div class="sqm-switch" role="group" aria-label="Cambiar de mensajería">${sw}</div>
        ${`<div class="sqm-tools"><div class="chips" role="group" aria-label="Filtrar">${f('todas', 'Todas')}${f('sinleer', 'Sin leer')}${k === 'teams' ? f('pide', 'Te piden algo') : ''}</div>
          <label class="sqm-search">${ICON.search}<span class="sr">Buscar</span><input type="search" placeholder="Buscar persona o mensaje" value="${esc(st.q)}"></label></div>`}
        </div>
        <div class="sqm-list">${list}</div>
      </div>
      <div class="sqm-pane"></div>
    </div>`;
    if (st.open) paintConv();
  }

  /* ---------- conversación ---------- */
  let overlay = null;
  function convHost() {
    if (wide()) { const p = root.querySelector('.sqm-pane'); if (overlay) { overlay.remove(); overlay = null; document.body.classList.remove('sqm-lock'); } return p; }
    if (!overlay) {
      overlay = document.createElement('div'); overlay.className = 'sqm-overlay sqm'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay); document.body.classList.add('sqm-lock');
    }
    return overlay;
  }
  function closeConv(fromPop) {
    st.open = null; st.keep.clear();
    if (overlay) { overlay.remove(); overlay = null; document.body.classList.remove('sqm-lock'); }
    if (!fromPop && history.state && history.state.sqm) history.back();
    paint();
  }
  addEventListener('popstate', () => { if (st.open && !wide()) closeConv(true); });

  async function openConv(id) {
    st.open = id; st.keep.add(id);
    if (!wide() && !(history.state && history.state.sqm)) history.pushState({ sqm: 1 }, '');
    if (st.canal === 'teams') {
      const d = st.teams.get(id);
      if (d && teamsUnread(id, d)) setVisto(id, true); // abrirla basta para darla por leída
    } else if (st.canal === 'synqalia') {
      if (!st.msgs.has(id)) { paint(); await loadMsgs(id); }
      markRead(id);
    }
    paint();
  }

  function paintConv() {
    const host = convHost(); if (!host) return;
    if (st.canal === 'teams') return paintTeamsConv(host);
    if (st.canal === 'synqalia') return paintSynqConv(host);
  }

  function convHead(nombre, sub, k, extra = '') {
    return `<div class="sqm-chead">
      <button type="button" class="sqm-ib" data-act="cerrar" aria-label="Volver">${ICON.back}</button>
      <span class="sqm-av sqm-av-${k}">${esc(ini(nombre))}</span>
      <span class="sqm-ctit"><b>${esc(nombre)}</b><span>${esc(sub)}</span></span>${extra}</div>`;
  }

  function paintTeamsConv(host) {
    const id = st.open, d = st.teams.get(id);
    if (!d) { closeConv(); return; }
    const url = safeUrl(d.enlace);
    const msgs = Array.isArray(d.mensajes) ? d.mensajes : null;
    const bubbles = msgs && msgs.length
      ? msgs.map((m) => `<div class="sqm-b ${m.mio ? 'me' : ''}">${!m.mio && m.de ? `<span class="sqm-bwho">${esc(m.de)}</span>` : ''}<p>${esc(m.texto)}</p><span class="sqm-bt">${esc(m.hora || '')}</span></div>`).join('')
      : `<div class="sqm-b"><p>${esc(d.ultimo || '—')}</p><span class="sqm-bt">${esc(d.hora || '')}</span></div>
         <p class="sqm-info">Por ahora Synqalia solo recibe el último mensaje de cada chat. El hilo completo y responder desde aquí llegan al conectar Microsoft 365.</p>`;
    host.innerHTML = `<div class="sqm-conv">
      ${convHead(d.nombre || 'Chat de Teams', 'Chat de Teams', 'teams', url ? `<a class="sqm-ib" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Abrir en Teams" title="Abrir en Teams">${ICON.ext}</a>` : '')}
      ${d.accion ? `<div class="sqm-ask${isTrue(d.pide) ? ' pide' : ''}"><span class="sqm-pide">${isTrue(d.pide) ? 'Te pide algo' : 'Resumen'}</span><p>${esc(d.accion)}</p></div>` : ''}
      <div class="sqm-thread">${bubbles}</div>
      <div class="sqm-foot">
        ${isTrue(d.noLeido) ? '<button type="button" class="sqm-link" data-act="noleido">Marcar como no leído</button>' : ''}
        <form class="sqm-compose" data-act="teams-copy"><label class="sr" for="sqm-in">Respuesta</label>
          <textarea id="sqm-in" rows="1" placeholder="Escribe la respuesta…"></textarea>
          <button type="submit" class="sqm-send" aria-label="Copiar y abrir en Teams" title="Copia el texto y abre el chat en Teams">${ICON.ext}</button></form>
        <p class="sqm-hint">Hasta conectar Microsoft 365, al pulsar se copia tu respuesta y se abre el chat en Teams para pegarla.</p>
      </div></div>`;
  }

  function paintSynqConv(host) {
    const id = st.open, c = st.chats.find((x) => x.id === id);
    if (!c) { closeConv(); return; }
    const msgs = st.msgs.get(id);
    const members = c.members || [];
    const sub = c.kind === 'directo' ? 'Chat de Synqalia' : `${c.kind === 'espacio' ? 'Grupo de trabajo' : 'Grupo'} · ${members.map((m) => (m.email === me ? 'tú' : m.name.split(' ')[0])).join(', ')}`;
    let html = '';
    if (!msgs) html = '<p class="note">Cargando…</p>';
    else if (!msgs.length) html = `<p class="sqm-info">${c.kind === 'espacio' ? 'Este es el chat del grupo de trabajo. Todo lo que escribas aquí lo ven todas las personas del grupo.' : 'Aún no hay mensajes. Escribe el primero.'}</p>`;
    else {
      let lastDay = '', lastFrom = '';
      const others = members.filter((m) => m.email !== me);
      const myLast = [...msgs].reverse().find((m) => m.from_email === me);
      msgs.forEach((m) => {
        const day = new Date(m.created_at).toDateString();
        if (day !== lastDay) { html += `<p class="sqm-day">${esc(diaDe(m.created_at))}</p>`; lastDay = day; lastFrom = ''; }
        const mine = m.from_email === me;
        let seen = '';
        if (mine && myLast && m.id === myLast.id && others.length) {
          const who = others.filter((o) => o.read && new Date(o.read) >= new Date(m.created_at)).map((o) => o.name.split(' ')[0]);
          seen = who.length ? (who.length === others.length && others.length > 1 ? ' · Visto por todos' : ' · Visto por ' + who.join(' y ')) : ' · Enviado';
        }
        html += `<div class="sqm-b ${mine ? 'me' : ''}">${!mine && c.kind !== 'directo' && m.from_email !== lastFrom ? `<span class="sqm-bwho">${esc(personName(m.from_email))}</span>` : ''}<p>${esc(m.body)}</p><span class="sqm-bt">${hhmm(m.created_at)}${seen}</span></div>`;
        lastFrom = m.from_email;
      });
    }
    const prevIn = host.querySelector('#sqm-in')?.value || '';
    host.innerHTML = `<div class="sqm-conv">
      ${convHead(chatTitle(c), sub, 'synqalia')}
      <div class="sqm-thread">${html}</div>
      <div class="sqm-foot"><form class="sqm-compose" data-act="synq-send"><label class="sr" for="sqm-in">Mensaje</label>
        <textarea id="sqm-in" rows="1" placeholder="${c.kind === 'directo' ? 'Escribe un mensaje…' : 'Escribe al grupo…'}"></textarea>
        <button type="submit" class="sqm-send" aria-label="Enviar">${ICON.send}</button></form></div></div>`;
    const ta = host.querySelector('#sqm-in'); if (prevIn) { ta.value = prevIn; grow(ta); }
    const th = host.querySelector('.sqm-thread'); th.scrollTop = th.scrollHeight;
  }

  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }

  /* ---------- nuevo chat ---------- */
  function nuevoChat() {
    const dlg = document.createElement('div'); dlg.className = 'sqm-overlay sqm sqm-dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Nuevo mensaje');
    const people = st.people.filter((p) => p.email !== me);
    let grupo = false;
    const paintDlg = () => {
      dlg.innerHTML = `<div class="sqm-conv">
        <div class="sqm-chead"><button type="button" class="sqm-ib" data-x aria-label="Cerrar">${ICON.x}</button><span class="sqm-ctit"><b>${grupo ? 'Nuevo grupo' : 'Nuevo mensaje'}</b><span>${grupo ? 'Elige el nombre y las personas' : 'Elige a quién escribir'}</span></span></div>
        <div class="sqm-dlg-body">
          ${grupo ? '<label class="sqm-field"><span>Nombre del grupo</span><input id="sqm-gname" type="text" maxlength="80" placeholder="Ej.: Aperturas Valencia"></label>' : '<button type="button" class="sqm-row sqm-mk" data-grupo><span class="sqm-av grp sqm-av-synqalia">+</span><span class="sqm-rmain"><span class="sqm-name">Crear un grupo</span><span class="sqm-txt">Varias personas en el mismo chat</span></span></button>'}
          ${people.map((p) => grupo
            ? `<label class="sqm-row sqm-pick"><input type="checkbox" value="${esc(p.email)}"><span class="sqm-av sqm-av-synqalia">${esc(ini(p.name))}</span><span class="sqm-rmain"><span class="sqm-name">${esc(p.name)}</span><span class="sqm-txt">${p.activated ? esc(p.email) : 'Aún no ha entrado en Synqalia'}</span></span></label>`
            : `<button type="button" class="sqm-row" data-to="${esc(p.email)}"><span class="sqm-av sqm-av-synqalia">${esc(ini(p.name))}</span><span class="sqm-rmain"><span class="sqm-name">${esc(p.name)}</span><span class="sqm-txt">${p.activated ? esc(p.email) : 'Aún no ha entrado en Synqalia: lo verá al entrar'}</span></span></button>`).join('')}
        </div>
        ${grupo ? '<div class="sqm-foot"><button type="button" class="btn primary sqm-wide" data-crear>Crear grupo</button></div>' : ''}</div>`;
    };
    paintDlg();
    document.body.appendChild(dlg); document.body.classList.add('sqm-lock');
    const close = () => { dlg.remove(); if (!overlay) document.body.classList.remove('sqm-lock'); };
    dlg.addEventListener('click', async (e) => {
      if (e.target.closest('[data-x]')) return close();
      if (e.target.closest('[data-grupo]')) { grupo = true; paintDlg(); return; }
      const to = e.target.closest('[data-to]');
      if (to) {
        const { data: cid, error } = await sb.rpc('chat_open_direct', { p_email: to.dataset.to });
        if (error) { alert('No se ha podido abrir el chat: ' + error.message); return; }
        close(); await loadChats(); st.canal = 'synqalia'; st.nivel = 'canal'; openConv(cid); return;
      }
      if (e.target.closest('[data-crear]')) {
        const name = dlg.querySelector('#sqm-gname').value.trim();
        const emails = [...dlg.querySelectorAll('.sqm-pick input:checked')].map((i) => i.value);
        if (!name) { dlg.querySelector('#sqm-gname').focus(); return; }
        if (!emails.length) { alert('Elige al menos una persona.'); return; }
        const { data: cid, error } = await sb.rpc('chat_create_group', { p_title: name, p_emails: emails });
        if (error) { alert('No se ha podido crear el grupo: ' + error.message); return; }
        close(); await loadChats(); st.canal = 'synqalia'; st.nivel = 'canal'; openConv(cid);
      }
    });
  }

  /* ---------- eventos ---------- */
  async function onClick(e) {
    const t = e.target;
    const canalBtn = t.closest('[data-canal]');
    if (canalBtn) { st.canal = CANALES[canalBtn.dataset.canal] ? canalBtn.dataset.canal : 'teams'; st.nivel = 'canal'; st.f = 'todas'; st.q = ''; st.keep.clear(); if (st.open) closeConv(); else paint(); scrollTo(0, 0); return; }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'hub') { if (st.open) closeConv(); st.nivel = 'hub'; paint(); scrollTo(0, 0); return; }
    if (act === 'cerrar') { closeConv(); return; }
    if (act === 'nuevo') { nuevoChat(); return; }
    if (act === 'noleido') { const id = st.open; await setVisto(id, false); closeConv(); return; }
    const chip = t.closest('.chips .chip');
    if (chip) { st.f = chip.dataset.f; st.keep.clear(); if (st.open) st.keep.add(st.open); paint(); return; }
    const row = t.closest('.sqm-list .sqm-row');
    if (row) { openConv(row.dataset.id); }
  }
  root.addEventListener('click', onClick);
  document.addEventListener('click', (e) => { if (overlay && overlay.contains(e.target)) onClick(e); });
  root.addEventListener('input', (e) => { if (e.target.matches('.sqm-search input')) { st.q = e.target.value; const pos = e.target.selectionStart; paintCanal(); const i = root.querySelector('.sqm-search input'); i.focus(); i.setSelectionRange(pos, pos); } });
  const onInput = (e) => { if (e.target.id === 'sqm-in') grow(e.target); };
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'sqm-in' && e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); e.target.form.requestSubmit(); }
    if (e.key === 'Escape' && st.open && !document.querySelector('.sqm-dlg')) closeConv();
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('.sqm-compose'); if (!f) return;
    e.preventDefault();
    const ta = f.querySelector('textarea'), body = ta.value.trim();
    if (f.dataset.act === 'teams-copy') {
      const d = st.teams.get(st.open), url = safeUrl(d?.enlace) || 'https://teams.microsoft.com/v2/';
      if (body) { try { await navigator.clipboard.writeText(body); } catch {} }
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (!body || !st.open) return;
    const id = st.open, temp = { id: 'tmp' + Date.now(), chat_id: id, from_email: me, body, created_at: new Date().toISOString() };
    st.msgs.set(id, [...(st.msgs.get(id) || []), temp]);
    ta.value = ''; grow(ta); paintConv();
    const { data, error } = await sb.from('chat_messages').insert({ chat_id: id, body }).select('id,chat_id,from_email,body,ref,created_at').single();
    const arr = (st.msgs.get(id) || []).filter((m) => m.id !== temp.id);
    if (error) { alert('No se ha podido enviar: ' + error.message); ta.value = body; }
    else if (!arr.some((m) => m.id === data.id)) arr.push(data);
    st.msgs.set(id, arr);
    const c = st.chats.find((x) => x.id === id); if (c && data) { c.last_at = data.created_at; c.last_text = data.body; c.last_from = me; }
    paint();
  });
  // tocar «Mensajes» estando dentro vuelve a las tarjetas
  document.getElementById('tab-mensajes')?.addEventListener('click', () => { if (!view.hidden && st.nivel !== 'hub') { if (st.open) closeConv(); st.nivel = 'hub'; paint(); } });
  let wasWide = wide();
  addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); if (st.open) paint(); } });

  /* ---------- tiempo real ---------- */
  sb.channel('sq-mensajes-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row) return;
    if (row.col === 'teams_visto') { if (p.eventType === 'DELETE') st.visto.delete(row.id); else st.visto.set(row.id, row.data || {}); }
    else if (row.col === 'teams') { if (p.eventType === 'DELETE') st.teams.delete(row.id); else { st.teams.set(row.id, row.data || {}); st.teamsAt = row.data?.capturado || st.teamsAt; } }
    else return;
    if (!document.activeElement || document.activeElement.id !== 'sqm-in') paint(); else paintCounts();
  }).subscribe();

  let reloadT = null;
  const reloadChats = () => { clearTimeout(reloadT); reloadT = setTimeout(async () => { await loadChats(); if (!document.activeElement || document.activeElement.id !== 'sqm-in' || st.canal !== 'synqalia') paint(); else paintCounts(); }, 250); };
  sb.channel('sq-chat-' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (p) => {
      const m = p.new; if (!m) return;
      if (st.msgs.has(m.chat_id)) { const arr = st.msgs.get(m.chat_id); if (!arr.some((x) => x.id === m.id)) { arr.push(m); } }
      if (st.open === m.chat_id && st.canal === 'synqalia' && m.from_email !== me && !document.hidden) markRead(m.chat_id);
      reloadChats();
      if (st.open === m.chat_id) paintConv();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, reloadChats)
    .subscribe();

  await Promise.all([loadTeams(), loadChats()]);
  paint();
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    await Promise.all([loadTeams(), loadChats()]);
    if (st.open && st.canal === 'synqalia') { await loadMsgs(st.open); markRead(st.open); }
    if (!document.activeElement || document.activeElement.id !== 'sqm-in') paint();
  });
})();
