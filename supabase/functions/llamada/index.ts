// synqalia · función «llamada»: videollamadas desde el chat de Synqalia (25/11/2026).
// Acciones (POST, con la sesión de synqalia):
//   config                                → { synqalia: bool }   (¿está configurado LiveKit?)
//   iniciar  {chat_id, proveedor, join_url?} → crea (o reutiliza) la llamada activa del chat y deja el aviso en el chat.
//            proveedor 'synqalia': sala propia (LiveKit) y devuelve { call, url, token } para entrar.
//            proveedor 'teams': join_url sale de reuniones/teamsAhora (Microsoft 365); solo se guarda y se avisa.
//   unirse   {call_id}                    → { call, url, token }
//   salir    {call_id}                    → si no queda nadie dentro, la llamada termina.
//   rechazar {call_id}                    → en un chat directo, termina la llamada.
// Portabilidad: el token de LiveKit se firma aquí (HS256 con Web Crypto, sin librerías ni nada propio de Supabase);
// LiveKit es código abierto y se puede alojar en AWS cambiando solo LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LK_URL = Deno.env.get("LIVEKIT_URL") ?? "";
const LK_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LK_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const ACTIVA_H = 4; // una llamada de Synqalia sin terminar se da por acabada a las 4 h
const TEAMS_H = 2;  // una reunión de Teams «al momento» se ofrece para unirse durante 2 h

const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- token de LiveKit (JWT HS256) ----------
const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
async function lkToken(identity: string, name: string, room: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64u(enc.encode(JSON.stringify({
    iss: LK_KEY, sub: identity, name, nbf: now - 10, exp: now + 6 * 3600,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  })));
  const key = await crypto.subtle.importKey("raw", enc.encode(LK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}
const lkOk = () => !!(LK_URL && LK_KEY && LK_SECRET);

// ---------- datos ----------
async function isMember(chat: string, email: string) {
  const { data } = await db.from("chat_members").select("chat_id").eq("chat_id", chat).ilike("email", email).maybeSingle();
  return !!data;
}
async function getCall(id: string) {
  const { data } = await db.from("calls").select("*").eq("id", id).maybeSingle();
  return data as any;
}
const caducada = (c: any) => {
  const h = (Date.now() - new Date(c.started_at).getTime()) / 36e5;
  return !!c.ended_at || h > (c.proveedor === "teams" ? TEAMS_H : ACTIVA_H);
};
async function entrar(c: any, email: string, name: string) {
  if (!lkOk()) throw new Error("La videollamada de Synqalia aún no está configurada");
  const { data, error } = await db.rpc("call_join", { p_call: c.id, p_email: email });
  if (error) throw error;
  const call = Array.isArray(data) ? data[0] : data;
  if (!call || !call.id) throw new Error("Esta llamada ya ha terminado");
  return { call, url: LK_URL, token: await lkToken(email, name, c.sala) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Inicia sesión" }, 401);
  const { data: ud } = await db.auth.getUser(jwt);
  const user = ud.user;
  if (!user) return json({ error: "Inicia sesión" }, 401);
  const email = String(user.email || "").toLowerCase();
  const { data: member } = await db.from("members").select("email,name").ilike("email", email).maybeSingle();
  if (!member) return json({ error: "No eres miembro de synqalia" }, 403);
  const name = String(member.name || email.split("@")[0]);
  const b = await req.json().catch(() => ({}));

  try {
    if (b.action === "config") return json({ synqalia: lkOk() });

    if (b.action === "iniciar") {
      const chat = String(b.chat_id || "");
      const proveedor = b.proveedor === "teams" ? "teams" : "synqalia";
      if (!UUID.test(chat)) throw new Error("Chat no válido");
      if (!(await isMember(chat, email))) return json({ error: "No estás en este chat" }, 403);
      if (proveedor === "synqalia" && !lkOk()) throw new Error("La videollamada de Synqalia aún no está configurada");
      let joinUrl: string | null = null;
      if (proveedor === "teams") {
        try { const u = new URL(String(b.join_url || "")); if (u.protocol === "https:" && /(^|\.)teams\.(microsoft|live)\.com$/i.test(u.hostname)) joinUrl = u.href; } catch { /* no válido */ }
        if (!joinUrl) throw new Error("Falta el enlace de Teams");
      }
      // ¿ya hay una llamada en marcha en este chat con el mismo sistema? Entonces se entra en ella.
      const { data: abiertas } = await db.from("calls").select("*").eq("chat_id", chat).eq("proveedor", proveedor).is("ended_at", null).order("started_at", { ascending: false }).limit(3);
      const viva = (abiertas || []).find((c: any) => !caducada(c));
      if (viva) {
        if (proveedor === "synqalia") return json({ ...(await entrar(viva, email, name)), reutilizada: true });
        return json({ call: viva, reutilizada: true });
      }
      const { data: call, error } = await db.from("calls").insert({ chat_id: chat, proveedor, join_url: joinUrl, started_by: email }).select("*").single();
      if (error) throw error;
      if (proveedor === "synqalia") await db.from("calls").update({ sala: `sq-${call.id}` }).eq("id", call.id);
      call.sala = `sq-${call.id}`;
      // aviso en el chat (lo ven todos; también sirve de historial)
      await db.from("chat_messages").insert({
        chat_id: chat, from_email: email, kind: "llamada",
        body: proveedor === "teams" ? "📹 Reunión de Teams" : "📹 Videollamada",
        ref: { llamada: call.id, proveedor },
      });
      if (proveedor === "synqalia") return json(await entrar(call, email, name));
      return json({ call });
    }

    const id = String(b.call_id || "");
    if (!UUID.test(id)) throw new Error("Llamada no válida");
    const c = await getCall(id);
    if (!c) throw new Error("No encuentro esta llamada");
    if (!(await isMember(c.chat_id, email))) return json({ error: "No estás en este chat" }, 403);

    if (b.action === "unirse") {
      if (caducada(c)) throw new Error("Esta llamada ya ha terminado");
      if (c.proveedor === "teams") return json({ call: c });
      return json(await entrar(c, email, name));
    }
    if (b.action === "salir") {
      const { data } = await db.rpc("call_leave", { p_call: id, p_email: email });
      return json({ call: (Array.isArray(data) ? data[0] : data) || c });
    }
    if (b.action === "rechazar") {
      const { data: ch } = await db.from("chats").select("kind").eq("id", c.chat_id).maybeSingle();
      const { data } = await db.rpc("call_decline", { p_call: id, p_email: email, p_end: ch?.kind === "directo" });
      return json({ call: (Array.isArray(data) ? data[0] : data) || c });
    }
    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
