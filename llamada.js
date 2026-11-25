/* Synqalia · Videollamadas desde el chat (25/11/2026)
   - Botón de cámara en la cabecera de un chat de Synqalia → «Videollamada en Synqalia» o «Reunión de Teams ahora».
   - Synqalia: sala propia con LiveKit (librería livekit-client cargada solo al llamar). Personas y grupos.
   - Teams: reunion/teamsAhora crea la reunión al momento (sin convocar a nadie) y el enlace se deja en el chat.
   - Servidor: función «llamada» (iniciar, unirse, salir, rechazar) + tabla calls (RLS: integrantes del chat; Realtime).
   - Llamada entrante: aviso con «Contestar» / «Rechazar» mientras Synqalia está abierta (45 s).
   API: window.__sqLlamada = { menu(chatId, btn, opts), bubble(m, mine), hydrate(scope), start(chatId, proveedor, titulo), join(callId) } */
(async () => {
  const sb = window.__sb;
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const me = String(session?.user?.email || '').toLowerCase();
  if (!me) return;

  const LK_SRC = 'https://cdn.jsdelivr.net/npm/livekit-client@2.25.0/dist/livekit-client.umd.js';
  const RING_MS = 45000;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ini = (n) => (String(n || '?').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const I = {
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/></svg>',
    videoOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10 6h3.5A2.5 2.5 0 0 1 16 8.5V12m0 4a2.5 2.5 0 0 1-2.5 2H5.5A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5 6.05"/><path d="m16 10.5 5-3v9l-3-1.8"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.8-1"/><path d="M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3"/></svg>',
    flip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9.5 13.5a2.5 2.5 0 0 0 4.6 1.3M14.5 12.5a2.5 2.5 0 0 0-4.6-1.3"/></svg>',
    screen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M12 13V7M9 10l3-3 3 3"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14.5c5-4.7 13-4.7 18 0l-2.4 2.6-3.3-1.5v-2.8a11 11 0 0 0-6.6 0v2.8l-3.3 1.5z" fill="currentColor" stroke="none"/></svg>',
    min: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
    teams: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="M6.5 9.5h5M9 9.5V15"/><circle cx="18" cy="8" r="2"/><path d="M16 12h4.5v4a2.5 2.5 0 0 1-4.5 1.5"/></svg>',
  };

  // personas (nombres) y configuración del servidor
  let people = new Map();
  sb.from('members').select('email,name').then(({ data }) => { people = new Map((data || []).map((p) => [String(p.email).toLowerCase(), p.name])); });
  const nameOf = (e) => people.get(String(e || '').toLowerCase()) || String(e || '').split('@')[0];
  const first = (e) => (e === me ? 'Tú' : nameOf(e).split(' ')[0]);

  async function api(action, body = {}) {
    const { data, error } = await sb.functions.invoke('llamada', { body: { action, ...body } });
    if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
    return data;
  }
  let cfg = null;
  const config = async () => { if (!cfg) cfg = api('config').catch(() => ({ synqalia: false })); return cfg; };

  /* ---------- estado de las llamadas (para las burbujas del chat) ---------- */
  const calls = new Map();
  const activa = (c) => c && !c.ended_at && (Date.now() - new Date(c.started_at)) / 36e5 < (c.proveedor === 'teams' ? 2 : 4);
  const dur = (c) => { const m = Math.max(1, Math.round((new Date(c.ended_at) - new Date(c.started_at)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const teamsUrl = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && /(^|\.)teams\.(microsoft|live)\.com$/i.test(x.hostname) ? x.href : null; } catch { return null; } };

  function bubbleInner(c, mine) {
    if (!c) return '<span class="sqv-bt">📹 Videollamada</span>';
    if (c.proveedor === 'teams') {
      const u = teamsUrl(c.join_url);
      return `<span class="sqv-bt">${I.teams}<b>Reunión de Teams</b></span>
        ${activa(c) && u ? `<a class="sqv-join teams" href="${esc(u)}" target="_blank" rel="noopener">Unirse en Teams</a>` : '<span class="sqv-bs">Terminada</span>'}`;
    }
    if (activa(c)) {
      const dentro = c.participants || [];
      const yo = dentro.includes(me) && room && cur && cur.id === c.id;
      return `<span class="sqv-bt">${I.video}<b>Videollamada</b></span>
        <span class="sqv-bs">${dentro.length ? `En curso · ${dentro.map(first).join(', ')}` : 'Llamando…'}</span>
        ${yo ? '<button type="button" class="sqv-join" data-sqv-volver>Volver a la llamada</button>' : `<button type="button" class="sqv-join" data-sqv-unirse="${esc(c.id)}">Unirse</button>`}`;
    }
    const otros = (c.joined || []).filter((e) => e !== c.started_by);
    const txt = otros.length ? `Terminada · ${dur(c)}` : (c.declined || []).length ? (mine ? `${(c.declined || []).map(first).join(', ')} no ha podido atender` : 'Rechazada') : (mine ? 'Sin respuesta' : 'Llamada perdida');
    return `<span class="sqv-bt">${I.video}<b>Videollamada</b></span><span class="sqv-bs${!otros.length && !mine ? ' lost' : ''}">${esc(txt)}</span>`;
  }
  // burbuja de un mensaje kind='llamada' (la pinta mensajes.js)
  function bubble(m, mine) {
    const id = m?.ref?.llamada || '';
    return `<div class="sqv-bub" data-sqcall="${esc(id)}" data-mine="${mine ? 1 : ''}">${bubbleInner(calls.get(id), mine)}</div>`;
  }
  async function hydrate(scope = document) {
    const els = [...scope.querySelectorAll('[data-sqcall]')];
    const falta = [...new Set(els.map((e) => e.dataset.sqcall).filter((id) => id && !calls.has(id)))];
    if (falta.length) {
      const { data } = await sb.from('calls').select('*').in('id', falta.slice(0, 100));
      (data || []).forEach((c) => calls.set(c.id, c));
    }
    els.forEach((e) => { const c = calls.get(e.dataset.sqcall); if (c) e.innerHTML = bubbleInner(c, !!e.dataset.mine); });
  }

  /* ---------- menú «Videollamada» ---------- */
  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };
  async function menu(chatId, btn, opts = {}) {
    if (menuEl) { closeMenu(); return; }
    const c = await config();
    menuEl = document.createElement('div');
    menuEl.className = 'sqv-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = `
      <button type="button" role="menuitem" data-sqv="synqalia" ${c.synqalia ? '' : 'disabled'}>${I.video}<span><b>Videollamada en Synqalia</b><small>${c.synqalia ? (opts.grupo ? 'Con todo el grupo, aquí mismo' : 'Aquí mismo, con cámara y micro') : 'Falta configurar el servidor de vídeo'}</small></span></button>
      <button type="button" role="menuitem" data-sqv="teams" ${opts.graph ? '' : 'disabled'}>${I.teams}<span><b>Reunión de Teams ahora</b><small>${opts.graph ? 'Deja el enlace en el chat y abre Teams' : 'Conecta Microsoft 365 para usarla'}</small></span></button>`;
    document.body.appendChild(menuEl);
    const r = btn.getBoundingClientRect();
    menuEl.style.top = `${Math.round(r.bottom + 6)}px`;
    menuEl.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    menuEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sqv]'); if (!b || b.disabled) return;
      closeMenu();
      start(chatId, b.dataset.sqv, opts.titulo || 'Chat');
    });
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (menuEl && !menuEl.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off); } }), 0);
  }

  /* ---------- iniciar / unirse ---------- */
  async function start(chatId, proveedor, titulo) {
    if (proveedor === 'teams') {
      const w = window.open('', '_blank'); // abrir ya la ventana (si no, el navegador la bloquea tras esperar)
      try {
        const { data, error } = await sb.functions.invoke('reuniones', { body: { action: 'teamsAhora', titulo: `Videollamada · ${titulo}` } });
        if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
        const r = await api('iniciar', { chat_id: chatId, proveedor: 'teams', join_url: data.unirse });
        if (r.call) calls.set(r.call.id, r.call);
        const u = teamsUrl(r.call?.join_url || data.unirse);
        if (w && u) w.location.href = u; else if (u) window.open(u, '_blank', 'noopener'); else w?.close();
      } catch (e) { w?.close(); alert('No se ha podido crear la reunión de Teams: ' + e.message); }
      return;
    }
    if (room) { show(); return; }
    openUI({ titulo, estado: 'Conectando…' });
    try {
      const r = await api('iniciar', { chat_id: chatId, proveedor: 'synqalia' });
      await connect(r, titulo);
    } catch (e) { fail(e); }
  }
  async function join(callId) {
    if (room && cur && cur.id === callId) { show(); return; }
    if (room) { if (!confirm('Ya estás en otra llamada. ¿Colgarla y entrar en esta?')) return; await hangup(); }
    stopRing();
    const c = calls.get(callId);
    if (c && c.proveedor === 'teams') { const u = teamsUrl(c.join_url); if (u) window.open(u, '_blank', 'noopener'); return; }
    openUI({ titulo: tituloDe(c), estado: 'Conectando…' });
    try { const r = await api('unirse', { call_id: callId }); await connect(r, tituloDe(r.call)); }
    catch (e) { fail(e); }
  }
  const chatTitles = new Map();
  const tituloDe = (c) => (c && chatTitles.get(c.chat_id)) || (c ? nameOf(c.started_by) : 'Videollamada');

  /* ---------- sala (LiveKit) ---------- */
  let room = null, cur = null, ui = null, tiles = new Map(), timerT = null, t0 = 0, facing = 'user', accessToken = '';
  let lkLoad = null;
  function loadLK() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (!lkLoad) lkLoad = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = LK_SRC; s.async = true; s.onload = () => ok(window.LivekitClient); s.onerror = () => { lkLoad = null; ko(new Error('No se ha podido cargar el vídeo (sin conexión)')); }; document.head.appendChild(s); });
    return lkLoad;
  }
  async function connect(r, titulo) {
    const LK = await loadLK();
    cur = r.call; calls.set(cur.id, cur);
    accessToken = (await sb.auth.getSession()).data.session?.access_token || '';
    const { Room, RoomEvent } = LK;
    room = new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { facingMode: 'user', resolution: { width: 1280, height: 720, frameRate: 24 } } });
    const re = () => render();
    [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged]
      .forEach((ev) => room.on(ev, re));
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'audio') { const a = track.attach(); a.dataset.sqv = '1'; ui.querySelector('.sqv-audio').appendChild(a); } });
    room.on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); });
    room.on(RoomEvent.Disconnected, () => { if (room) cleanup(true); });
    room.on(RoomEvent.Reconnecting, () => setEstado('Reconectando…'));
    room.on(RoomEvent.Reconnected, () => render());
    await room.connect(r.url, r.token);
    try { await room.localParticipant.enableCameraAndMicrophone(); }
    catch (e) {
      // sin cámara (o sin permiso): al menos el micro
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch {}
      setAviso('No se ha podido usar la cámara o el micro. Revisa los permisos del navegador.');
    }
    ui.querySelector('.sqv-tit b').textContent = titulo;
    t0 = Date.now(); clearInterval(timerT); timerT = setInterval(render, 1000);
    render();
  }

  function openUI({ titulo, estado }) {
    closeMenu();
    if (!ui) {
      ui = document.createElement('div');
      ui.className = 'sqv';
      ui.setAttribute('role', 'dialog'); ui.setAttribute('aria-modal', 'true'); ui.setAttribute('aria-label', 'Videollamada');
      ui.innerHTML = `
        <div class="sqv-top"><span class="sqv-tit"><b></b><span class="sqv-st"></span></span>
          <button type="button" class="sqv-ib" data-sqv-act="min" aria-label="Minimizar la llamada" title="Seguir en el chat">${I.min}</button></div>
        <div class="sqv-aviso" hidden></div>
        <div class="sqv-stage"><div class="sqv-screen" hidden></div><div class="sqv-grid"></div></div>
        <div class="sqv-bar">
          <button type="button" class="sqv-cb" data-sqv-act="mic" aria-label="Micro">${I.mic}</button>
          <button type="button" class="sqv-cb" data-sqv-act="cam" aria-label="Cámara">${I.video}</button>
          <button type="button" class="sqv-cb only-touch" data-sqv-act="flip" aria-label="Cambiar de cámara">${I.flip}</button>
          ${navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && matchMedia('(pointer: fine)').matches ? `<button type="button" class="sqv-cb" data-sqv-act="screen" aria-label="Compartir pantalla">${I.screen}</button>` : ''}
          <button type="button" class="sqv-cb end" data-sqv-act="colgar" aria-label="Colgar">${I.end}</button>
        </div>
        <button type="button" class="sqv-pill" data-sqv-act="max" hidden>${I.video}<span class="sqv-pill-t">En llamada</span></button>
        <div class="sqv-audio" hidden></div>`;
      document.body.appendChild(ui);
      ui.addEventListener('click', onUI);
    }
    ui.classList.remove('mini'); ui.querySelector('.sqv-pill').hidden = true;
    ui.querySelector('.sqv-tit b').textContent = titulo || 'Videollamada';
    setEstado(estado || ''); setAviso('');
    document.documentElement.classList.add('sqv-on');
  }
  const show = () => { if (!ui) return; ui.classList.remove('mini'); ui.querySelector('.sqv-pill').hidden = true; document.documentElement.classList.add('sqv-on'); };
  const setEstado = (t) => { const e = ui?.querySelector('.sqv-st'); if (e) e.textContent = t; };
  const setAviso = (t) => { const e = ui?.querySelector('.sqv-aviso'); if (e) { e.textContent = t; e.hidden = !t; } };
  function fail(e) {
    const c = cur;
    setAviso(e.message || String(e)); setEstado(''); cleanup(false);
    if (c) api('salir', { call_id: c.id }).catch(() => {});
  }

  async function onUI(e) {
    const b = e.target.closest('[data-sqv-act]'); if (!b || !room && b.dataset.sqvAct !== 'colgar' && b.dataset.sqvAct !== 'min') return;
    const lp = room?.localParticipant;
    switch (b.dataset.sqvAct) {
      case 'mic': await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch((x) => setAviso(x.message)); break;
      case 'cam': await lp.setCameraEnabled(!lp.isCameraEnabled).catch((x) => setAviso(x.message)); break;
      case 'flip': {
        const pub = lp.getTrackPublication(window.LivekitClient.Track.Source.Camera);
        if (pub?.track) { facing = facing === 'user' ? 'environment' : 'user'; await pub.track.restartTrack({ facingMode: facing }).catch((x) => setAviso(x.message)); }
        break;
      }
      case 'screen': await lp.setScreenShareEnabled(!lp.isScreenShareEnabled).catch(() => {}); break;
      case 'min': ui.classList.add('mini'); ui.querySelector('.sqv-pill').hidden = false; document.documentElement.classList.remove('sqv-on'); if (!room) cleanup(false); break;
      case 'max': show(); break;
      case 'colgar': await hangup(); break;
    }
    render();
  }

  function render() {
    if (!room || !ui) return;
    const { Track } = window.LivekitClient;
    const lp = room.localParticipant;
    const parts = [lp, ...room.remoteParticipants.values()];
    const grid = ui.querySelector('.sqv-grid');
    // pantalla compartida (la primera que haya) en grande
    let shareTrack = null, shareWho = '';
    for (const p of parts) { const pub = p.getTrackPublication(Track.Source.ScreenShare); if (pub?.track && !pub.isMuted) { shareTrack = pub.track; shareWho = p.name || nameOf(p.identity); break; } }
    const scr = ui.querySelector('.sqv-screen');
    scr.hidden = !shareTrack;
    if (shareTrack && scr._t !== shareTrack) { scr.innerHTML = `<span class="sqv-lbl">Pantalla de ${esc(p1(shareWho))}</span>`; const v = shareTrack.attach(); scr.prepend(v); scr._t = shareTrack; }
    if (!shareTrack && scr._t) { scr._t.detach(); scr.innerHTML = ''; scr._t = null; }
    ui.classList.toggle('sharing', !!shareTrack);

    const ids = new Set(parts.map((p) => p.identity));
    for (const [id, t] of tiles) if (!ids.has(id)) { t.track?.detach(t.video); t.el.remove(); tiles.delete(id); }
    parts.forEach((p, i) => {
      let t = tiles.get(p.identity);
      const nombre = p === lp ? 'Tú' : (p.name || nameOf(p.identity));
      if (!t) {
        const el = document.createElement('div'); el.className = 'sqv-tile' + (p === lp ? ' me' : '');
        el.innerHTML = `<video playsinline autoplay muted></video><span class="sqv-av">${esc(ini(nombre === 'Tú' ? nameOf(me) : nombre))}</span><span class="sqv-name"><i class="sqv-mute">${I.micOff}</i><span></span></span>`;
        t = { el, video: el.querySelector('video'), track: null }; tiles.set(p.identity, t);
      }
      if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null);
      const pub = p.getTrackPublication(Track.Source.Camera);
      const tr = pub?.track && !pub.isMuted ? pub.track : null;
      if (tr !== t.track) { t.track?.detach(t.video); if (tr) tr.attach(t.video); t.track = tr; }
      t.el.classList.toggle('off', !tr);
      t.el.classList.toggle('mirror', p === lp && facing === 'user');
      t.el.classList.toggle('talk', !!p.isSpeaking);
      t.el.classList.toggle('muted', !p.isMicrophoneEnabled);
      t.el.querySelector('.sqv-name span').textContent = nombre;
    });
    grid.dataset.n = String(Math.min(parts.length, 9));
    const solo = room.remoteParticipants.size === 0;
    const s = Math.floor((Date.now() - t0) / 1000);
    const reloj = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    setEstado(solo ? 'Llamando…' : `${room.remoteParticipants.size + 1} en la llamada · ${reloj}`);
    ui.querySelector('.sqv-pill-t').textContent = solo ? 'Llamando…' : `En llamada · ${reloj}`;
    const set = (act, on, icOn, icOff, lab) => { const b = ui.querySelector(`[data-sqv-act="${act}"]`); if (!b) return; b.classList.toggle('off', !on); b.innerHTML = on ? icOn : icOff; b.setAttribute('aria-pressed', String(!on)); b.title = lab(on); };
    set('mic', lp.isMicrophoneEnabled, I.mic, I.micOff, (on) => (on ? 'Silenciar el micro' : 'Activar el micro'));
    set('cam', lp.isCameraEnabled, I.video, I.videoOff, (on) => (on ? 'Apagar la cámara' : 'Encender la cámara'));
    const sc = ui.querySelector('[data-sqv-act="screen"]'); if (sc) { sc.classList.toggle('on', lp.isScreenShareEnabled); sc.title = lp.isScreenShareEnabled ? 'Dejar de compartir' : 'Compartir pantalla'; }
  }
  const p1 = (n) => String(n || '').split(' ')[0];

  async function hangup() {
    const c = cur;
    cleanup(false);
    if (c) { try { const r = await api('salir', { call_id: c.id }); if (r.call) { calls.set(r.call.id, r.call); hydrate(); } } catch {} }
  }
  function cleanup(remoto) {
    clearInterval(timerT);
    const r = room; room = null;
    if (r) { try { r.disconnect(); } catch {} }
    tiles.forEach((t) => { t.track?.detach(t.video); }); tiles.clear();
    if (ui) {
      if (remoto && cur) { setAviso('La llamada se ha cortado.'); }
      const keep = !ui.querySelector('.sqv-aviso').hidden && !remoto;
      if (!keep) { ui.remove(); ui = null; document.documentElement.classList.remove('sqv-on'); }
      else { ui.querySelector('.sqv-grid').innerHTML = ''; ui.querySelector('.sqv-bar').hidden = true; setTimeout(() => { if (ui && !room) { ui.remove(); ui = null; document.documentElement.classList.remove('sqv-on'); } }, 4000); }
    }
    if (remoto && cur) { const c = cur; api('salir', { call_id: c.id }).catch(() => {}); }
    cur = null;
  }
  // si se cierra la pestaña en mitad de la llamada, avisar al servidor (keepalive deja terminar la petición)
  addEventListener('pagehide', () => {
    if (!cur || !accessToken) return;
    try {
      fetch(`${sb.supabaseUrl}/functions/v1/llamada`, { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${accessToken}`, apikey: sb.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'salir', call_id: cur.id }) });
    } catch {}
  });

  /* ---------- llamada entrante ---------- */
  let ringEl = null, ringT = null, ringCall = null, audioCtx = null, beepT = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = 660; o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
        g.gain.setValueAtTime(0.15, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.frequency.setValueAtTime(880, t + 0.2); o.start(t); o.stop(t + 0.5);
      };
      play(); beepT = setInterval(play, 1800);
    } catch {}
    try { navigator.vibrate && navigator.vibrate([400, 300, 400, 300, 400]); } catch {}
  }
  function stopRing() { clearTimeout(ringT); clearInterval(beepT); ringT = null; ringCall = null; try { navigator.vibrate && navigator.vibrate(0); } catch {} if (ringEl) { ringEl.remove(); ringEl = null; } }
  async function ring(c) {
    if (room || ringCall || c.started_by === me) return;
    if (Date.now() - new Date(c.started_at) > RING_MS) return;
    const { data: ch } = await sb.from('chats').select('kind,title').eq('id', c.chat_id).maybeSingle();
    if (!ch) return; // no es de un chat mío (RLS)
    ringCall = c;
    const grupo = ch.kind !== 'directo' && ch.title;
    if (grupo) chatTitles.set(c.chat_id, ch.title); else chatTitles.set(c.chat_id, nameOf(c.started_by));
    const teams = c.proveedor === 'teams';
    ringEl = document.createElement('div');
    ringEl.className = 'sqv-ring'; ringEl.setAttribute('role', 'alertdialog'); ringEl.setAttribute('aria-label', 'Llamada entrante');
    ringEl.innerHTML = `<span class="sqv-ring-av">${esc(ini(nameOf(c.started_by)))}</span>
      <span class="sqv-ring-t"><b>${esc(nameOf(c.started_by))}</b><span>${teams ? 'Te invita a una reunión de Teams' : 'Te está llamando'}${grupo ? ` · ${esc(ch.title)}` : ''}</span></span>
      <button type="button" class="sqv-rb no" data-ring="no" aria-label="Rechazar" title="Rechazar">${I.end}</button>
      <button type="button" class="sqv-rb si" data-ring="si" aria-label="${teams ? 'Unirse en Teams' : 'Contestar'}" title="${teams ? 'Unirse en Teams' : 'Contestar'}">${teams ? I.teams : I.video}</button>`;
    document.body.appendChild(ringEl);
    ringEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ring]'); if (!b) return;
      const call = ringCall; stopRing();
      if (b.dataset.ring === 'si') join(call.id);
      else api('rechazar', { call_id: call.id }).then((r) => { if (r.call) calls.set(r.call.id, r.call); hydrate(); }).catch(() => {});
    });
    if (!teams) beep();
    ringT = setTimeout(stopRing, RING_MS - (Date.now() - new Date(c.started_at)));
  }

  sb.channel('sq-calls-' + me)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (p) => { const c = p.new; if (!c) return; calls.set(c.id, c); ring(c); hydrate(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (p) => {
      const c = p.new; if (!c) return;
      const prev = calls.get(c.id); calls.set(c.id, c);
      if (ringCall && ringCall.id === c.id && (c.ended_at || (c.participants || []).includes(me))) stopRing();
      // quien llama: avisar si le rechazan
      if (cur && cur.id === c.id) {
        cur = c;
        const nuevos = (c.declined || []).filter((e) => !(prev?.declined || []).includes(e));
        if (nuevos.length) setAviso(`${nuevos.map(first).join(' y ')} no puede atender ahora.`);
        if (c.ended_at && room && room.remoteParticipants.size === 0) { cleanup(false); }
      }
      hydrate();
    })
    .subscribe();

  // botones «Unirse» / «Volver a la llamada» de las burbujas
  document.addEventListener('click', (e) => {
    const u = e.target.closest('[data-sqv-unirse]'); if (u) { e.preventDefault(); join(u.dataset.sqvUnirse); return; }
    if (e.target.closest('[data-sqv-volver]')) { e.preventDefault(); show(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  window.__sqLlamada = {
    menu: (chatId, btn, opts = {}) => { chatTitles.set(chatId, opts.titulo || ''); return menu(chatId, btn, opts); },
    bubble, hydrate, join,
    start: (chatId, proveedor, titulo) => { chatTitles.set(chatId, titulo || ''); return start(chatId, proveedor, titulo); },
  };
  document.dispatchEvent(new Event('sq-llamada-lista'));
})();
