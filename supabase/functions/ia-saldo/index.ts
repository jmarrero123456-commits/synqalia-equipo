// Synqalia · Configuración › IA y saldo (28/11/2026)
// Backend de la pantalla de saldo de IA, con tres vistas según quién entra:
//  - estado      (cualquier persona): lo que ha usado este mes, lo que le queda (en % y usos aproximados) y su nivel.
//  - admin       (administrador de su empresa): consumo por persona y función, límites, avisos, recargas y registro.
//  - propietario (dueño de Synqalia, IA_PROPIETARIOS): todas las empresas, coste frente a lo cobrado, saldo de Anthropic.
// Seguridad: la web no lee las tablas ia_* (RLS sin políticas); todo pasa por aquí y cada consulta filtra por la
// company_id de la persona. Los cambios de límites, niveles, saldo y recargas quedan en audit_log (triggers) y aquí se
// registran además los accesos a las vistas de administración y las exportaciones.
// Pago con tarjeta: Stripe Checkout (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). Sin esas variables el botón sale desactivado.
// El webhook de Stripe llega a esta misma función con ?stripe=webhook (sin sesión; se verifica la firma).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identificar, saldoEmpresa, plataforma, periodo, FUNCIONES, type Persona } from '../_shared/ia-motor.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const APP_URL = (Deno.env.get('APP_URL') || 'https://app.synqalia.com').replace(/\/$/, '');
const IVA = Number(Deno.env.get('STRIPE_IVA_PCT') || '21');
const DIA = 864e5;

// Importe válido (o null si se deja vacío); rechaza negativos y cifras absurdas
function importe(v: unknown, { nulo = true, max = 100000 } = {}): number | null | undefined {
  if (v === null || v === '' || v === undefined) return nulo ? null : undefined;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > max) return undefined;
  return r2(n);
}

async function agregado(admin: any, company: string | null, desde: Date | string, hasta?: Date | string) {
  const { data, error } = await admin.rpc('ia_agregado', { p_company: company, p_desde: new Date(desde).toISOString(), p_hasta: hasta ? new Date(hasta).toISOString() : null });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, usos: num(r.usos), importe: num(r.importe), coste_eur: num(r.coste_eur), coste_usd: num(r.coste_usd) }));
}
const suma = (rows: any[], k: string) => rows.reduce((s, r) => s + num(r[k]), 0);

function siguienteMes(inicio: string) {
  const d = new Date(new Date(inicio).getTime() + 40 * DIA);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7) + '-01';
}
// Medianoche de hoy en Madrid (horario de invierno +01 o de verano +02)
function medianocheMadrid(d = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
  for (const o of ['+01:00', '+02:00']) {
    const t = new Date(`${ymd}T00:00:00${o}`);
    if (new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(t) === '00') return t;
  }
  return new Date(`${ymd}T00:00:00Z`);
}
// Fecha estimada en la que se acaba el saldo al ritmo del mes
function finEstimado(consumido: number, disponible: number, inicio: string) {
  const dias = Math.max((Date.now() - new Date(inicio).getTime()) / DIA, 1);
  const ritmo = consumido / dias;
  if (ritmo <= 0) return null;
  return new Date(Date.now() + (disponible / ritmo) * DIA).toISOString().slice(0, 10);
}

async function nombres(admin: any, company: string | null) {
  let q = admin.from('members').select('email,name,role,company_id');
  if (company) q = q.eq('company_id', company);
  const { data } = await q;
  return (data || []) as { email: string; name: string; role: string; company_id: string }[];
}

