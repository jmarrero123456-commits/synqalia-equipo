/* Synqalia · Mensajes
   Tres niveles, como en el mockup del Z Fold cerrado:
   1) «Mensajes»: una tarjeta por mensajería (Teams, Synqalia) con sus sin leer y lo que te piden.
   2) Una mensajería: sus conversaciones (Todas · Sin leer · Te piden algo, buscador) y arriba un selector para saltar a otra.
   3) Una conversación: a pantalla completa en el móvil (panel a la derecha en el PC), con el hilo y la caja de respuesta.

   Teams: personal_docs col «teams» (la escribe la sincronización). Visto en Synqalia: col «teams_visto» (firma del último mensaje);
   si llega uno nuevo, la firma cambia y vuelve a «Sin leer». Si el doc trae «mensajes» (lista), se pinta el hilo.
   Synqalia: mensajería interna propia (tablas chats, chat_members, chat_messages; funciones chat_list, chat_open_direct,
   chat_create_group, chat_mark_read, chat_people). Tiempo real con Realtime.
   Synqalia admite fotos (se revisan antes de enviar), notas de voz y emoticonos: ver «fotos, notas de voz y emoticonos».
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
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    smile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
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
    const { data, error } = await sb.from('chat_messages').select('id,chat_id,from_email,body,ref,kind,media,created_at').eq('chat_id', id).order('created_at', { ascending: false }).limit(300);
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
    const oldPane = root.querySelector('.sqm-pane');
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
    if (oldPane && st.open && wide()) root.querySelector('.sqm-pane').replaceWith(oldPane);
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
    media.reset();
    st.open = null; st.keep.clear();
    if (overlay) { overlay.remove(); overlay = null; document.body.classList.remove('sqm-lock'); }
    if (!fromPop && history.state && history.state.sqm) history.back();
    paint();
  }
  let viewerClose = null; // visor de fotos abierto: el botón atrás del móvil lo cierra a él, no la conversación
  addEventListener('popstate', () => { if (viewerClose) { viewerClose(true); return; } if (st.open && !wide()) closeConv(true); });

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
    host.dataset.cid = 't:' + id;
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

  function msgHtml(m, c, mine, showWho, seen) {
    const who = showWho ? `<span class="sqm-bwho">${esc(personName(m.from_email))}</span>` : '';
    const tm = `<span class="sqm-bt">${m.sending ? (m.sending === 'error' ? 'No se ha enviado' : 'Enviando…') : hhmm(m.created_at) + seen}</span>`;
    const md = m.media || {};
    if (m.kind === 'foto' && md.path) {
      const ratio = md.w && md.h ? Math.max(0.5, Math.min(1.6, md.h / md.w)) : 0.75;
      return `<div class="sqm-b sqm-bfoto ${mine ? 'me' : ''}">${who}<button type="button" class="sqm-photo" data-path="${esc(md.path)}" aria-label="Ver la foto" style="aspect-ratio: 1 / ${ratio.toFixed(3)}"><img alt="Foto" data-src="${esc(md.path)}"${m.local ? ` src="${esc(m.local)}"` : ''}></button>${m.body ? `<p>${esc(m.body)}</p>` : ''}${tm}</div>`;
    }
    if (m.kind === 'audio' && md.path) {
      const peaks = Array.isArray(md.peaks) && md.peaks.length ? md.peaks : Array.from({ length: 36 }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i * 1.7)));
      return `<div class="sqm-b sqm-baudio ${mine ? 'me' : ''}">${who}<div class="sqm-audio" data-path="${esc(md.path)}" data-dur="${Number(md.dur) || 0}">
        <button type="button" class="sqm-play" aria-label="Reproducir nota de voz">${ICON.play}</button>
        <span class="sqm-wave" aria-hidden="true">${peaks.map((v) => `<i style="height:${Math.round(18 + 82 * Math.max(0, Math.min(1, v)))}%"></i>`).join('')}</span>
        <span class="sqm-adur">${fmtDur(md.dur)}</span></div>${tm}</div>`;
    }
    return `<div class="sqm-b ${mine ? 'me' : ''}">${who}<p>${esc(m.body)}</p>${tm}</div>`;
  }
  const fmtDur = (d) => { d = Math.max(0, Math.round(Number(d) || 0)); return Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0'); };

  function threadHtml(c) {
    const msgs = st.msgs.get(c.id);
    const members = c.members || [];
    if (!msgs) return '<p class="note">Cargando…</p>';
    if (!msgs.length) return `<p class="sqm-info">${c.kind === 'espacio' ? 'Este es el chat del grupo de trabajo. Todo lo que escribas aquí lo ven todas las personas del grupo.' : 'Aún no hay mensajes. Escribe el primero.'}</p>`;
    let html = '', lastDay = '', lastFrom = '';
    const others = members.filter((m) => m.email !== me);
    const myLast = [...msgs].reverse().find((m) => m.from_email === me && !m.sending);
    msgs.forEach((m) => {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) { html += `<p class="sqm-day">${esc(diaDe(m.created_at))}</p>`; lastDay = day; lastFrom = ''; }
      const mine = m.from_email === me;
      let seen = '';
      if (mine && myLast && m.id === myLast.id && others.length) {
        const who = others.filter((o) => o.read && new Date(o.read) >= new Date(m.created_at)).map((o) => o.name.split(' ')[0]);
        seen = who.length ? (who.length === others.length && others.length > 1 ? ' · Visto por todos' : ' · Visto por ' + who.join(' y ')) : ' · Enviado';
      }
      html += msgHtml(m, c, mine, !mine && c.kind !== 'directo' && m.from_email !== lastFrom, seen);
      lastFrom = m.from_email;
    });
    return html;
  }

  function paintSynqConv(host) {
    const id = st.open, c = st.chats.find((x) => x.id === id);
    if (!c) { closeConv(); return; }
    const members = c.members || [];
    const sub = c.kind === 'directo' ? 'Chat de Synqalia' : `${c.kind === 'espacio' ? 'Grupo de trabajo' : 'Grupo'} · ${members.map((m) => (m.email === me ? 'tú' : m.name.split(' ')[0])).join(', ')}`;
    if (host.dataset.cid !== id || !host.querySelector('.sqm-compose')) {
      host.dataset.cid = id;
      host.innerHTML = `<div class="sqm-conv">
        ${convHead(chatTitle(c), sub, 'synqalia')}
        <div class="sqm-thread"></div>
        <div class="sqm-foot">
          <div class="sqm-emo" hidden></div>
          <div class="sqm-tray" hidden></div>
          <form class="sqm-compose" data-act="synq-send">
            <button type="button" class="sqm-cb" data-act="emoji" aria-label="Emoticonos" aria-expanded="false">${ICON.smile}</button>
            <button type="button" class="sqm-cb" data-act="foto" aria-label="Enviar fotos">${ICON.cam}</button>
            <input type="file" class="sqm-file" accept="image/*" multiple hidden>
            <label class="sr" for="sqm-in">Mensaje</label>
            <textarea id="sqm-in" rows="1" placeholder="${c.kind === 'directo' ? 'Escribe un mensaje…' : 'Escribe al grupo…'}"></textarea>
            <button type="button" class="sqm-send sqm-mic" data-act="grabar" aria-label="Grabar nota de voz">${ICON.mic}</button>
            <button type="submit" class="sqm-send sqm-go" aria-label="Enviar">${ICON.send}</button>
          </form>
          <div class="sqm-rec" hidden>
            <button type="button" class="sqm-ib sqm-rec-x" data-act="rec-cancel" aria-label="Cancelar la grabación">${ICON.trash}</button>
            <span class="sqm-rec-dot" aria-hidden="true"></span><span class="sqm-rec-t" aria-live="off">0:00</span>
            <span class="sqm-rec-wave" aria-hidden="true"></span>
            <button type="button" class="sqm-send" data-act="rec-send" aria-label="Enviar la nota de voz">${ICON.send}</button>
          </div>
        </div></div>`;
      media.syncCompose(host);
      media.paintTray(host);
    } else {
      const sp = host.querySelector('.sqm-ctit span'); if (sp) sp.textContent = sub;
    }
    const th = host.querySelector('.sqm-thread');
    const atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 80 || !th.dataset.done;
    th.innerHTML = threadHtml(c);
    th.dataset.done = '1';
    media.hydrate(th);
    if (atBottom) th.scrollTop = th.scrollHeight;
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


  /* ---------- fotos, notas de voz y emoticonos (chat de Synqalia) ----------
     Archivos en Storage, cubo privado «chat», ruta <id del chat>/<uuid>.<ext> (solo lo ven los integrantes del chat).
     El mensaje lleva kind ('foto' | 'audio') y media {path, mime, w, h, size | dur, peaks}. Se muestran con enlaces firmados de 1 h. */
  const EMOJIS = {
    'Caras': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😍 😘 😎 🤩 🥳 🤔 🤨 😐 😶 🙄 😏 😬 😮 😯 😲 😴 😌 😜 🤪 😝 🤤 😒 😓 😔 😕 🙃 🤑 😷 🤒 🤕 🤧 🥵 🥶 😱 😨 😰 😥 😢 😭 😤 😡 🤬 🤯 😳 🥺 🤗 🤭 🤫 😇 🫡 🫠 🙈 🙉 🙊',
    'Gestos': '👍 👎 👌 🤌 ✌️ 🤞 🤝 🙏 👏 🙌 👐 💪 👋 🤙 👊 ✊ 👉 👈 👆 👇 ☝️ ✋ 🖐️ 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 🔥 ✨ ⭐ 🌟 🎉 🎊',
    'Trabajo': '✅ ☑️ ❌ ⚠️ ❗ ❓ ⏰ ⏳ 📅 📆 📌 📍 📎 📝 📊 📈 📉 💼 📁 📂 🗂️ 📧 📞 📱 💻 🖥️ 🖨️ 💡 🔑 🔒 💶 💰 🧾 🏢 🏬 🚗 ✈️ 🚀 🏁 🎯 🛒 📦 🧴 💇 💇‍♂️ 💈 ✂️ 💅 🪮',
    'Otros': '☕ 🍵 🥐 🍕 🍔 🍷 🍾 🥂 🎂 🎁 🌞 🌧️ ⛅ 🌈 🌴 🏖️ ⚽ 🏆 🎵 📷 🐶 🐱 🌹 🌻 🍀 👀 💤 🆗 🆕 🔝 ➡️ ⬅️ 🔄 ➕ ➖',
  };
  const media = (() => {
    const urls = new Map(); // ruta → {url, exp}
    const tray = []; // fotos preparadas para enviar: {blob, url, w, h}
    let rec = null; // grabación en curso
    let audio = null, audioPath = null, audioEl = null;

    async function signed(path) {
      const hit = urls.get(path);
      if (hit && hit.exp > Date.now() + 60000) return hit.url;
      const { data, error } = await sb.storage.from('chat').createSignedUrl(path, 3600);
      if (error || !data) throw error || new Error('sin enlace');
      urls.set(path, { url: data.signedUrl, exp: Date.now() + 3600 * 1000 });
      return data.signedUrl;
    }
    function hydrate(scope) {
      scope.querySelectorAll('img[data-src]').forEach(async (img) => {
        if (img.getAttribute('src') && !img.getAttribute('src').startsWith('blob:')) return;
        try { const u = await signed(img.dataset.src); const pre = new Image(); pre.onload = () => { img.src = u; }; pre.src = u; } catch { img.alt = 'No se ha podido cargar la foto'; }
      });
      if (audioPath) { const el = scope.querySelector(`.sqm-audio[data-path="${CSS.escape(audioPath)}"]`); if (el) { audioEl = el; setPlayUI(); } }
    }

    /* --- redacción: micrófono si no hay nada que enviar, flecha si hay texto o fotos --- */
    function syncCompose(host) {
      const f = host?.querySelector('.sqm-compose[data-act="synq-send"]'); if (!f) return;
      const has = !!f.querySelector('textarea').value.trim() || tray.length > 0;
      f.classList.toggle('has', has);
    }

    /* --- emoticonos --- */
    const recent = () => { try { return JSON.parse(localStorage.getItem('sq-emoji-recent') || '[]'); } catch { return []; } };
    function toggleEmoji(host, force) {
      const box = host.querySelector('.sqm-emo'), btn = host.querySelector('[data-act="emoji"]');
      const open = force ?? box.hidden;
      if (open) {
        const r = recent();
        const cats = (r.length ? [['Recientes', r]] : []).concat(Object.entries(EMOJIS).map(([k, v]) => [k, v.split(' ')]));
        box.innerHTML = `<div class="sqm-emo-tabs" role="tablist">${cats.map(([k], i) => `<button type="button" role="tab" data-emocat="${i}" aria-selected="${i === 0}">${esc(k)}</button>`).join('')}</div>
          <div class="sqm-emo-grid">${cats.map(([k, list], i) => `<div class="sqm-emo-sec" data-sec="${i}"${i ? ' hidden' : ''}>${list.map((e) => `<button type="button" data-emo="${esc(e)}" aria-label="${esc(e)}">${esc(e)}</button>`).join('')}</div>`).join('')}</div>`;
      }
      box.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    }
    function insertEmoji(host, e) {
      const ta = host.querySelector('#sqm-in');
      const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, a) + e + ta.value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + e.length;
      if (matchMedia('(pointer: fine)').matches) ta.focus();
      grow(ta); syncCompose(host);
      try { const r = [e, ...recent().filter((x) => x !== e)].slice(0, 24); localStorage.setItem('sq-emoji-recent', JSON.stringify(r)); } catch {}
    }

    /* --- fotos: se reducen a 1600 px (JPEG) antes de subir; se revisan en la bandeja antes de enviar --- */
    async function shrink(file) {
      const bmp = await (window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null) : null);
      let w, h, src = bmp;
      if (!bmp) { src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); }); }
      w = src.width; h = src.height;
      const k = Math.min(1, 1600 / Math.max(w, h)); const W = Math.round(w * k), H = Math.round(h * k);
      if (file.type === 'image/gif' && file.size < 8e6) return { blob: file, w, h, mime: 'image/gif', ext: 'gif' };
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(src, 0, 0, W, H);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.84));
      return { blob, w: W, h: H, mime: 'image/jpeg', ext: 'jpg' };
    }
    async function addFiles(host, files) {
      const list = [...files].filter((f) => /^image\//.test(f.type)).slice(0, Math.max(0, 10 - tray.length));
      if (!list.length) return;
      for (const f of list) {
        try { const r = await shrink(f); r.url = URL.createObjectURL(r.blob); tray.push(r); } catch (e) { console.warn(e); alert('No se ha podido abrir una de las fotos.'); }
      }
      paintTray(host); syncCompose(host);
    }
    function paintTray(host) {
      const box = host?.querySelector('.sqm-tray'); if (!box) return;
      box.hidden = !tray.length;
      box.innerHTML = tray.length ? `<div class="sqm-tray-row">${tray.map((t, i) => `<span class="sqm-thumb"><img src="${esc(t.url)}" alt="Foto ${i + 1}"><button type="button" data-untray="${i}" aria-label="Quitar la foto ${i + 1}">${ICON.x}</button></span>`).join('')}
        ${tray.length < 10 ? `<button type="button" class="sqm-thumb add" data-act="foto" aria-label="Añadir más fotos">+</button>` : ''}</div>
        <p class="sqm-hint">${tray.length === 1 ? '1 foto lista' : tray.length + ' fotos listas'}. Si escribes algo, va como pie de foto. Pulsa enviar cuando las hayas revisado.</p>` : '';
    }
    function untray(host, i) { const t = tray.splice(i, 1)[0]; if (t) URL.revokeObjectURL(t.url); paintTray(host); syncCompose(host); }

    async function upload(chatId, blob, mime, ext) {
      const path = `${chatId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from('chat').upload(path, blob, { contentType: mime, upsert: false });
      if (error) throw error;
      return path;
    }
    async function insertMsg(row) {
      const { data, error } = await sb.from('chat_messages').insert(row).select('id,chat_id,from_email,body,ref,kind,media,created_at').single();
      if (error) throw error;
      return data;
    }
    function pushLocal(id, m) { st.msgs.set(id, [...(st.msgs.get(id) || []), m]); paintConv(); }
    function settle(id, tempId, data) {
      const arr = (st.msgs.get(id) || []).filter((m) => m.id !== tempId);
      if (data && !arr.some((m) => m.id === data.id)) arr.push(data);
      st.msgs.set(id, arr);
      const c = st.chats.find((x) => x.id === id);
      if (c && data) { c.last_at = data.created_at; c.last_text = data.kind === 'foto' ? '📷 ' + (data.body || 'Foto') : data.kind === 'audio' ? '🎤 Nota de voz' : data.body; c.last_from = me; }
    }
    function fail(id, tempId) { const m = (st.msgs.get(id) || []).find((x) => x.id === tempId); if (m) m.sending = 'error'; paintConv(); }

    async function sendTray(id, caption) {
      const items = tray.splice(0); paintTray(convHost()); syncCompose(convHost());
      for (let i = 0; i < items.length; i++) {
        const t = items[i], temp = 'tmp' + Date.now() + i, body = i === 0 ? caption : '';
        pushLocal(id, { id: temp, chat_id: id, from_email: me, body, kind: 'foto', media: { path: 'local', w: t.w, h: t.h }, local: t.url, created_at: new Date().toISOString(), sending: true });
        try {
          const path = await upload(id, t.blob, t.mime, t.ext);
          urls.set(path, { url: t.url, exp: Date.now() + 3000 * 1000 }); // mientras tanto se ve la copia local
          const data = await insertMsg({ chat_id: id, body, kind: 'foto', media: { path, mime: t.mime, w: t.w, h: t.h, size: t.blob.size } });
          settle(id, temp, data);
        } catch (e) { console.warn(e); fail(id, temp); alert('No se ha podido enviar una foto: ' + (e.message || e)); }
      }
      paint();
    }

    /* --- notas de voz --- */
    const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    async function startRec(host) {
      if (rec) return;
      if (window.__sqRecording) { alert('Hay una grabación o un dictado en marcha en otra sección: páralo antes de grabar una nota de voz.'); return; }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { alert('Este navegador no permite grabar audio.'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { alert('Synqalia necesita permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.'); return; }
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      rec = { mr, stream, ctx, an, buf, chunks: [], levels: [], t0: Date.now(), host, cancel: false, raf: 0, tick: 0 };
      mr.ondataavailable = (e) => { if (e.data && e.data.size) rec?.chunks.push(e.data); };
      mr.start(250);
      window.__sqRecording = true;
      host.querySelector('.sqm-compose').hidden = true;
      host.querySelector('.sqm-emo').hidden = true;
      const box = host.querySelector('.sqm-rec'); box.hidden = false;
      const wave = box.querySelector('.sqm-rec-wave'); wave.innerHTML = '<i></i>'.repeat(28);
      const bars = [...wave.children], tEl = box.querySelector('.sqm-rec-t');
      const loop = () => {
        if (!rec) return;
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        if (++rec.tick % 3 === 0) { rec.levels.push(lvl); const last = rec.levels.slice(-bars.length); bars.forEach((b, i) => { const v = last[i - (bars.length - last.length)] ?? 0; b.style.height = Math.round(12 + 88 * v) + '%'; }); }
        const secs = (Date.now() - rec.t0) / 1000; tEl.textContent = fmtDur(secs);
        if (secs >= 300) { stopRec(true); return; } // máximo 5 minutos: se envía sola
        rec.raf = requestAnimationFrame(loop);
      };
      loop();
    }
    async function stopRec(send) {
      if (!rec) return;
      const r = rec; rec = null;
      cancelAnimationFrame(r.raf);
      const dur = (Date.now() - r.t0) / 1000;
      const done = new Promise((ok) => { r.mr.onstop = ok; });
      try { r.mr.stop(); } catch {}
      await done;
      r.stream.getTracks().forEach((t) => t.stop()); r.ctx.close().catch(() => {});
      window.__sqRecording = false;
      const host = convHost();
      if (host) { const box = host.querySelector('.sqm-rec'); if (box) box.hidden = true; const f = host.querySelector('.sqm-compose'); if (f) f.hidden = false; }
      if (!send || !st.open || dur < 0.8) return;
      const id = st.open;
      const mime = (r.mr.mimeType || r.chunks[0]?.type || 'audio/webm').split(';')[0];
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(r.chunks, { type: mime });
      const n = 36, L = r.levels.length || 1, peaks = Array.from({ length: n }, (_, i) => { const seg = r.levels.slice(Math.floor(i * L / n), Math.floor((i + 1) * L / n) || undefined); return Math.round(100 * (seg.length ? Math.max(...seg) : 0.2)) / 100; });
      const temp = 'tmp' + Date.now();
      const localUrl = URL.createObjectURL(blob);
      pushLocal(id, { id: temp, chat_id: id, from_email: me, body: '', kind: 'audio', media: { path: 'local:' + temp, dur: Math.round(dur), peaks }, created_at: new Date().toISOString(), sending: true });
      try {
        const path = await upload(id, blob, mime, ext);
        urls.set(path, { url: localUrl, exp: Date.now() + 3000 * 1000 });
        const data = await insertMsg({ chat_id: id, body: '', kind: 'audio', media: { path, mime, dur: Math.round(dur), peaks, size: blob.size } });
        settle(id, temp, data); paint();
      } catch (e) { console.warn(e); fail(id, temp); alert('No se ha podido enviar la nota de voz: ' + (e.message || e)); }
    }

    /* --- reproducir --- */
    function setPlayUI() {
      document.querySelectorAll('.sqm-audio.on').forEach((el) => { if (el !== audioEl) { el.classList.remove('on'); el.querySelector('.sqm-play').innerHTML = ICON.play; el.querySelectorAll('.sqm-wave i.done').forEach((b) => b.classList.remove('done')); el.querySelector('.sqm-adur').textContent = fmtDur(el.dataset.dur); } });
      if (!audioEl || !audio) return;
      const playing = !audio.paused;
      audioEl.classList.toggle('on', true);
      audioEl.querySelector('.sqm-play').innerHTML = playing ? ICON.pause : ICON.play;
      audioEl.querySelector('.sqm-play').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir nota de voz');
      const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(audioEl.dataset.dur) || 1;
      const p = Math.min(1, audio.currentTime / d), bars = audioEl.querySelectorAll('.sqm-wave i');
      bars.forEach((b, i) => b.classList.toggle('done', (i + 0.5) / bars.length <= p));
      audioEl.querySelector('.sqm-adur').textContent = fmtDur(playing || audio.currentTime ? audio.currentTime : audioEl.dataset.dur);
    }
    async function togglePlay(el) {
      const path = el.dataset.path; if (!path || path.startsWith('local')) return;
      if (audio && audioPath === path) { if (audio.paused) audio.play(); else audio.pause(); return; }
      if (audio) { audio.pause(); audio = null; }
      audioPath = path; audioEl = el;
      try {
        audio = new Audio(await signed(path));
        audio.ontimeupdate = audio.onplay = audio.onpause = setPlayUI;
        audio.onended = () => { audio.currentTime = 0; setPlayUI(); if (audioEl) { audioEl.querySelectorAll('.sqm-wave i.done').forEach((b) => b.classList.remove('done')); audioEl.querySelector('.sqm-adur').textContent = fmtDur(audioEl.dataset.dur); } };
        await audio.play();
      } catch (e) { console.warn(e); alert('No se ha podido reproducir la nota de voz.'); }
    }
    function seek(el, x) {
      if (!audio || audioPath !== el.dataset.path || !isFinite(audio.duration)) return;
      const r = el.querySelector('.sqm-wave').getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * audio.duration;
    }

    /* --- ver una foto a pantalla completa --- */
    async function viewPhoto(path) {
      const v = document.createElement('div'); v.className = 'sqm-viewer sqm'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', 'Foto');
      v.innerHTML = `<div class="sqm-vbar"><button type="button" class="sqm-ib" data-vx aria-label="Cerrar">${ICON.x}</button><span></span><a class="sqm-ib" data-vdl aria-label="Descargar la foto" download>${ICON.down}</a></div><img alt="Foto">`;
      document.body.appendChild(v);
      history.pushState({ sqm: 1, sqmv: 1 }, '');
      const close = (fromPop) => { if (!v.isConnected) return; v.remove(); viewerClose = null; removeEventListener('keydown', onKey, true); if (!fromPop && history.state?.sqmv) history.back(); };
      viewerClose = close;
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
      addEventListener('keydown', onKey, true);
      v.addEventListener('click', (e) => { if (e.target.closest('[data-vx]') || e.target === v) close(false); });
      try { const u = await signed(path); v.querySelector('img').src = u; const a = v.querySelector('[data-vdl]'); a.href = u; a.setAttribute('download', path.split('/').pop()); } catch { v.querySelector('img').alt = 'No se ha podido cargar la foto'; }
    }

    function reset() {
      if (rec) stopRec(false);
      tray.splice(0).forEach((t) => URL.revokeObjectURL(t.url));
      if (audio) { audio.pause(); audio = null; audioPath = null; audioEl = null; }
    }
    return { hydrate, syncCompose, toggleEmoji, insertEmoji, addFiles, paintTray, untray, sendTray, startRec, stopRec, togglePlay, seek, viewPhoto, reset, hasTray: () => tray.length > 0, recording: () => !!rec };
  })();

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
    const host = st.open ? convHost() : null;
    if (host && host.contains(t)) {
      if (act === 'emoji') { media.toggleEmoji(host); return; }
      if (act === 'foto') { host.querySelector('.sqm-file')?.click(); return; }
      if (act === 'grabar') { media.startRec(host); return; }
      if (act === 'rec-cancel') { media.stopRec(false); return; }
      if (act === 'rec-send') { media.stopRec(true); return; }
      const emo = t.closest('[data-emo]'); if (emo) { media.insertEmoji(host, emo.dataset.emo); return; }
      const cat = t.closest('[data-emocat]');
      if (cat) { host.querySelectorAll('[data-emocat]').forEach((b) => b.setAttribute('aria-selected', String(b === cat))); host.querySelectorAll('.sqm-emo-sec').forEach((sec) => { sec.hidden = sec.dataset.sec !== cat.dataset.emocat; }); return; }
      const un = t.closest('[data-untray]'); if (un) { media.untray(host, Number(un.dataset.untray)); return; }
      const ph = t.closest('.sqm-photo'); if (ph && !ph.dataset.path.startsWith('local')) { media.viewPhoto(ph.dataset.path); return; }
      const pl = t.closest('.sqm-play'); if (pl) { media.togglePlay(pl.closest('.sqm-audio')); return; }
      const wv = t.closest('.sqm-wave'); if (wv) { media.seek(wv.closest('.sqm-audio'), e.clientX); return; }
    }
    const chip = t.closest('.chips .chip');
    if (chip) { st.f = chip.dataset.f; st.keep.clear(); if (st.open) st.keep.add(st.open); paint(); return; }
    const row = t.closest('.sqm-list .sqm-row');
    if (row) { openConv(row.dataset.id); }
  }
  root.addEventListener('click', onClick);
  document.addEventListener('click', (e) => { if (overlay && overlay.contains(e.target)) onClick(e); });
  document.addEventListener('change', (e) => { if (e.target.matches('.sqm-file')) { const host = convHost(); media.addFiles(host, e.target.files); e.target.value = ''; } });
  // pegar una imagen en el chat también la prepara para enviar
  document.addEventListener('paste', (e) => { if (e.target.id !== 'sqm-in' || st.canal !== 'synqalia') return; const fs = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); media.addFiles(convHost(), fs); } });
  root.addEventListener('input', (e) => { if (e.target.matches('.sqm-search input')) { st.q = e.target.value; const pos = e.target.selectionStart; paintCanal(); const i = root.querySelector('.sqm-search input'); i.focus(); i.setSelectionRange(pos, pos); } });
  const onInput = (e) => { if (e.target.id === 'sqm-in') { grow(e.target); media.syncCompose(e.target.closest('.sqm-conv')?.parentElement); } };
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
    if (!st.open) return;
    const id = st.open;
    const hostC = convHost(); const emo = hostC?.querySelector('.sqm-emo'); if (emo && !emo.hidden) media.toggleEmoji(hostC, false);
    if (media.hasTray()) { ta.value = ''; grow(ta); await media.sendTray(id, body); return; }
    if (!body) return;
    const temp = { id: 'tmp' + Date.now(), chat_id: id, from_email: me, body, kind: 'texto', created_at: new Date().toISOString(), sending: true };
    st.msgs.set(id, [...(st.msgs.get(id) || []), temp]);
    ta.value = ''; grow(ta); media.syncCompose(hostC); paintConv();
    const { data, error } = await sb.from('chat_messages').insert({ chat_id: id, body }).select('id,chat_id,from_email,body,ref,kind,media,created_at').single();
    const arr = (st.msgs.get(id) || []).filter((m) => m.id !== temp.id);
    if (error) { alert('No se ha podido enviar: ' + error.message); ta.value = body; grow(ta); media.syncCompose(hostC); }
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
    paint();
  }).subscribe();

  let reloadT = null;
  const reloadChats = () => { clearTimeout(reloadT); reloadT = setTimeout(async () => { await loadChats(); paint(); }, 250); };
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
    paint();
  });
})();
