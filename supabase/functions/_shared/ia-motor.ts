// Synqalia · Motor IA común (28/11/2026)
// Una sola puerta para toda la IA: identifica a la persona y su empresa, comprueba el saldo Synqalia y los límites,
// elige el modelo según el nivel (básica / avanzada), llama al proveedor y apunta el consumo (tokens, coste y lo que se
// descuenta). Lo usan las funciones «ai», «asistente» e «ia-saldo».
// Portabilidad: solo SQL estándar (tablas ia_* y funciones ia_saldo_empresa / ia_agregado), variables de entorno y fetch.
// El proveedor del modelo está aislado en llamarModelo(): hoy la API de Anthropic; mañana Bedrock (UE) sin tocar el resto.
// Si las tablas aún no existen (migración sin aplicar), la IA sigue funcionando como antes y no se mide (fail-open),
// para no dejar a nadie sin IA por un despliegue a medias. Con las tablas, el saldo agotado sí bloquea (fail-closed).

export const FUNCIONES: Record<string, string> = {
  respuestas: 'Respuestas sugeridas',
  resumenes: 'Resúmenes de correo',
  asistente: 'Asistente',
  reuniones: 'Resúmenes de reuniones',
  dictado: 'Dictado y notas',
  tareas: 'Tareas',
  listas: 'Listas',
  mensajes: 'Mensajes',
  otros: 'Otros',
};
export const funcionValida = (f: unknown) => (typeof f === 'string' && f in FUNCIONES ? f : 'otros');

export type Persona = { email: string; owner: string; nombre: string; company_id: string; role: string; propietario: boolean };
export type Permiso =
  | { ok: true; medir: boolean; modelo: string; nivel: 'basica' | 'avanzada'; aviso?: string }
  | { ok: false; code: string; error: string };

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
export const propietarios = () => (Deno.env.get('IA_PROPIETARIOS') || 'j.marrero@correo-provalliance.es').toLowerCase().split(/[,;\s]+/).filter(Boolean);
const faltaTabla = (e: any) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|could not find/i.test(e.message || ''));

// Identifica a la persona (sesión) y su empresa. Toda consulta posterior filtra por persona.company_id.
export async function identificar(admin: any, req: Request): Promise<Persona | { error: string; status: number }> {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return { error: 'Inicia sesión', status: 401 };
  const { data: u } = await admin.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (!email) return { error: 'Inicia sesión', status: 401 };
  let { data: m, error } = await admin.from('members').select('email,name,role,company_id').ilike('email', email).maybeSingle();
  if (error && /company_id/.test(error.message || '')) ({ data: m } = await admin.from('members').select('email,name,role').ilike('email', email).maybeSingle());
  if (!m) return { error: 'No autorizado', status: 403 };
  return {
    email, owner: u.user.id, nombre: String(m.name || u.user.user_metadata?.full_name || email),
    company_id: String(m.company_id || 'provalliance'), role: String(m.role || 'member'), propietario: propietarios().includes(email),
  };
}

export async function plataforma(admin: any) {
  const { data, error } = await admin.from('ia_plataforma').select('*').eq('id', 1).maybeSingle();
  if (error) return faltaTabla(error) ? null : Promise.reject(error);
  return data;
}

export const periodo = (zona = 'Europe/Madrid', d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);

export async function saldoEmpresa(admin: any, company: string) {
  const { data, error } = await admin.rpc('ia_saldo_empresa', { p_company: company });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return { saldo_mensual: num(r.saldo_mensual), consumido_mes: num(r.consumido_mes), recargas_restantes: num(r.recargas_restantes), disponible: num(r.disponible), inicio_mes: r.inicio_mes };
}

export async function consumoPersonaMes(admin: any, company: string, email: string, desde: string | Date) {
  const { data, error } = await admin.rpc('ia_agregado', { p_company: company, p_desde: new Date(desde).toISOString(), p_hasta: null });
  if (error) throw error;
  return (data || []).filter((r: any) => r.email === email).reduce((s: number, r: any) => s + num(r.importe), 0);
}

// ¿Puede usar la IA ahora? Devuelve el modelo a usar según su nivel.
export async function permitir(admin: any, p: Persona, opts: { nivel?: string } = {}): Promise<Permiso> {
  const defecto = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
  let plat: any;
  try { plat = await plataforma(admin); } catch (e) { console.error('ia-motor: plataforma', e); return { ok: true, medir: false, modelo: defecto, nivel: 'basica' }; }
  if (!plat) return { ok: true, medir: false, modelo: defecto, nivel: 'basica' }; // migración sin aplicar
  const { data: emp } = await admin.from('ia_empresas').select('*').eq('company_id', p.company_id).maybeSingle();
  if (!emp || !emp.activa) return { ok: false, code: 'sin_plan', error: 'Tu empresa no tiene activada la IA de Synqalia. Habla con tu administrador.' };
  const { data: per } = await admin.from('ia_personas').select('nivel,limite').eq('company_id', p.company_id).eq('email', p.email).maybeSingle();
  const nivel: 'basica' | 'avanzada' = opts.nivel === 'avanzada' && per?.nivel === 'avanzada' ? 'avanzada' : 'basica';
  const s = await saldoEmpresa(admin, p.company_id);
  if (!s || s.disponible <= 0) return { ok: false, code: 'saldo_empresa', error: 'Se ha acabado el saldo de IA de tu empresa este mes. Tu administrador puede comprar o solicitar más saldo en Configuración › IA y saldo.' };
  if (emp.limite_mensual != null && s.consumido_mes >= num(emp.limite_mensual)) return { ok: false, code: 'limite_empresa', error: 'Tu empresa ha llegado al límite de gasto en IA que ha puesto el administrador para este mes.' };
  const limite = per?.limite != null ? num(per.limite) : emp.limite_persona != null ? num(emp.limite_persona) : null;
  if (limite != null) {
    const usado = await consumoPersonaMes(admin, p.company_id, p.email, s.inicio_mes);
    if (usado >= limite) return { ok: false, code: 'saldo_persona', error: 'Has llegado a tu límite de IA de este mes. Se renueva el día 1; tu administrador puede ampliarlo.' };
  }
  return { ok: true, medir: true, modelo: nivel === 'avanzada' ? plat.modelo_avanzada : plat.modelo_basica, nivel };
}