const CAMPOS: Record<string, string> = {
  saldo_mensual: 'Saldo mensual del plan', limite_mensual: 'Límite mensual de la empresa', limite_persona: 'Límite por persona',
  aviso_80: 'Aviso al 80 %', aviso_100: 'Aviso al 100 %', aviso_correo_admin: 'Aviso por correo al administrador', al_tope: 'Al llegar al 100 %',
  tope_tarjeta: 'Máximo de recargas con tarjeta', multiplicador: 'Multiplicador de precio', activa: 'IA activada', nombre: 'Nombre',
  nivel: 'Nivel', limite: 'Límite', usd_eur: 'Cambio US$→€', modelo_basica: 'Modelo de IA básica', modelo_avanzada: 'Modelo de IA avanzada',
  aviso_saldo_usd: 'Aviso de saldo de Anthropic', gasto_disparado_pct: 'Aviso de gasto disparado', margen_min_pct: 'Margen mínimo',
  anthropic_saldo_usd: 'Saldo de Anthropic apuntado', anthropic_recarga_auto: 'Recarga automática de Anthropic', estado: 'Estado', importe: 'Importe',
  usd_in: 'Precio entrada', usd_out: 'Precio salida',
};
const val = (k: string, v: any) => v == null ? '—' : typeof v === 'boolean' ? (v ? 'sí' : 'no')
  : k === 'al_tope' ? (v === 'pausar' ? 'pausar la IA' : 'recargar con tarjeta') : k === 'nivel' ? (v === 'avanzada' ? 'avanzada' : 'básica')
  : /limite|saldo_mensual|tope|importe/.test(k) ? `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €` : String(v);

// Convierte el registro técnico en frases para la pantalla
function frase(a: any, quien: (e: string) => string) {
  const d = a.detalle || {}, antes = d.antes || {}, despues = d.despues || {};
  const t = String(a.accion).replace(/^ia\./, '');
  if (t === 'aviso') return `Aviso del ${d.umbral} % ${d.email ? 'de ' + quien(d.email) : 'de la empresa'} (${d.periodo})`;
  if (t === 'acceso') return `Ha abierto la vista de ${d.vista}`;
  if (t === 'exportar') return `Ha exportado ${d.que}`;
  if (t.startsWith('ia_recargas.')) {
    const tipo = despues.tipo || antes.tipo, imp = val('importe', despues.importe ?? antes.importe);
    if (t.endsWith('insert')) return tipo === 'solicitud' ? `Solicita ${imp} de saldo` : tipo === 'tarjeta' ? `Inicia una recarga con tarjeta de ${imp}` : `Ajuste de saldo de ${imp}`;
    if (antes.estado !== despues.estado) return `${tipo === 'solicitud' ? 'Solicitud' : 'Recarga'} de ${imp}: ${despues.estado}`;
    return `Recarga de ${imp} modificada`;
  }
  if (t.startsWith('ia_personas') && despues.pide_avanzada && !antes.pide_avanzada) return `${quien(despues.email)} pide la IA avanzada`;
  const cambios = Object.keys(CAMPOS).filter((k) => k in despues && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
    .map((k) => `${CAMPOS[k]}: ${t.endsWith('insert') ? '' : val(k, antes[k]) + ' → '}${val(k, despues[k])}`);
  const quienEs = t.startsWith('ia_personas') ? quien(despues.email || antes.email) + ' · ' : t.startsWith('ia_modelos') ? (despues.modelo || antes.modelo) + ' · ' : '';
  return cambios.length ? quienEs + cambios.join(' · ') : null;
}
async function registro(admin: any, company: string | null, limite = 30) {
  let q = admin.from('audit_log').select('company_id,accion,detalle,created_at').like('accion', 'ia.%').neq('accion', 'ia.acceso').order('created_at', { ascending: false }).limit(limite * 2);
  if (company) q = q.eq('company_id', company);
  const { data } = await q;
  const gente = await nombres(admin, company);
  const quien = (e: string) => gente.find((g) => g.email.toLowerCase() === String(e || '').toLowerCase())?.name || e || 'Synqalia';
  return (data || []).map((a: any) => {
    const texto = frase(a, quien);
    if (!texto) return null;
    const por = a.detalle?.por;
    return { fecha: a.created_at, company_id: a.company_id, por: por === 'migracion' ? 'Synqalia' : por === 'stripe' ? 'Stripe' : por ? quien(por) : 'Synqalia', texto };
  }).filter(Boolean).slice(0, limite);
}
const acceso = (admin: any, p: Persona, accion: string, detalle: Record<string, unknown>) =>
  admin.from('audit_log').insert({ company_id: p.company_id, owner: p.owner, accion, detalle: { ...detalle, por: p.email } });

// ---------- Stripe ----------
async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function webhook(admin: any, req: Request) {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook no configurado' }, 501);
  const raw = await req.text();
  const head = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(head.split(',').map((x) => x.split('=') as [string, string]));
  const t = parts.t, firmas = head.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!t || !firmas.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return json({ error: 'Firma no válida' }, 400);
  const esperada = await hmacHex(secret, `${t}.${raw}`);
  if (!firmas.includes(esperada)) return json({ error: 'Firma no válida' }, 400);
  const ev = JSON.parse(raw);
  const s = ev?.data?.object;
  if (ev.type === 'checkout.session.completed' && s?.payment_status === 'paid') {
    await admin.from('ia_recargas').update({ estado: 'pagada', resuelto_por: 'stripe', resuelto_at: new Date().toISOString() })
      .eq('stripe_session', s.id).eq('estado', 'pendiente');
  }
  if (ev.type === 'checkout.session.expired') {
    await admin.from('ia_recargas').update({ estado: 'cancelada', resuelto_por: 'stripe', resuelto_at: new Date().toISOString() })
      .eq('stripe_session', s.id).eq('estado', 'pendiente');
  }
  return json({ received: true });
}
async function checkout(admin: any, p: Persona, euros: number) {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return { error: 'El pago con tarjeta aún no está activado. Puedes enviar una solicitud.' };
  const { data: rec, error } = await admin.from('ia_recargas').insert({ company_id: p.company_id, tipo: 'tarjeta', importe: euros, estado: 'pendiente', solicitado_por: p.email }).select('id').single();
  if (error) throw error;
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', `${APP_URL}/mi.html?ia_pago=ok#ia`);
  f.set('cancel_url', `${APP_URL}/mi.html?ia_pago=cancelado#ia`);
  f.set('client_reference_id', rec.id);
  f.set('customer_email', p.email);
  f.set('metadata[recarga_id]', rec.id);
  f.set('metadata[company_id]', p.company_id);
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'eur');
  f.set('line_items[0][price_data][unit_amount]', String(Math.round(euros * (1 + IVA / 100) * 100)));
  f.set('line_items[0][price_data][product_data][name]', `Saldo de IA Synqalia · ${euros.toFixed(2).replace('.', ',')} € + IVA ${IVA} %`);
  f.set('expires_at', String(Math.floor(Date.now() / 1000) + 3600));
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.url) {
    console.error('ia-saldo: Stripe', r.status, out?.error?.message);
    await admin.from('ia_recargas').update({ estado: 'cancelada', resuelto_por: 'stripe', nota: 'No se pudo abrir el pago' }).eq('id', rec.id);
    return { error: 'No se ha podido abrir el pago con tarjeta. Prueba más tarde o envía una solicitud.' };
  }
  await admin.from('ia_recargas').update({ stripe_session: out.id }).eq('id', rec.id);
  return { url: out.url };
}

