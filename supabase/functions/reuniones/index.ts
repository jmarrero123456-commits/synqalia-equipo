// synqalia · función reuniones: convocar reuniones desde synqalia con la cuenta de Microsoft 365 conectada (graph_accounts).
// Acciones (POST, con la sesión de synqalia): contactos {forzar?}, disponibilidad {fecha, emails, duracion}, crearReunion {...},
// moverReunion {enlace, fecha, inicio, fin, lugar?} (24/11/2026: solo reuniones que convoca el usuario o citas suyas; Microsoft avisa a los asistentes).
// 25/11/2026 (asistente por voz): huecos {emails, duracion, desde?, dias?, franjaDesde?, franjaHasta?, max?} = primeros huecos comunes en varios días;
// cancelarReunion {id, comentario?} = anula una reunión que convoca el usuario (Microsoft avisa a los asistentes).
// Usa el mismo token de Microsoft que la función «graph» (permisos ya aprobados: Mail.ReadWrite y Calendars.ReadWrite).
// Tras crear una reunión pide a «graph» una sincronización rápida de la agenda para que salga al momento en synqalia.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = "7b6bfd26-646f-4330-abbc-c83be49decb5";
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
const iso = () => new Date().toISOString();
const owaId = (id: string) => encodeURIComponent(id.replace(/-/g, "/").replace(/_/g, "+"));
const escH = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) => `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${String(t || "").split(/\n/).map((l) => escH(l)).join("<br>")}</div>`;

async function listCol(owner: string, col: string) {
  const { data, error } = await db.from("personal_docs").select("id,data").eq("owner", owner).eq("col", col);
  if (error) throw error;
  return (data || []) as { id: string; data: any }[];
}
async function setDoc(owner: string, col: string, id: string, data: any) {
  const { error } = await db.from("personal_docs").upsert({ owner, col, id, data }, { onConflict: "owner,col,id" });
  if (error) throw error;
}

type Ctx = { owner: string; token: string; me: any };
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split("\r\n")[0] || j.error || "token");
  return j;
}
async function g(ctx: Ctx, path: string, init: RequestInit & { prefer?: string[] } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" };
  if (init.prefer?.length) headers.Prefer = init.prefer.join(", ");
  const r = await fetch(path.startsWith("http") ? path : G + path, { ...init, headers });
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(`${r.status} ${j?.error?.code || ""} ${j?.error?.message || ""}`.trim()); e.status = r.status; throw e; }
  return j;
}
async function gAll(ctx: Ctx, path: string, prefer: string[] = [], max = 500) {
  const out: any[] = [];
  let url: string | null = path;
  while (url && out.length < max) { const j: any = await g(ctx, url, { prefer }); out.push(...(j.value || [])); url = j["@odata.nextLink"] || null; }
  return out;
}
async function ctxFor(acc: any): Promise<Ctx> {
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: acc.refresh_token, scope: REFRESH_SCOPE });
  if (tok.refresh_token) await db.from("graph_accounts").update({ refresh_token: tok.refresh_token }).eq("owner", acc.owner);
  const ctx: Ctx = { owner: acc.owner, token: tok.access_token, me: null };
  ctx.me = await g(ctx, "/me?$select=id,displayName,userPrincipalName,mail");
  return ctx;
}

