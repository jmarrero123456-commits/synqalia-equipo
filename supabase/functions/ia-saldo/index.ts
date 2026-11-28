// Synqalia · Configuración › IA y saldo (28/11/2026), sobre el Motor IA común.
// Tres vistas según quién entra:
//  - estado      (cualquier persona): lo que ha usado este mes, lo que le queda (en % y usos aproximados) y su nivel.
//  - admin       (administrador de su empresa): consumo por persona y función, límites, avisos, recargas y registro.
//  - propietario (dueño de Synqalia, IA_PROPIETARIOS): todas las empresas, coste frente a lo cobrado, saldo de Anthropic.
// Datos: tablas del motor (empresas, ia_planes, ia_saldo, ia_consumo, ia_movimientos, ia_avisos, ia_tarifas) y las de
// la pantalla (ia_personas, ia_solicitudes, ia_plataforma). La web no lee ninguna: todo pasa por aquí, con el rol de
// servicio y filtrando siempre por la empresa de la persona. El saldo solo entra por ia_recargar (movimiento + auditoría).
// Pago con tarjeta: Stripe Checkout (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET); sin ellas, el botón sale desactivado.
// El webhook de Stripe llega a esta misma función con ?stripe=webhook (sin sesión; se comprueba la firma).
import { usuarioDePeticion, clienteServicio, type Usuario } from '../_shared/auth.ts';
import { env } from '../_shared/env.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const DIA = 864e5;
const APP_URL = () => (env('APP_URL') || 'https://app.synqalia.com').replace(/\/$/, '');
const IVA = () => Number(env('STRIPE_IVA_PCT') || '21');
const propietarios = () => (env('IA_PROPIETARIOS') || 'j.marrero@correo-provalliance.es').toLowerCase().split(/[,;\s]+/).filter(Boolean);

export const FUNCIONES: Record<string, string> = {
  sugerida: 'Respuestas sugeridas', resumen: 'Resúmenes de correo', perfeccionar: 'Revisar y perfeccionar', asistente: 'Asistente',
  asistente_voz: 'Asistente por voz', reuniones: 'Resúmenes de reuniones', dictado: 'Dictado', notas: 'Notas', tareas: 'Tareas',
  listas: 'Listas', mensajes: 'Mensajes', chat: 'Chat libre', general: 'Otros',
};

function importe(v: unknown, { nulo = true, max = 100000 } = {}): number | null | undefined {
  if (v === null || v === '' || v === undefined) return nulo ? null : undefined;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > max) return undefined;
  return r2(n);
}
const suma = (rows: any[], k: string) => rows.reduce((s, r) => s + num(r[k]), 0);

type Db = ReturnType<typeof clienteServicio>;
async function rpc(db: Db, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
async function agregado(db: Db, company: string | null, desde: Date | string, hasta?: Date | string) {
  const data = await rpc(db, 'ia_agregado', { p_company: company, p_desde: new Date(desde).toISOString(), p_hasta: hasta ? new Date(hasta).toISOString() : null });
  return (data || []).map((r: any) => ({ ...r, usos: num(r.usos), importe_eur: num(r.importe_eur), coste_eur: num(r.coste_eur) }));
}
async function inicioMes(db: Db) { return String(await rpc(db, 'ia_inicio_mes')); }
function siguienteMes(inicio: string) {
  const d = new Date(new Date(inicio).getTime() + 40 * DIA);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7) + '-01';
}
function finEstimado(consumido: number, disponible: number, inicio: string) {
  const dias = Math.max((Date.now() - new Date(inicio).getTime()) / DIA, 1);
  const ritmo = consumido / dias;
  return ritmo > 0 && disponible > 0 ? new Date(Date.now() + (disponible / ritmo) * DIA).toISOString().slice(0, 10) : null;
}
function medianocheMadrid(d = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
  for (const o of ['+01:00', '+02:00']) {
    const t = new Date(`${ymd}T00:00:00${o}`);
    if (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(t) === '00') return t;
  }
  return new Date(`${ymd}T00:00:00Z`);
}

// Saldo de la empresa este mes (renueva la bolsa si ha cambiado el mes, igual que hace el motor)
async function saldo(db: Db, company: string) {
  await rpc(db, 'ia_renovar_mes', { p_company: company });
  const { data: s } = await db.from('ia_saldo').select('*').eq('company_id', company).maybeSingle();
  const { data: e } = await db.from('empresas').select('id,nombre,activa,plan_id').eq('id', company).maybeSingle();
  const { data: p } = e?.plan_id ? await db.from('ia_planes').select('*').eq('id', e.plan_id).maybeSingle() : { data: null };
  const inicio = await inicioMes(db);
  const mes = await agregado(db, company, inicio);
  const consumido = suma(mes, 'importe_eur');
  const disponible = Math.max(num(s?.bolsa_restante_eur) + num(s?.extra_eur), 0);
  const total = consumido + disponible;
  const limMes = s?.limite_mensual_eur != null ? num(s.limite_mensual_eur) : null;
  let pct = total > 0 ? (consumido / total) * 100 : consumido > 0 ? 100 : 0;
  if (limMes) pct = Math.max(pct, (consumido / limMes) * 100);
  return { s, e, p, inicio, mes, consumido, disponible, pct, limMes };
}