// ---------- vistas ----------
async function vistaUsuario(admin: any, p: Persona) {
  const { data: emp } = await admin.from('ia_empresas').select('*').eq('company_id', p.company_id).maybeSingle();
  if (!emp) return { activa: false, rol: { admin: p.role === 'admin', propietario: p.propietario } };
  const s = (await saldoEmpresa(admin, p.company_id))!;
  const { data: per } = await admin.from('ia_personas').select('nivel,limite,pide_avanzada').eq('company_id', p.company_id).eq('email', p.email).maybeSingle();
  const mes = await agregado(admin, p.company_id, s.inicio_mes);
  const mias = mes.filter((r: any) => r.email === p.email);
  const usado = suma(mias, 'importe');
  const limite = per?.limite != null ? num(per.limite) : emp.limite_persona != null ? num(emp.limite_persona) : null;
  const totalEmp = s.consumido_mes + s.disponible;
  let base: number, restante: number, pct: number;
  if (limite != null) { base = limite; restante = Math.min(Math.max(limite - usado, 0), s.disponible); pct = limite > 0 ? usado / limite : 1; }
  else { base = totalEmp; restante = s.disponible; pct = totalEmp > 0 ? s.consumido_mes / totalEmp : 1; }
  if (emp.limite_mensual != null) restante = Math.min(restante, Math.max(num(emp.limite_mensual) - s.consumido_mes, 0));
  // Usos aproximados que le quedan: con el coste medio por uso de cada función en su empresa (últimos 90 días)
  const hist = await agregado(admin, p.company_id, new Date(Date.now() - 90 * DIA));
  const medio = (f: string) => { const rows = hist.filter((r: any) => r.funcion === f); const u = suma(rows, 'usos'); return u ? suma(rows, 'importe') / u : 0; };
  const usos: Record<string, number | null> = {};
  for (const f of ['respuestas', 'resumenes', 'asistente']) { const m = medio(f); usos[f] = m > 0 ? Math.floor(restante / m) : null; }
  const porFuncion = Object.keys(FUNCIONES).map((f) => {
    const rows = mias.filter((r: any) => r.funcion === f);
    return { funcion: f, nombre: FUNCIONES[f], usos: suma(rows, 'usos'), pct: base > 0 ? Math.round((suma(rows, 'importe') / base) * 1000) / 10 : 0 };
  }).filter((x) => x.usos > 0).sort((a, b) => b.pct - a.pct);
  const per0 = periodo(emp.zona);
  const { data: av } = await admin.from('ia_avisos').select('email,umbral').eq('company_id', p.company_id).eq('periodo', per0).in('email', ['', p.email]);
  return {
    activa: emp.activa, nivel: per?.nivel || 'basica', pide_avanzada: per?.pide_avanzada || null,
    pct: Math.min(Math.round(pct * 1000) / 10, 100), queda_pct: Math.max(Math.round((1 - pct) * 1000) / 10, 0),
    tiene_limite_propio: limite != null, pausada: restante <= 0, renueva: siguienteMes(s.inicio_mes),
    usos_aprox: usos, por_funcion: porFuncion, aviso_80: emp.aviso_80, aviso_100: emp.aviso_100,
    avisos: (av || []).map((a: any) => ({ de: a.email ? 'tú' : 'empresa', umbral: a.umbral })),
    rol: { admin: p.role === 'admin', propietario: p.propietario },
  };
}

