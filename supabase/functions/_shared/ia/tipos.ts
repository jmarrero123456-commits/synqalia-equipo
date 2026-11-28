// Synqalia · Motor IA común · tipos compartidos.

/** Nivel pedido por la función: básica (incluida), avanzada (de pago) o fondo (tareas que el usuario no ve). */
export type Nivel = 'basica' | 'avanzada' | 'fondo';
/** Nivel con el que se ha hecho la llamada: además, «ahorro» cuando se ha agotado el saldo. */
export type NivelUsado = Nivel | 'ahorro';

/** Petición al modelo (formato de mensajes de Anthropic, que es el que usan Anthropic y Bedrock). */
export interface PeticionIA {
  system?: unknown;
  messages: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
}

export interface Uso {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Respuesta del modelo (formato de Anthropic). */
export interface RespuestaIA {
  content: any[];
  stop_reason?: string;
  usage?: Uso;
  model?: string;
}

export interface Contexto {
  company_id: string;
  email: string;
}

export interface EstadoIA {
  activa: boolean;
  nivel: 'basica' | 'avanzada';
  bloqueado: boolean;
  al_agotar: 'ahorro' | 'parar';
  usuario_limite: number;
  usuario_usados: number;
  empresa_total: number;
  empresa_usados: number;
  recarga_auto: boolean;
  recargas: number;
  recarga_max_mes: number;
}

export interface Precio {
  entrada_usd: number;
  salida_usd: number;
  cache_escritura_usd: number;
  cache_lectura_usd: number;
}

export interface Registro {
  company_id: string;
  email: string;
  periodo: string;
  funcion: string;
  nivel: NivelUsado;
  modelo: string;
  tokens_entrada: number;
  tokens_salida: number;
  cache_lectura: number;
  cache_escritura: number;
  coste_usd: number;
  creditos: number;
  ok: boolean;
  codigo_error: string | null;
  ms: number;
}

/** Acceso a datos del motor. Hoy: funciones SQL vía Supabase. Mañana: PostgreSQL directo (RDS). */
export interface RepositorioIA {
  estado(ctx: Contexto, periodo: string): Promise<EstadoIA>;
  registrar(r: Registro): Promise<{ recarga: boolean }>;
  precios(): Promise<Record<string, Precio>>;
}

/** Proveedor del modelo. Hoy: API de Anthropic. Preparado para Bedrock (UE). */
export interface ProveedorIA {
  nombre: string;
  enviar(modelo: string, p: PeticionIA): Promise<{ ok: true; respuesta: RespuestaIA } | { ok: false; status: number; mensaje: string; retryAfter?: number }>;
}

/** Códigos de error que la app sabe explicar al usuario. */
export type CodigoIA =
  | 'no_contratada'   // pide IA avanzada sin tenerla
  | 'sin_saldo'       // saldo agotado y la empresa ha elegido «parar»
  | 'bloqueado'       // el administrador le ha quitado la IA
  | 'ia_desactivada'  // la empresa no tiene IA
  | 'clave'           // falta o falla la clave del proveedor
  | 'sin_saldo_proveedor' // el saldo de Synqalia con el proveedor se ha agotado
  | 'saturada' | 'rate_limited' | 'modelo' | 'ia';

export class ErrorIA extends Error {
  constructor(public codigo: CodigoIA, message: string, public status = 502) { super(message); }
}
