/* synqalia · Mensajes
   Conversaciones de Teams sincronizadas (personal_docs, col «teams»), en una bandeja como la de Correo:
   Todas · Sin leer · Te piden algo, buscador y «Abrir en Teams ↗». Cambios en vivo.
   Pensado para sumar más canales (WhatsApp) con el mismo formato: cada conversación lleva «canal». */
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

  const st = { f: 'todas', q: '', open: null, rows: new Map() };
  async function load() {
    const { data: rows, error } = await sb.from('personal_docs').select('id,data,updated_at').eq('owner', uid).eq('col', 'teams');
    if (error) { list.innerHTML = '<p class="note">No se han podido cargar los mensajes.</p>'; return; }
    st.rows = new Map((rows || []).map((r) => [r.id, { canal: 'teams', ...r.data }]));
    const last = (rows || []).map((r) => r.data?.capturado || r.updated_at).filter(Boolean).sort().pop();
    $('#msg-updated').textContent = last ? 'Última sincronización: ' + new Date(last).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    paint();
  }

  function paint() {
    const all = [...st.rows.entries()];
    const sinleer = all.filter(([, d]) => isTrue(d.noLeido));
    const pide = all.filter(([, d]) => isTrue(d.pide));
    $('#msg-c-todas').textContent = all.length || '';
    $('#msg-c-sinleer').textContent = sinleer.length || '';
    $('#msg-c-pide').textContent = pide.length || '';
    const tc = $('#count-mensajes'); if (tc) tc.textContent = sinleer.length ? String(sinleer.length) : '';
    document.querySelectorAll('#msg-filter .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === st.f)));

    let rows = st.f === 'sinleer' ? sinleer : st.f === 'pide' ? pide : all;
    const q = st.q.trim().toLowerCase();
    if (q) rows = rows.filter(([, d]) => [d.nombre, d.ultimo, d.accion].join(' ').toLowerCase().includes(q));
    rows.sort((a, b) => (isTrue(b[1].noLeido) - isTrue(a[1].noLeido)) || (isTrue(b[1].pide) - isTrue(a[1].pide)) || String(when(b[1])).localeCompare(String(when(a[1]))));
    if (!rows.length) { list.innerHTML = `<p class="note" style="padding:14px">${all.length ? 'Nada en esta vista.' : 'Aún no hay conversaciones sincronizadas.'}</p>`; return; }

    list.innerHTML = rows.map(([id, d]) => {
      const open = st.open === id, url = safeUrl(d.enlace), nl = isTrue(d.noLeido), pd = isTrue(d.pide);
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
          <div class="actions">${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir en ${canal} ↗</a>` : `<a class="btn" href="https://teams.microsoft.com/v2/" target="_blank" rel="noopener" title="Abre Teams; busca el chat de ${esc(d.nombre)}">Abrir Teams ↗</a>`}</div>
        </div>
      </div>`;
    }).join('');
  }

  list.addEventListener('click', (e) => {
    const line = e.target.closest('.msgline'); if (!line) return;
    const id = line.parentElement.dataset.id; st.open = st.open === id ? null : id; paint();
  });
  list.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('msgline')) { e.preventDefault(); e.target.click(); } });
  $('#msg-filter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; st.f = b.dataset.f; paint(); });
  $('#msg-search').addEventListener('input', (e) => { st.q = e.target.value; paint(); });

  sb.channel('sq-mensajes-' + uid).on('postgres_changes', { event: '*', schema: 'public', table: 'personal_docs', filter: 'owner=eq.' + uid }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row || row.col !== 'teams') return;
    if (p.eventType === 'DELETE') st.rows.delete(row.id); else st.rows.set(row.id, { canal: 'teams', ...row.data });
    paint();
  }).subscribe();

  await load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