async function vistaAdmin(admin: any, p: Persona) {
  const { data: emp } = await admin.from('ia_empresas').select('*').eq('company_id', p.company_id).maybeSingle();
  if (!emp) return { activa: false };
  const s = (await saldoEmpresa(admin, p.company_id))!;
  const mes = await agregado(admin, p.company_id, s.inicio_mes);
  const gente = await nombres(admin, p.company_id);
  const { data: pers } = await admin.from('ia_personas').select('*').eq('company_id', p.company_id);
  const personas = gente.map((g) => {
    const e = g.email.toLowerCase(), cfg = (pers || []).find((x: any) => x.email === e);
    const usado = suma(mes.filter((r: any) => r.email === e), 'importe');
    const limite = cfg?.limite != null ? num(cfg.limite) : emp.limite_persona != null ? num(emp.limite_persona) : null;
    return { email: e, nombre: g.name || e, nivel: cfg?.nivel || 'basica', limite_propio: cfg?.limite != null ? num(cfg.limite) : null, limite, usado: r2(usado), pct: limite ? Math.round((usado / limite) * 1000) / 10 : null, pide_avanzada: cfg?.pide_avanzada || null };
  }).sort((a, b) => b.usado - a.usado);
  const porFuncion = Object.keys(FUNCIONES).map((f) => ({ funcion: f, nombre: FUNCIONES[f], importe: r2(suma(mes.filter((r: any) => r.funcion === f), 'importe')), usos: suma(mes.filter((r: any) => r.funcion === f), 'usos') }))
    .filter((x) => x.usos > 0).sort((a, b) => b.importe - a.importe);
  const { data: rec } = await admin.from('ia_recargas').select('id,tipo,importe,estado,solicitado_por,created_at,resuelto_at,nota').eq('company_id', p.company_id).order('created_at', { ascending: false }).limit(24);
  const extraMes = suma((rec || []).filter((r: any) => ['pagada', 'aprobada'].includes(r.estado) && new Date(r.resuelto_at || r.created_at) >= new Date(s.inicio_mes)), 'importe');
  const total = s.consumido_mes + s.disponible;
  await acceso(admin, p, 'ia.acceso', { vista: 'administrador' });
  return {
    activa: emp.activa, empresa: emp.nombre, renueva: siguienteMes(s.inicio_mes),
    saldo: { mensual: s.saldo_mensual, consumido: r2(s.consumido_mes), disponible: r2(s.disponible), recargas_restantes: r2(s.recargas_restantes), recargas_mes: r2(extraMes), pct: total > 0 ? Math.round((s.consumido_mes / total) * 1000) / 10 : 100, fin_estimado: s.disponible > 0 ? finEstimado(s.consumido_mes, s.disponible, s.inicio_mes) : null },
    config: { limite_mensual: emp.limite_mensual == null ? null : num(emp.limite_mensual), limite_persona: emp.limite_persona == null ? null : num(emp.limite_persona), aviso_80: emp.aviso_80, aviso_100: emp.aviso_100, aviso_correo_admin: emp.aviso_correo_admin, al_tope: emp.al_tope, tope_tarjeta: emp.tope_tarjeta == null ? null : num(emp.tope_tarjeta) },
    personas, avanzada: personas.filter((x) => x.nivel === 'avanzada').length, por_funcion: porFuncion,
    recargas: (rec || []).map((r: any) => ({ ...r, importe: num(r.importe) })),
    registro: await registro(admin, p.company_id),
    tarjeta: !!Deno.env.get('STRIPE_SECRET_KEY'), iva: IVA,
  };
}

