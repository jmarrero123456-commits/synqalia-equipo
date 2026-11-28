// Synqalia · utilidades HTTP comunes de las funciones (CORS y respuestas JSON).
// Sin dependencias de la plataforma: funciona igual en Supabase Edge, Deno o Node (Response estándar).
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
