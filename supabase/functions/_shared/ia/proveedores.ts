// Synqalia · Motor IA común · proveedores del modelo.
// IA_PROVEEDOR = 'anthropic' (por defecto) | 'bedrock'.
// Solo usa fetch estándar: corre igual en Supabase Edge, Deno o Node 18+.
import type { Entorno } from './motor.ts';
import type { PeticionIA, ProveedorIA } from './tipos.ts';
import { ErrorIA } from './tipos.ts';

/** API directa de Anthropic. Variables: ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (opcional). */
export function proveedorAnthropic(env: Entorno): ProveedorIA {
  const key = env('ANTHROPIC_API_KEY');
  const base = (env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    nombre: 'anthropic',
    async enviar(modelo: string, p: PeticionIA) {
      if (!key) throw new ErrorIA('clave', 'IA no configurada', 501);
      const r = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelo, max_tokens: p.max_tokens ?? 4000, ...quitarVacios(p) }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true as const, respuesta: out };
      return { ok: false as const, status: r.status, mensaje: String(out?.error?.message || 'Error de la IA'), retryAfter: Number(r.headers.get('retry-after')) || 0 };
    },
  };
}

/**
 * Claude en AWS Bedrock (región UE, p. ej. eu-central-1 Fráncfort). Pendiente de activar:
 * necesita la cuenta de AWS, acceso a los modelos en Bedrock y firma SigV4 (AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY o el rol del servidor en ECS). La petición y la respuesta usan el mismo formato de
 * mensajes que Anthropic, así que el motor no cambia: solo este proveedor.
 */
export function proveedorBedrock(_env: Entorno): ProveedorIA {
  return {
    nombre: 'bedrock',
    enviar() { throw new ErrorIA('clave', 'El proveedor Bedrock aún no está activado', 501); },
  };
}

export function proveedorDesdeEntorno(env: Entorno): ProveedorIA {
  return (env('IA_PROVEEDOR') || 'anthropic') === 'bedrock' ? proveedorBedrock(env) : proveedorAnthropic(env);
}

function quitarVacios(p: PeticionIA) {
  const o: Record<string, unknown> = { messages: p.messages };
  if (p.system !== undefined && p.system !== '') o.system = p.system;
  if (p.tools?.length) o.tools = p.tools;
  if (p.tool_choice) o.tool_choice = p.tool_choice;
  if (p.temperature !== undefined) o.temperature = p.temperature;
  return o;
}
