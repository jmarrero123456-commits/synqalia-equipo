// Synqalia · función «ai»: recibe un prompt (y opcionalmente imágenes) y devuelve JSON.
// v7 (28/11/2026): pasa por el Motor IA común (saldo de la empresa, registro de consumo, avisos y motivos de fallo).
// Cuerpo: { prompt, images?, funcion?: sugerida|resumen|perfeccionar|tareas|general…, nivel?: basico|avanzado } · { ping: true }
// Respuesta: { result, ia: { nivel, degradado, aviso?, avisos[] } } · error: { error, code }
import { usuarioDePeticion, clienteServicio } from '../_shared/auth.ts';
import { baseDatosSupabase } from '../_shared/db.ts';
import { preguntar, iaDisponible, textoDe, cuerpoError, ErrorIA } from '../_shared/ia/motor.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function extractJson(t: string) {
  const s = t.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* sigue */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* sigue */ } }
  const c = s.indexOf('['), d = s.lastIndexOf(']');
  if (c >= 0 && d > c) { try { return JSON.parse(s.slice(c, d + 1)); } catch { /* sigue */ } }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const u = await usuarioDePeticion(req);
  if (!u) return json({ error: 'Inicia sesión', code: 'no_autorizado' }, 401);
  if (u === 'no_miembro') return json({ error: 'No autorizado', code: 'no_autorizado' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida', code: 'peticion' }, 400); }
  if (body.ping) return json({ available: iaDisponible(), images: true });

  const content: any[] = [];
  for (const im of (body.images || []).slice(0, 4)) {
    if (im?.data && im?.media_type) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  content.push({ type: 'text', text: String(body.prompt || '').slice(0, 60000) });

  try {
    const r = await preguntar(
      { db: baseDatosSupabase(clienteServicio()), email: u.email, companyId: u.companyId },
      {
        funcion: String(body.funcion || 'general'), nivel: body.nivel === 'avanzado' ? 'avanzado' : 'basico',
        peticion: { max_tokens: 4000, system: 'Respondes siempre con un único JSON válido, sin texto antes ni después.', messages: [{ role: 'user', content }] },
      },
    );
    const text = textoDe(r.respuesta);
    const parsed = extractJson(text);
    if (parsed == null) { console.error('ai: respuesta no JSON', text.slice(0, 300)); throw new ErrorIA('formato'); }
    return json({ result: parsed, ia: { nivel: r.nivel, degradado: r.degradado, aviso: r.aviso, avisos: r.avisos } });
  } catch (e) {
    const { status, body: b } = cuerpoError(e);
    return json(b, status);
  }
});