async function miembros(db: Db, company: string | null) {
  let q = db.from('members').select('email,name,role,company_id');
  if (company) q = q.eq('company_id', company);
  const { data } = await q;
  return (data || []) as { email: string; name: string; role: string; company_id: string }[];
}

// ---------- registro de cambios legible ----------
const eur = (v: unknown) => v == null ? 'sin límite' : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as any)} €`;
const CAMPOS: Record<string, (v: any) => string> = {
  nivel: (v) => `nivel ${v === 'avanzado' ? 'avanzada' : 'básica'}`, limite_eur: (v) => `límite ${eur(v)}`,
  al_tope: (v) => `al 100 %: ${v === 'pausar' ? 'pausar la IA' : 'modo ahorro'}`, aviso_80: (v) => `aviso 80 % ${v ? 'sí' : 'no'}`, aviso_100: (v) => `aviso 100 % ${v ? 'sí' : 'no'}`,
  aviso_saldo_usd: (v) => `aviso de saldo de Anthropic ${v} US$`, gasto_disparado_pct: (v) => `gasto disparado ${v} %`, margen_min_pct: (v) => `margen mínimo ${v} %`,
  anthropic_saldo_usd: (v) => `saldo de Anthropic apuntado ${v} US$`, anthropic_recarga_auto: (v) => `recarga automática ${v ? 'sí' : 'no'}`,
};
function frase(a: any, quien: (e: string) => string): { texto: string; por?: string } | null {
  const d = a.detalle || {}, t = String(a.accion);
  if (t === 'ia_saldo_bolsa_mensual') return { texto: `Saldo del plan del mes: ${eur(d.importe_eur)}`, por: 'Synqalia' };
  if (t === 'ia_saldo_recarga') return { texto: `Recarga de ${eur(d.importe_eur)}${d.motivo ? ' · ' + d.motivo : ''}`, por: d.hecho_por };
  if (t === 'ia_saldo_ajuste') return { texto: `Ajuste de saldo de ${eur(d.importe_eur)}${d.motivo ? ' · ' + d.motivo : ''}`, por: d.hecho_por };
  if (t === 'ia_limites') {
    const c = [];
    if (d.antes?.mensual !== d.despues?.mensual) c.push(`límite mensual de la empresa: ${eur(d.antes?.mensual)} → ${eur(d.despues?.mensual)}`);
    if (d.antes?.usuario !== d.despues?.usuario) c.push(`límite por persona: ${eur(d.antes?.usuario)} → ${eur(d.despues?.usuario)}`);
    return c.length ? { texto: c.join(' · ') } : null;
  }
  if (/^ia_aviso_\d+$/.test(t)) return { texto: `Aviso del ${t.slice(9)} %: la empresa lleva el ${Math.round(num(d.porcentaje))} % del saldo`, por: 'Synqalia' };
  if (t === 'empresa_plan') return { texto: `Plan: ${d.plan_antes ?? '—'} → ${d.plan_despues ?? '—'}${d.activa === false ? ' · IA desactivada' : ''}` };
  if (t === 'ia_plan_cambio') return { texto: `Plan «${d.plan}» modificado (bolsa ${eur(d.despues?.bolsa_mensual_eur)}, multiplicador ${d.despues?.multiplicador})` };
  if (t === 'ia.tarifa') return { texto: `Nueva tarifa para «${d.patron}»: ${d.usd_entrada_mtok} / ${d.usd_salida_mtok} US$ por millón de tokens`, por: d.por };
  if (t === 'ia.exportar') return { texto: `Exporta ${d.que}`, por: d.por };
  if (t.startsWith('ia.ia_solicitudes.')) {
    const x = d.despues || {}, y = d.antes || {};
    if (t.endsWith('insert')) return { texto: x.tipo === 'tarjeta' ? `Inicia un pago con tarjeta de ${eur(x.importe_eur)}` : `Solicita ${eur(x.importe_eur)} de saldo`, por: x.solicitado_por };
    if (y.estado !== x.estado) return { texto: `${x.tipo === 'tarjeta' ? 'Pago con tarjeta' : 'Solicitud'} de ${eur(x.importe_eur)}: ${x.estado}`, por: x.resuelto_por };
    return null;
  }
  if (t.startsWith('ia.')) {
    const x = d.despues || {}, y = d.antes || {};
    if (t.startsWith('ia.ia_personas') && x.pide_avanzado && !y.pide_avanzado) return { texto: `${quien(x.email)} pide la IA avanzada`, por: d.por };
    const c = Object.keys(CAMPOS).filter((k) => k in x && JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => CAMPOS[k](x[k]));
    if (!c.length) return null;
    return { texto: (t.startsWith('ia.ia_personas') ? quien(x.email || y.email) + ': ' : '') + c.join(' · '), por: d.por };
  }
  return null;
}
async function registro(db: Db, company: string | null, limite = 30) {
  let q = db.from('audit_log').select('company_id,accion,detalle,created_at').or('accion.like.ia*,accion.eq.empresa_plan')
    .neq('accion', 'ia.acceso').order('created_at', { ascending: false }).limit(limite * 2);
  if (company) q = q.eq('company_id', company);
  const { data } = await q;
  const gente = await miembros(db, company);
  const quien = (e: string) => gente.find((g) => g.email.toLowerCase() === String(e || '').toLowerCase())?.name || e || 'Synqalia';
  return (data || []).map((a: any) => {
    const f = frase(a, quien);
    if (!f) return null;
    const por = f.por ?? a.detalle?.por;
    return { fecha: a.created_at, company_id: a.company_id, por: !por || por === 'sistema' ? 'Synqalia' : por === 'stripe' ? 'Stripe' : quien(por), texto: f.texto };
  }).filter(Boolean).slice(0, limite);
}
const acceso = (db: Db, u: Usuario, accion: string, detalle: Record<string, unknown>) =>
  db.from('audit_log').insert({ company_id: u.companyId, owner: u.id, accion, detalle: { ...detalle, por: u.email } });

// ---------- Stripe ----------
async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function abonar(db: Db, sol: any, por: string) {
  await rpc(db, 'ia_recargar', { p_company: sol.company_id, p_importe: num(sol.importe_eur), p_motivo: sol.tipo === 'tarjeta' ? 'Pago con tarjeta (Stripe)' : 'Solicitud aprobada por Synqalia', p_hecho_por: por });
}
async function webhook(db: Db, req: Request) {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook no configurado' }, 501);
  const raw = await req.text();
  const head = req.headers.get('stripe-signature') || '';
  const t = head.split(',').find((x) => x.startsWith('t='))?.slice(2);
  const firmas = head.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!t || !firmas.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return json({ error: 'Firma no válida' }, 400);
  if (!firmas.includes(await hmacHex(secret, `${t}.${raw}`))) return json({ error: 'Firma no válida' }, 400);
  const ev = JSON.parse(raw), s = ev?.data?.object;
  const ahora = new Date().toISOString();
  if (ev.type === 'checkout.session.completed' && s?.payment_status === 'paid') {
    const { data } = await db.from('ia_solicitudes').update({ estado: 'pagada', resuelto_por: 'stripe', resuelto_at: ahora }).eq('stripe_session', s.id).eq('estado', 'pendiente').select('*');
    if (data?.[0]) await abonar(db, data[0], 'stripe');
  }
  if (ev.type === 'checkout.session.expired') await db.from('ia_solicitudes').update({ estado: 'cancelada', resuelto_por: 'stripe', resuelto_at: ahora }).eq('stripe_session', s.id).eq('estado', 'pendiente');
  return json({ received: true });
}
async function checkout(db: Db, u: Usuario, euros: number) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) return { error: 'El pago con tarjeta aún no está activado. Puedes enviar una solicitud.' };
  const { data: sol, error } = await db.from('ia_solicitudes').insert({ company_id: u.companyId, tipo: 'tarjeta', importe_eur: euros, solicitado_por: u.email }).select('id').single();
  if (error) throw error;
  const f = new URLSearchParams({
    mode: 'payment', success_url: `${APP_URL()}/mi.html?ia_pago=ok#ia`, cancel_url: `${APP_URL()}/mi.html?ia_pago=cancelado#ia`,
    client_reference_id: sol.id, customer_email: u.email, 'metadata[solicitud]': sol.id, 'metadata[company_id]': u.companyId,
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(Math.round(euros * (1 + IVA() / 100) * 100)),
    'line_items[0][price_data][product_data][name]': `Saldo de IA Synqalia · ${euros.toFixed(2).replace('.', ',')} € + IVA ${IVA()} %`,
    expires_at: String(Math.floor(Date.now() / 1000) + 3600),
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f });
  const out: any = await r.json().catch(() => ({}));
  if (!r.ok || !out.url) {
    console.error('ia-saldo: Stripe', r.status, out?.error?.message);
    await db.from('ia_solicitudes').update({ estado: 'cancelada', resuelto_por: 'stripe', nota: 'No se pudo abrir el pago' }).eq('id', sol.id);
    return { error: 'No se ha podido abrir el pago con tarjeta. Prueba más tarde o envía una solicitud.' };
  }
  await db.from('ia_solicitudes').update({ stripe_session: out.id }).eq('id', sol.id);
  return { url: out.url };
}