// Convocar reuniones desde synqalia (24/11/2026): contactos, disponibilidad y crear la reunión.
// Contactos: personas con las que se cruza correo (recibido, enviado) y reuniones de los últimos meses + miembros de synqalia.
// Se guarda en personal_docs contactos/yo y se rehace como mucho una vez al día (o con «forzar»).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NO_CONTACT = /(no-?reply|noreply|donotreply|mailer-daemon|postmaster|notifications?@|notificaciones@|newsletter|bounce|calendar-notification|microsoft\.com$|sharepointonline|teams\.mail)/i;
async function contactos(ctx: Ctx, forzar = false) {
  const prev = (await listCol(ctx.owner, "contactos")).find((d) => d.id === "yo")?.data;
  if (!forzar && prev?.actualizado && Date.now() - new Date(prev.actualizado).getTime() < 20 * 3600e3) return prev;
  const meMail = String(ctx.me.mail || ctx.me.userPrincipalName || "").toLowerCase();
  const map = new Map<string, { nombre: string; email: string; n: number; ultimo: string }>();
  const add = (r: any, peso: number, fecha: string) => {
    const email = String(r?.emailAddress?.address || "").toLowerCase().trim();
    if (!EMAIL_RE.test(email) || email === meMail || NO_CONTACT.test(email)) return;
    const nombre = String(r?.emailAddress?.name || "").replace(/^'+|'+$/g, "").trim();
    const c = map.get(email) || { nombre: "", email, n: 0, ultimo: "" };
    if (nombre && nombre.toLowerCase() !== email && (!c.nombre || c.nombre.toLowerCase() === email)) c.nombre = nombre;
    c.n += peso; if (fecha > c.ultimo) c.ultimo = fecha;
    map.set(email, c);
  };
  const since = new Date(Date.now() - 200 * 86400e3).toISOString();
  const [inbox, sent, evs] = await Promise.all([
    gAll(ctx, `/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since}&$select=from,toRecipients,ccRecipients,receivedDateTime&$top=500`, [], 2000).catch(() => []),
    gAll(ctx, `/me/mailFolders/sentitems/messages?$filter=sentDateTime ge ${since}&$select=toRecipients,ccRecipients,sentDateTime&$top=500`, [], 2000).catch(() => []),
    gAll(ctx, `/me/calendarView?startDateTime=${since}&endDateTime=${new Date(Date.now() + 60 * 86400e3).toISOString()}&$select=organizer,attendees,start&$top=250`, [], 1500).catch(() => []),
  ]);
  for (const m of inbox) { const f = String(m.receivedDateTime || ""); add(m.from, 2, f); (m.toRecipients || []).forEach((r: any) => add(r, 1, f)); (m.ccRecipients || []).forEach((r: any) => add(r, 1, f)); }
  for (const m of sent) { const f = String(m.sentDateTime || ""); (m.toRecipients || []).forEach((r: any) => add(r, 4, f)); (m.ccRecipients || []).forEach((r: any) => add(r, 2, f)); }
  for (const e of evs) { const f = String(e.start?.dateTime || ""); add(e.organizer, 3, f); (e.attendees || []).forEach((a: any) => add(a, 3, f)); }
  const { data: mem } = await db.from("members").select("email,name");
  for (const m of mem || []) add({ emailAddress: { address: m.email, name: m.name } }, 5, "");
  const lista = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 1500);
  const doc = { actualizado: iso(), total: lista.length, lista };
  await setDoc(ctx.owner, "contactos", "yo", doc);
  return doc;
}

