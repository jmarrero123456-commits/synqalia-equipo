// Synqalia · IA general: recibe un prompt (y opcionalmente imágenes) y devuelve JSON.
// Solo para usuarios con sesión iniciada que sean miembros de Synqalia.
// v6 (27/11): registra el motivo de cada fallo, reintenta si la IA está saturada y devuelve un código para que la app lo explique.
// v7 (28/11): pasa por el Motor IA común (_shared/ia): saldo por empresa y usuario, niveles, modo ahorro y registro de consumo.
//   Cuerpo: { prompt, images?, funcion?, nivel? ('basica' | 'avanzada'), fondo? (true = tarea de fondo con el modelo barato) }
//   { ping: true } → { available, images }    { estado: true } → { saldo }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json } from '../_shared/http.ts';
import { ErrorAuth, usuarioDePeticion } from '../_shared/auth.ts';
import { ErrorIA, iaConfigurada, motorIA, nivelDe } from '../_shared/ia/index.ts';

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
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let yo;
  try { yo = await usuarioDePeticion(req, admin); } catch (e) {
    if (e instanceof ErrorAuth) return json({ error: e.message }, e.status);
    throw e;
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Petición no válida' }, 400); }
  if (body.ping) return json({ available: iaConfigurada(), images: true });

  const motor = motorIA(admin);
  const ctx = { company_id: yo.company_id, email: yo.email };
  if (body.estado) {
    try { return json({ saldo: await motor.estado(ctx) }); } catch (e) { console.error('ai: estado', e); return json({ error: 'No se pudo leer el saldo' }, 500); }
  }
  if (!iaConfigurada()) return json({ error: 'IA no configurada', code: 'clave' }, 501);

  const content: any[] = [];
  for (const im of (body.images || []).slice(0, 4)) {
    if (im?.data && im?.media_type) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  content.push({ type: 'text', text: String(body.prompt || '').slice(0, 60000) });
  const funcion = String(body.funcion || 'general').replace(/[^a-z0-9_.-]/gi, '').slice(0, 60) || 'general';

  try {
    const r = await motor.ejecutar(ctx, funcion, body.fondo ? 'fondo' : nivelDe(body.nivel), {
      max_tokens: 4000,
      system: 'Respondes siempre con un único JSON válido, sin texto antes ni después.',
      messages: [{ role: 'user', content }],
    });
    const text = (r.respuesta.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const parsed = extractJson(text);
    if (parsed == null) { console.error('ai: respuesta no JSON', text.slice(0, 300)); return json({ error: 'Respuesta no válida', code: 'formato', raw: text.slice(0, 500) }, 502); }
    return json({ result: parsed, saldo: r.saldo, ahorro: r.ahorro });
  } catch (e) {
    if (e instanceof ErrorIA) return json({ error: e.message, code: e.codigo }, e.status);
    console.error('ai: fallo interno', e);
    return json({ error: 'Fallo interno de la IA', code: 'ia' }, 500);
  }
});
