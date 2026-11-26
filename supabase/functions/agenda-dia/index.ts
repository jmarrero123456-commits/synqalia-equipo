// synqalia · función agenda-dia (26/11/2026): lee de Outlook, al momento, la agenda de los días que pide la app.
// La sincronización periódica («graph») solo guarda de hoy a 3 semanas; cuando el usuario va a otro día (14 de enero, un mes pasado…)
// la app pide esa semana aquí: POST {desde, hasta} (máx. 62 días) con la sesión de synqalia.
// Guarda cada día en personal_docs agenda/<fecha> con el mismo formato que «graph» y devuelve { dias: { fecha: eventos[] } }.
// Usa el token de Microsoft de graph_accounts (Calendars.Read ya concedido). Solo lee: no cambia nada en Outlook.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("AZURE_CLIENT_ID") ?? "7b6bfd26-646f-4330-abbc-c83be49decb5";
const CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET") ?? "";
const AUTH = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const REFRESH_SCOPE = "offline_access https://graph.microsoft.com/.default";
const G = "https://graph.microsoft.com/v1.0";
const TZ_WIN = "Romance Standard Time"; // Madrid

const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const owaId = (id: string) => encodeURIComponent(id.replace(/-/g, "/").replace(/_/g, "+"));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (f: string, n: number) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function token(acc: any) {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: acc.refresh_token, scope: REFRESH_SCOPE }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split("\r\n")[0] || j.error || "token");
  if (j.refresh_token) await db.from("graph_accounts").update({ refresh_token: j.refresh_token }).eq("owner", acc.owner);
  return j.access_token as string;
}
async function gAll(tok: string, url: string, max = 1500) {
  const out: any[] = [];
  let next: string | null = url;
  while (next && out.length < max) {
    const r = await fetch(next, { headers: { Authorization: `Bearer ${tok}`, Prefer: `outlook.timezone="${TZ_WIN}"` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${j?.error?.message || ""}`.trim());
    out.push(...(j.value || [])); next = j["@odata.nextLink"] || null;
  }
  return out;
}
// mismo formato que eventItem de «graph»
function eventItem(e: any) {
  const ini = e.isAllDay ? "00:00" : e.start.dateTime.slice(11, 16);
  const fin = e.isAllDay ? "23:59" : e.end.dateTime.slice(11, 16);
  const org = e.organizer?.emailAddress?.name || "";
  const unresp = !e.isOrganizer && (e.responseStatus?.response === "notResponded" || (e.responseStatus?.response === "none" && e.responseRequested));
  const ev: any = { inicio: ini, fin, titulo: (e.subject || "(sin asunto)").replace(/^Icono de cubiertos, /, "") + (!e.isOrganizer && org ? ` (${org})` : "") };
  if (e.isAllDay) ev.todoElDia = true;
  if (e.isOnlineMeeting && /teams/i.test(e.onlineMeetingProvider || "")) ev.lugar = "Teams";
  else if (e.location?.displayName) ev.lugar = e.location.displayName.slice(0, 60);
  ev.enlace = `https://outlook.cloud.microsoft/calendar/item/${owaId(e.id)}`;
  if (e.onlineMeeting?.joinUrl) ev.unirse = e.onlineMeeting.joinUrl;
  if (unresp) { ev.estado = "Sin confirmar"; ev.organiza = org; }
  return ev;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Inicia sesión" }, 401);
  const { data: ud } = await db.auth.getUser(jwt);
  const user = ud.user;
  if (!user) return json({ error: "Inicia sesión" }, 401);
  const { data: member } = await db.from("members").select("email").eq("email", (user.email || "").toLowerCase()).maybeSingle();
  if (!member) return json({ error: "No eres miembro de synqalia" }, 403);
  const b = await req.json().catch(() => ({}));
  const desde = String(b.desde || ""), hasta = String(b.hasta || b.desde || "");
  if (!DAY.test(desde) || !DAY.test(hasta) || hasta < desde) return json({ error: "Fechas no válidas" }, 400);
  if ((new Date(hasta).getTime() - new Date(desde).getTime()) / 864e5 > 62) return json({ error: "Como mucho dos meses de una vez" }, 400);
  const { data: acc } = await db.from("graph_accounts").select("*").eq("owner", user.id).maybeSingle();
  if (!acc) return json({ error: "Microsoft 365 no está conectado" }, 400);
  try {
    const tok = await token(acc);
    // de 00:00 del primer día a 00:00 del día siguiente al último, en hora de Madrid (margen de un día por los cambios de hora)
    const s = new Date(addDays(desde, -1) + "T00:00:00Z").toISOString(), e = new Date(addDays(hasta, 2) + "T00:00:00Z").toISOString();
    const evs = await gAll(tok, `${G}/me/calendarView?startDateTime=${s}&endDateTime=${e}&$top=250&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,isCancelled,isOrganizer,organizer,responseStatus,responseRequested,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,location,showAs`);
    const dias: Record<string, any[]> = {};
    for (let f = desde; f <= hasta; f = addDays(f, 1)) dias[f] = [];
    for (const ev of evs) {
      if (ev.isCancelled || /^(Cancelado|Canceled|Cancelled):/i.test(ev.subject || "")) continue;
      const f = String(ev.start?.dateTime || "").slice(0, 10);
      if (dias[f]) dias[f].push(eventItem(ev));
    }
    const now = new Date().toISOString();
    const rows = Object.entries(dias).map(([f, list]) => ({ owner: user.id, col: "agenda", id: f, data: { fecha: f, capturado: now, eventos: list.sort((a, b) => a.inicio.localeCompare(b.inicio)), fuente: "graph-dia" } }));
    const { error } = await db.from("personal_docs").upsert(rows, { onConflict: "owner,col,id" });
    if (error) throw error;
    return json({ dias, capturado: now });
  } catch (err) {
    console.error(JSON.stringify({ fn: "agenda-dia", owner: user.id, desde, hasta, error: (err as Error).message }));
    return json({ error: (err as Error).message }, 400);
  }
});
