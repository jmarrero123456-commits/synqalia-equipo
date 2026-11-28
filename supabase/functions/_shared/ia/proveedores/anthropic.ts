// Proveedor: API directa de Anthropic. Variables: ANTHROPIC_API_KEY, IA_MODELO_BASICO, IA_MODELO_AVANZADO.
import { env } from '../../env.ts';
import { ErrorIA } from '../errores.ts';
import type { Nivel, PeticionModelo, Proveedor, RespuestaModelo } from '../tipos.ts';

export function codigoDesdeError(status: number, tipo: string, msg: string): ErrorIA {
  const m = (msg || '').toLowerCase();
  if (m.includes('credit') || m.includes('billing') || m.includes('balance')) return new ErrorIA('servicio_no_disponible', 'proveedor_sin_saldo');
  if (status === 401 || status === 403) return new ErrorIA('configuracion', 'clave');
  if (status === 429) return new ErrorIA('demasiadas_peticiones', 'rate_limit');
  if (status === 529 || status >= 500 || m.includes('overloaded')) return new ErrorIA('saturada', tipo || String(status));
  if (status === 404 || (status === 400 && m.includes('model'))) return new ErrorIA('modelo', msg.slice(0, 200));
  if (status === 400 || status === 413) return new ErrorIA('peticion', msg.slice(0, 200));
  return new ErrorIA('interno', `${status} ${msg.slice(0, 200)}`);
}

export const anthropic: Proveedor = {
  nombre: 'anthropic',
  configurado: () => !!env('ANTHROPIC_API_KEY'),
  modelo(nivel: Nivel) {
    return nivel === 'avanzado'
      ? (env('IA_MODELO_AVANZADO') || 'claude-opus-5-5')
      : (env('IA_MODELO_BASICO') || env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5');
  },
  async llamar(modelo: string, p: PeticionModelo): Promise<RespuestaModelo> {
    const key = env('ANTHROPIC_API_KEY');
    if (!key) throw new ErrorIA('configuracion', 'falta ANTHROPIC_API_KEY');
    let r: Response;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelo, ...p }),
      });
    } catch (e) {
      throw new ErrorIA('saturada', 'red: ' + String((e as Error)?.message || e));
    }
    const out: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = codigoDesdeError(r.status, out?.error?.type || '', out?.error?.message || '');
      const ra = Number(r.headers.get('retry-after')) || 0;
      if (ra) err.reintentarEn = ra * 1000;
      throw err;
    }
    const u = out.usage || {};
    return {
      content: out.content || [], stop_reason: out.stop_reason || '', modelo: out.model || modelo,
      uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, cache_lectura: u.cache_read_input_tokens || 0, cache_escritura: u.cache_creation_input_tokens || 0 },
    };
  },
};
