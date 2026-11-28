/* Synqalia · Configuración › IA y saldo (28/11/2026)
   Tres vistas según quién entra (las decide el servidor, función «ia-saldo»):
   - Mi uso: lo que ha usado este mes, lo que le queda (en % y usos aproximados) y su nivel de IA.
   - Empresa (administrador): consumo por persona y función, límites, avisos, recargas y registro de cambios.
   - Synqalia (propietario): todas las empresas, coste de Anthropic frente a lo cobrado, saldo de Anthropic y solicitudes.
   La web nunca lee las tablas de saldo: todo llega ya filtrado por la empresa de la persona. */
(() => {
  const view = document.getElementById('view-ia');
  if (!view || window.__sqIaSaldo) return;
  window.__sqIaSaldo = true;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (v) => (v == null ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €');
  const usd = (v) => (v == null ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' US$');
  const pc = (v) => (v == null ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %');
  const fDia = (iso) => (iso ? new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)) : '');
  const fHora = (iso) => (iso ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
  const fMes = (ym) => new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(ym + '-15T12:00:00'));
  const w = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const tono = (p) => (p >= 100 ? 'bad' : p >= 80 ? 'warn' : '');
  const bar = (p, extra = '') => `<div class="iax-bar ${tono(p)}" ${extra}><i style="width:${w(p)}%"></i></div>`;
  const num = (s) => { const t = String(s ?? '').trim().replace(/\./g, '').replace(',', '.'); return t === '' ? null : Number(t); };
  const IC = {
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };

  const S = { tab: 'yo', yo: null, adm: null, own: null, busy: false, edit: null, editPlan: null, importe: 100, msg: null };

  async function call(action, extra) {
    const sb = window.__sb;
    if (!sb) throw new Error('Sin conexión');
    const { data, error } = await sb.functions.invoke('ia-saldo', { body: { action, ...(extra || {}) } });
    if (error) { let t = error.message; try { const b = await error.context.json(); t = b.error || t; } catch (e) { /* sin detalle */ } throw new Error(t); }
    return data;
  }
  function toast(t, mal) {
    S.msg = { t, mal: !!mal };
    paintMsg();
    clearTimeout(toast.k); toast.k = setTimeout(() => { S.msg = null; paintMsg(); }, mal ? 7000 : 3500);
  }
  function paintMsg() {
    let el = view.querySelector('.iax-toast');
    if (!S.msg) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'iax-toast'; el.setAttribute('role', 'status'); view.appendChild(el); }
    el.classList.toggle('mal', S.msg.mal); el.textContent = S.msg.t;
  }

  async function load() {
    try {
      S.yo = await call('estado');
      if (S.yo.rol?.admin && S.tab === 'empresa') S.adm = await call('admin');
      if (S.yo.rol?.propietario && S.tab === 'synqalia') S.own = await call('propietario');
      render();
    } catch (e) { view.innerHTML = `<div class="iax"><p class="note">${esc(e.message || e)}</p></div>`; }
  }
  async function go(tab) {
    S.tab = tab; S.edit = null; S.editPlan = null;
    view.querySelector('.iax-body')?.classList.add('cargando');
    try {
      if (tab === 'empresa') S.adm = await call('admin');
      if (tab === 'synqalia') S.own = await call('propietario');
    } catch (e) { toast(e.message, true); }
    render();
  }
  async function act(action, extra, ok) {
    if (S.busy) return;
    S.busy = true;
    try { const r = await call(action, extra); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); S.busy = false; return r; }
    catch (e) { S.busy = false; toast(e.message, true); return null; }
  }

  /* ---------- Mi uso ---------- */
  function vYo(d) {
    if (!d.activa) return `<section class="iax-card"><h3>IA de Synqalia</h3><p>Tu empresa todavía no tiene activada la IA de Synqalia. Habla con tu administrador.</p></section>`;
    const u = d.usos_aprox || {};
    const usos = [u.respuestas != null && `<b>${u.respuestas} respuestas sugeridas</b>`, u.resumenes != null && `<b>${u.resumenes} resúmenes</b>`, u.asistente != null && `<b>${u.asistente} preguntas al Asistente</b>`].filter(Boolean);
    const aviso = d.pausada
      ? `<div class="iax-alert bad" role="alert">${IC.warn}<div><b>La IA está en pausa.</b> Has llegado al 100 % de ${d.tiene_limite_propio ? 'tu límite' : 'el saldo de tu empresa'} este mes. Vuelve el ${fDia(d.renueva)} o cuando tu administrador lo amplíe. El resto de Synqalia sigue funcionando.</div></div>`
      : d.pct >= 80 ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Has usado el ${pc(d.pct)}</b> de ${d.tiene_limite_propio ? 'tu límite' : 'la IA de tu empresa'} este mes.</div></div>` : '';
    const avz = d.nivel === 'avanzada';
    return `${aviso}
    <div class="iax-grid iax-g3">
      <section class="iax-card iax-span2">
        <div class="iax-hero"><div><small>Te queda</small><strong>${pc(d.queda_pct)}</strong></div><p>Has usado el ${pc(d.pct)} de ${d.tiene_limite_propio ? 'tu límite mensual' : 'la IA de tu empresa'}<br>Se renueva el ${esc(fDia(d.renueva))}</p></div>
        <div class="iax-bigbar">${bar(d.pct)}<span class="iax-mark" style="left:80%"></span></div>
        <div class="iax-scale"><span>0 %</span><span>Aviso 80 %</span><span>100 % · la IA se pausa</span></div>
        ${usos.length && !d.pausada ? `<p class="iax-soft">Con lo que te queda: unas ${usos.join(' o ')}.</p>` : ''}
      </section>
      <section class="iax-card iax-col">
        <small>Tu nivel de IA</small>
        <strong class="iax-lvl">${avz ? 'IA avanzada' : 'IA básica'}</strong>
        <p>${avz ? 'Modelo superior para textos largos y análisis. La activa tu administrador.' : 'Incluida en tu plan: respuestas, resúmenes y Asistente con el modelo estándar.'}</p>
        ${avz ? '' : d.pide_avanzada ? `<p class="iax-soft">Pediste la IA avanzada el ${esc(fDia(d.pide_avanzada))}. Tu administrador la tiene pendiente.</p>` : `<div class="iax-dash"><b>IA avanzada</b> · modelo superior para textos largos y análisis. La activa tu administrador.</div><button type="button" class="btn iax-out" data-a="pedir">Pedir IA avanzada</button>`}
      </section>
    </div>
    <section class="iax-card">
      <h3>En qué lo has usado</h3>
      ${d.por_funcion.length ? `<div class="iax-rows">${d.por_funcion.map((f) => `<div class="iax-row"><span>${esc(f.nombre)}</span>${bar(f.pct)}<span class="iax-muted">${f.usos} ${f.usos === 1 ? 'uso' : 'usos'}</span><b>${pc(f.pct)}</b></div>`).join('')}</div>` : '<p class="iax-soft">Aún no has usado la IA este mes.</p>'}
    </section>
    <section class="iax-card iax-info">
      <div><b>Avisos</b><span>${d.aviso_80 || d.aviso_100 ? `Te avisamos aquí al llegar ${[d.aviso_80 && 'al 80 %', d.aviso_100 && 'al 100 %'].filter(Boolean).join(' y ')}.` : 'Tu empresa no tiene avisos activados.'}</span></div>
      <div><b>Si llegas al 100 %</b><span>La IA se pausa hasta el día 1 o hasta que tu administrador amplíe el límite. El resto de Synqalia sigue funcionando.</span></div>
      <div><b>Privacidad</b><span>Tus datos se guardan en la UE.</span></div>
    </section>`;
  }

  /* ---------- Empresa (administrador) ---------- */
  function vAdmin(d) {
    if (!d) return '<p class="note">Cargando…</p>';
    if (!d.activa) return '<section class="iax-card"><p>La IA de Synqalia no está activada para tu empresa.</p></section>';
    const s = d.saldo, c = d.config;
    const alerta = s.pct >= 100 ? `<div class="iax-alert bad" role="alert">${IC.warn}<div><b>Se ha acabado el saldo de IA de la empresa.</b> La IA está en pausa para todo el equipo hasta el ${esc(fDia(d.renueva))} o hasta que añadas saldo.</div></div>`
      : s.pct >= 80 ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Habéis usado el ${pc(s.pct)} del saldo de la empresa.</b> Al llegar al 100 % la IA se pausa para todo el equipo hasta el ${esc(fDia(d.renueva))}.</div></div>` : '';
    const piden = d.personas.filter((p) => p.pide_avanzada && p.nivel !== 'avanzada');
    const filas = d.personas.map((p) => {
      const abierta = S.edit === p.email;
      const est = p.pct == null ? '<span class="iax-muted">sin límite</span>' : p.pct >= 100 ? '<span class="iax-chip bad">Pausada</span>' : p.pct >= 80 ? `<span class="iax-chip warn">${pc(p.pct)}</span>` : `<span class="iax-muted">${pc(p.pct)}</span>`;
      return `<div class="iax-p${abierta ? ' on' : ''}">
        <div class="iax-p-main"><b>${esc(p.nombre)}</b> <small>· ${p.nivel === 'avanzada' ? 'avanzada' : 'básica'}${p.pide_avanzada && p.nivel !== 'avanzada' ? ' · pide avanzada' : ''}</small>${p.limite ? bar(p.pct) : ''}</div>
        <div class="iax-p-num">${eur(p.usado)}${p.limite ? ' / ' + eur(p.limite) : ''}<br>${est}</div>
        <button type="button" class="btn" data-a="editp" data-e="${esc(p.email)}" aria-expanded="${abierta}" aria-label="Editar límite de ${esc(p.nombre)}">${abierta ? 'Cerrar' : 'Editar'}</button>
        ${abierta ? `<form class="iax-pform" data-f="persona" data-e="${esc(p.email)}">
          <label>Nivel<select name="nivel"><option value="basica"${p.nivel !== 'avanzada' ? ' selected' : ''}>IA básica</option><option value="avanzada"${p.nivel === 'avanzada' ? ' selected' : ''}>IA avanzada</option></select></label>
          <label>Límite al mes (€)<input name="limite" inputmode="decimal" value="${p.limite_propio ?? ''}" placeholder="${c.limite_persona != null ? 'El de la empresa: ' + eur(c.limite_persona) : 'Sin límite'}"></label>
          <button type="submit" class="btn primary">Guardar</button></form>` : ''}
      </div>`;
    }).join('');
    const imp = [50, 100, 250];
    const otro = !imp.includes(S.importe);
    return `${alerta}
    <div class="iax-head"><div><h2>IA y saldo de la empresa</h2><p>${esc(d.empresa)} · se renueva el ${esc(fDia(d.renueva))}</p></div><a href="#iax-recargar" class="btn primary iax-big">Comprar / solicitar más saldo</a></div>
    <div class="iax-grid iax-g4">
      <div class="iax-kpi"><small>Saldo disponible</small><strong>${eur(s.disponible)}</strong><span>${eur(s.mensual)} al mes${s.recargas_restantes ? ' + ' + eur(s.recargas_restantes) + ' de recargas' : ''}</span></div>
      <div class="iax-kpi"><small>Consumido este mes</small><strong class="${tono(s.pct)}">${eur(s.consumido)}</strong><span>${pc(s.pct)}${s.fin_estimado ? ' · a este ritmo se acaba el ' + esc(fDia(s.fin_estimado)) : ''}</span></div>
      <div class="iax-kpi"><small>Recargas extra</small><strong>${eur(s.recargas_mes)}</strong><span>este mes</span></div>
      <div class="iax-kpi"><small>IA avanzada</small><strong>${d.avanzada} de ${d.personas.length}</strong><span>personas</span></div>
    </div>
    ${piden.length ? `<section class="iax-card iax-ask"><h3>Piden la IA avanzada</h3>${piden.map((p) => `<div class="iax-line"><span><b>${esc(p.nombre)}</b> · lo pidió el ${esc(fDia(p.pide_avanzada))}</span><span class="iax-btns"><button type="button" class="btn primary" data-a="avz" data-e="${esc(p.email)}" data-n="avanzada">Activar</button><button type="button" class="btn" data-a="avz" data-e="${esc(p.email)}" data-n="basica">Dejar en básica</button></span></div>`).join('')}</section>` : ''}
    <div class="iax-grid iax-g3">
      <section class="iax-card iax-span2"><div class="iax-ch"><h3>Consumo por persona</h3><button type="button" class="btn" data-a="csv">Exportar CSV</button></div><div class="iax-plist">${filas || '<p class="iax-soft">No hay personas dadas de alta.</p>'}</div></section>
      <section class="iax-card"><h3>Por función</h3>${d.por_funcion.length ? `<div class="iax-fn">${d.por_funcion.map((f) => `<div><div class="iax-lr"><span>${esc(f.nombre)}</span><b>${eur(f.importe)}</b></div>${bar(s.consumido ? (f.importe / s.consumido) * 100 : 0)}</div>`).join('')}</div>` : '<p class="iax-soft">Aún no hay consumo este mes.</p>'}</section>
    </div>
    <div class="iax-grid iax-g2">
      <section class="iax-card"><h3>Límites y avisos</h3>
        <form class="iax-form" data-f="empresa">
          <div class="iax-two">
            <label>Límite mensual de la empresa (€)<input name="limite_mensual" inputmode="decimal" value="${c.limite_mensual ?? ''}" placeholder="Sin límite: hasta agotar el saldo"></label>
            <label>Límite por persona (€, por defecto)<input name="limite_persona" inputmode="decimal" value="${c.limite_persona ?? ''}" placeholder="Sin límite"></label>
          </div>
          <div class="iax-checks">
            <label><input type="checkbox" name="aviso_80"${c.aviso_80 ? ' checked' : ''}>Avisar al 80 %</label>
            <label><input type="checkbox" name="aviso_100"${c.aviso_100 ? ' checked' : ''}>Avisar al 100 %</label>
            <label><input type="checkbox" name="aviso_correo_admin"${c.aviso_correo_admin ? ' checked' : ''}>Avisarme también a mí</label>
          </div>
          <fieldset><legend>Al llegar al 100 %</legend>
            <label><input type="radio" name="al_tope" value="pausar"${c.al_tope !== 'tarjeta' ? ' checked' : ''}>Pausar la IA hasta el mes siguiente</label>
            <label><input type="radio" name="al_tope" value="tarjeta"${c.al_tope === 'tarjeta' ? ' checked' : ''}${d.tarjeta ? '' : ' disabled'}>Recargar con tarjeta hasta un máximo de <input name="tope_tarjeta" inputmode="decimal" class="iax-mini" value="${c.tope_tarjeta ?? ''}" aria-label="Máximo de recargas con tarjeta al mes"${d.tarjeta ? '' : ' disabled'}> €${d.tarjeta ? '' : ' <small>(cuando se active el pago con tarjeta)</small>'}</label>
          </fieldset>
          <button type="submit" class="btn primary iax-dark">Guardar cambios</button>
          <small class="iax-muted">Cada cambio queda en el registro de cambios.</small>
        </form>
      </section>
      <section class="iax-card iax-buy" id="iax-recargar"><h3>Comprar / solicitar más saldo</h3>
        <div class="iax-amts" role="group" aria-label="Importe">${imp.map((v) => `<button type="button" class="btn${S.importe === v ? ' on' : ''}" aria-pressed="${S.importe === v}" data-a="imp" data-v="${v}">${v} €</button>`).join('')}<label class="iax-otro${otro ? ' on' : ''}"><span class="vh">Otro importe</span><input inputmode="decimal" data-a="impotro" placeholder="Otro" value="${otro ? S.importe : ''}"> €</label></div>
        <div class="iax-opt"><b>Pagar ahora con tarjeta</b><span>Pago seguro con Stripe. El saldo se suma en cuanto se confirma el pago y recibes la factura por correo. Se añade el IVA (${d.iva} %).</span>
          <button type="button" class="btn primary iax-big" data-a="pagar"${d.tarjeta ? '' : ' disabled'}>${d.tarjeta ? 'Pagar ' + eur(S.importe) + ' + IVA con tarjeta' : 'Pago con tarjeta: pendiente de activar'}</button></div>
        <div class="iax-opt"><b>Solicitar a Synqalia</b><span>Sin tarjeta: Synqalia lo aprueba y se incluye en tu próxima factura. El saldo se suma cuando se aprueba.</span>
          <button type="button" class="btn iax-out iax-big" data-a="solicitar">Enviar solicitud de ${eur(S.importe)}</button></div>
      </section>
    </div>
    <div class="iax-grid iax-g2">
      <section class="iax-card"><h3>Historial de recargas</h3>${d.recargas.length ? `<div class="iax-list">${d.recargas.map((r) => `<div class="iax-line"><span>${esc(fDia(r.created_at))} · ${r.tipo === 'tarjeta' ? 'Tarjeta (Stripe)' : r.tipo === 'solicitud' ? 'Solicitud a Synqalia' : 'Ajuste de Synqalia'} · <span class="iax-chip ${r.estado === 'pendiente' ? 'info' : ['pagada', 'aprobada'].includes(r.estado) ? 'ok' : ''}">${esc(r.estado)}</span>${r.estado === 'pendiente' && r.tipo === 'solicitud' ? ` <button type="button" class="iax-link" data-a="cancelar" data-id="${esc(r.id)}">Cancelar</button>` : ''}</span><b>${eur(r.importe)}</b></div>`).join('')}</div>` : '<p class="iax-soft">Todavía no hay recargas. Cada mes se incluye el saldo del plan.</p>'}</section>
      <section class="iax-card"><h3>Registro de cambios</h3>${vRegistro(d.registro)}</section>
    </div>
    <p class="iax-foot">Datos tratados y guardados en la UE.</p>`;
  }
  const vRegistro = (rows, conEmpresa) => (rows && rows.length ? `<div class="iax-log">${rows.map((r) => `<div><b>${esc(fHora(r.fecha))} · ${esc(r.por)}${conEmpresa && r.company_id && r.company_id !== 'plataforma' ? ' · ' + esc(r.company_id) : ''}</b><span>${esc(r.texto)}</span></div>`).join('')}</div>` : '<p class="iax-soft">Sin cambios todavía.</p>');

  /* ---------- Synqalia (propietario) ---------- */
  function vOwner(d) {
    if (!d) return '<p class="note">Cargando…</p>';
    const t = d.totales, a = d.anthropic, pl = d.plataforma || {};
    const consola = '<a class="btn iax-danger" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Abrir consola de Anthropic ' + IC.ext + '</a>';
    const alerta = !a ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Apunta tu saldo de Anthropic</b> para que te avise antes de que se acabe. Anthropic no deja leerlo desde fuera: escribe aquí lo que te marca su consola cada vez que recargues.</div>${consola}</div>`
      : a.bajo || (a.dias != null && a.dias <= 7) ? `<div class="iax-alert bad" role="alert">${IC.warn}<div><b>Tu saldo de Anthropic: unos ${usd(a.restante)}.</b> ${a.dias != null ? `Al ritmo de esta semana se acaba en unos ${a.dias} días.` : ''} Si se acaba, la IA se para en todas las empresas. Recarga automática: <b>${pl.anthropic_recarga_auto ? 'activada' : 'desactivada'}</b>.</div>${consola}</div>`
      : `<div class="iax-alert ok" role="status"><div><b>Saldo de Anthropic: unos ${usd(a.restante)}</b>${a.dias != null ? ` · te llega para unos ${a.dias} días` : ''}. Apuntado ${esc(fDia(a.fecha))}: ${usd(a.apuntado)}, gastado desde entonces ${usd(a.gastado)}.</div></div>`;
    const maxMes = Math.max(1, ...d.meses.map((m) => Math.max(m.cobrado, m.coste)));
    const filas = d.empresas.map((e) => {
      const ab = S.editPlan === e.company_id;
      return `<tr><td><b>${esc(e.nombre)}</b>${e.activa ? '' : ' <span class="iax-chip">IA desactivada</span>'}</td><td>${e.usuarios}</td><td class="r">${eur(e.cobrado)}</td><td class="r">${eur(e.coste)}</td><td class="r ${e.margen_pct != null && e.margen_pct < (pl.margen_min_pct ?? 60) ? 'warn' : ''}">${pc(e.margen_pct)}</td>
        <td><div class="iax-inl">${bar(e.pct)}<span>${pc(e.pct)}</span></div></td>
        <td>${e.solicitudes ? '<span class="iax-chip info">Solicitud pendiente</span>' : e.pct >= 100 ? '<span class="iax-chip bad">Sin saldo</span>' : e.pct >= 80 ? '<span class="iax-chip warn">Cerca del límite</span>' : '<span class="iax-muted">Normal</span>'}</td>
        <td><button type="button" class="btn" data-a="plan" data-c="${esc(e.company_id)}" aria-expanded="${ab}">${ab ? 'Cerrar' : 'Plan'}</button></td></tr>
        ${ab ? `<tr class="iax-planrow"><td colspan="8"><form class="iax-pform" data-f="plan" data-c="${esc(e.company_id)}">
          <label>Saldo incluido al mes (€)<input name="saldo_mensual" inputmode="decimal" value="${e.saldo_mensual}"></label>
          <label>Multiplicador de precio<input name="multiplicador" inputmode="decimal" value="${e.multiplicador ?? ''}" placeholder="El general: ${pl.multiplicador ?? ''}"></label>
          <label class="iax-chk"><input type="checkbox" name="activa"${e.activa ? ' checked' : ''}>IA activada</label>
          <button type="submit" class="btn primary">Guardar plan</button>
          <span class="iax-sep"></span>
          <label>Añadir saldo (€)<input name="ajuste" inputmode="decimal" placeholder="p. ej. 50"></label>
          <button type="button" class="btn" data-a="ajuste" data-c="${esc(e.company_id)}">Añadir</button></form></td></tr>` : ''}`;
    }).join('');
    return `<div class="iax-head"><div><h2>IA de todas las empresas</h2><p>Mes en curso · ${d.empresas.length} empresas · ${t.usuarios} usuarios</p></div><button type="button" class="btn" data-a="csvall">Exportar CSV</button></div>
    ${alerta}
    <div class="iax-grid iax-g5">
      <div class="iax-kpi"><small>Cobrado a clientes</small><strong>${eur(t.cobrado)}</strong><span>consumo a precio de venta</span></div>
      <div class="iax-kpi"><small>Coste Anthropic</small><strong>${eur(t.coste)}</strong><span>${usd(t.coste_usd)} al cambio de ${pl.usd_eur ?? ''}</span></div>
      <div class="iax-kpi"><small>Margen</small><strong class="okc">${eur(t.margen)}</strong><span>${pc(t.margen_pct)} · objetivo ${pc(pl.margen_min_pct)}</span></div>
      <div class="iax-kpi"><small>Coste de hoy</small><strong class="${t.disparado ? 'warn' : ''}">${eur(t.coste_hoy)}</strong><span>${t.disparado ? '<b class="warn">Gasto disparado</b> · ' : ''}media ${eur(t.media_dia)}/día</span></div>
      <div class="iax-kpi"><small>Cerca del límite</small><strong>${d.empresas.filter((e) => e.pct >= 80).length} empresas</strong><span>más del 80 %</span></div>
    </div>
    <section class="iax-card"><h3>Empresas</h3><div class="iax-scroll"><table class="iax-tab"><thead><tr><th>Empresa</th><th>Usuarios</th><th class="r">Cobrado</th><th class="r">Coste IA</th><th class="r">Margen</th><th>Uso del saldo</th><th>Estado</th><th><span class="vh">Plan</span></th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr><td><b>Total</b></td><td>${t.usuarios}</td><td class="r"><b>${eur(t.cobrado)}</b></td><td class="r"><b>${eur(t.coste)}</b></td><td class="r"><b>${pc(t.margen_pct)}</b></td><td colspan="3"></td></tr></tfoot></table></div>
      <form class="iax-pform iax-new" data-f="nueva"><label>Nueva empresa (id)<input name="company_id" placeholder="p. ej. acme" pattern="[a-z0-9_\\-]{2,40}"></label><label>Nombre<input name="nombre"></label><label>Saldo al mes (€)<input name="saldo_mensual" inputmode="decimal"></label><button type="submit" class="btn">Dar de alta</button></form>
    </section>
    <div class="iax-grid iax-g3">
      <section class="iax-card"><h3>Solicitudes de saldo</h3>${d.solicitudes.length ? d.solicitudes.map((x) => `<div class="iax-opt"><div><b>${esc(x.empresa)} · ${eur(x.importe)}</b><br><span class="iax-muted">${esc(fHora(x.created_at))} · la pide ${esc(x.quien || 'su administrador')} · a la próxima factura${x.nota ? ' · «' + esc(x.nota) + '»' : ''}</span></div>
        <div class="iax-btns"><button type="button" class="btn iax-okb" data-a="resolver" data-id="${esc(x.id)}" data-ok="1">Aprobar</button><button type="button" class="btn" data-a="resolver" data-id="${esc(x.id)}" data-ok="0">Rechazar</button></div></div>`).join('') : '<p class="iax-soft">No hay solicitudes pendientes.</p>'}</section>
      <section class="iax-card"><h3>Coste frente a cobrado</h3>${d.meses.length ? `<div class="iax-chart" role="img" aria-label="Cobrado y coste por mes">${d.meses.map((m) => `<div><div class="iax-cols"><i style="height:${(m.cobrado / maxMes) * 100}%" title="Cobrado ${eur(m.cobrado)}"></i><i class="c" style="height:${(m.coste / maxMes) * 100}%" title="Coste ${eur(m.coste)}"></i></div><span>${esc(fMes(m.mes))}</span></div>`).join('')}</div>
        <div class="iax-legend"><span><i></i>Cobrado</span><span><i class="c"></i>Coste Anthropic</span></div>` : '<p class="iax-soft">Aún no hay meses con consumo.</p>'}</section>
      <section class="iax-card"><h3>Saldo de Anthropic y avisos</h3>
        <form class="iax-form" data-f="anthropic"><label>Saldo que marca la consola ahora (US$)<input name="anthropic_saldo_usd" inputmode="decimal" placeholder="${a ? 'Último: ' + usd(a.apuntado) : 'p. ej. 200'}"></label><button type="submit" class="btn">Apuntar saldo</button></form>
        <form class="iax-form" data-f="plataforma">
          <label>Avisarme si el saldo de Anthropic baja de (US$)<input name="aviso_saldo_usd" inputmode="decimal" value="${pl.aviso_saldo_usd ?? ''}"></label>
          <label>Gasto disparado: coste del día por encima del (% de la media)<input name="gasto_disparado_pct" inputmode="numeric" value="${pl.gasto_disparado_pct ?? ''}"></label>
          <label>Margen mínimo por empresa (%)<input name="margen_min_pct" inputmode="numeric" value="${pl.margen_min_pct ?? ''}"></label>
          <label>Multiplicador de precio general (venta = coste × …)<input name="multiplicador" inputmode="decimal" value="${pl.multiplicador ?? ''}"></label>
          <label>Cambio: € por cada US$<input name="usd_eur" inputmode="decimal" value="${pl.usd_eur ?? ''}"></label>
          <label class="iax-chk"><input type="checkbox" name="anthropic_recarga_auto"${pl.anthropic_recarga_auto ? ' checked' : ''}>Tengo la recarga automática activada en Anthropic</label>
          <label>Modelo de IA básica<select name="modelo_basica">${d.modelos.map((m) => `<option${m.modelo === pl.modelo_basica ? ' selected' : ''}>${esc(m.modelo)}</option>`).join('')}</select></label>
          <label>Modelo de IA avanzada<select name="modelo_avanzada">${d.modelos.map((m) => `<option${m.modelo === pl.modelo_avanzada ? ' selected' : ''}>${esc(m.modelo)}</option>`).join('')}</select></label>
          <button type="submit" class="btn primary iax-dark">Guardar ajustes</button></form>
      </section>
    </div>
    <section class="iax-card"><h3>Precios de los modelos (US$ por millón de tokens)</h3><div class="iax-scroll"><table class="iax-tab"><thead><tr><th>Modelo</th><th>Nivel</th><th class="r">Entrada</th><th class="r">Salida</th><th class="r">Caché escritura</th><th class="r">Caché lectura</th></tr></thead><tbody>${d.modelos.map((m) => `<tr><td>${esc(m.modelo)}</td><td>${m.nivel === 'avanzada' ? 'Avanzada' : 'Básica'}</td><td class="r">${m.usd_in}</td><td class="r">${m.usd_out}</td><td class="r">${m.usd_cache_write}</td><td class="r">${m.usd_cache_read}</td></tr>`).join('')}</tbody></table></div>
      <form class="iax-pform" data-f="modelo"><label>Modelo<input name="modelo" placeholder="claude-…"></label><label>Nivel<select name="nivel"><option value="basica">Básica</option><option value="avanzada">Avanzada</option></select></label><label>Entrada<input name="usd_in" inputmode="decimal"></label><label>Salida<input name="usd_out" inputmode="decimal"></label><label>Caché escr.<input name="usd_cache_write" inputmode="decimal"></label><label>Caché lect.<input name="usd_cache_read" inputmode="decimal"></label><button type="submit" class="btn">Guardar precio</button></form></section>
    <section class="iax-card"><h3>Registro de cambios (todas las empresas)</h3>${vRegistro(d.registro, true)}</section>
    <p class="iax-foot">Todos los datos se tratan y guardan en la UE. Esta vista solo la ve el propietario de Synqalia.</p>`;
  }

  function render() {
    const d = S.yo;
    if (!d) return;
    const tabs = [['yo', 'Mi uso'], d.rol?.admin && ['empresa', 'Empresa'], d.rol?.propietario && ['synqalia', 'Synqalia']].filter(Boolean);
    if (!tabs.find((t) => t[0] === S.tab)) S.tab = 'yo';
    const y = view.scrollTop;
    view.innerHTML = `<div class="iax">
      <div class="iax-top"><div><small>Configuración</small><h2>IA y saldo</h2></div>
      ${tabs.length > 1 ? `<div class="iax-tabs" role="tablist" aria-label="Vista">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${S.tab === k}" data-a="tab" data-t="${k}">${l}</button>`).join('')}</div>` : ''}</div>
      <div class="iax-body">${S.tab === 'empresa' ? vAdmin(S.adm) : S.tab === 'synqalia' ? vOwner(S.own) : vYo(d)}</div></div>`;
    view.scrollTop = y;
    paintMsg();
  }

  async function refresh(tab) { if (tab === 'empresa') S.adm = await call('admin'); if (tab === 'synqalia') S.own = await call('propietario'); S.yo = await call('estado'); render(); }
  function descargar(r) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
    a.download = r.nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  view.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]');
    if (!b || b.tagName === 'INPUT' || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'tab') return go(b.dataset.t);
    if (a === 'editp') { S.edit = S.edit === b.dataset.e ? null : b.dataset.e; return render(); }
    if (a === 'plan') { S.editPlan = S.editPlan === b.dataset.c ? null : b.dataset.c; return render(); }
    if (a === 'imp') { S.importe = Number(b.dataset.v); return render(); }
    if (a === 'pedir') { if (await act('pedir_avanzada', {}, 'Petición enviada a tu administrador')) refresh('yo'); return; }
    if (a === 'avz') { if (await act('guardar_persona', { email: b.dataset.e, nivel: b.dataset.n }, b.dataset.n === 'avanzada' ? 'IA avanzada activada' : 'Se queda en IA básica')) refresh('empresa'); return; }
    if (a === 'solicitar') { if (!confirm(`¿Enviar a Synqalia una solicitud de ${eur(S.importe)} de saldo? Se incluirá en tu próxima factura cuando se apruebe.`)) return; if (await act('recargar', { importe: S.importe, modo: 'solicitud' }, 'Solicitud enviada. Te avisaremos cuando se apruebe.')) refresh('empresa'); return; }
    if (a === 'pagar') { const r = await act('recargar', { importe: S.importe, modo: 'tarjeta' }); if (r && r.url) location.href = r.url; return; }
    if (a === 'cancelar') { if (!confirm('¿Cancelar esta solicitud?')) return; if (await act('cancelar_solicitud', { id: b.dataset.id }, 'Solicitud cancelada')) refresh('empresa'); return; }
    if (a === 'csv' || a === 'csvall') { const r = await act('exportar', { todas: a === 'csvall' }); if (r) descargar(r); return; }
    if (a === 'resolver') {
      const ok = b.dataset.ok === '1';
      if (!confirm(ok ? '¿Aprobar esta solicitud? El saldo se suma ahora y se factura en la próxima factura.' : '¿Rechazar esta solicitud?')) return;
      if (await act('resolver_solicitud', { id: b.dataset.id, aprobar: ok }, ok ? 'Solicitud aprobada' : 'Solicitud rechazada')) refresh('synqalia');
      return;
    }
    if (a === 'ajuste') {
      const f = b.closest('form'); const v = num(f.elements.ajuste.value);
      if (!v || v <= 0) return toast('Escribe el importe a añadir', true);
      if (!confirm(`¿Añadir ${eur(v)} de saldo a esta empresa?`)) return;
      if (await act('ajuste', { company_id: b.dataset.c, importe: v }, 'Saldo añadido')) refresh('synqalia');
    }
  });
  view.addEventListener('input', (ev) => {
    if (ev.target.dataset && ev.target.dataset.a === 'impotro') { const v = num(ev.target.value); if (v > 0) { S.importe = v; view.querySelectorAll('[data-a="pagar"],[data-a="solicitar"]').forEach((x) => { x.textContent = x.dataset.a === 'pagar' ? (x.disabled ? x.textContent : 'Pagar ' + eur(v) + ' + IVA con tarjeta') : 'Enviar solicitud de ' + eur(v); }); view.querySelectorAll('[data-a="imp"]').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); } }
  });
  view.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('form[data-f]'); if (!f) return;
    ev.preventDefault();
    const E = f.elements, k = f.dataset.f;
    const bad = (x) => x !== null && !(x >= 0);
    if (k === 'persona') {
      const lim = num(E.limite.value); if (bad(lim)) return toast('Límite no válido', true);
      if (await act('guardar_persona', { email: f.dataset.e, nivel: E.nivel.value, limite: lim }, 'Guardado')) { S.edit = null; refresh('empresa'); }
    } else if (k === 'empresa') {
      const cfg = { limite_mensual: num(E.limite_mensual.value), limite_persona: num(E.limite_persona.value), aviso_80: E.aviso_80.checked, aviso_100: E.aviso_100.checked, aviso_correo_admin: E.aviso_correo_admin.checked, al_tope: (f.querySelector('[name="al_tope"]:checked') || {}).value || 'pausar' };
      if (!E.tope_tarjeta.disabled) cfg.tope_tarjeta = num(E.tope_tarjeta.value);
      if ([cfg.limite_mensual, cfg.limite_persona, cfg.tope_tarjeta ?? null].some(bad)) return toast('Revisa los importes', true);
      if (await act('guardar_empresa', { config: cfg }, 'Cambios guardados')) refresh('empresa');
    } else if (k === 'plan') {
      const saldo = num(E.saldo_mensual.value); if (saldo == null || bad(saldo)) return toast('Saldo no válido', true);
      if (await act('guardar_plan', { company_id: f.dataset.c, saldo_mensual: saldo, multiplicador: E.multiplicador.value.trim() === '' ? null : num(E.multiplicador.value), activa: E.activa.checked }, 'Plan guardado')) { S.editPlan = null; refresh('synqalia'); }
    } else if (k === 'nueva') {
      const id = E.company_id.value.trim().toLowerCase(); if (!id) return toast('Escribe el identificador de la empresa', true);
      if (await act('guardar_plan', { company_id: id, nombre: E.nombre.value.trim() || id, saldo_mensual: num(E.saldo_mensual.value) || 0, activa: true }, 'Empresa dada de alta')) refresh('synqalia');
    } else if (k === 'anthropic') {
      const v = num(E.anthropic_saldo_usd.value); if (v == null || bad(v)) return toast('Escribe el saldo en US$', true);
      if (await act('guardar_plataforma', { config: { anthropic_saldo_usd: v } }, 'Saldo de Anthropic apuntado')) refresh('synqalia');
    } else if (k === 'plataforma') {
      const cfg = { aviso_saldo_usd: num(E.aviso_saldo_usd.value), gasto_disparado_pct: num(E.gasto_disparado_pct.value), margen_min_pct: num(E.margen_min_pct.value), multiplicador: num(E.multiplicador.value), usd_eur: num(E.usd_eur.value), anthropic_recarga_auto: E.anthropic_recarga_auto.checked, modelo_basica: E.modelo_basica.value, modelo_avanzada: E.modelo_avanzada.value };
      if (await act('guardar_plataforma', { config: cfg }, 'Ajustes guardados')) refresh('synqalia');
    } else if (k === 'modelo') {
      const m = { modelo: E.modelo.value.trim(), nivel: E.nivel.value, usd_in: num(E.usd_in.value), usd_out: num(E.usd_out.value), usd_cache_write: num(E.usd_cache_write.value) || 0, usd_cache_read: num(E.usd_cache_read.value) || 0 };
      if (!m.modelo || m.usd_in == null || m.usd_out == null) return toast('Faltan el modelo y sus precios', true);
      if (await act('guardar_modelo', { modelo: m }, 'Precio guardado')) refresh('synqalia');
    }
  });

  // Al volver del pago con tarjeta
  const qp = new URLSearchParams(location.search);
  if (qp.has('ia_pago')) {
    const ok = qp.get('ia_pago') === 'ok';
    S.tab = 'empresa';
    setTimeout(() => toast(ok ? 'Pago recibido. El saldo se suma en cuanto Stripe lo confirma (unos segundos).' : 'Pago cancelado: no se ha cobrado nada.', !ok), 600);
    qp.delete('ia_pago');
    history.replaceState(null, '', location.pathname + (qp.toString() ? '?' + qp : '') + location.hash);
  }

  const visible = () => !view.hidden;
  let cargado = false;
  const alEntrar = () => { if (visible()) { if (!cargado) view.innerHTML = '<div class="iax"><p class="note">Cargando tu IA y saldo…</p></div>'; cargado = true; load(); } };
  new MutationObserver(alEntrar).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  alEntrar();
})();