// Disponibilidad de varias personas un día (franja 08:00–20:00, tramos de 15 min) y huecos comunes.
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
async function disponibilidad(ctx: Ctx, b: any) {
  const fecha = String(b.fecha || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Fecha no válida");
  const meMail = String(ctx.me.mail || ctx.me.userPrincipalName || "").toLowerCase();
  const emails = [...new Set([meMail, ...(Array.isArray(b.emails) ? b.emails : []).map((x: any) => String(x).toLowerCase().trim()).filter((x: string) => EMAIL_RE.test(x))])].slice(0, 20);
  const desde = 8 * 60, hasta = 20 * 60, paso = 15;
  const r: any = await g(ctx, "/me/calendar/getSchedule", { method: "POST", prefer: [`outlook.timezone="${TZ_WIN}"`], body: JSON.stringify({ schedules: emails, startTime: { dateTime: `${fecha}T08:00:00`, timeZone: TZ_WIN }, endTime: { dateTime: `${fecha}T20:00:00`, timeZone: TZ_WIN }, availabilityViewInterval: paso }) });
  const n = (hasta - desde) / paso;
  const personas = (r.value || []).map((s: any) => {
    const v = String(s.availabilityView || "");
    const ok = !s.error && v.length >= n;
    const ocupado = (s.scheduleItems || []).filter((i: any) => i.status !== "free").map((i: any) => ({ inicio: String(i.start?.dateTime || "").slice(11, 16), fin: String(i.end?.dateTime || "").slice(11, 16), estado: i.status }));
    return { email: String(s.scheduleId || "").toLowerCase(), yo: String(s.scheduleId || "").toLowerCase() === meMail, ok, vista: ok ? v.slice(0, n) : "", ocupado, error: s.error?.message ? "No se puede ver su calendario" : (ok ? null : "Sin datos de calendario") };
  });
  const dur = Math.max(15, Math.min(480, Number(b.duracion) || 30));
  const libre = (i: number) => personas.every((p: any) => !p.ok || p.vista[i] === "0" || p.vista[i] === "4");
  const huecos: { inicio: string; fin: string }[] = [];
  let i = 0;
  while (i < n) {
    if (!libre(i)) { i++; continue; }
    let j = i; while (j < n && libre(j)) j++;
    if ((j - i) * paso >= dur) huecos.push({ inicio: hm(desde + i * paso), fin: hm(desde + j * paso) });
    i = j;
  }
  return { fecha, desde: hm(desde), hasta: hm(hasta), paso, personas, huecos };
}

// Primeros huecos comunes en varios días (para el asistente por voz: «¿cuándo puedo verme una hora con Belén?»).
// Una sola consulta a Microsoft para todo el periodo (tramos de 15 min). Solo días laborables, dentro de la franja,
// y hoy a partir de ahora + 30 min. Devuelve como mucho un hueco por día (el primero) para ofrecer alternativas en días distintos.
const madridNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
};
const addDays = (f: string, n: number) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMinS = (s: string, def: number) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : def; };
async function huecos(ctx: Ctx, b: any) {
  const meMail = String(ctx.me.mail || ctx.me.userPrincipalName || "").toLowerCase();
  const emails = [...new Set([meMail, ...(Array.isArray(b.emails) ? b.emails : []).map((x: any) => String(x).toLowerCase().trim()).filter((x: string) => EMAIL_RE.test(x))])].slice(0, 15);
  const now = madridNow();
  let desde = /^\d{4}-\d{2}-\d{2}$/.test(String(b.desde || "")) ? String(b.desde) : now.fecha;
  if (desde < now.fecha) desde = now.fecha;
  const dias = Math.max(1, Math.min(30, Number(b.dias) || 14));
  const hasta = addDays(desde, dias);
  const dur = Math.max(15, Math.min(480, Number(b.duracion) || 60));
  const fDesde = toMinS(b.franjaDesde, 9 * 60), fHasta = toMinS(b.franjaHasta, 19 * 60);
  const paso = 15, porDia = 96;
  const r: any = await g(ctx, "/me/calendar/getSchedule", { method: "POST", prefer: [`outlook.timezone="${TZ_WIN}"`], body: JSON.stringify({ schedules: emails, startTime: { dateTime: `${desde}T00:00:00`, timeZone: TZ_WIN }, endTime: { dateTime: `${hasta}T00:00:00`, timeZone: TZ_WIN }, availabilityViewInterval: paso }) });
  const personas = (r.value || []).map((s: any) => {
    const v = String(s.availabilityView || "");
    return { email: String(s.scheduleId || "").toLowerCase(), yo: String(s.scheduleId || "").toLowerCase() === meMail, ok: !s.error && v.length >= dias * porDia, vista: v };
  });
  const sinVer = personas.filter((p: any) => !p.ok && !p.yo).map((p: any) => p.email);
  const libre = (k: number) => personas.every((p: any) => !p.ok || p.vista[k] === "0" || p.vista[k] === "4");
  const out: { fecha: string; inicio: string; fin: string; libreHasta: string }[] = [];
  const max = Math.max(1, Math.min(10, Number(b.max) || 5));
  for (let d = 0; d < dias && out.length < max; d++) {
    const fecha = addDays(desde, d);
    const wd = new Date(fecha + "T12:00:00Z").getUTCDay();
    if (!b.findes && (wd === 0 || wd === 6)) continue;
    let a = fDesde;
    if (fecha === now.fecha) a = Math.max(a, Math.ceil((now.min + 30) / 15) * 15);
    for (let m = a; m + dur <= fHasta; m += paso) {
      const k0 = d * porDia + m / paso, k1 = k0 + dur / paso;
      let ok = true; for (let k = k0; k < k1; k++) if (!libre(k)) { ok = false; break; }
      if (!ok) continue;
      let e = k1; while (e < d * porDia + fHasta / paso && libre(e)) e++;
      out.push({ fecha, inicio: hm(m), fin: hm(m + dur), libreHasta: hm((e - d * porDia) * paso) });
      break;
    }
  }
  return { desde, hasta: addDays(hasta, -1), duracion: dur, franja: `${hm(fDesde)}–${hm(fHasta)}`, huecos: out, sinVer };
}

