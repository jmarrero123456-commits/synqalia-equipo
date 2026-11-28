// Proveedor: Claude en AWS Bedrock (región UE). Firma SigV4 propia con Web Crypto: sin SDK de AWS, funciona en Deno y Node.
// Variables: AWS_REGION (por defecto eu-central-1, Fráncfort), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN (opcional),
// IA_BEDROCK_MODELO_BASICO e IA_BEDROCK_MODELO_AVANZADO (id del modelo o del perfil de inferencia UE, tal como aparece en la consola de Bedrock).
import { env } from '../../env.ts';
import { ErrorIA } from '../errores.ts';
import type { Nivel, PeticionModelo, Proveedor, RespuestaModelo } from '../tipos.ts';

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, s: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(s));
}
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function firmarSigV4(o: { method: string; host: string; path: string; body: string; region: string; servicio: string; ak: string; sk: string; token?: string; ahora?: Date }) {
  const d = o.ahora || new Date();
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dia = amz.slice(0, 8);
  const hBody = await sha256(o.body);
  const h: Record<string, string> = { host: o.host, 'x-amz-date': amz, 'x-amz-content-sha256': hBody, 'content-type': 'application/json', accept: 'application/json' };
  if (o.token) h['x-amz-security-token'] = o.token;
  const nombres = Object.keys(h).sort();
  const canonUri = o.path.split('/').map(rfc3986).join('/'); // servicios no-S3: la ruta se codifica otra vez
  const canon = [o.method, canonUri, '', nombres.map((n) => `${n}:${h[n].trim()}\n`).join(''), nombres.join(';'), hBody].join('\n');
  const ambito = `${dia}/${o.region}/${o.servicio}/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amz, ambito, await sha256(canon)].join('\n');
  let k = await hmac(bytes('AWS4' + o.sk), dia);
  k = await hmac(k, o.region); k = await hmac(k, o.servicio); k = await hmac(k, 'aws4_request');
  const firma = hex(await hmac(k, aFirmar));
  h.authorization = `AWS4-HMAC-SHA256 Credential=${o.ak}/${ambito}, SignedHeaders=${nombres.join(';')}, Signature=${firma}`;
  delete h.host;
  return h;
}

function errorBedrock(status: number, tipo: string, msg: string): ErrorIA {
  const t = (tipo || '').toLowerCase(), m = (msg || '').toLowerCase();
  if (status === 403 || t.includes('accessdenied') || t.includes('unrecognizedclient')) return new ErrorIA('configuracion', 'aws: ' + tipo);
  if (status === 429 || t.includes('throttling')) return new ErrorIA('demasiadas_peticiones', tipo);
  if (status >= 500 || t.includes('serviceunavailable') || t.includes('modelnotready')) return new ErrorIA('saturada', tipo || String(status));
  if (status === 404 || t.includes('resourcenotfound') || (t.includes('validation') && m.includes('model'))) return new ErrorIA('modelo', msg.slice(0, 200));
  if (status === 400) return new ErrorIA('peticion', msg.slice(0, 200));
  return new ErrorIA('interno', `${status} ${msg.slice(0, 200)}`);
}

export const bedrock: Proveedor = {
  nombre: 'bedrock',
  configurado: () => !!(env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY') && env('IA_BEDROCK_MODELO_BASICO')),
  modelo(nivel: Nivel) {
    return nivel === 'avanzado' ? (env('IA_BEDROCK_MODELO_AVANZADO') || env('IA_BEDROCK_MODELO_BASICO') || '') : (env('IA_BEDROCK_MODELO_BASICO') || '');
  },
  async llamar(modelo: string, p: PeticionModelo): Promise<RespuestaModelo> {
    const ak = env('AWS_ACCESS_KEY_ID'), sk = env('AWS_SECRET_ACCESS_KEY');
    if (!ak || !sk || !modelo) throw new ErrorIA('configuracion', 'faltan credenciales o modelo de Bedrock');
    const region = env('AWS_REGION') || 'eu-central-1';
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const path = `/model/${encodeURIComponent(modelo)}/invoke`;
    const body = JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', ...p });
    const headers = await firmarSigV4({ method: 'POST', host, path, body, region, servicio: 'bedrock', ak, sk, token: env('AWS_SESSION_TOKEN') });
    let r: Response;
    try { r = await fetch(`https://${host}${path}`, { method: 'POST', headers, body }); }
    catch (e) { throw new ErrorIA('saturada', 'red: ' + String((e as Error)?.message || e)); }
    const out: any = await r.json().catch(() => ({}));
    if (!r.ok) throw errorBedrock(r.status, r.headers.get('x-amzn-errortype')?.split(':')[0] || out?.__type || '', out?.message || out?.Message || '');
    const u = out.usage || {};
    return {
      content: out.content || [], stop_reason: out.stop_reason || '', modelo,
      uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, cache_lectura: u.cache_read_input_tokens || 0, cache_escritura: u.cache_creation_input_tokens || 0 },
    };
  },
};
