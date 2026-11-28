// Synqalia · Motor IA común.
// Toda la IA de Synqalia pasa por aquí: decide el modelo según el nivel, comprueba el saldo de la empresa y del
// usuario, llama al proveedor (con reintentos), calcula el coste, lo registra y descuenta el saldo.
//
// Portable: no usa nada de Supabase ni de Deno. Recibe el entorno (variables), el repositorio de datos y el
// proveedor desde fuera, así que se puede ejecutar en cualquier servidor Node (p. ej. ECS en AWS).
//
// Variables de entorno:
//   IA_MODELO_BASICA   (por defecto claude-sonnet-5-5)
//   IA_MODELO_AVANZADA (por defecto claude-opus-5-5)
//   IA_MODELO_FONDO    (por defecto claude-haiku-5-5; también el del modo ahorro)
//   IA_EUR_POR_USD     (por defecto 0.86)
//   IA_CREDITO_EUR     (por defecto 0.01 → 1 crédito = 1 céntimo de coste real)
import type { Contexto, EstadoIA, Nivel, NivelUsado, PeticionIA, Precio, ProveedorIA, RepositorioIA, RespuestaIA } from './tipos.ts';
import { ErrorIA } from './tipos.ts';

export type Entorno = (clave: string) => string | undefined;

export interface Resultado {
  respuesta: RespuestaIA;
  modelo: string;
  nivel: NivelUsado;
  ahorro: boolean;
  saldo: SaldoVisible;
}

/** Lo que ve el usuario: porcentajes, no dinero (vale sea cual sea el formato del saldo). */
export interface SaldoVisible {
  nivel: 'basica' | 'avanzada';
  usuario_pct_restante: number;
  empresa_pct_restante: number;
  agotado: boolean;
  al_agotar: 'ahorro' | 'parar';
  bloqueado: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function periodoActual(fecha = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(fecha).slice(0, 7);
}

export function saldoVisible(e: EstadoIA): SaldoVisible {
  const pct = (usados: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - usados / total)))) : 0);
  const u = pct(Number(e.usuario_usados), Number(e.usuario_limite));
  const c = pct(Number(e.empresa_usados), Number(e.empresa_total));
  return { nivel: e.nivel, usuario_pct_restante: u, empresa_pct_restante: c, agotado: u <= 0 || c <= 0, al_agotar: e.al_agotar, bloqueado: e.bloqueado };
}

export function codigoDeFallo(status: number, msg: string) {
  const m = (msg || '').toLowerCase();
  if (m.includes('credit') || m.includes('billing') || m.includes('balance')) return 'sin_saldo_proveedor' as const;
  if (status === 401 || status === 403) return 'clave' as const;
  if (status === 429) return 'rate_limited' as const;
  if (status === 529 || status >= 500 || m.includes('overloaded')) return 'saturada' as const;
  if (m.includes('model')) return 'modelo' as const;
  return 'ia' as const;
}