// Crear la reunión en el calendario y enviar la convocatoria a los asistentes (con enlace de Teams si se pide).
async function crearReunion(ctx: Ctx, b: any) {
  const titulo = String(b.titulo || "").trim().slice(0, 250); if (!titulo) throw new Error("Falta el título");
  const fecha = String(b.fecha || ""), ini = String(b.inicio || ""), fin = String(b.fin || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fin) || fin <= ini) throw new Error("Revisa la fecha y las horas");
  const meMail = String(ctx.me.mail || ctx.me.userPrincipalName || "").toLowerCase();
  const seen = new Set<string>();
  const att = (arr: any[], type: string) => (Array.isArray(arr) ? arr : []).map((x: any) => ({ email: String(x?.email || x || "").toLowerCase().trim(), nombre: String(x?.nombre || "").trim() }))
    .filter((x) => EMAIL_RE.test(x.email) && x.email !== meMail && !seen.has(x.email) && seen.add(x.email))
    .map((x) => ({ type, emailAddress: { address: x.email, ...(x.nombre ? { name: x.nombre } : {}) } }));
  const attendees = [...att(b.asistentes, "required"), ...att(b.opcionales, "optional")].slice(0, 100);
  if (!attendees.length) throw new Error("Añade al menos una persona");
  const teams = b.teams !== false;
  const texto = String(b.texto || "").trim();
  const ev: any = {
    subject: titulo,
    start: { dateTime: `${fecha}T${ini}:00`, timeZone: TZ_WIN },
    end: { dateTime: `${fecha}T${fin}:00`, timeZone: TZ_WIN },
    attendees,
    body: { contentType: "HTML", content: texto ? toHtml(texto) : "" },
    allowNewTimeProposals: true,
  };
  if (teams) { ev.isOnlineMeeting = true; ev.onlineMeetingProvider = "teamsForBusiness"; }
  if (b.lugar) ev.location = { displayName: String(b.lugar).slice(0, 120) };
  const e: any = await g(ctx, "/me/events", { method: "POST", prefer: [`outlook.timezone="${TZ_WIN}"`], body: JSON.stringify(ev) });
  return { creada: true, id: e.id, enlace: `https://outlook.cloud.microsoft/calendar/item/${owaId(e.id)}`, unirse: e.onlineMeeting?.joinUrl || null, asistentes: attendees.length };
}