async function vistaPropietario(admin: any, p: Persona) {
  const plat = await plataforma(admin);
  const { data: emps } = await admin.from('ia_empresas').select('*').order('nombre');
  const gente = await nombres(admin, null);
  const ahora = new Date();
  const inicioMes = new Date((await admin.rpc('ia_inicio_mes', { p_zona: 'Europe/Madrid' })).data);
  const mes = await agregado(admin, null, inicioMes);
  const hoy0 = medianocheMadrid(ahora);
  const hoy = await agregado(admin, null, hoy0);
  const sem = await agregado(admin, null, new Date(hoy0.getTime() - 7 * DIA), hoy0);
  const costeHoy = suma(hoy, 'coste_eur'), mediaDia = suma(sem, 'coste_eur') / 7;
  const empresas = [];
  for (const e of emps || []) {
    const s = await saldoEmpresa(admin, e.company_id);
    const rows = mes.filter((r: any) => r.company_id === e.company_id);
    const cobrado = suma(rows, 'importe'), coste = suma(rows, 'coste_eur');
    const total = s ? s.consumido_mes + s.disponible : 0;
    const { count } = await admin.from('ia_recargas').select('id', { count: 'exact', head: true }).eq('company_id', e.company_id).eq('estado', 'pendiente').eq('tipo', 'solicitud');
    empresas.push({
      company_id: e.company_id, nombre: e.nombre, activa: e.activa, usuarios: gente.filter((g) => g.company_id === e.company_id).length,
      saldo_mensual: num(e.saldo_mensual), multiplicador: e.multiplicador == null ? null : num(e.multiplicador),
      cobrado: r2(cobrado), coste: r2(coste), margen_pct: cobrado > 0 ? Math.round(((cobrado - coste) / cobrado) * 1000) / 10 : null,
      pct: total > 0 && s ? Math.round((s.consumido_mes / total) * 1000) / 10 : null, disponible: s ? r2(s.disponible) : 0, solicitudes: count || 0,
    });
  }
  const { data: pend } = await admin.from('ia_recargas').select('id,company_id,importe,solicitado_por,created_at,nota').eq('tipo', 'solicitud').eq('estado', 'pendiente').order('created_at');
  const desde6 = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 5, 1));
  const { data: meses } = await admin.rpc('ia_meses', { p_desde: desde6.toISOString() });
  // Saldo de Anthropic: lo apunta Jaime al recargar; se le resta el coste medido desde entonces
  let anthropic: any = null;
  if (plat?.anthropic_saldo_usd != null) {
    const gastado = plat.anthropic_saldo_fecha ? suma(await agregado(admin, null, plat.anthropic_saldo_fecha), 'coste_usd') : 0;
    const restante = num(plat.anthropic_saldo_usd) - gastado;
    const usdDia = suma(sem, 'coste_usd') / 7;
    anthropic = { apuntado: num(plat.anthropic_saldo_usd), fecha: plat.anthropic_saldo_fecha, gastado: r2(gastado), restante: r2(restante), dias: usdDia > 0 ? Math.floor(restante / usdDia) : null, bajo: restante < num(plat.aviso_saldo_usd) };
  }
  const { data: modelos } = await admin.from('ia_modelos').select('*').order('nivel');
  const cobrado = suma(mes, 'importe'), coste = suma(mes, 'coste_eur');
  await acceso(admin, p, 'ia.acceso', { vista: 'propietario' });
  return {
    plataforma: plat, anthropic, modelos: modelos || [],
    totales: { cobrado: r2(cobrado), coste: r2(coste), coste_usd: r2(suma(mes, 'coste_usd')), margen: r2(cobrado - coste), margen_pct: cobrado > 0 ? Math.round(((cobrado - coste) / cobrado) * 1000) / 10 : null, coste_hoy: r2(costeHoy), media_dia: r2(mediaDia), disparado: mediaDia > 0 && costeHoy > mediaDia * num(plat?.gasto_disparado_pct || 150) / 100, usuarios: gente.length },
    empresas, solicitudes: (pend || []).map((x: any) => ({ ...x, importe: num(x.importe), empresa: (emps || []).find((e: any) => e.company_id === x.company_id)?.nombre || x.company_id, quien: gente.find((g) => g.email.toLowerCase() === String(x.solicitado_por || '').toLowerCase())?.name || x.solicitado_por })),
    meses: (meses || []).map((m: any) => ({ mes: m.mes, cobrado: r2(num(m.importe)), coste: r2(num(m.coste_eur)) })),
    registro: await registro(admin, null, 40),
  };
}

