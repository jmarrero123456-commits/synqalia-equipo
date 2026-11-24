/* Synqalia · Nueva reunión: convocar desde Synqalia (Microsoft 365)
   - Botón «＋ Nueva reunión» en Reuniones. Título, personas, fecha, hora, duración, Teams, lugar y mensaje.
   - Personas: se buscan entre los contactos de tu correo y reuniones (función «reuniones», contactos/yo) o se escribe un correo.
   - Disponibilidad de todos ese día (08:00–20:00) y huecos en los que estáis todos libres: tocar uno pone la hora.
   - «Convocar» crea la reunión en tu calendario de Outlook y Microsoft envía la convocatoria a cada persona. */
(async () => {
  if (!document.getElementById('view-reuniones') || window.__sqNewMeet) return;
  window.__sqNewMeet = true;
  await window.__sqReady;
  const sb = window.__sb;
  if (!sb || window.__sqOffline) return;
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const call = async (body) => {
    const { data, error } = await sb.functions.invoke('reuniones', { body });
    if (error) { let t = error.message; try { t = (await error.context.json()).error || t; } catch {} throw new Error(t); }
    if (data && data.error) throw new Error(data.error);
    return data;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const hm = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const nice = (c) => (c.nombre && !EMAIL.test(c.nombre) ? c.nombre : c.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()));

  /* ---------- estilos ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .nm-open{white-space:nowrap}
  .nm-card{display:grid;gap:14px}
  .nm-card[hidden]{display:none}
  .nm-grid{display:grid;grid-template-columns:1fr 150px 120px 130px;gap:10px;align-items:end}
  .nm-grid .field{margin:0}
  @media (max-width:760px){.nm-grid{grid-template-columns:1fr 1fr}.nm-grid .nm-t{grid-column:1/-1}}
  .nm-people{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 8px;min-height:42px;position:relative}
  .nm-people:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
  .nm-chip{display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--accent) 10%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:999px;padding:3px 6px 3px 10px;font-size:13px;font-weight:600}
  .nm-chip small{font-weight:500;color:var(--muted)}
  .nm-chip button{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
  .nm-people input{flex:1;min-width:180px;border:0!important;box-shadow:none!important;background:transparent!important;padding:4px!important;font:inherit;outline:none}
  .nm-sug{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.14);max-height:280px;overflow:auto;padding:4px}
  .nm-sug[hidden]{display:none}
  .nm-sug button{display:flex;width:100%;justify-content:space-between;gap:10px;border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:13.5px;color:var(--ink)}
  .nm-sug button small{color:var(--muted)}
  .nm-sug button.on,.nm-sug button:hover{background:color-mix(in srgb,var(--accent) 9%,transparent)}
  .nm-row{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
  .nm-row label.chk{display:inline-flex;gap:7px;align-items:center;font-size:13.5px;font-weight:600;cursor:pointer}
  .nm-av{display:grid;gap:6px}
  .nm-av .lbl{font-size:12px;color:var(--muted);font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .nm-tl{display:grid;grid-template-columns:150px 1fr;gap:4px 10px;align-items:center;font-size:12.5px}
  .nm-tl .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
  .nm-tl .who.err{color:var(--muted);font-style:italic}
  .nm-bar{position:relative;height:16px;border-radius:5px;background:color-mix(in srgb,var(--ok) 14%,var(--panel));border:1px solid var(--line);overflow:hidden}
  .nm-bar i{position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--bad) 55%,transparent)}
  .nm-bar i.t{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--warn) 50%,transparent) 0 4px,transparent 4px 8px)}
  .nm-bar b{position:absolute;top:-2px;bottom:-2px;border:2px solid var(--accent);border-radius:4px;background:color-mix(in srgb,var(--accent) 14%,transparent)}
  .nm-hours{display:grid;grid-template-columns:150px 1fr;gap:10px;font-size:10.5px;color:var(--muted)}
  .nm-hours div:last-child{display:flex;justify-content:space-between}
  @media (max-width:560px){.nm-tl,.nm-hours{grid-template-columns:90px 1fr}}
  .nm-slots{display:flex;flex-wrap:wrap;gap:6px}
  .nm-slots button{border:1px solid color-mix(in srgb,var(--ok) 40%,var(--line));background:color-mix(in srgb,var(--ok) 9%,var(--panel));color:var(--ink);border-radius:999px;padding:4px 11px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
  .nm-slots button.on{background:var(--ok);color:#fff;border-color:var(--ok)}
  .nm-msg{font-size:13px}
  .nm-msg.err{color:var(--bad)} .nm-msg.ok{color:var(--ok);font-weight:600}
  .nm-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}`;
  document.head.appendChild(css);

  /* ---------- tarjeta ---------- */
  const view = document.getElementById('view-reuniones');
  const agendaCard = document.getElementById('agenda-card');
  const card = document.createElement('section');
  card.className = 'card nm-card'; card.id = 'nm-card'; card.hidden = true;
  card.innerHTML = `
    <div class="row-between"><h2>Nueva reunión</h2><span class="note">Se crea en tu calendario de Outlook y Microsoft envía la convocatoria a cada persona.</span></div>
    <div class="nm-grid">
      <div class="field nm-t"><label for="nm-tit">Título</label><input id="nm-tit" maxlength="250" placeholder="Ej.: Catch-up zona norte"></div>
      <div class="field"><label for="nm-fecha">Fecha</label><input id="nm-fecha" type="date"></div>
      <div class="field"><label for="nm-hora">Hora</label><input id="nm-hora" type="time" step="900"></div>
      <div class="field"><label for="nm-dur">Duración</label><select id="nm-dur"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">1 h</option><option value="90">1 h 30</option><option value="120">2 h</option><option value="180">3 h</option></select></div>
    </div>
    <div class="field"><label for="nm-q">Personas</label>
      <div class="nm-people" id="nm-people"><input id="nm-q" autocomplete="off" placeholder="Escribe un nombre o un correo…" aria-autocomplete="list"><div class="nm-sug" id="nm-sug" role="listbox" hidden></div></div>
      <p class="note" id="nm-cnote">Cargando tus contactos…</p>
    </div>
    <div class="nm-av" id="nm-av" hidden></div>
    <div class="nm-row">
      <label class="chk"><input type="checkbox" id="nm-teams" checked> Reunión de Teams</label>
      <div class="field" style="flex:1;min-width:200px;margin:0"><input id="nm-lugar" maxlength="120" placeholder="Lugar (opcional): sala, salón, dirección…"></div>
    </div>
    <div class="field"><label for="nm-txt">Mensaje para los asistentes (opcional)</label><textarea id="nm-txt" rows="3" placeholder="Orden del día, documentos a traer…"></textarea></div>
    <p class="nm-msg" id="nm-msg" hidden></p>
    <div class="nm-acts"><button type="button" class="btn ghost" id="nm-cancel">Cancelar</button><button type="button" class="btn primary" id="nm-go">Convocar</button></div>`;
  if (agendaCard) agendaCard.before(card); else view.prepend(card);
  const $ = (s) => card.querySelector(s);

  // botón en la cabecera de la agenda
  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = 'btn primary nm-open'; openBtn.textContent = '＋ Nueva reunión';
  const head = agendaCard?.querySelector('.row-between');
  if (head) head.appendChild(openBtn); else view.prepend(openBtn);

  /* ---------- contactos ---------- */
  let contacts = [];
  const cnote = $('#nm-cnote');
  const setContacts = (doc) => { if (doc?.lista) { contacts = doc.lista; cnote.textContent = `Te propongo personas de tus correos y reuniones (${contacts.length}). También puedes escribir un correo completo y pulsar Intro.`; } };
  async function loadContacts() {
    try {
      const { data } = await sb.from('personal_docs').select('data').eq('owner', uid).eq('col', 'contactos').eq('id', 'yo').maybeSingle();
      if (data?.data) setContacts(data.data);
      const old = !data?.data?.actualizado || Date.now() - new Date(data.data.actualizado).getTime() > 20 * 3600e3;
      if (old) { if (!contacts.length) cnote.textContent = 'Preparando tus contactos a partir de tu correo (la primera vez tarda alrededor de un minuto)…'; setContacts(await call({ action: 'contactos' })); }
    } catch (e) {
      cnote.textContent = window.__sqGraph && !window.__sqGraph.connected ? 'Conecta Microsoft 365 para buscar personas y convocar.' : 'No pude cargar tus contactos (' + e.message + '). Puedes escribir el correo completo y pulsar Intro.';
    }
  }

  /* ---------- personas (chips + sugerencias) ---------- */
  const people = [];
  const q = $('#nm-q'), sug = $('#nm-sug'), box = $('#nm-people');
  let sel = -1, shown = [];
  function paintChips() {
    box.querySelectorAll('.nm-chip').forEach((c) => c.remove());
    people.forEach((p, i) => {
      const c = document.createElement('span'); c.className = 'nm-chip'; c.title = p.email;
      c.innerHTML = `${esc(nice(p))}${p.nombre ? '' : ` <small>${esc(p.email.split('@')[1])}</small>`}<button type="button" aria-label="Quitar a ${esc(nice(p))}">×</button>`;
      c.querySelector('button').addEventListener('click', () => { people.splice(i, 1); paintChips(); availSoon(); });
      box.insertBefore(c, q);
    });
  }
  function addPerson(p) {
    const email = String(p.email || '').toLowerCase().trim();
    if (!EMAIL.test(email) || people.some((x) => x.email === email)) return;
    people.push({ email, nombre: p.nombre || '' });
    q.value = ''; sug.hidden = true; paintChips(); availSoon(); q.focus();
  }
  function suggest() {
    const t = nrm(q.value.trim());
    if (!t) { sug.hidden = true; return; }
    const words = t.split(/\s+/);
    shown = contacts.filter((c) => !people.some((p) => p.email === c.email)).filter((c) => { const h = nrm(c.nombre + ' ' + c.email); return words.every((w) => h.includes(w)); }).slice(0, 8);
    if (EMAIL.test(q.value.trim()) && !shown.some((c) => c.email === q.value.trim().toLowerCase())) shown.push({ email: q.value.trim().toLowerCase(), nombre: '' });
    sel = shown.length ? 0 : -1;
    sug.innerHTML = shown.length ? shown.map((c, i) => `<button type="button" role="option" data-i="${i}" class="${i === sel ? 'on' : ''}"><span>${esc(c.nombre || c.email)}</span><small>${esc(c.nombre ? c.email : 'añadir este correo')}</small></button>`).join('') : `<div class="note" style="padding:8px 10px">No lo encuentro en tus contactos. Escribe su correo completo.</div>`;
    sug.hidden = false;
  }
  q.addEventListener('input', suggest);
  q.addEventListener('focus', () => { if (q.value.trim()) suggest(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!shown.length) return; e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; sug.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === sel)); }
    else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
      const v = q.value.trim();
      if (sel >= 0 && shown[sel] && v) { e.preventDefault(); addPerson(shown[sel]); }
      else if (EMAIL.test(v)) { e.preventDefault(); addPerson({ email: v }); }
    } else if (e.key === 'Backspace' && !q.value && people.length) { people.pop(); paintChips(); availSoon(); }
    else if (e.key === 'Escape') sug.hidden = true;
  });
  sug.addEventListener('mousedown', (e) => e.preventDefault());
  sug.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) addPerson(shown[Number(b.dataset.i)]); });
  q.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
  q.addEventListener('paste', (e) => {
    const t = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const found = t.match(/[^\s<>;,"']+@[^\s<>;,"']+\.[^\s<>;,"']+/g);
    if (found && found.length > 1) { e.preventDefault(); found.forEach((m) => { const c = contacts.find((x) => x.email === m.toLowerCase()); addPerson(c || { email: m }); }); }
  });

  /* ---------- disponibilidad ---------- */
  const av = $('#nm-av');
  let avTimer = null, avSeq = 0, lastAv = null;
  const availSoon = () => { clearTimeout(avTimer); avTimer = setTimeout(availability, 500); };
  async function availability() {
    const fecha = $('#nm-fecha').value;
    if (!fecha || !people.length) { av.hidden = true; lastAv = null; return; }
    const my = ++avSeq;
    av.hidden = false; av.innerHTML = '<span class="note">Mirando la agenda de todos…</span>';
    try {
      const r = await call({ action: 'disponibilidad', fecha, emails: people.map((p) => p.email), duracion: Number($('#nm-dur').value) });
      if (my !== avSeq) return;
      lastAv = r; paintAvail();
    } catch (e) { if (my === avSeq) av.innerHTML = `<span class="note">No pude ver la disponibilidad: ${esc(e.message)}</span>`; }
  }
  function paintAvail() {
    const r = lastAv; if (!r) return;
    const d0 = toMin(r.desde), d1 = toMin(r.hasta), span = d1 - d0;
    const pct = (m) => Math.max(0, Math.min(100, ((m - d0) / span) * 100));
    const hora = $('#nm-hora').value, dur = Number($('#nm-dur').value);
    const pick = hora ? { a: toMin(hora), b: toMin(hora) + dur } : null;
    const nameOf = (p) => (p.yo ? 'Tú' : nice(people.find((x) => x.email === p.email) || contacts.find((x) => x.email === p.email) || { email: p.email }));
    let html = '<div class="lbl">Disponibilidad</div><div class="nm-hours"><div></div><div><span>08:00</span><span>11:00</span><span>14:00</span><span>17:00</span><span>20:00</span></div></div><div class="nm-tl">';
    let choque = [];
    for (const p of r.personas) {
      html += `<div class="who${p.ok ? '' : ' err'}" title="${esc(p.email)}">${esc(nameOf(p))}</div>`;
      if (!p.ok) { html += `<div class="note">${esc(p.error || 'Sin datos de calendario')}</div>`; continue; }
      html += '<div class="nm-bar">' + p.ocupado.map((o) => `<i class="${o.estado === 'tentative' ? 't' : ''}" style="left:${pct(toMin(o.inicio))}%;width:${pct(toMin(o.fin)) - pct(toMin(o.inicio))}%" title="${esc(o.inicio + '–' + o.fin + (o.estado === 'tentative' ? ' · provisional' : ' · ocupado'))}"></i>`).join('') + (pick ? `<b style="left:${pct(pick.a)}%;width:${pct(pick.b) - pct(pick.a)}%"></b>` : '') + '</div>';
      if (pick && p.ocupado.some((o) => o.estado !== 'tentative' && toMin(o.inicio) < pick.b && toMin(o.fin) > pick.a)) choque.push(nameOf(p));
    }
    html += '</div>';
    if (r.huecos.length) {
      const opts = [];
      for (const h of r.huecos) { let a = toMin(h.inicio); const b = toMin(h.fin); const now = new Date(); if (r.fecha === isoDay(now)) a = Math.max(a, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15); if (b - a >= dur) opts.push({ a, b }); }
      html += opts.length ? `<div class="lbl">Huecos en los que estáis todos libres (${dur} min)</div><div class="nm-slots">${opts.map((o) => `<button type="button" data-a="${hm(o.a)}" class="${hora === hm(o.a) ? 'on' : ''}" title="Libres de ${hm(o.a)} a ${hm(o.b)}">${hm(o.a)}${o.b - o.a > dur ? ' – ' + hm(o.b) : ''}</button>`).join('')}</div>` : '<span class="note">Ese día no hay ningún hueco en el que estéis todos libres. Prueba otro día o acorta la reunión.</span>';
    } else html += '<span class="note">Ese día no hay ningún hueco en el que estéis todos libres. Prueba otro día o acorta la reunión.</span>';
    if (choque.length) html += `<span class="note" style="color:var(--warn)">A esa hora tienen otra cosa: ${esc(choque.join(', '))}.</span>`;
    av.innerHTML = html;
    av.querySelectorAll('.nm-slots button').forEach((b) => b.addEventListener('click', () => { $('#nm-hora').value = b.dataset.a; paintAvail(); }));
  }
  $('#nm-fecha').addEventListener('change', availSoon);
  $('#nm-dur').addEventListener('change', availSoon);
  $('#nm-hora').addEventListener('change', () => paintAvail());

  /* ---------- abrir / cerrar / convocar ---------- */
  const msg = $('#nm-msg');
  const say = (t, kind) => { msg.hidden = !t; msg.textContent = t || ''; msg.className = 'nm-msg' + (kind ? ' ' + kind : ''); };
  function reset() {
    people.length = 0; paintChips(); q.value = ''; $('#nm-tit').value = ''; $('#nm-txt').value = ''; $('#nm-lugar').value = ''; $('#nm-teams').checked = true; $('#nm-dur').value = '30'; $('#nm-hora').value = '';
    const d = new Date(); if (d.getHours() >= 18 || d.getDay() === 0 || d.getDay() === 6) { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    $('#nm-fecha').value = isoDay(d); $('#nm-fecha').min = isoDay(new Date());
    av.hidden = true; lastAv = null; say('');
  }
  function open() {
    if (window.__sqGraph && !window.__sqGraph.connected) { alert('Para convocar reuniones desde Synqalia, primero conecta Microsoft 365.'); return; }
    reset(); card.hidden = false; openBtn.hidden = true;
    if (!contacts.length) loadContacts();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#nm-tit').focus(), 250);
  }
  function close() { card.hidden = true; openBtn.hidden = false; }
  openBtn.addEventListener('click', open);
  $('#nm-cancel').addEventListener('click', close);
  window.__sqNewMeeting = (pre = {}) => { open(); if (pre.titulo) $('#nm-tit').value = pre.titulo; (pre.personas || []).forEach((p) => addPerson(p)); };

  $('#nm-go').addEventListener('click', async () => {
    const titulo = $('#nm-tit').value.trim(), fecha = $('#nm-fecha').value, hora = $('#nm-hora').value, dur = Number($('#nm-dur').value);
    const pend = q.value.trim(); if (EMAIL.test(pend)) addPerson({ email: pend });
    if (!titulo) { say('Pon un título a la reunión.', 'err'); $('#nm-tit').focus(); return; }
    if (!people.length) { say('Añade al menos una persona.', 'err'); q.focus(); return; }
    if (!fecha || !hora) { say('Elige la fecha y la hora (o toca uno de los huecos libres).', 'err'); return; }
    const a = toMin(hora), b = a + dur;
    if (b > 24 * 60) { say('La reunión termina después de medianoche: revisa la hora.', 'err'); return; }
    if (new Date(fecha + 'T' + hora) < new Date()) { if (!confirm('Esa hora ya ha pasado. ¿Convocar igualmente?')) return; }
    const fechaTxt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const lista = people.map((p) => '• ' + nice(p) + ' <' + p.email + '>').join('\n');
    if (!confirm(`¿Enviar la convocatoria?\n\n«${titulo}»\n${fechaTxt}, ${hora}–${hm(b)}${$('#nm-teams').checked ? ' · Teams' : ''}${$('#nm-lugar').value.trim() ? ' · ' + $('#nm-lugar').value.trim() : ''}\n\nA ${people.length} ${people.length === 1 ? 'persona' : 'personas'}:\n${lista}`)) return;
    const go = $('#nm-go'); go.disabled = true; go.textContent = 'Convocando…'; say('');
    try {
      const r = await call({ action: 'crearReunion', titulo, fecha, inicio: hora, fin: hm(b), asistentes: people.map((p) => ({ email: p.email, nombre: p.nombre })), teams: $('#nm-teams').checked, lugar: $('#nm-lugar').value.trim(), texto: $('#nm-txt').value.trim() });
      close();
      if (typeof window.__sqGoDay === 'function') window.__sqGoDay(fecha);
      const t = document.createElement('p'); t.className = 'nm-msg ok'; t.textContent = `✓ Convocatoria enviada a ${r.asistentes} ${r.asistentes === 1 ? 'persona' : 'personas'}: «${titulo}», ${fechaTxt} a las ${hora}.`;
      agendaCard?.querySelector('.row-between')?.after(t); setTimeout(() => t.remove(), 12000);
    } catch (e) { say('No se pudo convocar: ' + e.message, 'err'); }
    go.disabled = false; go.textContent = 'Convocar';
  });

  // precarga silenciosa de los contactos (si ya están guardados, al instante)
  loadContacts();
})();