export function crearMotor(opts: { env: Entorno; repo: RepositorioIA; proveedor: ProveedorIA; log?: (msg: string, datos?: unknown) => void }) {
  const { env, repo, proveedor } = opts;
  const log = opts.log || ((m: string, d?: unknown) => console.error(m, d === undefined ? '' : JSON.stringify(d)));
  const modelos: Record<Nivel, string> = {
    basica: env('IA_MODELO_BASICA') || 'claude-sonnet-5-5',
    avanzada: env('IA_MODELO_AVANZADA') || 'claude-opus-5-5',
    fondo: env('IA_MODELO_FONDO') || 'claude-haiku-5-5',
  };
  const eurPorUsd = Number(env('IA_EUR_POR_USD') || 0.86);
  const creditoEur = Number(env('IA_CREDITO_EUR') || 0.01);

  let preciosCache: { t: number; v: Record<string, Precio> } | null = null;
  async function precios() {
    if (preciosCache && Date.now() - preciosCache.t < 10 * 60_000) return preciosCache.v;
    preciosCache = { t: Date.now(), v: await repo.precios() };
    return preciosCache.v;
  }

  /** Coste en USD. Si el modelo no tiene precio, se usa el más caro conocido: nunca sale gratis por error. */
  async function costeUsd(modelo: string, u: RespuestaIA['usage']) {
    const tabla = await precios();
    let p = tabla[modelo];
    if (!p) {
      log('motor-ia: modelo sin precio, se aplica el más caro', { modelo });
      p = Object.values(tabla).sort((a, b) => b.salida_usd - a.salida_usd)[0] || { entrada_usd: 15, salida_usd: 75, cache_escritura_usd: 18.75, cache_lectura_usd: 1.5 };
    }
    return ((u?.input_tokens || 0) * p.entrada_usd + (u?.output_tokens || 0) * p.salida_usd +
      (u?.cache_read_input_tokens || 0) * p.cache_lectura_usd + (u?.cache_creation_input_tokens || 0) * p.cache_escritura_usd) / 1e6;
  }

  async function estado(ctx: Contexto) {
    return saldoVisible(await repo.estado(ctx, periodoActual()));
  }

  /**
   * Hace una llamada al modelo.
   * - funcion: para qué es (asistente, correo.sugerida, notas.ordenar…): sale en el consumo por función.
   * - nivel: 'basica' | 'avanzada' | 'fondo'.
   */
  async function ejecutar(ctx: Contexto, funcion: string, nivel: Nivel, peticion: PeticionIA): Promise<Resultado> {
    const periodo = periodoActual();
    const e = await repo.estado(ctx, periodo);
    const saldo = saldoVisible(e);
    if (!e.activa) throw new ErrorIA('ia_desactivada', 'La IA no está activada en tu empresa', 403);
    if (e.bloqueado) throw new ErrorIA('bloqueado', 'Tu administrador ha desactivado la IA para tu usuario', 403);
    if (nivel === 'avanzada' && e.nivel !== 'avanzada') throw new ErrorIA('no_contratada', 'La IA avanzada no está contratada', 402);

    let usado: NivelUsado = nivel;
    if (saldo.agotado && nivel !== 'fondo') {
      if (e.al_agotar === 'parar') throw new ErrorIA('sin_saldo', 'Se ha agotado el saldo de IA de este mes', 402);
      usado = 'ahorro';
    }
    let modelo = usado === 'ahorro' ? modelos.fondo : modelos[nivel];

    const t0 = Date.now();
    let fallo: { status: number; mensaje: string } | null = null;
    let respuesta: RespuestaIA | null = null;
    for (let i = 0; i < 3; i++) {
      const r = await proveedor.enviar(modelo, peticion);
      if (r.ok) { respuesta = r.respuesta; fallo = null; break; }
      fallo = r;
      log('motor-ia: fallo del proveedor', { proveedor: proveedor.nombre, status: r.status, msg: r.mensaje.slice(0, 300), modelo, intento: i + 1, funcion });
      // Modelo que no existe → el de la básica (si no era ya ese).
      if ((r.status === 404 || (r.status === 400 && /model/i.test(r.mensaje))) && modelo !== modelos.basica) { modelo = modelos.basica; continue; }
      if (r.status === 429 || r.status === 529 || r.status >= 500) {
        const ra = Number(r.retryAfter) || 0;
        await sleep(Math.min(ra * 1000 || 1500 * (i + 1), 6000));
        continue;
      }
      break;
    }
    const ms = Date.now() - t0;

    if (!respuesta) {
      const codigo = codigoDeFallo(fallo?.status || 0, fallo?.mensaje || '');
      await repo.registrar({ ...ctx, periodo, funcion, nivel: usado, modelo, tokens_entrada: 0, tokens_salida: 0, cache_lectura: 0, cache_escritura: 0, coste_usd: 0, creditos: 0, ok: false, codigo_error: codigo, ms })
        .catch((err) => log('motor-ia: no se pudo registrar el fallo', String(err)));
      throw new ErrorIA(codigo, fallo?.mensaje || 'Error de la IA', 502);
    }

    const coste = await costeUsd(modelo, respuesta.usage);
    const creditos = (coste * eurPorUsd) / creditoEur;
    // El registro descuenta el saldo. Si fallara, la respuesta se entrega igual pero queda en el log del servidor.
    await repo.registrar({
      ...ctx, periodo, funcion, nivel: usado, modelo,
      tokens_entrada: respuesta.usage?.input_tokens || 0, tokens_salida: respuesta.usage?.output_tokens || 0,
      cache_lectura: respuesta.usage?.cache_read_input_tokens || 0, cache_escritura: respuesta.usage?.cache_creation_input_tokens || 0,
      coste_usd: Number(coste.toFixed(6)), creditos: Number(creditos.toFixed(4)), ok: true, codigo_error: null, ms,
    }).catch((err) => log('motor-ia: no se pudo registrar el consumo', { err: String(err), ...ctx, funcion, coste }));

    const despues: SaldoVisible = {
      ...saldo,
      usuario_pct_restante: Math.max(0, Math.round(saldo.usuario_pct_restante - (100 * creditos) / Math.max(1, Number(e.usuario_limite)))),
      empresa_pct_restante: Math.max(0, Math.round(saldo.empresa_pct_restante - (100 * creditos) / Math.max(1, Number(e.empresa_total)))),
    };
    despues.agotado = despues.usuario_pct_restante <= 0 || despues.empresa_pct_restante <= 0;
    return { respuesta, modelo, nivel: usado, ahorro: usado === 'ahorro', saldo: despues };
  }

  return { ejecutar, estado, modelos };
}

export type Motor = ReturnType<typeof crearMotor>;