// Mover una reunión (otro día u otra hora, y opcionalmente el lugar). El id sale del enlace de Outlook que guarda la agenda.
const idFromEnlace = (l: string) => { const m = /\/calendar\/item\/([^?#/]+)/.exec(String(l || "")); return m ? decodeURIComponent(m[1]).replace(/\//g, "-").replace(/\+/g, "_") : null; };
async function moverReunion(ctx: Ctx, b: any) {
  const id = String(b.id || "") || idFromEnlace(b.enlace);
  if (!id) throw new Error("No encuentro esta reunión en tu calendario de Outlook");
  const e: any = await g(ctx, `/me/events/${id}?$select=id,subject,isOrganizer,attendees,type,isCancelled,location`);
  // «comprobar»: solo dice si se puede mover (lo usa la sala de la reunión para enseñar el botón)
  if (b.comprobar) return { puede: !!e.isOrganizer && !e.isCancelled, asistentes: (e.attendees || []).length, lugar: e.location?.displayName || "" };
  const fecha = String(b.fecha || ""), ini = String(b.inicio || ""), fin = String(b.fin || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fin) || fin <= ini) throw new Error("Revisa la fecha y las horas");
  if (e.isCancelled) throw new Error("Esta reunión está cancelada");
  if (!e.isOrganizer) { const err: any = new Error("NO_ORGANIZADOR"); throw err; }
  const patch: any = { start: { dateTime: `${fecha}T${ini}:00`, timeZone: TZ_WIN }, end: { dateTime: `${fecha}T${fin}:00`, timeZone: TZ_WIN } };
  if (typeof b.lugar === "string") patch.location = { displayName: b.lugar.trim().slice(0, 120) };
  if (typeof b.titulo === "string" && b.titulo.trim()) patch.subject = b.titulo.trim().slice(0, 250);
  await g(ctx, `/me/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return { movida: true, asistentes: (e.attendees || []).length, serie: e.type === "occurrence" ? "solo esta" : null };
}

// Anular una reunión que convoca el usuario: Microsoft envía la cancelación a los asistentes.
async function cancelarReunion(ctx: Ctx, b: any) {
  const id = String(b.id || "") || idFromEnlace(b.enlace);
  if (!id) throw new Error("No encuentro esta reunión en tu calendario de Outlook");
  const e: any = await g(ctx, `/me/events/${id}?$select=id,isOrganizer,isCancelled`);
  if (e.isCancelled) return { cancelada: true, ya: true };
  if (!e.isOrganizer) throw new Error("NO_ORGANIZADOR");
  await g(ctx, `/me/events/${id}/cancel`, { method: "POST", body: JSON.stringify({ comment: String(b.comentario || "").slice(0, 500) }) });
  return { cancelada: true };
}

const syncAgenda = (auth: string) => fetch(`${SB_URL}/functions/v1/graph`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ action: "respond" }) }).catch(() => null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const auth = req.headers.get("authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Inicia sesión" }, 401);
  const { data: ud } = await db.auth.getUser(jwt);
  const user = ud.user;
  if (!user) return json({ error: "Inicia sesión" }, 401);
  const { data: member } = await db.from("members").select("email").eq("email", (user.email || "").toLowerCase()).maybeSingle();
  if (!member) return json({ error: "No eres miembro de synqalia" }, 403);
  const body = await req.json().catch(() => ({}));
  const { data: a } = await db.from("graph_accounts").select("*").eq("owner", user.id).maybeSingle();
  if (!a) return json({ error: "Microsoft 365 no está conectado" }, 400);
  try {
    const ctx = await ctxFor(a);
    if (body.action === "contactos") return json(await contactos(ctx, !!body.forzar));
    if (body.action === "disponibilidad") return json(await disponibilidad(ctx, body));
    if (body.action === "huecos") return json(await huecos(ctx, body));
    if (body.action === "crearReunion") {
      const r = await crearReunion(ctx, body);
      // que la reunión salga ya en la agenda de synqalia (sincronización rápida de «graph»)
      await syncAgenda(auth);
      return json(r);
    }
    if (body.action === "moverReunion") {
      const r: any = await moverReunion(ctx, body);
      if (body.comprobar) return json(r);
      await syncAgenda(auth);
      return json(r);
    }
    if (body.action === "cancelarReunion") {
      const r = await cancelarReunion(ctx, body);
      await syncAgenda(auth);
      return json(r);
    }
    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