// Llamada al modelo. Hoy: API de Anthropic. Para pasar a Bedrock (eu-central-1), solo se cambia aquí.
export async function llamarModelo(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; out: any; headers: Headers }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, status: 501, out: { error: { message: 'IA no configurada' } }, headers: new Headers() };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, out, headers: r.headers };
}

const precios = new Map<string, any>();
async function precioModelo(admin: any, modelo: string) {
  if (precios.has(modelo)) return precios.get(modelo);
  const { data } = await admin.from('ia_modelos').select('*').eq('modelo', modelo).maybeSingle();
  let p = data;
  if (!p) { // modelo sin precio: se cobra como el más caro del mismo nombre base, o el de la básica (y se avisa en el registro)
    console.error('ia-motor: modelo sin precio en ia_modelos', modelo);
    const { data: all } = await admin.from('ia_modelos').select('*').order('usd_out', { ascending: false }).limit(1);
    p = all?.[0] || { usd_in: 2, usd_out: 10, usd_cache_write: 2.5, usd_cache_read: 0.1 };
  }
  precios.set(modelo, p);
  return p;
}

// Apunta el consumo de una llamada y lanza los avisos del 80 % y el 100 % (empresa y persona).
export async function registrar(admin: any, p: Persona, perm: Permiso, d: { funcion: string; modelo: string; usage?: any; ok?: boolean }) {
  if (!perm.ok || !perm.medir) return;
  try {
    const u = d.usage || {};
    const tin = num(u.input_tokens), tout = num(u.output_tokens), tcw = num(u.cache_creation_input_tokens), tcr = num(u.cache_read_input_tokens);
    if (!tin && !tout && !tcw && !tcr) return;
    const pr = await precioModelo(admin, d.modelo);
    const plat = await plataforma(admin);
    const { data: emp } = await admin.from('ia_empresas').select('multiplicador,zona,aviso_80,aviso_100,limite_persona').eq('company_id', p.company_id).maybeSingle();
    const usd = (tin * num(pr.usd_in) + tout * num(pr.usd_out) + tcw * num(pr.usd_cache_write) + tcr * num(pr.usd_cache_read)) / 1e6;
    const eur = usd * num(plat?.usd_eur || 0.91);
    const mult = emp?.multiplicador != null ? num(emp.multiplicador) : num(plat?.multiplicador || 2.5);
    const { error } = await admin.from('ia_consumo').insert({
      company_id: p.company_id, owner: p.owner, email: p.email, funcion: funcionValida(d.funcion), modelo: d.modelo, nivel: perm.nivel,
      tokens_in: tin, tokens_out: tout, tokens_cache_w: tcw, tokens_cache_r: tcr,
      coste_usd: usd.toFixed(6), coste_eur: eur.toFixed(6), importe: (eur * mult).toFixed(6), ok: d.ok !== false,
    });
    if (error) { console.error('ia-motor: no se pudo apuntar el consumo', error); return; }
    await avisos(admin, p, emp);
  } catch (e) { console.error('ia-motor: registrar', e); }
}

async function avisos(admin: any, p: Persona, emp: any) {
  if (!emp || (!emp.aviso_80 && !emp.aviso_100)) return;
  const s = await saldoEmpresa(admin, p.company_id);
  if (!s) return;
  const per = periodo(emp.zona);
  const lanzar = async (email: string, pct: number) => {
    for (const umbral of [80, 100]) {
      if (pct < umbral || (umbral === 80 && !emp.aviso_80) || (umbral === 100 && !emp.aviso_100)) continue;
      const { data } = await admin.from('ia_avisos').upsert({ company_id: p.company_id, email, periodo: per, umbral }, { onConflict: 'company_id,email,periodo,umbral', ignoreDuplicates: true }).select();
      if (data && data.length) await admin.from('audit_log').insert({ company_id: p.company_id, owner: email ? p.owner : null, accion: 'ia.aviso', detalle: { umbral, email: email || null, periodo: per, pct: Math.round(pct) } });
    }
  };
  const total = s.consumido_mes + s.disponible;
  if (total > 0) await lanzar('', (s.consumido_mes / total) * 100);
  const { data: pp } = await admin.from('ia_personas').select('limite').eq('company_id', p.company_id).eq('email', p.email).maybeSingle();
  const limite = pp?.limite != null ? num(pp.limite) : emp.limite_persona != null ? num(emp.limite_persona) : null;
  if (limite) await lanzar(p.email, (await consumoPersonaMes(admin, p.company_id, p.email, s.inicio_mes) / limite) * 100);
}