// ---------- vistas ----------
async function vistaUsuario(db: Db, u: Usuario, rol: { admin: boolean; propietario: boolean }) {
  const st = await saldo(db, u.companyId);
  if (!st.e || !st.p || !st.e.activa) return { activa: false, rol };
  const { data: pe } = await db.from('ia_personas').select('*').eq('company_id', u.companyId).eq('email', u.email).maybeSingle();
  const mias = st.mes.filter((r: any) => r.usuario === u.email);
  const usado = suma(mias, 'importe_eur');
  const limite = pe?.limite_eur != null ? num(pe.limite_eur) : st.s?.limite_usuario_eur != null ? num(st.s.limite_usuario_eur) : null;
  let base: number, restante: number, pct: number;
  if (limite != null) { base = limite; restante = Math.min(Math.max(limite - usado, 0), st.disponible); pct = limite > 0 ? (usado / limite) * 100 : 100; }
  else { base = st.consumido + st.disponible; restante = st.disponible; pct = st.pct; }
  if (st.limMes != null) restante = Math.min(restante, Math.max(st.limMes - st.consumido, 0));
  const pausar = st.s?.al_tope === 'pausar';
  const hist = await agregado(db, u.companyId, new Date(Date.now() - 90 * DIA));
  const medio = (f: string) => { const rows = hist.filter((r: any) => r.funcion === f); const n = suma(rows, 'usos'); return n ? suma(rows, 'importe_eur') / n : 0; };
  const usos: Record<string, number | null> = {};
  for (const f of ['sugerida', 'resumen', 'asistente']) { const m = medio(f); usos[f] = m > 0 ? Math.floor(restante / m) : null; }
  const porFuncion = Object.keys(FUNCIONES).map((f) => {
    const rows = mias.filter((r: any) => r.funcion === f);
    return { funcion: f, nombre: FUNCIONES[f], usos: suma(rows, 'usos'), pct: base > 0 ? Math.round((suma(rows, 'importe_eur') / base) * 1000) / 10 : 0 };
  }).filter((x) => x.usos > 0).sort((a, b) => b.pct - a.pct);
  const { data: av } = await db.from('ia_avisos').select('umbral').eq('company_id', u.companyId).eq('periodo', st.s?.periodo);
  return {
    activa: true, nivel: pe?.nivel || 'basico', pide_avanzado: pe?.pide_avanzado || null, plan_avanzado: !!st.p.avanzado,
    pct: Math.min(Math.round(pct * 10) / 10, 100), queda_pct: Math.max(Math.round((100 - pct) * 10) / 10, 0),
    tiene_limite_propio: limite != null, al_tope: pausar ? 'pausar' : 'ahorro', agotado: restante <= 0, renueva: siguienteMes(st.inicio),
    usos_aprox: usos, por_funcion: porFuncion, aviso_80: st.s?.aviso_80 !== false, aviso_100: st.s?.aviso_100 !== false,
    avisos: (av || []).map((a: any) => a.umbral), rol,
  };
}

