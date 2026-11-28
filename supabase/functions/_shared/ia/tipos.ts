// Tipos del Motor IA. El formato de mensajes es el de Claude (Messages API), igual en la API de Anthropic y en Bedrock.
export type Nivel = 'basico' | 'avanzado';

export const FUNCIONES = [
  'sugerida', 'resumen', 'perfeccionar', 'tareas', 'asistente', 'asistente_voz', 'chat', 'dictado', 'general',
] as const;
export type Funcion = typeof FUNCIONES[number];

export interface PeticionModelo {
  system?: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  max_tokens: number;
}

export interface Uso { entrada: number; salida: number; cache_lectura: number; cache_escritura: number }

export interface RespuestaModelo {
  content: any[];
  stop_reason: string;
  uso: Uso;
  modelo: string;
}

export interface Proveedor {
  nombre: string; // 'anthropic' | 'bedrock'
  configurado(): boolean;
  modelo(nivel: Nivel): string;
  llamar(modelo: string, peticion: PeticionModelo): Promise<RespuestaModelo>;
}

// Acceso a la base de datos que necesita el motor: solo llamadas a funciones SQL (ia_reservar, ia_liquidar).
// Hoy lo implementa supabase-js; en un servidor propio, un cliente pg con `select fn(...)`.
export interface BaseDatos {
  rpc<T = any>(funcion: string, args: Record<string, unknown>): Promise<T>;
}
