/* Synqalia · Asistente por voz (25/11/2026)
   Conversación hablada con el asistente desde el Inicio: escucha → piensa → contesta en voz alta → vuelve a escuchar.
   Sabe buscar huecos en tu agenda y en la de otras personas de Microsoft 365 y preparar convocatorias, apuntar notas y tareas,
   marcar tareas hechas o cambiarles la fecha, asignar tareas, contestar correos, responder convocatorias y mandar mensajes de Synqalia.
   Notas y tareas tuyas se guardan al momento («Apuntado»). Lo que ven otras personas (convocar, asignar, contestar un correo,
   responder una convocatoria, mandar un mensaje) solo se hace cuando dices un «sí» claro (sí, envíala, adelante…); si dices
   otra cosa, la IA lo cambia o te vuelve a preguntar. Después de convocar puedes decir «cancélala» y se anula.
   Las acciones las hace mi.html (window.__sqActs) con las mismas piezas que el resto de la app.
   Servidor: función «asistente» con modo: 'voz' (propuestas) y función «reuniones» (crearReunion, moverReunion, cancelarReunion). */
(() => {
  const sb = window.__sb;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = window.speechSynthesis;
  const S = { open: false, phase: 'idle', msgs: [], pend: null, ultima: null, rec: null, retries: 0, utter: null, ttsTimer: 0, busy: false };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¡!¿?.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  const RE_SI = /^(si|sii|vale|ok|okey|okay|adelante|envia(la|lo)?|mandala|convoca(la)?|confirmo|confirmado|perfecto|de acuerdo|hazlo|correcto|claro|venga|exacto|eso es|dale)( (si|vale|adelante|enviala|mandala|por favor|gracias|perfecto))*$/;
  const RE_DUDA = /\b(no|espera|cambia|mejor|pero|aunque|en vez|otra|otro|antes|despues|mas tarde|ponle|quita|anade)\b/;
  const RE_NO = /^(no|nada|dejalo|mejor no|no la envies|no gracias|cancela|olvidalo)( .*)?$/;
  const RE_CANCELA = /\b(cancela(la)?|anula(la)?|borra(la)?)\b/;
  const RE_FIN = /^(gracias|muchas gracias|eso es todo|nada mas|adios|hasta luego|terminar|termina|para|cierra|ya esta)( .*)?$/;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const mic = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';

  /* ---------- interfaz ---------- */
  const box = document.createElement('div');
  box.id = 'sq-voz'; box.className = 'vz'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Asistente por voz');
  box.innerHTML = `<div class="vz-panel">
    <div class="vz-head"><b>Asistente por voz</b><button type="button" class="vz-x" aria-label="Cerrar">✕</button></div>
    <div class="vz-log" aria-live="polite"></div>
    <div class="vz-card" hidden></div>
    <div class="vz-foot">
      <div class="vz-state"><span class="vz-orb" aria-hidden="true"></span><span class="vz-st">Pulsa el micro y habla</span></div>
      <button type="button" class="vz-mic" aria-label="Hablar">${mic}</button>
      <p class="vz-hint">Ej.: «¿Cuándo puedo verme con Belén?» · «Apúntame una nota…» · «¿Qué tengo urgente?» · Para acabar: «gracias».</p>
    </div></div>`;
  document.body.appendChild(box);
  const $l = box.querySelector('.vz-log'), $st = box.querySelector('.vz-st'), $mic = box.querySelector('.vz-mic'), $card = box.querySelector('.vz-card');
  box.querySelector('.vz-x').addEventListener('click', () => close());
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => { if (S.open && e.key === 'Escape') close(); });
  $mic.addEventListener('click', () => {
    if (S.phase === 'listening') { stopListen(true); return; }
    if (S.phase === 'speaking') { stopSpeak(); listen(); return; }
    if (S.phase === 'thinking') return;
    listen();
  });

  function setPhase(p, txt) {
    S.phase = p; box.dataset.phase = p;
    $st.textContent = txt || ({ idle: 'Pulsa el micro y habla', listening: 'Te escucho…', thinking: 'Pensando…', speaking: 'Hablando… (toca el micro para interrumpir)' })[p];
    $mic.setAttribute('aria-label', p === 'listening' ? 'Dejar de escuchar' : 'Hablar');
  }
  function bubble(who, text, cls) {
    const d = document.createElement('div'); d.className = 'vz-b ' + who + (cls ? ' ' + cls : ''); d.textContent = text;
    $l.appendChild(d); $l.scrollTop = $l.scrollHeight; return d;
  }
  const fmtDia = (f) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(f + 'T12:00:00')).replace(',', '');
  const hora = (h) => { const [a, b] = h.split(':').map(Number); return b ? `${a}:${String(b).padStart(2, '0')}` : String(a); };
  const quien = (p) => p.personas.map((x) => x.nombre || x.email).join(', ').replace(/, ([^,]*)$/, ' y $1');
  const RESP = { aceptar: 'Acepto', provisional: 'Dejo como provisional', rechazar: 'Rechazo' };
  const corto = (n) => String(n || '').split(/\s+/)[0] || n;
  function leer(p) {
    if (p.tipo === 'asignar') return `Le asigno a ${p.para.nombre} «${p.titulo}»${p.vence ? ' para el ' + fmtDia(p.vence) : ''}. ¿Se la envío?`;
    if (p.tipo === 'correo') return `Respondo a ${String(p.para).replace(/<[^>]*>/g, '').trim()} sobre «${String(p.asunto).replace(/^(re|rv|fw|fwd)\s*:\s*/i, '')}»: ${p.texto} ¿Lo envío?`;
    if (p.tipo === 'convocatoria') return `${RESP[p.respuesta]} «${p.titulo}», el ${fmtDia(p.fecha)} a las ${hora(p.inicio)}${p.serie > 1 ? ', toda la serie' : ''}${p.comentario ? ', con el mensaje: ' + p.comentario : ''}. ¿La envío?`;
    if (p.tipo === 'mensaje') return `Le mando a ${corto(p.para.nombre)} por Synqalia: ${p.texto} ¿Lo envío?`;
    return `${p.cambia ? 'La cambio a' : 'Convoco'} «${p.titulo}», el ${fmtDia(p.fecha)} de ${hora(p.inicio)} a ${hora(p.fin)}, ${p.teams ? 'por Teams' : (p.lugar ? 'en ' + p.lugar : 'presencial')}, con ${quien(p)}. ¿La envío?`;
  }
  function showCard() {
    const p = S.pend; $card.hidden = !p; if (!p) return;
    const k = (t) => `<div class="vz-card-k">${t} · di «sí» para enviarlo</div>`;
    if (p.tipo === 'asignar') $card.innerHTML = k('Tarea para ' + esc(corto(p.para.nombre))) + `<div class="vz-card-t">${esc(p.titulo)}</div><div class="vz-card-m">${p.vence ? esc(fmtDia(p.vence)) : 'Sin fecha'} · prioridad ${esc((p.prioridad || 'Media').toLowerCase())}</div>`;
    else if (p.tipo === 'correo') $card.innerHTML = k('Respuesta de correo') + `<div class="vz-card-t">RE: ${esc(p.asunto)}</div><div class="vz-card-m">Para ${esc(p.para)}</div><div class="vz-card-txt">${esc(p.texto)}</div>`;
    else if (p.tipo === 'convocatoria') $card.innerHTML = k('Respuesta a convocatoria') + `<div class="vz-card-t">${esc(RESP[p.respuesta])} · ${esc(p.titulo)}</div><div class="vz-card-m">${esc(fmtDia(p.fecha))} · ${esc(p.inicio)}–${esc(p.fin || '')}${p.serie > 1 ? ' · toda la serie' : ''}${p.organiza ? ' · convoca ' + esc(p.organiza) : ''}</div>${p.comentario ? `<div class="vz-card-txt">${esc(p.comentario)}</div>` : ''}`;
    else if (p.tipo === 'mensaje') $card.innerHTML = k('Mensaje de Synqalia') + `<div class="vz-card-t">Para ${esc(p.para.nombre)}</div><div class="vz-card-txt">${esc(p.texto)}</div>`;
    else $card.innerHTML = k(p.cambia ? 'Cambio de la reunión' : 'Convocatoria preparada') + `<div class="vz-card-t">${esc(p.titulo)}</div>
      <div class="vz-card-m">${esc(fmtDia(p.fecha))} · ${esc(p.inicio)}–${esc(p.fin)} · ${p.teams ? 'Teams' : esc(p.lugar || 'Presencial')}</div>
      <div class="vz-card-m">Con ${esc(quien(p))}</div>`;
  }

  /* ---------- hablar ---------- */
  function speak(text, then) {
    stopSpeak();
    if (!TTS) { then && then(); return; }
    setPhase('speaking');
    const u = new SpeechSynthesisUtterance(String(text).replace(/[«»*_#]/g, ''));
    u.lang = 'es-ES'; u.rate = 1.05;
    const v = TTS.getVoices().find((x) => /^es(-|_)ES/i.test(x.lang)) || TTS.getVoices().find((x) => /^es/i.test(x.lang)); if (v) u.voice = v;
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(S.ttsTimer); S.utter = null; if (S.open && S.phase === 'speaking') { setPhase('idle'); then && then(); } };
    u.onend = fin; u.onerror = fin;
    S.utter = u; TTS.speak(u);
    // algunos móviles no avisan del final: plan B por la longitud del texto
    S.ttsTimer = setTimeout(fin, 2500 + String(text).length * 75);
  }
  function stopSpeak() { clearTimeout(S.ttsTimer); if (TTS && (TTS.speaking || TTS.pending)) TTS.cancel(); S.utter = null; }

  /* ---------- escuchar ---------- */
  function listen() {
    if (!S.open) return;
    if (!SR) { setPhase('idle', 'Este navegador no permite dictar: usa Chrome o Samsung Internet.'); return; }
    stopSpeak();
    let fin = '', inter = '';
    const live = bubble('yo', '…', 'live');
    const r = new SR(); r.lang = 'es-ES'; r.continuous = false; r.interimResults = true; S.rec = r;
    r.onresult = (ev) => { inter = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t + ' '; else inter += t; } live.textContent = (fin + inter).trim() || '…'; };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.rec = null; live.remove(); setPhase('idle', 'No puedo usar el micrófono: revisa el permiso del navegador.'); } };
    r.onend = () => {
      if (S.rec !== r) return; S.rec = null;
      const text = (fin + ' ' + inter).replace(/\s+/g, ' ').trim();
      if (!text) { live.remove(); if (S.open && ++S.retries <= 1 && S.phase === 'listening') { setPhase('idle'); listen(); } else setPhase('idle', 'No te he oído. Pulsa el micro para seguir.'); return; }
      S.retries = 0; live.classList.remove('live'); live.textContent = text;
      handle(text);
    };
    try { r.start(); setPhase('listening'); } catch (e) { S.rec = null; live.remove(); setPhase('idle', 'Pulsa el micro para hablar.'); }
  }
  function stopListen(useIt) { const r = S.rec; if (!r) return; if (!useIt) { S.rec = null; r.onend = null; } try { r.stop(); } catch (e) { /* ya parado */ } if (!useIt) setPhase('idle'); }

  /* ---------- entender ---------- */
  async function handle(text) {
    const t = norm(text);
    if (RE_FIN.test(t) && !S.pend) { say('De nada. Aquí estoy cuando me necesites.', () => close()); return; }
    if (S.pend) {
      if (RE_SI.test(t) && !RE_DUDA.test(t)) { await enviar(); return; }
      if (RE_NO.test(t) && !/\b(a las|el (lunes|martes|miercoles|jueves|viernes)|manana|hora|dile|pon)\b/.test(t)) { S.pend = null; showCard(); say('Vale, no lo envío.', listen); S.msgs.push({ role: 'user', content: text }, { role: 'assistant', content: 'Vale, no lo envío.' }); return; }
    } else if (S.ultima && RE_CANCELA.test(t)) { await cancelar(); return; }
    await preguntar(text);
  }
  function say(text, then, cls) { bubble('ia', text, cls); speak(text, then); }

  async function preguntar(text) {
    S.msgs.push({ role: 'user', content: text });
    setPhase('thinking');
    const wait = bubble('ia', 'Pensando…', 'wait');
    const filler = setTimeout(() => { if (S.phase === 'thinking' && S.open && TTS) { const u = new SpeechSynthesisUtterance('Un momento.'); u.lang = 'es-ES'; TTS.speak(u); } }, 2500);
    let res = null, err = null;
    try {
      let contexto = null; try { contexto = window.__sqActs ? window.__sqActs.contexto() : null; } catch (e) { /* sin contexto */ }
      const { data, error } = await sb.functions.invoke('asistente', { body: { modo: 'voz', messages: S.msgs.slice(-16), estado: { pendiente: S.pend, contexto, ultima: S.ultima && { titulo: S.ultima.titulo, fecha: S.ultima.fecha, inicio: S.ultima.inicio, fin: S.ultima.fin, personas: S.ultima.personas } } } });
      if (error) { let m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch (e) { /* sin detalle */ } throw new Error(m); }
      res = data;
    } catch (e) { err = e; }
    clearTimeout(filler); wait.remove();
    if (!S.open) return;
    if (err || !res) { S.msgs.pop(); say('Perdona, no he podido contestar: ' + ((err && err.message) || 'error') + '. ¿Lo intentamos otra vez?', listen, 'err'); return; }
    // primero lo que se hace al momento (notas, tareas propias, hecha / cambio de fecha)
    const fallos = [];
    for (const a of (Array.isArray(res.directas) ? res.directas : [])) {
      try {
        if (!window.__sqActs) throw new Error('la app aún está cargando');
        if (a.tipo === 'nota') await window.__sqActs.nota(a);
        else if (a.tipo === 'tarea') await window.__sqActs.tarea(a);
        else if (a.tipo === 'tarea_cambio') await window.__sqActs.tareaCambio(a);
      } catch (e) { fallos.push('«' + (a.titulo || 'eso') + '»: ' + e.message); }
    }
    if (fallos.length) { const t2 = 'No he podido guardar ' + fallos.join('; ') + '.'; S.msgs.push({ role: 'assistant', content: t2 }); say(t2, listen, 'err'); return; }
    if (res.propuesta) {
      if (!res.propuesta.tipo) res.propuesta.tipo = 'reunion';
      S.pend = res.propuesta; showCard();
      const txt = ((res.directas || []).length ? 'Apuntado. ' : '') + leer(S.pend);
      S.msgs.push({ role: 'assistant', content: txt });
      say(txt, listen);
      return;
    }
    const ans = String(res.answer || '').trim() || 'No te he entendido. ¿Me lo repites?';
    S.msgs.push({ role: 'assistant', content: ans });
    say(ans, listen);
  }

  /* ---------- enviar, cambiar o anular ---------- */
  const callReuniones = async (body) => {
    const { data, error } = await sb.functions.invoke('reuniones', { body });
    if (error) { let m = error.message; try { const b = await error.context.json(); m = b.error || m; } catch (e) { /* sin detalle */ } throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    return data;
  };
  async function enviar() {
    const p = S.pend; if (!p || S.busy) return;
    if (p.tipo && p.tipo !== 'reunion') return enviarOtro(p);
    S.busy = true; setPhase('thinking', p.cambia ? 'Cambiando la reunión…' : 'Enviando la convocatoria…');
    try {
      if (p.cambia && S.ultima && S.ultima.id) {
        await callReuniones({ action: 'moverReunion', id: S.ultima.id, fecha: p.fecha, inicio: p.inicio, fin: p.fin, titulo: p.titulo, ...(p.lugar ? { lugar: p.lugar } : {}) });
        S.ultima = { ...S.ultima, ...p, id: S.ultima.id };
      } else {
        const r = await callReuniones({ action: 'crearReunion', titulo: p.titulo, fecha: p.fecha, inicio: p.inicio, fin: p.fin, asistentes: p.personas, teams: p.teams, lugar: p.lugar || '', texto: p.texto || '' });
        S.ultima = { ...p, id: r.id, enlace: r.enlace };
      }
      S.pend = null; showCard();
      const txt = (p.cambia ? 'Hecho, la he cambiado. Les llega el aviso a ' : 'Enviada. Le llega la convocatoria a ') + quien(p) + '. Si quieres anularla, dime «cancélala».';
      S.msgs.push({ role: 'user', content: 'Sí' }, { role: 'assistant', content: txt });
      say(txt, listen, 'ok');
    } catch (e) {
      const m = /NO_ORGANIZADOR/.test(e.message) ? 'esa reunión la convoca otra persona y no puedo cambiarla' : e.message;
      say('No he podido enviarla: ' + m + '.', listen, 'err');
    } finally { S.busy = false; }
  }
  // asignar una tarea, contestar un correo, responder una convocatoria o mandar un mensaje (ya con su «sí»)
  async function enviarOtro(p) {
    S.busy = true; setPhase('thinking', 'Enviando…');
    try {
      const A = window.__sqActs; if (!A) throw new Error('la app aún está cargando');
      let txt;
      if (p.tipo === 'asignar') { await A.asignar(p); txt = 'Hecho. ' + corto(p.para.nombre) + ' ya la tiene en su lista y tú la ves en «Esperando a otros».'; }
      else if (p.tipo === 'correo') { const r = await A.correo(p); txt = r === 'cola' ? 'La he dejado en la cola de Outlook: saldrá en la próxima actualización.' : 'Enviado. He dado el correo por gestionado.'; }
      else if (p.tipo === 'convocatoria') { await A.convocatoria(p); txt = 'Hecho, respuesta enviada a ' + (p.organiza ? corto(p.organiza) : 'quien convoca') + '.'; }
      else if (p.tipo === 'mensaje') { await A.mensaje(p); txt = 'Mensaje enviado a ' + corto(p.para.nombre) + '.'; }
      else throw new Error('no sé hacer eso todavía');
      S.pend = null; showCard();
      S.msgs.push({ role: 'user', content: 'Sí' }, { role: 'assistant', content: txt });
      say(txt, listen, 'ok');
    } catch (e) { say('No he podido hacerlo: ' + e.message + '.', listen, 'err'); } finally { S.busy = false; }
  }
  async function cancelar() {
    const u = S.ultima; if (!u || !u.id || S.busy) return;
    S.busy = true; setPhase('thinking', 'Anulando la reunión…');
    try {
      await callReuniones({ action: 'cancelarReunion', id: u.id });
      S.ultima = null;
      const txt = 'Anulada. Le llega la cancelación a ' + quien(u) + '.';
      S.msgs.push({ role: 'user', content: 'Cancélala' }, { role: 'assistant', content: txt });
      say(txt, listen, 'ok');
    } catch (e) { say('No he podido anularla: ' + e.message + '.', listen, 'err'); } finally { S.busy = false; }
  }

  /* ---------- abrir y cerrar ---------- */
  function open(first) {
    if (!sb) return;
    if (window.__sqRecording && !S.open) { alert('Hay una grabación o un dictado en marcha: páralo antes de hablar con el asistente.'); return; }
    S.open = true; box.hidden = false; document.body.classList.add('vz-on'); window.__sqRecording = true;
    if (!S.msgs.length) { $l.replaceChildren(); }
    if (first) handle(first);
    else if (!S.msgs.length) say('Dime.', listen);
    else listen();
  }
  function close() {
    S.open = false; stopListen(false); stopSpeak(); box.hidden = true; S.pend = null; showCard(); // lo que quedaba sin confirmar no se envía document.body.classList.remove('vz-on'); window.__sqRecording = false; setPhase('idle');
    // si se cierra con una convocatoria sin confirmar, no se envía; la conversación se olvida a los 10 minutos
    clearTimeout(S.forget); S.forget = setTimeout(() => { if (!S.open) { S.msgs = []; S.pend = null; S.ultima = null; showCard(); $l.replaceChildren(); } }, 10 * 60000);
  }
  window.__sqVoz = { open, close, disponible: !!(SR && sb) };
})();