async function vistaAdmin(db: Db, u: Usuario) {
  const st = await saldo(db, u.companyId);
  if (!st.e || !st.p) return { activa: false };
  const gente = await miembros(db, u.companyId);
  const { data: pers } = await db.from('ia_personas').select('*').eq('company_id', u.companyId);
  const limDef = st.s?.limite_usuario_eur != null ? num(st.s.limite_usuario_eur) : null;
  const personas = gente.map((g) => {
    const e = g.email.toLowerCase(), cfg = (pers || []).find((x: any) => x.email === e);
    const usado = suma(st.mes.filter((r: any) => r.usuario === e), 'importe_eur');
    const limite = cfg?.limite_eur != null ? num(cfg.limite_eur) : limDef;
    return { email: e, nombre: g.name || e, nivel: cfg?.nivel || 'basico', limite_propio: cfg?.limite_eur != null ? num(cfg.limite_eur) : null, limite, usado: r2(usado), pct: limite ? Math.round((usado / limite) * 1000) / 10 : null, pide_avanzado: cfg?.pide_avanzado || null };
  }).sort((a, b) => b.usado - a.usado);
  const porFuncion = Object.keys(FUNCIONES).map((f) => { const rows = st.mes.filter((r: any) => r.funcion === f); return { funcion: f, nombre: FUNCIONES[f], importe: r2(suma(rows, 'importe_eur')), usos: suma(rows, 'usos') }; })
    .filter((x) => x.usos > 0).sort((a, b) => b.importe - a.importe);
  const { data: sols } = await db.from('ia_solicitudes').select('*').eq('company_id', u.companyId).order('created_at', { ascending: false }).limit(20);
  const { data: movs } = await db.from('ia_movimientos').select('*').eq('company_id', u.companyId).order('created_at', { ascending: false }).limit(20);
  const recargasMes = suma((movs || []).filter((m: any) => m.tipo !== 'bolsa_mensual' && new Date(m.created_at) >= new Date(st.inicio)), 'importe_eur');
  const historial = [
    ...(sols || []).filter((x: any) => x.estado === 'pendiente' || x.estado === 'rechazada' || x.estado === 'cancelada').map((x: any) => ({ id: x.id, fecha: x.created_at, tipo: x.tipo, importe: num(x.importe_eur), estado: x.estado })),
    ...(movs || []).map((m: any) => ({ fecha: m.created_at, tipo: m.tipo, importe: num(m.importe_eur), estado: m.tipo === 'bolsa_mensual' ? 'incluido' : 'abonado', motivo: m.motivo })),
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 24);
  await acceso(db, u, 'ia.acceso', { vista: 'administrador' });
  return {
    activa: !!st.e.activa, empresa: st.e.nombre, renueva: siguienteMes(st.inicio), plan_avanzado: !!st.p.avanzado,
    saldo: { mensual: num(st.p.bolsa_mensual_eur), consumido: r2(st.consumido), disponible: r2(st.disponible), extra: r2(num(st.s?.extra_eur)), exceso: r2(num(st.s?.exceso_mes_eur)), recargas_mes: r2(recargasMes), pct: Math.round(st.pct * 10) / 10, fin_estimado: finEstimado(st.consumido, st.disponible, st.inicio), tope: st.p.tope_seguridad_eur != null ? num(st.p.tope_seguridad_eur) : null },
    config: { limite_mensual: st.limMes, limite_persona: limDef, aviso_80: st.s?.aviso_80 !== false, aviso_100: st.s?.aviso_100 !== false, al_tope: st.s?.al_tope === 'pausar' ? 'pausar' : 'ahorro' },
    personas, avanzada: personas.filter((x) => x.nivel === 'avanzado').length, por_funcion: porFuncion,
    historial, registro: await registro(db, u.companyId), tarjeta: !!env('STRIPE_SECRET_KEY'), iva: IVA(),
  };
}

