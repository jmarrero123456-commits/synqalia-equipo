// Asistente IA de synqalia: recibe un prompt (y opcionalmente imágenes) y devuelve JSON.
// Solo para usuarios con sesión iniciada que sean miembros de synqalia. Requiere ANTHROPIC_API_KEY.
// v6 (27/11): registra el motivo de cada fallo, reintenta si la IA está saturada y devuelve un código para que la app lo explique.
// v7 (28/11): pasa por el motor IA común: comprueba el saldo Synqalia de la empresa y los límites, usa el modelo del nivel
// de la persona y apunta el consumo por función (body.funcion: respuestas, resumenes, reuniones, dictado, tareas…).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identificar, permitir, registrar, llamarModelo, funcionValida } from '../_shared/ia-motor.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const FALLBACK = 'claude-sonnet-5-5';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractJson(t: string) {
  const s = t.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* sigue */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* sigue */ } }
  const c = s.indexOf('['), d = s.lastIndexOf(']');
  if (c >= 0 && d > c) { try { return JSON.parse(s.slice(c, d + 1)); } catch { /* sigue */ } }
  return null;
}

function codeOf(status: number, msg: string) {
  const m = (msg || '').toLowerCase();
  if (m.includes('credit') || m.includes('billing') || m.includes('balance')) return 'sin_saldo';
  if (status === 401 || status === 403) return 'clave';
  if (status === 429) return 'rate_limited';
  if (status === 529 || status >= 500 || m.includes('overloaded')) return 'saturada';
  if (m.includes('model')) return 'modelo';
  return 'ia';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const yo = await identificar(admin, req);
  if ('error' in yo) return json({ error: yo.error }, yo.status);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }
  if (body.ping) return json({ available: !!key, images: true });
  if (!key) return json({ error: 'IA no configurada', code: 'clave' }, 501);

  const perm = await permitir(admin, yo, { nivel: body.nivel });
  if (!perm.ok) return json({ error: perm.error, code: perm.code }, 402);
  const funcion = funcionValida(body.funcion);

  const content: any[] = [];
  for (const im of (body.images || []).slice(0, 4)) {
    if (im?.data && im?.media_type) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  content.push({ type: 'text', text: String(body.prompt || '').slice(0, 60000) });

  let model = perm.modelo;
  let r: Awaited<ReturnType<typeof llamarModelo>> | null = null;
  for (let i = 0; i < 3; i++) {
    r = await llamarModelo({ model, max_tokens: 4000, system: 'Respondes siempre con un único JSON válido, sin texto antes ni después.', messages: [{ role: 'user', content }] });
    if (r.ok) break;
    const msg = r.out?.error?.message || '';
    console.error('ai: fallo de la IA', JSON.stringify({ status: r.status, type: r.out?.error?.type, msg: msg.slice(0, 300), model, intento: i + 1 }));
    if ((r.status === 404 || (r.status === 400 && /model/i.test(msg))) && model !== FALLBACK) { model = FALLBACK; continue; }
    if (r.status === 429 || r.status === 529 || r.status >= 500) { const ra = Number(r.headers.get('retry-after')) || 0; await sleep(Math.min(ra * 1000 || 1500 * (i + 1), 6000)); continue; }
    break;
  }
  if (!r || !r.ok) {
    const msg = r?.out?.error?.message || 'Error de la IA';
    return json({ error: msg, code: codeOf(r?.status || 0, msg) }, 502);
  }
  const out = r.out;
  await registrar(admin, yo, perm, { funcion, modelo: model, usage: out.usage });
  const text = (out.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  const parsed = extractJson(text);
  if (parsed == null) { console.error('ai: respuesta no JSON', text.slice(0, 300)); return json({ error: 'Respuesta no válida', code: 'formato', raw: text.slice(0, 500) }, 502); }
  return json({ result: parsed });
});
