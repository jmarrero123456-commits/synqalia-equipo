/* synqalia · Mensajes
   Conversaciones de Teams sincronizadas (personal_docs, col «teams»), en una bandeja como la de Correo:
   Todas · Sin leer · Te piden algo, buscador y «Abrir en Teams ↗». Cambios en vivo.
   Pensado para sumar más canales (WhatsApp) con el mismo formato: cada conversación lleva «canal».
   Visto en synqalia: al abrir una conversación sin leer se guarda en la col «teams_visto» (id = id del chat)
   la «firma» de su último mensaje. Mientras la firma no cambie, cuenta como leída aunque Teams siga diciendo
   «no leído»; si llega un mensaje nuevo, la firma cambia y vuelve a «Sin leer». La sincronización no toca esa col. */
(async () => {
  if (!document.getElementById('view-mensajes') || window.__sqMensajes) return;
  window.__sqMensajes = true;
  // «Más» del móvil: muestra cuántas reuniones hay pendientes dentro del menú
  (() => { const src = document.getElementById('count-reuniones'), dst = document.getElementById('more-c-reuniones'), mas = document.getElementById('count-mas');
    if (!src || !dst) return; const sync = () => { dst.textContent = src.textContent; if (mas) mas.textContent = src.textContent; };
    new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true }); sync(); })();
  await window.__sqReady;
  const sb = window.__sb;
  const $ = (q) => document.querySelector(q);
  const list = $('#msg-list');
  if (!sb) { list.innerHTML = '<p class="note">Sin conexión: los mensajes se ven cuando vuelva la red.</p>'; return; }
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && /(^|\.)(microsoft\.com|cloud\.microsoft|office\.com|live\.com|teams\.microsoft\.com|whatsapp\.com)$/i.test(x.hostname) ? x.href : null; } catch { return null; } };
  const isTrue = (v) => v === true || v === 'true';
  const ini = (n) => (String(n || '?').split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const when = (d) => d.fecha || d.capturado || '';
  const CANAL = { teams: 'Teams', whatsapp: 'WhatsApp' };
  const VISTO = 'teams_visto';
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
  const firma = (d) => [d.fecha || '', d.hora || '', norm(d.ultimo)].join('|');

  const st = { f: 'todas', q: '', open: null, rows: new Map(), visto: new Map() };
  // Sin leer = Teams lo da por no leído y no se ha abierto en synqalia desde su último mensaje
  const unread = (id, d) => isTrue(d.noLeido) && st.visto.get(id)?.firma !== firma(d);
  async function setVisto(id, on) {
    const d = st.rows.get(id); if (!d) return;
    if (on) {
      const v = { firma: firma(d), en: new Date().toISOString(), canal: d.canal || 'teams' };
      st.visto.set(id, v);
      const { error } = await sb.from('personal_docs').upsert({ owner: uid, col: VISTO, id, data: v }, { onConflict: 'owner,col,id' });
      if (error) console.warn('No se pudo marcar como visto', error);
    } else {
      st.visto.delete(id);
      const { error } = await sb.from('personal_docs').delete().eq('owner', uid).eq('col', VISTO).eq('id', id);
      if (error) console.warn('No se pudo marcar como no leído', error);
    }
  }
  async function load() {
    const [{ data: rows, error }, { data: vis }] = await Promise.all([
      sb.from('personal_docs').select('id,data,updated_at').eq('owner', uid).eq('col', 'teams'),
      sb.from('personal_docs').select('id,data').eq('owner', uid).eq('col', VISTO),
    ]);
    if (error) { list.innerHTML = '<p class="note">No se han podido cargar los mensajes.</p>'; return; }
    st.rows = new Map((rows || []).map((r) => [r.id, { canal: 'teams', ...r.data }]));
    st.visto = new Map((vis || []).map((r) => [r.id, r.data || {}]));
    const last = (rows || []).map((r) => r.data?.capturado || r.updated_at).filter(Boolean).sort().pop();
    $('#msg-updated').textContent = last ? 'Última sincronización: ' + new Date(last).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    paint();
  }

  function paint() {
    const all = [...st.rows.entries()];
    const sinleer = all.filter(([id, d]) => unread(id, d));
    const pide = all.filter(([, d]) => isTrue(d.pide));
    $('#msg-c-todas').textContent = all.length || '';
    $('#msg-c-sinleer').textContent = sinleer.length || '';
    $('#msg-c-pide').textContent = pide.length || '';
    const tc = $('#count-mensajes'); if (tc) tc.textContent = sinleer.length ? String(sinleer.length) : '';
    document.querySelectorAll('#msg-filter .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === st.f)));

    let rows = st.f === 'sinleer' ? sinleer : st.f === 'pide' ? pide : all;
    const q = st.q.trim().toLowerCase();
    if (q) rows = rows.filter(([, d]) => [d.nombre, d.ultimo, d.accion].join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => (unread(b[0], b[1]) - unread(a[0], a[1])) || (isTrue(b[1].pide) - isTrue(a[1].pide)) || String(when(b[1])).localeCompare(String(when(a[1]))));
    if (!rows.length) { list.innerHTML = `<p class="note" style="padding:14px">${all.length ? 'Nada en esta vista.' : 'Aún no hay conversaciones sincronizadas.'}</p>`; return; }

    list.innerHTML = rows.map(([id, d]) => {
      const open = st.open === id, url = safeUrl(d.enlace), nl = unread(id, d), pd = isTrue(d.pide);
      const canal = CANAL[d.canal] || 'Teams';
      return `<div class="item mrow msg${open ? ' open' : ''}${pd ? ' dec' : ''}${nl ? ' unread' : ''}" data-id="${esc(id)}">
        <div class="stripe"></div>
        <div class="mline msgline" role="button" tabindex="0" aria-expanded="${open}">
          <span class="mfrom"><span class="mav" aria-hidden="true">${esc(ini(d.nombre))}<i class="ch ch-${esc(d.canal || 'teams')}" title="${canal}"></i></span>${esc(d.nombre)}</span>
          <span class="msub">${pd ? '<span class="mdec">Te piden algo</span>' : ''}${nl ? '<span class="mnew">Sin leer</span>' : ''}<b>${esc(d.ultimo || '')}</b>${d.accion ? `<span class="mprev"> — ${esc(d.accion)}</span>` : ''}</span>
          <span class="mdate">${esc(d.hora || '')}</span>
        </div>
        <div class="msgbody">
          ${d.accion ? `<p class="detail"><b>Qué hacer:</b> ${esc(d.accion)}</p>` : ''}
          ${d.ultimo ? `<p class="ult">Último mensaje: «${esc(d.ultimo)}»</p>` : ''}
          <div class="actions">${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir en ${canal} ↗</a>` : `<a class="btn" href="https://teams.microsoft.com/v2/" target="_blank" rel="noopener" title="Abre Teams; busca el chat de ${esc(d.nombre)}">Abrir Teams ↗</a>`}${isTrue(d.noLeido) ? `<button type="button" class="btn ghost msg-unread" title="Vuelve a dejarla como sin leer en synqalia">Marcar como no leído</button>` : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  list.addEventListener('click', (e) => {
    const un = e.target.closest('.msg-unread');
    if (un) { const id = un.closest('.msg').dataset.id; st.open = null; setVisto(id, false); paint(); return; }
    const line = e.target.closest('.msgline'); if (!line) return;
    const id = line.parentElement.dataset.id; st.open = st.open === id ? null : id;
    // Abrirla basta para darla por vista (sin pasar por Teams)
    if (st.open === id) { const d = st.rows.get(id); if (d && unread(id, d)) setVisto(id, true); }
    paint();
  });
  list.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('msgline')) { e.preventDefault(); e.target.click(); } });
  $('#msg-filter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; st.f = b.dataset.f; paint(); });
  $('#msg-search').addEventListener('input', (e) => { st.q = e.target.value; paint(); });

  sb.channel('sq-mensajes-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row) return;
    if (row.col === VISTO) { if (p.eventType === 'DELETE') st.visto.delete(row.id); else st.visto.set(row.id, row.data || {}); paint(); return; }
    if (row.col !== 'teams') return;
    if (p.eventType === 'DELETE') st.rows.delete(row.id); else st.rows.set(row.id, { canal: 'teams', ...row.data });
    paint();
  }).subscribe();

  await load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