async function vistaPropietario(db: Db, u: Usuario) {
  const { data: plat } = await db.from('ia_plataforma').select('*').eq('id', 1).maybeSingle();
  const { data: emps } = await db.from('empresas').select('*').order('nombre');
  const { data: planes } = await db.from('ia_planes').select('*').order('id');
  const gente = await miembros(db, null);
  const inicio = await inicioMes(db);
  const mes = await agregado(db, null, inicio);
  const hoy0 = medianocheMadrid();
  const hoy = await agregado(db, null, hoy0);
  const sem = await agregado(db, null, new Date(hoy0.getTime() - 7 * DIA), hoy0);
  const { data: tar } = await db.from('ia_tarifas').select('*').order('vigente_desde', { ascending: false });
  const eurUsd = num((tar || [])[0]?.eur_por_usd) || 0.89;
  const costeHoy = suma(hoy, 'coste_eur'), mediaDia = suma(sem, 'coste_eur') / 7;
  const empresas = [];
  for (const e of emps || []) {
    const st = await saldo(db, e.id);
    const rows = mes.filter((r: any) => r.company_id === e.id);
    const cobrado = suma(rows, 'importe_eur'), coste = suma(rows, 'coste_eur');
    const { count } = await db.from('ia_solicitudes').select('id', { count: 'exact', head: true }).eq('company_id', e.id).eq('estado', 'pendiente').eq('tipo', 'solicitud');
    empresas.push({ company_id: e.id, nombre: e.nombre, activa: e.activa, plan_id: e.plan_id, usuarios: gente.filter((g) => g.company_id === e.id).length, cobrado: r2(cobrado), coste: r2(coste), margen_pct: cobrado > 0 ? Math.round(((cobrado - coste) / cobrado) * 1000) / 10 : null, pct: Math.round(st.pct * 10) / 10, disponible: r2(st.disponible), exceso: r2(num(st.s?.exceso_mes_eur)), solicitudes: count || 0 });
  }
  const { data: pend } = await db.from('ia_solicitudes').select('*').eq('tipo', 'solicitud').eq('estado', 'pendiente').order('created_at');
  const ahora = new Date();
  const meses = await rpc(db, 'ia_meses', { p_desde: new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 5, 1)).toISOString() });
  let anthropic: any = null;
  if (plat?.anthropic_saldo_usd != null) {
    const gastado = plat.anthropic_saldo_fecha ? suma(await agregado(db, null, plat.anthropic_saldo_fecha), 'coste_eur') / eurUsd : 0;
    const restante = num(plat.anthropic_saldo_usd) - gastado;
    const usdDia = suma(sem, 'coste_eur') / eurUsd / 7;
    anthropic = { apuntado: num(plat.anthropic_saldo_usd), fecha: plat.anthropic_saldo_fecha, gastado: r2(gastado), restante: r2(restante), dias: usdDia > 0 ? Math.floor(restante / usdDia) : null, bajo: restante < num(plat.aviso_saldo_usd) };
  }
  const cobrado = suma(mes, 'importe_eur'), coste = suma(mes, 'coste_eur');
  await acceso(db, u, 'ia.acceso', { vista: 'propietario' });
  // tarifas vigentes: la más reciente de cada patrón
  const vistas = new Set<string>();
  const tarifas = (tar || []).filter((t: any) => { const k = (t.proveedor || '*') + '|' + t.patron; if (vistas.has(k)) return false; vistas.add(k); return true; });
  return {
    plataforma: plat, anthropic, planes: planes || [], tarifas, eur_por_usd: eurUsd,
    totales: { cobrado: r2(cobrado), coste: r2(coste), coste_usd: r2(coste / eurUsd), margen: r2(cobrado - coste), margen_pct: cobrado > 0 ? Math.round(((cobrado - coste) / cobrado) * 1000) / 10 : null, coste_hoy: r2(costeHoy), media_dia: r2(mediaDia), disparado: mediaDia > 0 && costeHoy > (mediaDia * num(plat?.gasto_disparado_pct || 150)) / 100, usuarios: gente.length },
    empresas, solicitudes: (pend || []).map((x: any) => ({ id: x.id, importe: num(x.importe_eur), created_at: x.created_at, nota: x.nota, empresa: (emps || []).find((e: any) => e.id === x.company_id)?.nombre || x.company_id, quien: gente.find((g) => g.email.toLowerCase() === String(x.solicitado_por || '').toLowerCase())?.name || x.solicitado_por })),
    meses: (meses || []).map((m: any) => ({ mes: m.mes, cobrado: r2(num(m.importe_eur)), coste: r2(num(m.coste_eur)) })),
    registro: await registro(db, null, 40),
  };
}

