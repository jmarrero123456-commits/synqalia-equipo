// Motivos de fallo del Motor IA: código estable para la app + texto listo para enseñar en pantalla.
export type CodigoIA =
  | 'no_autorizado' | 'sin_plan' | 'tope' | 'saturada' | 'demasiadas_peticiones' | 'servicio_no_disponible'
  | 'configuracion' | 'modelo' | 'formato' | 'peticion' | 'interno';

export const MENSAJES: Record<CodigoIA, string> = {
  no_autorizado: 'Tu usuario no tiene acceso a la IA de Synqalia.',
  sin_plan: 'Tu empresa no tiene un plan de IA activo. Habla con el administrador de tu empresa.',
  tope: 'Tu empresa ha llegado al límite de gasto de IA de este mes. Habla con el administrador de tu empresa.',
  saturada: 'La IA está saturada en este momento. Vuelve a probar en un minuto.',
  demasiadas_peticiones: 'Demasiadas peticiones seguidas a la IA. Espera un momento y vuelve a probar.',
  servicio_no_disponible: 'La IA de Synqalia no está disponible ahora mismo. Ya estamos avisados; vuelve a probar más tarde.',
  configuracion: 'La IA de Synqalia no está bien configurada. Ya estamos avisados.',
  modelo: 'El modelo de IA configurado no está disponible.',
  formato: 'La IA ha contestado algo que no he podido leer. Vuelve a probar.',
  peticion: 'La petición a la IA no es válida.',
  interno: 'Ha fallado la IA de Synqalia. Vuelve a probar.',
};

export const ESTADO_HTTP: Record<CodigoIA, number> = {
  no_autorizado: 403, sin_plan: 402, tope: 402, saturada: 503, demasiadas_peticiones: 429, servicio_no_disponible: 503,
  configuracion: 500, modelo: 502, formato: 502, peticion: 400, interno: 500,
};

// Motivos por los que una petición «avanzada» se ha atendido con el nivel básico (no es un error).
export const MOTIVOS_NIVEL: Record<string, string> = {
  sin_saldo: 'Tu empresa ha agotado el saldo de IA avanzada de este mes: se ha usado la IA básica.',
  limite_empresa: 'Tu empresa ha llegado a su límite mensual de IA avanzada: se ha usado la IA básica.',
  limite_usuario: 'Has llegado a tu límite mensual de IA avanzada: se ha usado la IA básica.',
  plan: 'El plan de tu empresa no incluye la IA avanzada: se ha usado la IA básica.',
};

export class ErrorIA extends Error {
  codigo: CodigoIA;
  detalle?: string; // motivo interno (no se enseña al usuario): p. ej. proveedor_sin_saldo
  reintentarEn?: number; // ms sugeridos por el proveedor
  constructor(codigo: CodigoIA, detalle?: string, reintentarEn?: number) {
    super(MENSAJES[codigo]);
    this.codigo = codigo;
    this.detalle = detalle;
    this.reintentarEn = reintentarEn;
  }
}

// Respuesta JSON uniforme para la app: { error, code } (code mantiene el nombre que ya lee la web).
export function cuerpoError(e: unknown) {
  const err = e instanceof ErrorIA ? e : new ErrorIA('interno', String((e as Error)?.message || e));
  return { status: ESTADO_HTTP[err.codigo], body: { error: err.message, code: err.codigo } };
}