// ---------- CSV (consumo del mes) ----------
function csv(rows: any[][]) { return rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n'); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  if (url.searchParams.get('stripe') === 'webhook') return await webhook(admin, req);

  const p = await identificar(admin, req);
  if ('error' in p) return json({ error: p.error }, p.status);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }
  const esAdmin = p.role === 'admin';
  const soloAdmin = () => json({ error: 'Solo el administrador de tu empresa puede hacer esto' }, 403);
  const soloDueno = () => json({ error: 'Solo el propietario de Synqalia puede hacer esto' }, 403);

  try {
    if (!(await plataforma(admin))) return json({ error: 'La sección de IA y saldo aún no está activada (falta preparar la base de datos).', code: 'sin_tablas' }, 503);
    switch (body.action) {
      case 'estado': return json(await vistaUsuario(admin, p));

      case 'pedir_avanzada': {
        const { data: per } = await admin.from('ia_personas').select('nivel').eq('company_id', p.company_id).eq('email', p.email).maybeSingle();
        if (per?.nivel === 'avanzada') return json({ ok: true, ya: true });
        const { error } = await admin.from('ia_personas').upsert({ company_id: p.company_id, email: p.email, pide_avanzada: new Date().toISOString(), updated_by: p.email, updated_at: new Date().toISOString() }, { onConflict: 'company_id,email' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'admin': if (!esAdmin) return soloAdmin(); return json(await vistaAdmin(admin, p));

      case 'guardar_empresa': {
        if (!esAdmin) return soloAdmin();
        const c = body.config || {}, cambios: Record<string, unknown> = {};
        for (const k of ['limite_mensual', 'limite_persona', 'tope_tarjeta']) if (k in c) { const v = importe(c[k]); if (v === undefined) return json({ error: `${CAMPOS[k]}: importe no válido` }, 400); cambios[k] = v; }
        for (const k of ['aviso_80', 'aviso_100', 'aviso_correo_admin']) if (k in c) cambios[k] = !!c[k];
        if ('al_tope' in c) { if (!['pausar', 'tarjeta'].includes(c.al_tope)) return json({ error: 'Opción no válida' }, 400); cambios.al_tope = c.al_tope; }
        if (!Object.keys(cambios).length) return json({ ok: true });
        const { error } = await admin.from('ia_empresas').update({ ...cambios, updated_by: p.email, updated_at: new Date().toISOString() }).eq('company_id', p.company_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_persona': {
        if (!esAdmin) return soloAdmin();
        const e = String(body.email || '').toLowerCase().trim();
        const { data: m } = await admin.from('members').select('email').eq('company_id', p.company_id).ilike('email', e).maybeSingle();
        if (!m) return json({ error: 'Esa persona no es de tu empresa' }, 404);
        const fila: Record<string, unknown> = { company_id: p.company_id, email: e, updated_by: p.email, updated_at: new Date().toISOString() };
        if ('nivel' in body) { if (!['basica', 'avanzada'].includes(body.nivel)) return json({ error: 'Nivel no válido' }, 400); fila.nivel = body.nivel; fila.pide_avanzada = null; }
        if ('limite' in body) { const v = importe(body.limite); if (v === undefined) return json({ error: 'Límite no válido' }, 400); fila.limite = v; }
        const { error } = await admin.from('ia_personas').upsert(fila, { onConflict: 'company_id,email' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'recargar': {
        if (!esAdmin) return soloAdmin();
        const euros = importe(body.importe, { nulo: false, max: 5000 });
        if (!euros || euros < 5) return json({ error: 'El importe tiene que estar entre 5 € y 5.000 €' }, 400);
        if (body.modo === 'tarjeta') { const r = await checkout(admin, p, euros); return json(r, r.error ? 400 : 200); }
        const { count } = await admin.from('ia_recargas').select('id', { count: 'exact', head: true }).eq('company_id', p.company_id).eq('tipo', 'solicitud').eq('estado', 'pendiente');
        if ((count || 0) >= 3) return json({ error: 'Ya tienes solicitudes pendientes de aprobar' }, 409);
        const { error } = await admin.from('ia_recargas').insert({ company_id: p.company_id, tipo: 'solicitud', importe: euros, estado: 'pendiente', solicitado_por: p.email, nota: String(body.nota || '').slice(0, 300) || null });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'cancelar_solicitud': {
        if (!esAdmin) return soloAdmin();
        const { error } = await admin.from('ia_recargas').update({ estado: 'cancelada', resuelto_por: p.email, resuelto_at: new Date().toISOString() })
          .eq('id', String(body.id || '')).eq('company_id', p.company_id).eq('estado', 'pendiente').eq('tipo', 'solicitud');
        if (error) throw error;
        return json({ ok: true });
      }

      case 'exportar': {
        if (!esAdmin && !p.propietario) return soloAdmin();
        const todas = !!body.todas && p.propietario;
        const company = todas ? null : p.company_id;
        const inicio = (await saldoEmpresa(admin, p.company_id))?.inicio_mes || new Date(Date.now() - 31 * DIA);
        const rows = await agregado(admin, company, inicio);
        const gente = await nombres(admin, company);
        const nom = (e: string) => gente.find((g) => g.email.toLowerCase() === e)?.name || e;
        const cab = todas ? ['Empresa', 'Persona', 'Email', 'Función', 'Usos', 'Importe €', 'Coste €', 'Coste US$'] : ['Persona', 'Email', 'Función', 'Usos', 'Importe €'];
        const f2 = (v: number) => v.toFixed(2).replace('.', ',');
        const lineas = rows.map((r: any) => todas ? [r.company_id, nom(r.email), r.email, FUNCIONES[r.funcion] || r.funcion, r.usos, f2(r.importe), f2(r.coste_eur), f2(r.coste_usd)] : [nom(r.email), r.email, FUNCIONES[r.funcion] || r.funcion, r.usos, f2(r.importe)]);
        await acceso(admin, p, 'ia.exportar', { que: todas ? 'el consumo de todas las empresas' : 'el consumo del mes' });
        return json({ nombre: `ia-consumo-${periodo()}${todas ? '-todas' : ''}.csv`, csv: '﻿' + csv([cab, ...lineas]) });
      }

      case 'propietario': if (!p.propietario) return soloDueno(); return json(await vistaPropietario(admin, p));

      case 'resolver_solicitud': {
        if (!p.propietario) return soloDueno();
        const estado = body.aprobar ? 'aprobada' : 'rechazada';
        const { data, error } = await admin.from('ia_recargas').update({ estado, resuelto_por: p.email, resuelto_at: new Date().toISOString(), nota: String(body.nota || '').slice(0, 300) || null })
          .eq('id', String(body.id || '')).eq('estado', 'pendiente').eq('tipo', 'solicitud').select('id');
        if (error) throw error;
        if (!data?.length) return json({ error: 'Esa solicitud ya no está pendiente' }, 409);
        return json({ ok: true });
      }

      case 'ajuste': {
        if (!p.propietario) return soloDueno();
        const euros = importe(body.importe, { nulo: false, max: 50000 });
        if (!euros) return json({ error: 'Importe no válido' }, 400);
        const { error } = await admin.from('ia_recargas').insert({ company_id: String(body.company_id || ''), tipo: 'ajuste', importe: euros, estado: 'aprobada', solicitado_por: p.email, resuelto_por: p.email, resuelto_at: new Date().toISOString(), nota: String(body.nota || '').slice(0, 300) || null });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_plan': {
        if (!p.propietario) return soloDueno();
        const id = String(body.company_id || '').trim();
        if (!/^[a-z0-9_-]{2,40}$/.test(id)) return json({ error: 'Identificador de empresa no válido' }, 400);
        const fila: Record<string, unknown> = { company_id: id, updated_by: p.email, updated_at: new Date().toISOString() };
        if ('nombre' in body) fila.nombre = String(body.nombre || '').trim().slice(0, 120) || id;
        if ('saldo_mensual' in body) { const v = importe(body.saldo_mensual, { nulo: false }); if (v === undefined) return json({ error: 'Saldo no válido' }, 400); fila.saldo_mensual = v; }
        if ('multiplicador' in body) { const v = body.multiplicador === null || body.multiplicador === '' ? null : Number(String(body.multiplicador).replace(',', '.')); if (v !== null && !(v >= 1 && v <= 20)) return json({ error: 'El multiplicador va de 1 a 20' }, 400); fila.multiplicador = v; }
        if ('activa' in body) fila.activa = !!body.activa;
        const { data: ya } = await admin.from('ia_empresas').select('company_id').eq('company_id', id).maybeSingle();
        const { error } = ya ? await admin.from('ia_empresas').update(fila).eq('company_id', id) : await admin.from('ia_empresas').insert({ nombre: id, ...fila });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_plataforma': {
        if (!p.propietario) return soloDueno();
        const c = body.config || {}, f: Record<string, unknown> = {};
        const nums: Record<string, [number, number]> = { usd_eur: [0.3, 3], multiplicador: [1, 20], aviso_saldo_usd: [0, 100000], gasto_disparado_pct: [100, 1000], margen_min_pct: [0, 99] };
        for (const [k, [lo, hi]] of Object.entries(nums)) if (k in c) { const v = Number(String(c[k]).replace(',', '.')); if (!(v >= lo && v <= hi)) return json({ error: `${CAMPOS[k]}: valor fuera de rango` }, 400); f[k] = v; }
        if ('anthropic_recarga_auto' in c) f.anthropic_recarga_auto = !!c.anthropic_recarga_auto;
        if ('anthropic_saldo_usd' in c) { const v = importe(c.anthropic_saldo_usd, { nulo: false, max: 1e6 }); if (v === undefined) return json({ error: 'Saldo no válido' }, 400); f.anthropic_saldo_usd = v; f.anthropic_saldo_fecha = new Date().toISOString(); }
        for (const k of ['modelo_basica', 'modelo_avanzada']) if (k in c) {
          const { data: m } = await admin.from('ia_modelos').select('modelo').eq('modelo', String(c[k])).maybeSingle();
          if (!m) return json({ error: `${CAMPOS[k]}: ese modelo no tiene precio en la tabla de modelos` }, 400);
          f[k] = m.modelo;
        }
        const { error } = await admin.from('ia_plataforma').update({ ...f, updated_by: p.email, updated_at: new Date().toISOString() }).eq('id', 1);
        if (error) throw error;
        return json({ ok: true });
      }

      case 'guardar_modelo': {
        if (!p.propietario) return soloDueno();
        const m = body.modelo || {};
        const modelo = String(m.modelo || '').trim();
        if (!/^[a-z0-9.\-:_]{3,80}$/i.test(modelo) || !['basica', 'avanzada'].includes(m.nivel)) return json({ error: 'Modelo o nivel no válido' }, 400);
        const precios = ['usd_in', 'usd_out', 'usd_cache_write', 'usd_cache_read'].map((k) => Number(String(m[k] ?? 0).replace(',', '.')));
        if (precios.some((v) => !(v >= 0 && v < 1000))) return json({ error: 'Precio no válido' }, 400);
        const { error } = await admin.from('ia_modelos').upsert({ modelo, nivel: m.nivel, usd_in: precios[0], usd_out: precios[1], usd_cache_write: precios[2], usd_cache_read: precios[3], activo: m.activo !== false, updated_at: new Date().toISOString() }, { onConflict: 'modelo' });
        if (error) throw error;
        return json({ ok: true });
      }

      default: return json({ error: 'Acción desconocida' }, 400);
    }
  } catch (e) {
    console.error('ia-saldo', body?.action, e);
    return json({ error: 'No se ha podido completar: ' + String((e as any)?.message || e) }, 500);
  }
});
