// Synqalia · Motor IA común (28/11/2026)
// La ÚNICA puerta por la que pasa la IA de Synqalia (respuesta sugerida, resúmenes, Perfeccionar, Asistente…):
//   1) reserva: comprueba plan, saldo y límites de la empresa en la base de datos (función SQL ia_reservar);
//   2) llama al modelo con el proveedor configurado (IA_PROVEEDOR = anthropic | bedrock);
//   3) liquida: apunta tokens y coste, lo descuenta del saldo y genera los avisos del 80 % / 100 % (ia_liquidar).
// Si la empresa ya no tiene saldo para el nivel avanzado, la petición se atiende con el básico (degradado = true).
//
// Portable: TypeScript sin dependencias de Supabase, Vercel ni Deno. La base de datos llega inyectada (BaseDatos)
// y los secretos se leen de variables de entorno.
import { env } from '../env.ts';
import { ErrorIA, MOTIVOS_NIVEL } from './errores.ts';
import { anthropic } from './proveedores/anthropic.ts';
import { bedrock } from './proveedores/bedrock.ts';
import { FUNCIONES, type BaseDatos, type Funcion, type Nivel, type PeticionModelo, type Proveedor, type RespuestaModelo } from './tipos.ts';

export * from './tipos.ts';
export { ErrorIA, MENSAJES, MOTIVOS_NIVEL, cuerpoError } from './errores.ts';

const PROVEEDORES: Record<string, Proveedor> = { anthropic, bedrock };

export function proveedorActual(): Proveedor {
  const n = (env('IA_PROVEEDOR') || 'anthropic').toLowerCase();
  const p = PROVEEDORES[n];
  if (!p) throw new ErrorIA('configuracion', 'IA_PROVEEDOR desconocido: ' + n);
  return p;
}

export function iaDisponible(): boolean {
  try { return proveedorActual().configurado(); } catch { return false; }
}

export interface Contexto {
  db: BaseDatos;
  email: string;
  companyId: string;
  peticionId?: string; // misma consulta en varios pasos (Asistente)
}

export interface Opciones {
  funcion: Funcion | string;
  nivel?: Nivel;
  peticion: PeticionModelo;
}

export interface Resultado {
  respuesta: RespuestaModelo;
  nivel: Nivel;
  degradado: boolean;
  aviso?: string;     // texto para la pantalla si se ha bajado a básico
  avisos: { umbral: number; porcentaje: number }[]; // umbrales cruzados en esta petición (80 / 100)
  consumoId: string;
}

// Tokens de entrada aproximados para la reserva (≈ 3 caracteres por token; cada imagen cuenta 1.600).
export function estimarTokens(p: PeticionModelo): number {
  let imgs = 0;
  const sinImagenes = JSON.stringify({ s: p.system, m: p.messages, t: p.tools }, (_k, v) => {
    if (v && typeof v === 'object' && v.type === 'image') { imgs++; return { type: 'image' }; }
    return v;
  });
  return Math.ceil(sinImagenes.length / 3) + imgs * 1600;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REINTENTABLES = new Set(['saturada', 'demasiadas_peticiones']);

export async function preguntar(ctx: Contexto, o: Opciones): Promise<Resultado> {
  if (!ctx.email || !ctx.companyId) throw new ErrorIA('no_autorizado');
  if (!o.peticion || !Array.isArray(o.peticion.messages) || !o.peticion.messages.length) throw new ErrorIA('peticion', 'sin mensajes');
  const funcion = (FUNCIONES as readonly string[]).includes(String(o.funcion)) ? String(o.funcion) : 'general';
  const nivelPedido: Nivel = o.nivel === 'avanzado' ? 'avanzado' : 'basico';
  const prov = proveedorActual();
  if (!prov.configurado()) throw new ErrorIA('configuracion', `proveedor ${prov.nombre} sin configurar`);

  // 1) Reserva
  const res: any = await ctx.db.rpc('ia_reservar', {
    p_company: ctx.companyId, p_usuario: ctx.email, p_funcion: funcion, p_nivel: nivelPedido, p_peticion: ctx.peticionId ?? null,
    p_proveedor: prov.nombre, p_modelo_basico: prov.modelo('basico'), p_modelo_avanzado: prov.modelo('avanzado'),
    p_tokens_entrada: estimarTokens(o.peticion), p_tokens_salida: Math.min(o.peticion.max_tokens || 1000, 4000),
  }).catch((e: unknown) => { throw new ErrorIA('interno', 'ia_reservar: ' + String((e as Error)?.message || e)); });
  if (!res?.ok) {
    if (res?.codigo === 'configuracion') console.error('motor-ia: configuración', res.detalle);
    throw new ErrorIA((res?.codigo || 'interno') as any, res?.detalle);
  }
  const nivel: Nivel = res.nivel;
  const modelo: string = res.modelo;
  const consumoId: string = res.consumo_id;

  // 2) Llamada al modelo (hasta 3 intentos si está saturada)
  const t0 = Date.now();
  let respuesta: RespuestaModelo | null = null;
  let fallo: ErrorIA | null = null;
  for (let i = 0; i < 3; i++) {
    try { respuesta = await prov.llamar(modelo, o.peticion); fallo = null; break; }
    catch (e) {
      fallo = e instanceof ErrorIA ? e : new ErrorIA('interno', String((e as Error)?.message || e));
      console.error('motor-ia: fallo', JSON.stringify({ proveedor: prov.nombre, modelo, funcion, codigo: fallo.codigo, detalle: fallo.detalle, intento: i + 1 }));
      if (!REINTENTABLES.has(fallo.codigo) || i === 2) break;
      await espera(Math.min(fallo.reintentarEn || 1500 * (i + 1), 6000));
    }
  }

  // 3) Liquidación (también de los fallos, con coste 0, para que quede el motivo)
  let liq: any = null;
  try {
    liq = await ctx.db.rpc('ia_liquidar', {
      p_consumo: consumoId, p_company: ctx.companyId, p_estado: respuesta ? 'ok' : 'error',
      p_codigo: fallo ? (fallo.detalle === 'proveedor_sin_saldo' ? 'proveedor_sin_saldo' : fallo.codigo) : null,
      p_modelo: respuesta?.modelo ?? null,
      p_in: respuesta?.uso.entrada ?? 0, p_out: respuesta?.uso.salida ?? 0,
      p_cache_r: respuesta?.uso.cache_lectura ?? 0, p_cache_w: respuesta?.uso.cache_escritura ?? 0,
      p_duracion: Date.now() - t0,
    });
  } catch (e) {
    // No se castiga al usuario por un fallo al apuntar: queda en el registro y la reserva caduca sola.
    console.error('motor-ia: no se pudo liquidar', consumoId, String((e as Error)?.message || e));
  }
  if (fallo || !respuesta) {
    if (fallo?.detalle === 'proveedor_sin_saldo') console.error('motor-ia: ALERTA el proveedor de IA se ha quedado sin crédito');
    throw fallo || new ErrorIA('interno');
  }
  return {
    respuesta, nivel, degradado: !!res.degradado, aviso: res.degradado ? MOTIVOS_NIVEL[res.motivo] : undefined,
    avisos: Array.isArray(liq?.avisos) ? liq.avisos : [], consumoId,
  };
}

// Texto de la respuesta (bloques «text» unidos).
export const textoDe = (r: RespuestaModelo) => (r.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