function csv(rows: any[][]) { return rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n'); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = clienteServicio();
  if (new URL(req.url).searchParams.get('stripe') === 'webhook') return await webhook(db, req);

  const u = await usuarioDePeticion(req);
  if (!u) return json({ error: 'Inicia sesión' }, 401);
  if (u === 'no_miembro' || !u.companyId) return json({ error: 'No autorizado' }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }
  const esAdmin = u.rol === 'admin', esDueno = propietarios().includes(u.email);
  const soloAdmin = () => json({ error: 'Solo el administrador de tu empresa puede hacer esto' }, 403);
  const soloDueno = () => json({ error: 'Solo el propietario de Synqalia puede hacer esto' }, 403);
  const ahora = new Date().toISOString();

  try {
    switch (body.action) {
      case 'estado': return json(await vistaUsuario(db, u, { admin: esAdmin, propietario: esDueno }));

      case 'pedir_avanzada': {
        const { data: pe } = await db.from('ia_personas').select('nivel').eq('company_id', u.companyId).eq('email', u.email).maybeSingle();
        if (pe?.nivel === 'avanzado') return json({ ok: true, ya: true });
        const { error } = await db.from('ia_personas').upsert({ company_id: u.companyId, email: u.email, pide_avanzado: ahora, updated_by: u.email, updated_at: ahora }, { onConflict: 'company_id,email' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'admin': if (!esAdmin) return soloAdmin(); return json(await vistaAdmin(db, u));

      case 'guardar_empresa': {
        if (!esAdmin) return soloAdmin();
        const c = body.config || {}, f: Record<string, unknown> = {};
        if ('limite_mensual' in c) { const v = importe(c.limite_mensual); if (v === undefined) return json({ error: 'Límite mensual no válido' }, 400); f.limite_mensual_eur = v; }
        if ('limite_persona' in c) { const v = importe(c.limite_persona); if (v === undefined) return json({ error: 'Límite por persona no válido' }, 400); f.limite_usuario_eur = v; }
        for (const k of ['aviso_80', 'aviso_100']) if (k in c) f[k] = !!c[k];
        if ('al_tope' in c) { if (!['ahorro', 'pausar'].includes(c.al_tope)) return json({ error: 'Opción no válida' }, 400); f.al_tope = c.al_tope; }
        await rpc(db, 'ia_renovar_mes', { p_company: u.companyId });
        const { error } = await db.from('ia_saldo').update({ ...f, updated_by: u.email }).eq('company_id', u.companyId);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_persona': {
        if (!esAdmin) return soloAdmin();
        const e = String(body.email || '').toLowerCase().trim();
        const { data: m } = await db.from('members').select('email').eq('company_id', u.companyId).ilike('email', e).maybeSingle();
        if (!m) return json({ error: 'Esa persona no es de tu empresa' }, 404);
        const fila: Record<string, unknown> = { company_id: u.companyId, email: e, updated_by: u.email, updated_at: ahora };
        if ('nivel' in body) { if (!['basico', 'avanzado'].includes(body.nivel)) return json({ error: 'Nivel no válido' }, 400); fila.nivel = body.nivel; fila.pide_avanzado = null; }
        if ('limite' in body) { const v = importe(body.limite); if (v === undefined) return json({ error: 'Límite no válido' }, 400); fila.limite_eur = v; }
        const { error } = await db.from('ia_personas').upsert(fila, { onConflict: 'company_id,email' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'recargar': {
        if (!esAdmin) return soloAdmin();
        const euros = importe(body.importe, { nulo: false, max: 5000 });
        if (!euros || euros < 5) return json({ error: 'El importe tiene que estar entre 5 € y 5.000 €' }, 400);
        if (body.modo === 'tarjeta') { const r = await checkout(db, u, euros); return json(r, r.error ? 400 : 200); }
        const { count } = await db.from('ia_solicitudes').select('id', { count: 'exact', head: true }).eq('company_id', u.companyId).eq('tipo', 'solicitud').eq('estado', 'pendiente');
        if ((count || 0) >= 3) return json({ error: 'Ya tienes solicitudes pendientes de aprobar' }, 409);
        const { error } = await db.from('ia_solicitudes').insert({ company_id: u.companyId, tipo: 'solicitud', importe_eur: euros, solicitado_por: u.email, nota: String(body.nota || '').slice(0, 300) || null });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'cancelar_solicitud': {
        if (!esAdmin) return soloAdmin();
        const { error } = await db.from('ia_solicitudes').update({ estado: 'cancelada', resuelto_por: u.email, resuelto_at: ahora })
          .eq('id', String(body.id || '')).eq('company_id', u.companyId).eq('estado', 'pendiente').eq('tipo', 'solicitud');
        if (error) throw error;
        return json({ ok: true });
      }

      case 'exportar': {
        if (!esAdmin && !esDueno) return soloAdmin();
        const todas = !!body.todas && esDueno;
        const company = todas ? null : u.companyId;
        const rows = await agregado(db, company, await inicioMes(db));
        const gente = await miembros(db, company);
        const nom = (e: string) => gente.find((g) => g.email.toLowerCase() === e)?.name || e;
        const f2 = (v: number) => v.toFixed(2).replace('.', ',');
        const cab = todas ? ['Empresa', 'Persona', 'Email', 'Función', 'Usos', 'Cobrado €', 'Coste €'] : ['Persona', 'Email', 'Función', 'Usos', 'Importe €'];
        const lineas = rows.map((r: any) => todas ? [r.company_id, nom(r.usuario), r.usuario, FUNCIONES[r.funcion] || r.funcion, r.usos, f2(r.importe_eur), f2(r.coste_eur)] : [nom(r.usuario), r.usuario, FUNCIONES[r.funcion] || r.funcion, r.usos, f2(r.importe_eur)]);
        await acceso(db, u, 'ia.exportar', { que: todas ? 'el consumo de todas las empresas' : 'el consumo del mes' });
        const per = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date());
        return json({ nombre: `ia-consumo-${per}${todas ? '-todas' : ''}.csv`, csv: '﻿' + csv([cab, ...lineas]) });
      }

      case 'propietario': if (!esDueno) return soloDueno(); return json(await vistaPropietario(db, u));

      case 'resolver_solicitud': {
        if (!esDueno) return soloDueno();
        const estado = body.aprobar ? 'aprobada' : 'rechazada';
        const { data, error } = await db.from('ia_solicitudes').update({ estado, resuelto_por: u.email, resuelto_at: ahora, nota: String(body.nota || '').slice(0, 300) || null })
          .eq('id', String(body.id || '')).eq('estado', 'pendiente').eq('tipo', 'solicitud').select('*');
        if (error) throw error;
        if (!data?.length) return json({ error: 'Esa solicitud ya no está pendiente' }, 409);
        if (body.aprobar) {
          try { await abonar(db, data[0], u.email); }
          catch (e) { await db.from('ia_solicitudes').update({ estado: 'pendiente', resuelto_por: null, resuelto_at: null }).eq('id', data[0].id); throw e; }
        }
        return json({ ok: true });
      }

      case 'ajuste': {
        if (!esDueno) return soloDueno();
        const n = Number(String(body.importe ?? '').replace(',', '.'));
        if (!isFinite(n) || n === 0 || Math.abs(n) > 50000) return json({ error: 'Importe no válido' }, 400);
        await rpc(db, 'ia_recargar', { p_company: String(body.company_id || ''), p_importe: r2(n), p_motivo: String(body.nota || 'Ajuste de Synqalia').slice(0, 200), p_hecho_por: u.email });
        return json({ ok: true });
      }

      case 'guardar_empresa_plan': {
        if (!esDueno) return soloDueno();
        const id = String(body.company_id || '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{2,40}$/.test(id)) return json({ error: 'Identificador de empresa no válido' }, 400);
        const { data: pl } = await db.from('ia_planes').select('id').eq('id', String(body.plan_id || '')).maybeSingle();
        if (!pl) return json({ error: 'Ese plan no existe' }, 400);
        const { data: ya } = await db.from('empresas').select('id').eq('id', id).maybeSingle();
        const fila: Record<string, unknown> = { plan_id: pl.id };
        if ('activa' in body) fila.activa = !!body.activa;
        if ('nombre' in body && String(body.nombre).trim()) fila.nombre = String(body.nombre).trim().slice(0, 120);
        const { error } = ya ? await db.from('empresas').update(fila).eq('id', id) : await db.from('empresas').insert({ id, nombre: id, ...fila });
        if (error) throw error;
        if (!ya) await db.from('audit_log').insert({ company_id: id, owner: u.id, accion: 'empresa_plan', detalle: { plan_antes: null, plan_despues: pl.id, activa: true, por: u.email } });
        return json({ ok: true });
      }

      case 'guardar_plan': {
        if (!esDueno) return soloDueno();
        const id = String(body.id || '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{2,40}$/.test(id)) return json({ error: 'Identificador de plan no válido' }, 400);
        const bolsa = importe(body.bolsa_mensual_eur, { nulo: false }), tope = importe(body.tope_seguridad_eur);
        const mult = Number(String(body.multiplicador ?? '').replace(',', '.'));
        if (bolsa === undefined || tope === undefined || !(mult >= 1 && mult <= 20)) return json({ error: 'Revisa la bolsa, el tope y el multiplicador (de 1 a 20)' }, 400);
        const fila = { id, nombre: String(body.nombre || id).slice(0, 80), bolsa_mensual_eur: bolsa, tope_seguridad_eur: tope, multiplicador: mult, avanzado: body.avanzado !== false };
        const { error } = await db.from('ia_planes').upsert(fila, { onConflict: 'id' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_plataforma': {
        if (!esDueno) return soloDueno();
        const c = body.config || {}, f: Record<string, unknown> = {};
        const rangos: Record<string, [number, number]> = { aviso_saldo_usd: [0, 100000], gasto_disparado_pct: [100, 1000], margen_min_pct: [0, 99] };
        for (const [k, [lo, hi]] of Object.entries(rangos)) if (k in c) { const v = Number(String(c[k]).replace(',', '.')); if (!(v >= lo && v <= hi)) return json({ error: 'Valor fuera de rango' }, 400); f[k] = v; }
        if ('anthropic_recarga_auto' in c) f.anthropic_recarga_auto = !!c.anthropic_recarga_auto;
        if ('anthropic_saldo_usd' in c) { const v = importe(c.anthropic_saldo_usd, { nulo: false, max: 1e6 }); if (v === undefined) return json({ error: 'Saldo no válido' }, 400); f.anthropic_saldo_usd = v; f.anthropic_saldo_fecha = ahora; }
        const { error } = await db.from('ia_plataforma').update({ ...f, updated_by: u.email, updated_at: ahora }).eq('id', 1);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_tarifa': {
        // Las tarifas no se sobrescriben: se añade una nueva vigente desde ahora (queda el histórico)
        if (!esDueno) return soloDueno();
        const t = body.tarifa || {};
        const patron = String(t.patron || '').trim().toLowerCase();
        const v = ['usd_entrada_mtok', 'usd_salida_mtok', 'usd_cache_lectura_mtok', 'usd_cache_escritura_mtok', 'eur_por_usd'].map((k) => (t[k] === '' || t[k] == null ? null : Number(String(t[k]).replace(',', '.'))));
        if (!/^[a-z0-9.\-:_]{3,80}$/.test(patron) || !(v[0]! >= 0) || !(v[1]! >= 0) || !(v[4]! > 0.3 && v[4]! < 3)) return json({ error: 'Revisa el modelo, los precios y el cambio €/US$' }, 400);
        const { error } = await db.from('ia_tarifas').insert({ proveedor: null, patron, usd_entrada_mtok: v[0], usd_salida_mtok: v[1], usd_cache_lectura_mtok: v[2], usd_cache_escritura_mtok: v[3], eur_por_usd: v[4], nota: 'Desde IA y saldo · ' + u.email });
        if (error) throw error;
        await db.from('audit_log').insert({ company_id: 'synqalia', owner: u.id, accion: 'ia.tarifa', detalle: { ...t, por: u.email } });
        return json({ ok: true });
      }

      default: return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    console.error('ia-saldo', body?.action, e);
    return json({ error: 'No se ha podido completar: ' + String((e as any)?.message || e) }, 500);
  }
});
