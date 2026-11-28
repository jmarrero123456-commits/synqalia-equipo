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
  // «1.234,50» o «1234,5» o «0.89»: con coma, los puntos son de miles; sin coma, el punto es el decimal
  const num = (s) => { let t = String(s ?? '').trim().replace(/\s|€|US\$/g, ''); if (t === '') return null; if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const n = Number(t); return isFinite(n) ? n : NaN; };
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
  const AHORRO = 'la IA avanzada pasa a básica y la básica sigue funcionando';
  function vYo(d) {
    if (!d.activa) return `<section class="iax-card"><h3>IA de Synqalia</h3><p>Tu empresa todavía no tiene activada la IA de Synqalia. Habla con tu administrador.</p></section>`;
    const u = d.usos_aprox || {};
    const usos = [u.sugerida != null && `<b>${u.sugerida} respuestas sugeridas</b>`, u.resumen != null && `<b>${u.resumen} resúmenes</b>`, u.asistente != null && `<b>${u.asistente} preguntas al Asistente</b>`].filter(Boolean);
    const de = d.tiene_limite_propio ? 'tu límite' : 'el saldo de tu empresa';
    const pausa = d.al_tope === 'pausar';
    const aviso = d.agotado
      ? (pausa ? `<div class="iax-alert bad" role="alert">${IC.warn}<div><b>La IA está en pausa.</b> Has llegado al 100 % de ${de} este mes. Vuelve el ${fDia(d.renueva)} o cuando tu administrador lo amplíe. El resto de Synqalia sigue funcionando.</div></div>`
        : `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Se ha acabado ${de} de este mes.</b> La IA sigue en modo ahorro: ${AHORRO}.</div></div>`)
      : d.pct >= 80 ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Has usado el ${pc(d.pct)}</b> de ${de} este mes.</div></div>` : '';
    const avz = d.nivel === 'avanzado';
    return `${aviso}
    <div class="iax-grid iax-g3">
      <section class="iax-card iax-span2">
        <div class="iax-hero"><div><small>Te queda</small><strong>${pc(d.queda_pct)}</strong></div><p>Has usado el ${pc(d.pct)} de ${d.tiene_limite_propio ? 'tu límite mensual' : 'la IA de tu empresa'}<br>Se renueva el ${esc(fDia(d.renueva))}</p></div>
        <div class="iax-bigbar">${bar(d.pct)}<span class="iax-mark" style="left:80%"></span></div>
        <div class="iax-scale"><span>0 %</span><span>Aviso 80 %</span><span>100 % · ${pausa ? 'la IA se pausa' : 'modo ahorro'}</span></div>
        ${usos.length && !d.agotado ? `<p class="iax-soft">Con lo que te queda: unas ${usos.join(' o ')}.</p>` : ''}
      </section>
      <section class="iax-card iax-col">
        <small>Tu nivel de IA</small>
        <strong class="iax-lvl">${avz ? 'IA avanzada' : 'IA básica'}</strong>
        <p>${avz ? 'Modelo superior para textos largos y análisis. La activa tu administrador.' : 'Incluida en tu plan: respuestas, resúmenes y Asistente con el modelo estándar.'}</p>
        ${avz || !d.plan_avanzado ? '' : d.pide_avanzado ? `<p class="iax-soft">Pediste la IA avanzada el ${esc(fDia(d.pide_avanzado))}. Tu administrador la tiene pendiente.</p>` : `<div class="iax-dash"><b>IA avanzada</b> · modelo superior para textos largos y análisis. La activa tu administrador.</div><button type="button" class="btn iax-out" data-a="pedir">Pedir IA avanzada</button>`}
      </section>
    </div>
    <section class="iax-card">
      <h3>En qué lo has usado</h3>
      ${d.por_funcion.length ? `<div class="iax-rows">${d.por_funcion.map((f) => `<div class="iax-row"><span>${esc(f.nombre)}</span>${bar(f.pct)}<span class="iax-muted">${f.usos} ${f.usos === 1 ? 'uso' : 'usos'}</span><b>${pc(f.pct)}</b></div>`).join('')}</div>` : '<p class="iax-soft">Aún no has usado la IA este mes.</p>'}
    </section>
    <section class="iax-card iax-info">
      <div><b>Avisos</b><span>${d.aviso_80 || d.aviso_100 ? `Te avisamos aquí al llegar ${[d.aviso_80 && 'al 80 %', d.aviso_100 && 'al 100 %'].filter(Boolean).join(' y ')}.` : 'Tu empresa no tiene avisos activados.'}</span></div>
      <div><b>Si llegas al 100 %</b><span>${pausa ? 'La IA se pausa hasta el día 1 o hasta que tu administrador amplíe el límite. El resto de Synqalia sigue funcionando.' : 'Modo ahorro: ' + AHORRO + '.'}</span></div>
      <div><b>Privacidad</b><span>Tus datos se guardan en la UE.</span></div>
    </section>`;
  }

  /* ---------- Empresa (administrador) ---------- */
  const TIPO = { tarjeta: 'Tarjeta (Stripe)', solicitud: 'Solicitud a Synqalia', bolsa_mensual: 'Saldo mensual del plan', recarga: 'Recarga', ajuste: 'Ajuste de Synqalia' };
  function vAdmin(d) {
    if (!d) return '<p class="note">Cargando…</p>';
    if (!d.activa) return '<section class="iax-card"><p>La IA de Synqalia no está activada para tu empresa.</p></section>';
    const s = d.saldo, c = d.config, pausa = c.al_tope === 'pausar';
    const alerta = s.pct >= 100 ? `<div class="iax-alert ${pausa ? 'bad' : 'warn'}" role="alert">${IC.warn}<div><b>Se ha acabado el saldo de IA de la empresa.</b> ${pausa ? `La IA está en pausa para todo el equipo hasta el ${esc(fDia(d.renueva))} o hasta que añadas saldo.` : `Modo ahorro: ${AHORRO}${s.exceso ? '; lo que se usa de más queda como exceso (' + eur(s.exceso) + ')' : ''}.`}</div></div>`
      : s.pct >= 80 ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Habéis usado el ${pc(s.pct)} del saldo de la empresa.</b> Al llegar al 100 % ${pausa ? 'la IA se pausa para todo el equipo' : AHORRO}.</div></div>` : '';
    const piden = d.personas.filter((p) => p.pide_avanzado && p.nivel !== 'avanzado');
    const filas = d.personas.map((p) => {
      const abierta = S.edit === p.email;
      const est = p.pct == null ? '<span class="iax-muted">sin límite</span>' : p.pct >= 100 ? `<span class="iax-chip bad">${pausa ? 'Pausada' : 'Al 100 %'}</span>` : p.pct >= 80 ? `<span class="iax-chip warn">${pc(p.pct)}</span>` : `<span class="iax-muted">${pc(p.pct)}</span>`;
      return `<div class="iax-p${abierta ? ' on' : ''}">
        <div class="iax-p-main"><b>${esc(p.nombre)}</b> <small>· ${p.nivel === 'avanzado' ? 'avanzada' : 'básica'}${p.pide_avanzado && p.nivel !== 'avanzado' ? ' · pide avanzada' : ''}</small>${p.limite ? bar(p.pct) : ''}</div>
        <div class="iax-p-num">${eur(p.usado)}${p.limite ? ' / ' + eur(p.limite) : ''}<br>${est}</div>
        <button type="button" class="btn" data-a="editp" data-e="${esc(p.email)}" aria-expanded="${abierta}" aria-label="Editar nivel y límite de ${esc(p.nombre)}">${abierta ? 'Cerrar' : 'Editar'}</button>
        ${abierta ? `<form class="iax-pform" data-f="persona" data-e="${esc(p.email)}">
          <label>Nivel<select name="nivel"><option value="basico"${p.nivel !== 'avanzado' ? ' selected' : ''}>IA básica</option><option value="avanzado"${p.nivel === 'avanzado' ? ' selected' : ''}${d.plan_avanzado ? '' : ' disabled'}>IA avanzada</option></select></label>
          <label>Límite al mes (€)<input name="limite" inputmode="decimal" value="${p.limite_propio ?? ''}" placeholder="${c.limite_persona != null ? 'El de la empresa: ' + eur(c.limite_persona) : 'Sin límite'}"></label>
          <button type="submit" class="btn primary">Guardar</button></form>` : ''}
      </div>`;
    }).join('');
    const imp = [50, 100, 250];
    const otro = !imp.includes(S.importe);
    return `${alerta}
    <div class="iax-head"><div><h2>IA y saldo de la empresa</h2><p>${esc(d.empresa)} · se renueva el ${esc(fDia(d.renueva))}</p></div><a href="#iax-recargar" class="btn primary iax-big">Comprar / solicitar más saldo</a></div>
    <div class="iax-grid iax-g4">
      <div class="iax-kpi"><small>Saldo disponible</small><strong>${eur(s.disponible)}</strong><span>${eur(s.mensual)} este mes${s.por_usuario ? ' (' + eur(s.por_usuario) + ' × ' + s.activos + (s.activos === 1 ? ' usuario' : ' usuarios') + ')' : ''}${s.extra ? ' · ' + eur(s.extra) + ' de recargas' : ''}</span></div>
      <div class="iax-kpi"><small>Consumido este mes</small><strong class="${tono(s.pct)}">${eur(s.consumido)}</strong><span>${pc(s.pct)}${s.fin_estimado ? ' · a este ritmo se acaba el ' + esc(fDia(s.fin_estimado)) : ''}${s.exceso ? ' · exceso ' + eur(s.exceso) : ''}</span></div>
      <div class="iax-kpi"><small>Recargas extra</small><strong>${eur(s.recargas_mes)}</strong><span>este mes</span></div>
      <div class="iax-kpi"><small>IA avanzada</small><strong>${d.avanzada} de ${d.personas.length}</strong><span>${d.plan_avanzado ? 'personas' : 'no incluida en tu plan'}</span></div>
    </div>
    ${piden.length ? `<section class="iax-card iax-ask"><h3>Piden la IA avanzada</h3>${piden.map((p) => `<div class="iax-line"><span><b>${esc(p.nombre)}</b> · lo pidió el ${esc(fDia(p.pide_avanzado))}</span><span class="iax-btns"><button type="button" class="btn primary" data-a="avz" data-e="${esc(p.email)}" data-n="avanzado"${d.plan_avanzado ? '' : ' disabled'}>Activar</button><button type="button" class="btn" data-a="avz" data-e="${esc(p.email)}" data-n="basico">Dejar en básica</button></span></div>`).join('')}</section>` : ''}
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
          </div>
          <fieldset><legend>Al llegar al 100 % (o a un límite)</legend>
            <label><input type="radio" name="al_tope" value="ahorro"${!pausa ? ' checked' : ''}>Modo ahorro: ${AHORRO}</label>
            <label><input type="radio" name="al_tope" value="pausar"${pausa ? ' checked' : ''}>Pausar la IA hasta el mes siguiente o hasta recargar</label>
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
      <section class="iax-card"><h3>Historial de saldo</h3>${d.historial.length ? `<div class="iax-list">${d.historial.map((r) => `<div class="iax-line"><span>${esc(fDia(r.fecha))} · ${esc(TIPO[r.tipo] || r.tipo)} · <span class="iax-chip ${r.estado === 'pendiente' ? 'info' : ['abonado', 'incluido'].includes(r.estado) ? 'ok' : ''}">${esc(r.estado)}</span>${r.estado === 'pendiente' && r.tipo === 'solicitud' ? ` <button type="button" class="iax-link" data-a="cancelar" data-id="${esc(r.id)}">Cancelar</button>` : ''}</span><b>${eur(r.importe)}</b></div>`).join('')}</div>` : '<p class="iax-soft">Todavía no hay movimientos. Cada mes se incluye el saldo del plan.</p>'}</section>
      <section class="iax-card"><h3>Registro de cambios</h3>${vRegistro(d.registro)}</section>
    </div>
    <p class="iax-foot">Datos tratados y guardados en la UE.</p>`;
  }
  const vRegistro = (rows, conEmpresa) => (rows && rows.length ? `<div class="iax-log">${rows.map((r) => `<div><b>${esc(fHora(r.fecha))} · ${esc(r.por)}${conEmpresa && r.company_id && r.company_id !== 'synqalia' ? ' · ' + esc(r.company_id) : ''}</b><span>${esc(r.texto)}</span></div>`).join('')}</div>` : '<p class="iax-soft">Sin cambios todavía.</p>');

  /* ---------- Synqalia (propietario) ---------- */
  function vOwner(d) {
    if (!d) return '<p class="note">Cargando…</p>';
    const t = d.totales, a = d.anthropic, pl = d.plataforma || {};
    const consola = '<a class="btn iax-danger" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Abrir consola de Anthropic ' + IC.ext + '</a>';
    const alerta = !a ? `<div class="iax-alert warn" role="status">${IC.warn}<div><b>Apunta tu saldo de Anthropic</b> para que te avise antes de que se acabe. Anthropic no deja leerlo desde fuera: escribe aquí lo que marca su consola cada vez que recargues.</div>${consola}</div>`
      : a.bajo || (a.dias != null && a.dias <= 7) ? `<div class="iax-alert bad" role="alert">${IC.warn}<div><b>Tu saldo de Anthropic: unos ${usd(a.restante)}.</b> ${a.dias != null ? `Al ritmo de esta semana se acaba en unos ${a.dias} días.` : ''} Si se acaba, la IA se para en todas las empresas. Recarga automática: <b>${pl.anthropic_recarga_auto ? 'activada' : 'desactivada'}</b>.</div>${consola}</div>`
      : `<div class="iax-alert ok" role="status"><div><b>Saldo de Anthropic: unos ${usd(a.restante)}</b>${a.dias != null ? ` · te llega para unos ${a.dias} días` : ''}. Apuntado el ${esc(fDia(a.fecha))}: ${usd(a.apuntado)}; gastado desde entonces, ${usd(a.gastado)}.</div></div>`;
    const maxMes = Math.max(1, ...d.meses.map((m) => Math.max(m.cobrado, m.coste)));
    const opPlan = (sel) => d.planes.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('');
    const filas = d.empresas.map((e) => {
      const ab = S.editPlan === e.company_id;
      return `<tr><td><b>${esc(e.nombre)}</b>${e.activa ? '' : ' <span class="iax-chip">IA desactivada</span>'}<br><small>${esc((d.planes.find((p) => p.id === e.plan_id) || {}).nombre || 'sin plan')}</small></td><td>${e.usuarios}</td><td class="r">${eur(e.cobrado)}</td><td class="r">${eur(e.coste)}</td><td class="r ${e.margen_pct != null && e.margen_pct < (pl.margen_min_pct ?? 60) ? 'warn' : ''}">${pc(e.margen_pct)}</td>
        <td><div class="iax-inl">${bar(e.pct)}<span>${pc(e.pct)}</span></div></td>
        <td>${e.solicitudes ? '<span class="iax-chip info">Solicitud pendiente</span>' : e.pct >= 100 ? '<span class="iax-chip bad">Sin saldo</span>' : e.pct >= 80 ? '<span class="iax-chip warn">Cerca del límite</span>' : '<span class="iax-muted">Normal</span>'}</td>
        <td><button type="button" class="btn" data-a="plan" data-c="${esc(e.company_id)}" aria-expanded="${ab}">${ab ? 'Cerrar' : 'Plan'}</button></td></tr>
        ${ab ? `<tr class="iax-planrow"><td colspan="8"><form class="iax-pform" data-f="empplan" data-c="${esc(e.company_id)}">
          <label>Plan<select name="plan_id">${opPlan(e.plan_id)}</select></label>
          <label class="iax-chk"><input type="checkbox" name="activa"${e.activa ? ' checked' : ''}>IA activada</label>
          <button type="submit" class="btn primary">Guardar</button>
          <span class="iax-sep"></span>
          <label>Añadir o quitar saldo (€)<input name="ajuste" inputmode="decimal" placeholder="p. ej. 50 o -20"></label>
          <label>Motivo<input name="motivo" placeholder="Opcional"></label>
          <button type="button" class="btn" data-a="ajuste" data-c="${esc(e.company_id)}">Aplicar</button></form></td></tr>` : ''}`;
    }).join('');
    return `<div class="iax-head"><div><h2>IA de todas las empresas</h2><p>Mes en curso · ${d.empresas.length} empresas · ${t.usuarios} usuarios</p></div><button type="button" class="btn" data-a="csvall">Exportar CSV</button></div>
    ${alerta}
    <div class="iax-grid iax-g5">
      <div class="iax-kpi"><small>Cobrado a clientes</small><strong>${eur(t.cobrado)}</strong><span>consumo a precio de venta</span></div>
      <div class="iax-kpi"><small>Coste Anthropic</small><strong>${eur(t.coste)}</strong><span>≈ ${usd(t.coste_usd)} (1 US$ = ${d.eur_por_usd} €)</span></div>
      <div class="iax-kpi"><small>Margen</small><strong class="okc">${eur(t.margen)}</strong><span>${pc(t.margen_pct)} · objetivo ${pc(pl.margen_min_pct)}</span></div>
      <div class="iax-kpi"><small>Coste de hoy</small><strong class="${t.disparado ? 'warn' : ''}">${eur(t.coste_hoy)}</strong><span>${t.disparado ? '<b class="warn">Gasto disparado</b> · ' : ''}media ${eur(t.media_dia)}/día</span></div>
      <div class="iax-kpi"><small>Cerca del límite</small><strong>${(() => { const n = d.empresas.filter((e) => e.pct >= 80).length; return n + (n === 1 ? ' empresa' : ' empresas'); })()}</strong><span>más del 80 %</span></div>
    </div>
    <section class="iax-card"><h3>Empresas</h3><div class="iax-scroll"><table class="iax-tab"><thead><tr><th>Empresa</th><th>Usuarios</th><th class="r">Cobrado</th><th class="r">Coste IA</th><th class="r">Margen</th><th>Uso del saldo</th><th>Estado</th><th><span class="vh">Plan</span></th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr><td><b>Total</b></td><td>${t.usuarios}</td><td class="r"><b>${eur(t.cobrado)}</b></td><td class="r"><b>${eur(t.coste)}</b></td><td class="r"><b>${pc(t.margen_pct)}</b></td><td colspan="3"></td></tr></tfoot></table></div>
      <form class="iax-pform iax-new" data-f="nueva"><label>Nueva empresa (id)<input name="company_id" placeholder="p. ej. acme"></label><label>Nombre<input name="nombre"></label><label>Plan<select name="plan_id">${opPlan(d.planes[0] && d.planes[0].id)}</select></label><button type="submit" class="btn">Dar de alta</button></form>
    </section>
    <section class="iax-card"><h3>Planes de IA</h3><div class="iax-scroll"><table class="iax-tab"><thead><tr><th>Plan</th><th class="r">Saldo fijo al mes</th><th class="r">Por usuario</th><th class="r">Multiplicador</th><th class="r">Tope de seguridad</th><th>IA avanzada</th></tr></thead><tbody>${d.planes.map((p) => `<tr><td><b>${esc(p.nombre)}</b><br><small>${esc(p.id)}</small></td><td class="r">${eur(p.bolsa_mensual_eur)}</td><td class="r">${eur(p.bolsa_por_usuario_eur || 0)}</td><td class="r">× ${esc(p.multiplicador)}</td><td class="r">${p.tope_seguridad_eur == null ? 'sin tope' : eur(p.tope_seguridad_eur)}</td><td>${p.avanzado ? 'Sí' : 'No'}</td></tr>`).join('')}</tbody></table></div>
      <p class="iax-muted" style="margin:8px 0 0">Saldo del mes = fijo + por usuario × usuarios activos (al activarse un usuario a mitad de mes, su parte se suma en ese momento). Precio de venta = coste de Anthropic × multiplicador. Con × 1 se cobra a precio de coste (margen 0 %).</p>
      <form class="iax-pform" data-f="plan"><label>Plan (id)<input name="id" placeholder="p. ej. interno"></label><label>Nombre<input name="nombre"></label><label>Saldo fijo al mes (€)<input name="bolsa_mensual_eur" inputmode="decimal" placeholder="0"></label><label>Por usuario activo (€)<input name="bolsa_por_usuario_eur" inputmode="decimal" placeholder="p. ej. 6"></label><label>Multiplicador<input name="multiplicador" inputmode="decimal" placeholder="p. ej. 2,5"></label><label>Tope de seguridad (€)<input name="tope_seguridad_eur" inputmode="decimal" placeholder="Sin tope"></label><label class="iax-chk"><input type="checkbox" name="avanzado" checked>Incluye IA avanzada</label><button type="submit" class="btn">Guardar plan</button></form>
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
          <label class="iax-chk"><input type="checkbox" name="anthropic_recarga_auto"${pl.anthropic_recarga_auto ? ' checked' : ''}>Tengo la recarga automática activada en Anthropic</label>
          <button type="submit" class="btn primary iax-dark">Guardar ajustes</button></form>
      </section>
    </div>
    <section class="iax-card"><h3>Precios de los modelos (US$ por millón de tokens)</h3><div class="iax-scroll"><table class="iax-tab"><thead><tr><th>Modelo (contiene)</th><th class="r">Entrada</th><th class="r">Salida</th><th class="r">Caché lectura</th><th class="r">Caché escritura</th><th class="r">€ por US$</th><th>Desde</th></tr></thead><tbody>${d.tarifas.map((m) => `<tr><td>${esc(m.patron)}${m.proveedor ? ' · ' + esc(m.proveedor) : ''}</td><td class="r">${m.usd_entrada_mtok}</td><td class="r">${m.usd_salida_mtok}</td><td class="r">${m.usd_cache_lectura_mtok ?? '—'}</td><td class="r">${m.usd_cache_escritura_mtok ?? '—'}</td><td class="r">${m.eur_por_usd}</td><td>${esc(fDia(m.vigente_desde))}</td></tr>`).join('')}</tbody></table></div>
      <form class="iax-pform" data-f="tarifa"><label>Modelo (contiene)<input name="patron" placeholder="p. ej. sonnet-5-5"></label><label>Entrada<input name="usd_entrada_mtok" inputmode="decimal"></label><label>Salida<input name="usd_salida_mtok" inputmode="decimal"></label><label>Caché lect.<input name="usd_cache_lectura_mtok" inputmode="decimal"></label><label>Caché escr.<input name="usd_cache_escritura_mtok" inputmode="decimal"></label><label>€ por US$<input name="eur_por_usd" inputmode="decimal" value="${d.eur_por_usd}"></label><button type="submit" class="btn">Añadir tarifa</button></form>
      <p class="iax-muted" style="margin:8px 0 0">Una tarifa nueva no borra la anterior: se aplica desde hoy y queda el histórico.</p></section>
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
    if (a === 'avz') { if (await act('guardar_persona', { email: b.dataset.e, nivel: b.dataset.n }, b.dataset.n === 'avanzado' ? 'IA avanzada activada' : 'Se queda en IA básica')) refresh('empresa'); return; }
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
      if (!v) return toast('Escribe el importe (en negativo para quitar)', true);
      if (!confirm(`¿${v > 0 ? 'Añadir' : 'Quitar'} ${eur(Math.abs(v))} de saldo a esta empresa?`)) return;
      if (await act('ajuste', { company_id: b.dataset.c, importe: v, nota: f.elements.motivo.value.trim() }, 'Saldo ajustado')) refresh('synqalia');
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
      const cfg = { limite_mensual: num(E.limite_mensual.value), limite_persona: num(E.limite_persona.value), aviso_80: E.aviso_80.checked, aviso_100: E.aviso_100.checked, al_tope: (f.querySelector('[name="al_tope"]:checked') || {}).value || 'ahorro' };
      if ([cfg.limite_mensual, cfg.limite_persona].some(bad)) return toast('Revisa los importes', true);
      if (await act('guardar_empresa', { config: cfg }, 'Cambios guardados')) refresh('empresa');
    } else if (k === 'empplan') {
      if (await act('guardar_empresa_plan', { company_id: f.dataset.c, plan_id: E.plan_id.value, activa: E.activa.checked }, 'Empresa guardada')) { S.editPlan = null; refresh('synqalia'); }
    } else if (k === 'nueva') {
      const id = E.company_id.value.trim().toLowerCase(); if (!id) return toast('Escribe el identificador de la empresa', true);
      if (await act('guardar_empresa_plan', { company_id: id, nombre: E.nombre.value.trim() || id, plan_id: E.plan_id.value, activa: true }, 'Empresa dada de alta')) refresh('synqalia');
    } else if (k === 'plan') {
      const id = E.id.value.trim().toLowerCase(); if (!id) return toast('Escribe el identificador del plan', true);
      const bolsa = num(E.bolsa_mensual_eur.value) ?? 0, porUsr = num(E.bolsa_por_usuario_eur.value) ?? 0, mult = num(E.multiplicador.value), tope = num(E.tope_seguridad_eur.value);
      if (bad(bolsa) || bad(porUsr) || !(mult >= 1) || bad(tope)) return toast('Revisa el saldo, el multiplicador (desde 1) y el tope', true);
      if (!confirm('Los cambios en un plan afectan a todas las empresas que lo tienen. ¿Guardar?')) return;
      if (await act('guardar_plan', { id, nombre: E.nombre.value.trim() || id, bolsa_mensual_eur: bolsa, bolsa_por_usuario_eur: porUsr, multiplicador: mult, tope_seguridad_eur: tope, avanzado: E.avanzado.checked }, 'Plan guardado')) refresh('synqalia');
    } else if (k === 'anthropic') {
      const v = num(E.anthropic_saldo_usd.value); if (v == null || bad(v)) return toast('Escribe el saldo en US$', true);
      if (await act('guardar_plataforma', { config: { anthropic_saldo_usd: v } }, 'Saldo de Anthropic apuntado')) refresh('synqalia');
    } else if (k === 'plataforma') {
      const cfg = { aviso_saldo_usd: num(E.aviso_saldo_usd.value), gasto_disparado_pct: num(E.gasto_disparado_pct.value), margen_min_pct: num(E.margen_min_pct.value), anthropic_recarga_auto: E.anthropic_recarga_auto.checked };
      if (await act('guardar_plataforma', { config: cfg }, 'Ajustes guardados')) refresh('synqalia');
    } else if (k === 'tarifa') {
      const t = { patron: E.patron.value.trim(), usd_entrada_mtok: num(E.usd_entrada_mtok.value), usd_salida_mtok: num(E.usd_salida_mtok.value), usd_cache_lectura_mtok: num(E.usd_cache_lectura_mtok.value), usd_cache_escritura_mtok: num(E.usd_cache_escritura_mtok.value), eur_por_usd: num(E.eur_por_usd.value) };
      if (!t.patron || t.usd_entrada_mtok == null || t.usd_salida_mtok == null) return toast('Faltan el modelo y sus precios', true);
      if (await act('guardar_tarifa', { tarifa: t }, 'Tarifa añadida')) refresh('synqalia');
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
