// Synqalia · función buzon (24/11/2026): el buzón completo de Outlook en directo contra Microsoft Graph,
// sin copiarlo a la base de datos. Usa la conexión de Microsoft 365 que guarda la función «graph» (tabla graph_accounts).
// Operaciones (body.op): carpetas, lista (90 días; la búsqueda va a todo el buzón), abrir, adjunto, leido, bandera,
// mover, eliminar (a Elementos eliminados) y redactar (responder / todos / reenviar / nuevo; enviar o dejar en Borradores).
// hilo (24/11): todos los mensajes de una conversación en cualquier carpeta (también tus respuestas), el más reciente primero,
// con el texto nuevo de cada uno (uniqueBody) y el completo para «Mostrar texto citado»; al abrirlo se marcan como leídos.
// pendiente (24/11): responder un correo de Pendientes añadiendo gente en copia (CC).
// personas (24/11): sugerencias para Para y CC (directorio de la empresa si hay permiso; si no, gente de tus correos).
// redactar con destinatarios:true (24/11): Para y CC editables al responder (quitar o añadir gente).
// programar (24/11): envío programado con PidTagDeferredSendTime (redactar, enviarBorrador y pendiente).
// agenda (24/11): ocupado de tu calendario entre dos días, para rellenar fechas libres en las respuestas.
// inline (25/11): imágenes pegadas dentro del texto (cid). pendiente admite preparar para adjuntos.
// conciliar / leidoPend (25/11): Pendientes al día con lo hecho en Outlook (respondido, reenviado, archivado, leído si es informativo).
// hilo (26/11): adjuntos en la misma petición e imágenes internas solo del mensaje que se ve (más rápido en el móvil).
// hilo (25/11): html (como en Outlook, sin scripts, imágenes internas incrustadas) y ligero:true para desplegar la lista.
// lista (25/11): foco «prioritarios» | «otros» (Bandeja de entrada Prioritarios / Otros de Outlook). Trae «verbo» (respondido 102/103, reenviado 104) para el icono de la lista.
// conciliar (25/11, tarde): además deja leídos en Outlook los gestionados en Synqalia (leidoOutlook); leidoPend busca la conversación si falta.
// leerHasta (25/11): marcar como leído todo lo anterior a un día (por tandas).
// carpetaNueva (25/11): crea una carpeta en Outlook (nombre; dentro = carpeta madre opcional).
// adjuntar / trozo / enviarBorrador (24/11): adjuntos al redactar (hasta 25 MB; los grandes en trozos por sesión de subida).
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = "7b6bfd26-646f-4330-abbc-c83be49decb5";
const CLIENT_SECRET = Deno.env.get("AZURE_CLIENT_SECRET") ?? "";
const AUTH = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const REFRESH_SCOPE = "offline_access https://graph.microsoft.com/.default";

const G = "https://graph.microsoft.com/v1.0";

const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const iso = () => new Date().toISOString();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function setDoc(owner: string, col: string, id: string, data: any) {
  const { error } = await db.from("personal_docs").upsert({ owner, col, id, data }, { onConflict: "owner,col,id" });
  if (error) throw error;
}
async function mergeDoc(owner: string, col: string, id: string, patch: any) {
  const { data } = await db.from("personal_docs").select("data").eq("owner", owner).eq("col", col).eq("id", id).maybeSingle();
  await setDoc(owner, col, id, { ...(data?.data || {}), ...patch });
}


type Perfil = { nombre: string; corto: string; cargo: string; contexto?: string };
async function perfilDe(owner: string, email = ""): Promise<Perfil> {
  const { data: pd } = await db.from("personal_docs").select("data").eq("owner", owner).eq("col", "perfil").eq("id", "yo").maybeSingle();
  let p: any = pd?.data || null;
  if (!p) {
    if (!email) { const { data: u } = await db.auth.admin.getUserById(owner); email = u.user?.email || ""; }
    const { data: m } = await db.from("members").select("name,perfil").ilike("email", email).maybeSingle();
    p = { nombre: m?.name || email.split("@")[0], ...(m?.perfil || {}) };
  }
  const nombre = String(p.nombre || "el usuario");
  return { nombre, corto: String(p.corto || nombre.split(/\s+/)[0]), cargo: String(p.cargo || "profesional de Grupo Provalliance España"), contexto: p.contexto || "" };
}

/* ---------- Microsoft ---------- */

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description?.split("\r\n")[0] || j.error || "token");
  return j;
}
type Ctx = { owner: string; token: string; me: any; deadline: number; log: string[]; perfil: Perfil };
async function g(ctx: Ctx, path: string, init: RequestInit & { prefer?: string[] } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" };
  if (init.prefer?.length) headers.Prefer = init.prefer.join(", ");
  let r = await fetch(path.startsWith("http") ? path : G + path, { ...init, headers });
  // Outlook solo deja unas pocas peticiones a la vez por buzón: si dice «espera» (429/503), se reintenta
  for (let k = 0; k < 3 && (r.status === 429 || r.status === 503); k++) {
    const wait = Math.min(4000, (Number(r.headers.get("Retry-After")) || 1) * 1000);
    await new Promise((res) => setTimeout(res, wait));
    r = await fetch(path.startsWith("http") ? path : G + path, { ...init, headers });
  }
  if (r.status === 204) return null;
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


const insertTop = (doc: string, part: string) => /<body[^>]*>/i.test(doc) ? doc.replace(/<body[^>]*>/i, (m) => m + part) : part + doc;

const escH = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) => `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${String(t || "").split(/\n/).map((l) => escH(l)).join("<br>")}</div>`;
// Firma electrónica de Outlook: Graph no la añade al enviar, así que se toma de un correo ya enviado (bloque id="Signature").
function sigBlock(html: string) {
  const m = /<div[^>]*id="?(x_)?Signature"?[^>]*>/i.exec(html || "");
  if (!m) return "";
  let depth = 0, i = m.index;
  const re = /<\/?div\b[^>]*>/gi; re.lastIndex = i;
  let t: RegExpExecArray | null;
  while ((t = re.exec(html))) { depth += t[0][1] === "/" ? -1 : 1; if (depth === 0) return html.slice(i, re.lastIndex); }
  return "";
}
async function firmaDe(ctx: Ctx, force = false): Promise<string> {
  const { data: acc } = await db.from("graph_accounts").select("state").eq("owner", ctx.owner).maybeSingle();
  const st = acc?.state || {};
  if (!force && st.firma && st.firma_at && Date.now() - new Date(st.firma_at).getTime() < 7 * 864e5) return st.firma;
  let firma = "";
  try {
    const j = await g(ctx, `/me/mailFolders/sentitems/messages?$select=body&$top=15&$orderby=sentDateTime desc`);
    for (const m of j?.value || []) { const b = sigBlock(m.body?.content || ""); if (b && b.length < 20000) { firma = b; break; } }
  } catch (e) { ctx.log.push("firma: " + (e as Error).message); }
  const { data: cur } = await db.from("graph_accounts").select("state").eq("owner", ctx.owner).maybeSingle();
  await db.from("graph_accounts").update({ state: { ...(cur?.state || {}), firma, firma_at: iso() } }).eq("owner", ctx.owner);
  return firma;
}
const firmaRe = (ctx: Ctx) => new RegExp(`\\n+\\s*${escRe(ctx.perfil.corto)}(\\s+\\S+){0,2}\\s*$`, "i");


/* ---------- buzón completo (en directo, sin copiar el buzón a la base de datos) ---------- */
const WK = ["inbox", "sentitems", "drafts", "outbox", "archive", "deleteditems", "junkemail"];
const WK_ORD: Record<string, number> = { inbox: 0, drafts: 1, outbox: 2, sentitems: 3, archive: 4, deleteditems: 5, junkemail: 6 };
const tokCache = new Map<string, { token: string; exp: number }>();
async function ctxBox(acc: any): Promise<Ctx> {
  const c = tokCache.get(acc.owner);
  let token = c && c.exp > Date.now() + 120000 ? c.token : "";
  if (!token) {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: acc.refresh_token, scope: REFRESH_SCOPE });
    if (tok.refresh_token) await db.from("graph_accounts").update({ refresh_token: tok.refresh_token }).eq("owner", acc.owner);
    token = tok.access_token;
    tokCache.set(acc.owner, { token, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
  }
  return { owner: acc.owner, token, me: null, deadline: Date.now() + 50000, log: [], perfil: null as unknown as Perfil };
}
const okId = (s: unknown) => { const v = String(s || ""); if (!/^[A-Za-z0-9_\-=+/.]{1,400}$/.test(v)) throw new Error("Referencia de correo no válida"); return encodeURIComponent(v); };
const okFolder = (s: unknown) => WK.includes(String(s)) ? String(s) : okId(s);
const MSG_SEL = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,flag,bodyPreview,conversationId,importance,isDraft,parentFolderId";
const who = (r: any) => ({ nombre: r?.emailAddress?.name || r?.emailAddress?.address || "", mail: r?.emailAddress?.address || "" });
const slim = (m: any) => ({
  id: m.id, asunto: m.subject || "(sin asunto)", de: who(m.from), para: (m.toRecipients || []).map(who), cc: (m.ccRecipients || []).map(who),
  fecha: m.receivedDateTime || m.sentDateTime, leido: !!m.isRead, adj: !!m.hasAttachments, bandera: m.flag?.flagStatus === "flagged",
  prev: String(m.bodyPreview || "").replace(/\s+/g, " ").slice(0, 220), conv: m.conversationId, imp: m.importance === "high", borrador: !!m.isDraft, carpeta: m.parentFolderId,
  verbo: Number((m.singleValueExtendedProperties || [])[0]?.value || 0) || 0,
});
const XVERB = () => `&$expand=${encodeURIComponent("singleValueExtendedProperties($filter=id eq 'Integer 0x1081')")}`;
async function boxFolders(ctx: Ctx) {
  const wk: any[] = [];
  for (const w of WK) wk.push(await g(ctx, `/me/mailFolders/${w}?$select=id,displayName,unreadItemCount,totalItemCount`).catch(() => null));
  const byId = new Map<string, string>();
  wk.forEach((f, i) => { if (f) byId.set(f.id, WK[i]); });
  const top = await gAll(ctx, `/me/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount`, [], 200);
  const inboxId = wk[0]?.id;
  const kids = inboxId ? await gAll(ctx, `/me/mailFolders/${inboxId}/childFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount`, [], 200).catch(() => []) : [];
  const out: any[] = [];
  for (const f of wk) if (f) out.push({ id: f.id, nombre: f.displayName, wk: byId.get(f.id), noLeidos: f.unreadItemCount, total: f.totalItemCount });
  out.sort((a, b) => WK_ORD[a.wk] - WK_ORD[b.wk]);
  const skip = /^(conversation history|historial de conversaciones|rss|sync issues|problemas de sincronización|outbox|bandeja de salida|notas|notes|outbox)/i;
  for (const f of top) if (!byId.has(f.id) && !skip.test(f.displayName)) out.push({ id: f.id, nombre: f.displayName, noLeidos: f.unreadItemCount, total: f.totalItemCount });
  for (const f of kids) out.push({ id: f.id, nombre: f.displayName, noLeidos: f.unreadItemCount, total: f.totalItemCount, dentro: "inbox" });
  return { carpetas: out };
}
async function boxList(ctx: Ctx, b: any) {
  let j: any;
  if (b.next) {
    const n = String(b.next);
    if (!n.startsWith(G + "/")) throw new Error("Página no válida");
    j = await g(ctx, n);
  } else if (String(b.q || "").trim()) {
    // la búsqueda va a todo el buzón y sin límite de 90 días
    const q = String(b.q).replace(/["\\]/g, " ").trim().slice(0, 120);
    j = await g(ctx, `/me/messages?$search=${encodeURIComponent(`"${q}"`)}&$top=60&$select=${MSG_SEL}`);
  } else {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const f = [`receivedDateTime ge ${since}`];
    if (b.ver === "noleidos") f.push("isRead eq false");
    if (b.ver === "leidos") f.push("isRead eq true");
    if (b.bandera) f.push("flag/flagStatus eq 'flagged'");
    if (b.adjuntos) f.push("hasAttachments eq true");
    // Prioritarios / Otros de Outlook (bandeja de entrada con prioridad), solo en la Bandeja de entrada
    const foco = (b.carpeta || "inbox") === "inbox" && (b.foco === "prioritarios" || b.foco === "otros") ? `inferenceClassification eq '${b.foco === "otros" ? "other" : "focused"}'` : "";
    const mk = (ff: string[]) => `/me/mailFolders/${okFolder(b.carpeta || "inbox")}/messages?$filter=${encodeURIComponent(ff.join(" and "))}&$orderby=receivedDateTime desc&$top=60&$select=${MSG_SEL}`;
    const url = mk(foco ? [...f, foco] : f);
    // con el «verbo» (icono respondido / reenviado); si Graph no lo acepta, la lista sale igual sin él
    j = await g(ctx, url + XVERB()).catch((e) => { if (e.status === 400) return g(ctx, url); throw e; })
      .catch((e) => { if (e.status === 400 && foco) return g(ctx, mk(f)).then((x: any) => ({ ...x, sinFoco: true })); throw e; });
  }
  return { items: (j?.value || []).map(slim), next: j?.["@odata.nextLink"] || null, ...(j?.sinFoco ? { sinFoco: true } : {}) };
}
async function boxGet(ctx: Ctx, b: any) {
  const id = okId(b.id);
  const m = await g(ctx, `/me/messages/${id}?$select=${MSG_SEL},body,webLink`, { prefer: ['outlook.body-content-type="text"'] });
  if (!m.isRead && b.marcar !== false) { await g(ctx, `/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => null); m.isRead = true; }
  let adjuntos: any[] = [];
  if (m.hasAttachments) {
    const a = await g(ctx, `/me/messages/${id}/attachments?$select=id,name,size,contentType,isInline`).catch(() => null);
    adjuntos = (a?.value || []).filter((x: any) => !x.isInline).map((x: any) => ({ id: x.id, nombre: x.name, tam: x.size, tipo: x.contentType }));
  }
  const cuerpo = String(m.body?.content || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 80000);
  return { ...slim(m), cuerpo, adjuntos, enlace: m.webLink || null };
}
async function boxAttachment(ctx: Ctx, b: any) {
  const a = await g(ctx, `/me/messages/${okId(b.id)}/attachments/${okId(b.aid)}`);
  if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") throw new Error("Este adjunto solo se puede abrir en Outlook");
  if ((a.size || 0) > 12 * 1024 * 1024) throw new Error("El adjunto es muy grande; ábrelo en Outlook");
  return { nombre: a.name, tipo: a.contentType || "application/octet-stream", b64: a.contentBytes };
}
const addrList = (s: unknown) => String(s || "").split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).map((address) => ({ emailAddress: { address } }));
/* ---------- envío programado (24/11): Exchange lo guarda y lo envía a la hora (PidTagDeferredSendTime) ---------- */
function okProgramar(v: unknown): string | null {
  if (!v) return null;
  const t = new Date(String(v));
  if (isNaN(t.getTime())) throw new Error("Hora de envío no válida");
  if (t.getTime() < Date.now() + 60000) throw new Error("La hora de envío ya ha pasado");
  if (t.getTime() > Date.now() + 60 * 864e5) throw new Error("Solo se puede programar hasta 60 días");
  return t.toISOString().replace(/\.\d{3}Z$/, "Z");
}
async function deferSend(ctx: Ctx, draftId: string, when: string | null) {
  if (!when) return;
  await g(ctx, `/me/messages/${draftId}`, { method: "PATCH", body: JSON.stringify({ singleValueExtendedProperties: [{ id: "SystemTime 0x3FEF", value: when }] }) });
}
async function boxCompose(ctx: Ctx, b: any, acc: any) {
  ctx.perfil = await perfilDe(acc.owner, acc.upn || "");
  const texto = String(b.texto || "").replace(firmaRe(ctx), "").trimEnd();
  const enviar = b.enviar === true;
  const tipo = String(b.tipo || "");
  const programar = enviar ? okProgramar(b.programar) : null;
  const firma = await firmaDe(ctx);
  // imágenes pegadas: dentro del correo, debajo del texto (25/11)
  const cids = (Array.isArray(b.inline) ? b.inline : []).map(String).filter((c: string) => /^[A-Za-z0-9._@-]{1,80}$/.test(c)).slice(0, 20);
  const imgs = cids.map((c: string) => `<div><img src="cid:${c}" style="max-width:100%;height:auto"></div>`).join("");
  const part = `${toHtml(texto)}${imgs}${firma ? "<br>" + firma : ""}<br>`;
  let draft: any;
  if (tipo === "nuevo") {
    const to = addrList(b.para), cc = addrList(b.cc);
    if (enviar && !to.length) throw new Error("Falta un destinatario válido en «Para»");
    if (enviar && !texto) throw new Error("El correo está vacío");
    draft = await g(ctx, `/me/messages`, { method: "POST", body: JSON.stringify({ subject: String(b.asunto || "").slice(0, 250), body: { contentType: "HTML", content: `<html><body>${part}</body></html>` }, toRecipients: to, ccRecipients: cc }) });
  } else {
    const fn = tipo === "responder" ? "createReply" : tipo === "todos" ? "createReplyAll" : tipo === "reenviar" ? "createForward" : "";
    if (!fn) throw new Error("Tipo de respuesta no válido");
    if (enviar && !texto && tipo !== "reenviar") throw new Error("La respuesta está vacía");
    draft = await g(ctx, `/me/messages/${okId(b.id)}/${fn}`, { method: "POST", body: JSON.stringify({}) });
    const patch: any = { body: { contentType: "HTML", content: insertTop(draft.body?.content || "", part) } };
    if (tipo === "reenviar") {
      const to = addrList(b.para), cc = addrList(b.cc);
      if (enviar && !to.length) throw new Error("Falta a quién reenviarlo («Para»)");
      patch.toRecipients = to; if (cc.length) patch.ccRecipients = cc;
    } else if (b.destinatarios === true) {
      // Para y CC elegidos a mano (se puede quitar a alguien del «Responder a todos»)
      const yo = String(acc.upn || "").toLowerCase();
      const notMe = (l: any[]) => l.filter((r) => r.emailAddress.address.toLowerCase() !== yo);
      const to = notMe(addrList(b.para)), cc = notMe(addrList(b.cc));
      if (enviar && !to.length) throw new Error("Falta al menos un destinatario en «Para»");
      patch.toRecipients = to; patch.ccRecipients = cc;
    } else if (b.cc) {
      const cc = addrList(b.cc); if (cc.length) patch.ccRecipients = [...(draft.ccRecipients || []), ...cc];
    }
    await g(ctx, `/me/messages/${draft.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  // con adjuntos: se deja preparado el borrador; los archivos se suben aparte y luego se envía (op enviarBorrador)
  if (b.preparar === true) return { draft: draft.id };
  if (!enviar) {
    const d = await g(ctx, `/me/messages/${draft.id}?$select=webLink`).catch(() => null);
    return { borrador: true, enlace: d?.webLink || null };
  }
  await deferSend(ctx, draft.id, programar);
  await g(ctx, `/me/messages/${draft.id}/send`, { method: "POST" });
  // si ese hilo estaba en Pendientes de Synqalia, queda gestionado
  if (tipo !== "nuevo" && tipo !== "reenviar" && draft.conversationId) {
    const { data: rows } = await db.from("personal_docs").select("id,data").eq("owner", ctx.owner).eq("col", "correos").eq("data->>conv", draft.conversationId);
    for (const r of rows || []) if (r.data?.estado === "pendiente") await mergeDoc(ctx.owner, "correos", r.id, { estado: "gestionado" });
  }
  return { enviado: true, programado: programar };
}
/* ---------- correo tal cual se ve en Outlook (25/11): HTML limpio (sin scripts) e imágenes internas incrustadas ---------- */
const decodeEnt = (t: string) => t.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/gi, "&");
function htmlToText(h: string) {
  return decodeEnt(String(h || "").replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t ]+\n/g, "\n").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function cleanHtml(h: string) {
  return String(h || "")
    .replace(/<(script|iframe|object|embed|form|frameset|frame|applet)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '$1="#"')
    .slice(0, 400000);
}
async function boxThread(ctx: Ctx, b: any, acc: any) {
  const conv = String(b.conv || "");
  if (!/^[A-Za-z0-9_\-=+/.]{1,400}$/.test(conv)) throw new Error("Conversación no válida");
  const ligero = b.ligero === true; // solo para desplegar el hilo en la lista: sin el texto
  const sel = ligero ? MSG_SEL : `${MSG_SEL},body,uniqueBody,webLink`;
  // rapidez (26/11): los adjuntos vienen en la misma petición (antes, una por mensaje)
  const base = `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${conv}'`)}&$top=50&$select=${sel}`;
  const all = ligero ? await gAll(ctx, base, [], 60)
    : await gAll(ctx, base + `&$expand=${encodeURIComponent("attachments($select=id,name,size,contentType,isInline)")}`, [], 60).catch((e) => { if (e.status === 400) return gAll(ctx, base, [], 60); throw e; });
  const yo = String(acc.upn || "").toLowerCase();
  const msgs = all.filter((m: any) => !m.isDraft).sort((x: any, y: any) => String(y.receivedDateTime || y.sentDateTime).localeCompare(String(x.receivedDateTime || x.sentDateTime)));
  const clean = (t: string, n: number) => String(t || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  let presupuesto = 1536 * 1024; // imágenes internas incrustadas (solo en el mensaje que se ve), como mucho
  const out = await Promise.all(msgs.map(async (m: any, i: number) => {
    const mio = String(m.from?.emailAddress?.address || "").toLowerCase() === yo;
    if (ligero) return { ...slim(m), mio };
    let adjuntos: any[] = [];
    let inl: any[] = [];
    if (m.hasAttachments) {
      const a = m.attachments ? { value: m.attachments } : await g(ctx, `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,size,contentType,isInline`).catch(() => null);
      adjuntos = (a?.value || []).filter((x: any) => !x.isInline).map((x: any) => ({ id: x.id, nombre: x.name, tam: x.size, tipo: x.contentType }));
      inl = (a?.value || []).filter((x: any) => x.isInline && x.size < 400000);
    }
    const isHtml = m.body?.contentType === "html";
    const fullH = isHtml ? String(m.body?.content || "") : "";
    const uniqH = m.uniqueBody?.contentType === "html" ? String(m.uniqueBody?.content || "") : "";
    const completo = clean(isHtml ? htmlToText(fullH) : m.body?.content, 40000);
    const nuevo = clean(uniqH ? htmlToText(uniqH) : (m.uniqueBody?.content || ""), 40000) || completo;
    const conCita = completo.length > nuevo.length + 40;
    let html = isHtml ? cleanHtml(uniqH || fullH) : "";
    let htmlCompleto = isHtml && conCita && i === 0 ? cleanHtml(fullH) : "";
    // imágenes pegadas o del logotipo de la firma (cid:) → dentro del correo
    if (i === 0 && (html || htmlCompleto) && inl.length && /cid:/i.test(html + htmlCompleto)) {
      const elegidas = inl.slice(0, 8).filter((x: any) => { if (presupuesto < x.size) return false; presupuesto -= x.size; return true; });
      const fs = await Promise.all(elegidas.map((x: any) => g(ctx, `/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(x.id)}`).catch(() => null)));
      for (const f of fs) {
        if (!f?.contentBytes || !f.contentId) continue;
        const uri = `data:${f.contentType || "image/png"};base64,${f.contentBytes}`;
        const re = new RegExp(`cid:${escRe(String(f.contentId).replace(/^<|>$/g, ""))}`, "gi");
        html = html.replace(re, uri); htmlCompleto = htmlCompleto.replace(re, uri);
      }
    }
    return { ...slim(m), mio, cuerpo: nuevo, citado: conCita ? completo : "", html, htmlCompleto, adjuntos, enlace: m.webLink || null };
  }));
  if (b.marcar !== false && !ligero) {
    const sinLeer = msgs.filter((m: any) => !m.isRead);
    await Promise.all(sinLeer.map((m: any) => g(ctx, `/me/messages/${encodeURIComponent(m.id)}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => null)));
    for (const m of out) m.leido = true;
  }
  return { mensajes: out };
}
// carpeta nueva (25/11): se crea en Outlook (suelta o dentro de otra)
async function boxNewFolder(ctx: Ctx, b: any) {
  const nombre = String(b.nombre || "").replace(/[\\/]+/g, "-").trim().slice(0, 120);
  if (!nombre) throw new Error("Pon un nombre a la carpeta");
  const base = b.dentro ? `/me/mailFolders/${okFolder(b.dentro)}/childFolders` : `/me/mailFolders`;
  const f = await g(ctx, base, { method: "POST", body: JSON.stringify({ displayName: nombre }) })
    .catch((e) => { if (e.status === 409 || /ErrorFolderExists/i.test(e.message)) throw new Error(`Ya tienes una carpeta «${nombre}»`); throw e; });
  return { id: f.id, nombre: f.displayName };
}
// leerHasta (25/11): marca como leído todo lo no leído del buzón recibido hasta un día (incluido), por tandas.
// Cada llamada trabaja ~90 s y dice si queda más; la app repite hasta terminar.
async function boxReadUntil(ctx: Ctx, b: any) {
  const d = String(b.hasta || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Fecha no válida");
  const lim = new Date(new Date(d + "T00:00:00Z").getTime() + 864e5 - 3600e3).toISOString(); // fin del día en Madrid (aprox.)
  const t0 = Date.now();
  let hechos = 0, fallos = 0;
  while (Date.now() - t0 < 90000) {
    const j = await g(ctx, `/me/messages?$filter=${encodeURIComponent(`isRead eq false and receivedDateTime le ${lim}`)}&$select=id&$top=200`);
    const ids: string[] = (j?.value || []).map((x: any) => x.id);
    if (!ids.length) return { hechos, quedan: false, fallos };
    let ok = 0;
    for (let i = 0; i < ids.length; i += 20) {
      const part = ids.slice(i, i + 20);
      const r = await g(ctx, `/$batch`, { method: "POST", body: JSON.stringify({ requests: part.map((id, k) => ({ id: String(k), method: "PATCH", url: `/me/messages/${encodeURIComponent(id)}`, headers: { "Content-Type": "application/json" }, body: { isRead: true } })) }) });
      const bien = (r?.responses || []).filter((x: any) => x.status >= 200 && x.status < 300).length;
      ok += bien; fallos += part.length - bien;
      if (bien < part.length) await new Promise((res) => setTimeout(res, 1500)); // Outlook pide calma: se espera un poco
    }
    hechos += ok;
    if (!ok) return { hechos, quedan: true, fallos, pausa: true };
  }
  return { hechos, quedan: true, fallos };
}
const idList = (b: any) => (Array.isArray(b.ids) && b.ids.length ? b.ids : [b.id]).slice(0, 50).map(okId);
async function boxMove(ctx: Ctx, b: any, destino: string) {
  const dest = WK.includes(destino) ? destino : decodeURIComponent(okId(destino));
  const r = await Promise.all(idList(b).map((id: string) => g(ctx, `/me/messages/${id}/move`, { method: "POST", body: JSON.stringify({ destinationId: dest }) }).then(() => 1).catch((e) => { if (e.status === 404) return 0; throw e; })));
  return { ok: true, movidos: r.reduce((a: number, x: number) => a + x, 0) };
}
// Responder un correo de Pendientes con más gente en copia (24/11): busca el original como la función «graph»
// y lo deja gestionado igual que «Enviar».
const gidFromLink = (l?: string) => { const m = /\/id\/([^?#]+)/.exec(l || ""); return m ? decodeURIComponent(m[1]).replace(/\//g, "-").replace(/\+/g, "_") : null; };
async function boxPendiente(ctx: Ctx, b: any, acc: any) {
  const mailId = String(b.mail || "");
  if (!/^[A-Za-z0-9_\-:.]{1,200}$/.test(mailId)) throw new Error("Correo no válido");
  const { data: cd } = await db.from("personal_docs").select("data").eq("owner", ctx.owner).eq("col", "correos").eq("id", mailId).maybeSingle();
  const c = cd?.data || {};
  let gid = c.gid || gidFromLink(c.enlace);
  if (gid) { try { await g(ctx, `/me/messages/${encodeURIComponent(gid)}?$select=id`); } catch { gid = null; } }
  if (!gid) {
    const q = String(c.asuntoOutlook || c.asunto || "").replace(/"/g, "");
    const found = q ? await g(ctx, `/me/messages?$search="subject:${encodeURIComponent(q)}"&$select=id,receivedDateTime,isDraft&$top=10`) : null;
    const cand = (found?.value || []).filter((m: any) => !m.isDraft).sort((x: any, y: any) => y.receivedDateTime.localeCompare(x.receivedDateTime))[0];
    gid = cand?.id || null;
  }
  if (!gid) throw new Error("No encuentro el correo original en tu buzón para responderlo");
  const todos = b.todos ?? /;|\bCC\b/.test(c.para || "");
  const r = await boxCompose(ctx, { tipo: todos ? "todos" : "responder", id: gid, texto: b.texto, cc: b.cc, programar: b.programar, inline: b.inline, preparar: b.preparar === true, enviar: b.enviar !== false }, acc);
  const now = iso();
  if (b.preparar === true) return r; // con adjuntos: el cliente sube los archivos y luego «enviarBorrador»
  if (b.enviar === false) {
    const { data: rd0 } = await db.from("personal_docs").select("data").eq("owner", ctx.owner).eq("col", "respuestas").eq("id", mailId).maybeSingle();
    await setDoc(ctx.owner, "respuestas", mailId, { ...(rd0?.data || {}), texto: String(b.texto || ""), cc: String(b.cc || ""), estado: "en_outlook", actualizado: now });
    return r;
  }
  const { data: rd } = await db.from("personal_docs").select("data").eq("owner", ctx.owner).eq("col", "respuestas").eq("id", mailId).maybeSingle();
  await setDoc(ctx.owner, "respuestas", mailId, { ...(rd?.data || {}), texto: String(b.texto || ""), cc: String(b.cc || ""), estado: "enviada", enviada: now, via: "synqalia", programado: (r as any)?.programado || null, draftId: null, actualizado: now });
  await mergeDoc(ctx.owner, "correos", mailId, { estado: "gestionado" });
  const { data: ts } = await db.from("personal_docs").select("id,data").eq("owner", ctx.owner).eq("col", "tareas").eq("data->>ref", mailId);
  for (const x of ts || []) if (x.data?.estado !== "hecha") await mergeDoc(ctx.owner, "tareas", x.id, { estado: "hecha", hecha: now });
  return r;
}
/* ---------- adjuntos al redactar (24/11) ---------- */
const MAX_ADJ = 25 * 1024 * 1024;
async function boxAttach(ctx: Ctx, b: any) {
  const draft = okId(b.draft);
  const nombre = String(b.nombre || "archivo").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 200);
  const cid = b.inline && /^[A-Za-z0-9._@-]{1,80}$/.test(String(b.cid || "")) ? String(b.cid) : null;
  const tipo = String(b.tipo || "application/octet-stream").slice(0, 120);
  const size = Number(b.size) || 0;
  if (size > MAX_ADJ) throw new Error(`«${nombre}» pasa de 25 MB`);
  if (b.b64 && size <= 3 * 1024 * 1024) {
    await g(ctx, `/me/messages/${draft}/attachments`, { method: "POST", body: JSON.stringify({ "@odata.type": "#microsoft.graph.fileAttachment", name: nombre, contentType: tipo, contentBytes: String(b.b64), isInline: !!cid, ...(cid ? { contentId: cid } : {}) }) });
    return { ok: true };
  }
  // archivo grande: sesión de subida (los trozos llegan con op «trozo»)
  const ses = await g(ctx, `/me/messages/${draft}/attachments/createUploadSession`, { method: "POST", body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: nombre, size, contentType: tipo, ...(cid ? { isInline: true, contentId: cid } : {}) } }) });
  return { url: ses.uploadUrl };
}
async function boxChunk(b: any) {
  const url = String(b.url || "");
  let host = "";
  try { host = new URL(url).hostname; } catch { /* */ }
  if (!/^https:/.test(url) || !/(^|\.)(outlook\.office\.com|outlook\.office365\.com|graph\.microsoft\.com)$/i.test(host)) throw new Error("Subida no válida");
  const bin = Uint8Array.from(atob(String(b.b64 || "")), (c) => c.charCodeAt(0));
  const start = Number(b.start) || 0, total = Number(b.total) || 0;
  if (!bin.length || total > MAX_ADJ) throw new Error("Trozo no válido");
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bin.length), "Content-Range": `bytes ${start}-${start + bin.length - 1}/${total}` }, body: bin });
  if (!r.ok && r.status !== 200 && r.status !== 201 && r.status !== 202) { const t = await r.text().catch(() => ""); throw new Error(`No se pudo subir el adjunto (${r.status}) ${t.slice(0, 120)}`); }
  return { ok: true };
}
async function boxSendDraft(ctx: Ctx, b: any) {
  const id = okId(b.draft);
  const d = await g(ctx, `/me/messages/${id}?$select=conversationId,isDraft`);
  if (!d.isDraft) throw new Error("Ese borrador ya se envió");
  const programar = okProgramar(b.programar);
  await deferSend(ctx, id, programar);
  await g(ctx, `/me/messages/${id}/send`, { method: "POST" });
  if ((b.tipo === "responder" || b.tipo === "todos") && d.conversationId) {
    const { data: rows } = await db.from("personal_docs").select("id,data").eq("owner", ctx.owner).eq("col", "correos").eq("data->>conv", d.conversationId);
    for (const r of rows || []) if (r.data?.estado === "pendiente") await mergeDoc(ctx.owner, "correos", r.id, { estado: "gestionado" });
  }
  return { enviado: true, programado: programar };
}
/* ---------- personas para «Para» y «CC» (24/11) ----------
   1) Directorio de la empresa y personas habituales (si el permiso está concedido); 2) si no, gente con la que te has
   escrito (búsqueda en tu buzón). */
async function boxPeople(ctx: Ctx, b: any) {
  const q = String(b.q || "").replace(/["'\\]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return { personas: [] };
  const out = new Map<string, { nombre: string; mail: string; origen: string }>();
  const add = (nombre: string, mail: string, origen: string) => {
    const m = String(mail || "").toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) || out.has(m)) return;
    out.set(m, { nombre: String(nombre || m), mail: m, origen });
  };
  const ql = q.toLowerCase();
  const fits = (n: string, m: string) => (n + " " + m).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(ql.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const tasks: Promise<unknown>[] = [
    g(ctx, `/me/people?$search=${encodeURIComponent(`"${q}"`)}&$top=15&$select=displayName,scoredEmailAddresses`).then((j: any) => {
      for (const p of j?.value || []) for (const e of p.scoredEmailAddresses || []) add(p.displayName, e.address, "empresa");
    }).catch(() => null),
    Promise.resolve(null),
    g(ctx, `/me/messages?$search=${encodeURIComponent(`"participants:${q}"`)}&$top=25&$select=from,toRecipients,ccRecipients`).then((j: any) => {
      for (const m of j?.value || []) for (const r of [m.from, ...(m.toRecipients || []), ...(m.ccRecipients || [])]) {
        const n = r?.emailAddress?.name || "", a = r?.emailAddress?.address || "";
        if (fits(n, a)) add(n, a, "correo");
      }
    }).catch(() => null),
  ];
  // el directorio necesita la cabecera ConsistencyLevel: eventual
  tasks[1] = fetch(`${G}/users?$search=${encodeURIComponent(`"displayName:${q}"`)}&$top=15&$select=displayName,mail,userPrincipalName`, { headers: { Authorization: `Bearer ${ctx.token}`, ConsistencyLevel: "eventual" } })
    .then((r) => r.ok ? r.json() : null).then((j: any) => { for (const u of j?.value || []) add(u.displayName, u.mail || u.userPrincipalName, "empresa"); }).catch(() => null);
  await Promise.all(tasks);
  return { personas: [...out.values()].slice(0, 12) };
}
/* ---------- agenda para proponer fechas (24/11): ocupado entre dos días, hora de Madrid ---------- */
async function boxAgenda(ctx: Ctx, b: any) {
  const d0 = String(b.desde || ""), d1 = String(b.hasta || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d0) || !/^\d{4}-\d{2}-\d{2}$/.test(d1)) throw new Error("Fechas no válidas");
  if ((new Date(d1).getTime() - new Date(d0).getTime()) / 864e5 > 62) throw new Error("Máximo 62 días");
  const evs = await gAll(ctx, `/me/calendarView?startDateTime=${d0}T00:00:00&endDateTime=${d1}T23:59:59&$select=subject,start,end,isAllDay,showAs,isCancelled&$top=200`, ['outlook.timezone="Europe/Madrid"'], 600);
  return { eventos: evs.filter((e: any) => !e.isCancelled && e.showAs !== "free").map((e: any) => ({ titulo: e.subject || "", inicio: e.start?.dateTime?.slice(0, 16), fin: e.end?.dateTime?.slice(0, 16), diaEntero: !!e.isAllDay, estado: e.showAs })) };
}
/* ---------- Pendientes al día con lo que haces en Outlook (25/11) ----------
   conciliar: cierra (gestionado) los correos de Pendientes que en Outlook ya has respondido o reenviado, que has archivado,
   borrado o movido fuera de la Bandeja de entrada, o que has leído si no te piden nada. Lo pide la app al abrirse y cada pocos minutos.
   leidoPend: al marcar «Gestionado» en Synqalia, el hilo queda leído también en Outlook. */
const VERB = "Integer 0x1081"; // PidTagLastVerbExecuted: 102 responder, 103 responder a todos, 104 reenviar
async function gBatch(ctx: Ctx, urls: string[]) {
  const out: any[] = new Array(urls.length).fill(null);
  for (let i = 0; i < urls.length; i += 20) {
    const part = urls.slice(i, i + 20);
    const j = await g(ctx, `/$batch`, { method: "POST", body: JSON.stringify({ requests: part.map((url, k) => ({ id: String(i + k), method: "GET", url, headers: { Prefer: 'outlook.body-content-type="text"' } })) }) });
    for (const r of j?.responses || []) out[Number(r.id)] = r.status === 200 ? r.body : (r.status === 404 ? { value: [] } : null);
  }
  return out;
}
async function boxConciliar(ctx: Ctx, acc: any) {
  const leidos = await gestionadosALeido(ctx).catch(() => 0);
  const { data: rows } = await db.from("personal_docs").select("id,data").eq("owner", ctx.owner).eq("col", "correos").eq("data->>estado", "pendiente");
  const docs = (rows || []).filter((r: any) => r.data?.conv && !r.data?.reunion).sort((a: any, b: any) => String(b.data.fecha || "").localeCompare(String(a.data.fecha || ""))).slice(0, 80);
  if (!docs.length) return { cerrados: [], leidos };
  const inbox = await g(ctx, `/me/mailFolders/inbox?$select=id`);
  const yo = String(acc.upn || "").toLowerCase();
  const urls = docs.map((d: any) => `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${String(d.data.conv).replace(/'/g, "''")}'`)}&$top=50&$select=id,isRead,isDraft,from,parentFolderId,receivedDateTime,sentDateTime&$expand=${encodeURIComponent(`singleValueExtendedProperties($filter=id eq '${VERB}')`)}`);
  const res = await gBatch(ctx, urls);
  const cerrados: any[] = [];
  const now = iso();
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], r = res[i];
    if (!r) continue; // no se pudo consultar: se deja como está
    const msgs = (r.value || []).filter((m: any) => !m.isDraft);
    const mine = (m: any) => String(m.from?.emailAddress?.address || "").toLowerCase() === yo;
    const when = (m: any) => String(m.receivedDateTime || m.sentDateTime || "");
    const recibidos = msgs.filter((m: any) => !mine(m)).sort((a: any, b: any) => when(b).localeCompare(when(a)));
    const enviados = msgs.filter(mine).sort((a: any, b: any) => when(b).localeCompare(when(a)));
    const ultimoRec = recibidos[0];
    let motivo = "";
    if (!msgs.length) motivo = "Borrado en Outlook";
    else if (ultimoRec && enviados[0] && when(enviados[0]) > when(ultimoRec)) motivo = "Respondido en Outlook";
    else if (ultimoRec && [102, 103, 104].includes(Number(ultimoRec.singleValueExtendedProperties?.[0]?.value || 0))) motivo = Number(ultimoRec.singleValueExtendedProperties[0].value) === 104 ? "Reenviado en Outlook" : "Respondido en Outlook";
    else if (recibidos.length && !recibidos.some((m: any) => m.parentFolderId === inbox.id)) motivo = "Archivado o movido en Outlook";
    else {
      const nm = d.data.nivelManual;
      const informativo = nm === "no" || (!nm && Object.prototype.hasOwnProperty.call(d.data, "nivel") && d.data.nivel == null);
      if (informativo && recibidos.length && recibidos.every((m: any) => m.isRead)) motivo = "Leído en Outlook (no te piden nada)";
    }
    if (!motivo) continue;
    await mergeDoc(ctx.owner, "correos", d.id, { estado: "gestionado", cierre: { motivo, fecha: now } });
    cerrados.push({ id: d.id, motivo });
  }
  return { cerrados, revisados: docs.length, leidos };
}
async function convDe(ctx: Ctx, id: string, data: any): Promise<string | null> {
  if (data?.conv) return data.conv;
  const gid = data?.gid || gidFromLink(data?.enlace);
  if (!gid) return null;
  const m = await g(ctx, `/me/messages/${encodeURIComponent(gid)}?$select=conversationId`).catch(() => null);
  if (!m?.conversationId) return null;
  await mergeDoc(ctx.owner, "correos", id, { conv: m.conversationId });
  return m.conversationId;
}
async function marcarLeidos(ctx: Ctx, ids: string[]) {
  let ok = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const r = await g(ctx, `/$batch`, { method: "POST", body: JSON.stringify({ requests: part.map((id, k) => ({ id: String(k), method: "PATCH", url: `/me/messages/${encodeURIComponent(id)}`, headers: { "Content-Type": "application/json" }, body: { isRead: true } })) }) });
    ok += (r?.responses || []).filter((x: any) => x.status >= 200 && x.status < 300).length;
  }
  return ok;
}
// gestionados en Synqalia que en Outlook siguen sin leer → leídos (por tandas de 100; se apunta leidoOutlook para no repetir)
async function gestionadosALeido(ctx: Ctx) {
  const { data: rows } = await db.from("personal_docs").select("id,data").eq("owner", ctx.owner).eq("col", "correos").eq("data->>estado", "gestionado").is("data->>leidoOutlook", null).limit(500);
  const docs = (rows || []).filter((r: any) => !r.data?.reunion).sort((a: any, b: any) => String(b.data.fecha || "").localeCompare(String(a.data.fecha || ""))).slice(0, 100);
  if (!docs.length) return 0;
  const now = iso();
  const conv: (string | null)[] = [];
  for (const d of docs) conv.push(await convDe(ctx, d.id, d.data).catch(() => null));
  const conCv = docs.map((d: any, i: number) => ({ d, c: conv[i] })).filter((x: any) => x.c);
  const res = await gBatch(ctx, conCv.map((x: any) => `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${String(x.c).replace(/'/g, "''")}' and isRead eq false`)}&$top=50&$select=id`));
  const ids: string[] = [];
  conCv.forEach((x: any, i: number) => { for (const m of res[i]?.value || []) ids.push(m.id); });
  const hechos = ids.length ? await marcarLeidos(ctx, ids) : 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], k = conCv.findIndex((x: any) => x.d === d);
    if (k >= 0 && !res[k]) continue; // no se pudo mirar: otra vez será
    await mergeDoc(ctx.owner, "correos", d.id, { leidoOutlook: conv[i] ? now : "sin-conversacion" });
  }
  return hechos;
}
async function boxLeidoPend(ctx: Ctx, b: any) {
  const mailId = String(b.mail || "");
  if (!/^[A-Za-z0-9_\-:.]{1,200}$/.test(mailId)) throw new Error("Correo no válido");
  const { data: cd } = await db.from("personal_docs").select("data").eq("owner", ctx.owner).eq("col", "correos").eq("id", mailId).maybeSingle();
  const conv = await convDe(ctx, mailId, cd?.data);
  if (!conv) return { ok: false, motivo: "No encuentro este correo en Outlook" };
  const j = await g(ctx, `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${String(conv).replace(/'/g, "''")}' and isRead eq false`)}&$top=50&$select=id`);
  const n = await marcarLeidos(ctx, (j?.value || []).map((m: any) => m.id));
  await mergeDoc(ctx.owner, "correos", mailId, { leidoOutlook: iso() });
  return { ok: true, marcados: n };
}
async function boxAction(ctx: Ctx, b: any, acc: any) {
  switch (b.op) {
    case "carpetas": return await boxFolders(ctx);
    case "lista": return await boxList(ctx, b);
    case "abrir": return await boxGet(ctx, b);
    case "adjunto": return await boxAttachment(ctx, b);
    case "leido": await Promise.all(idList(b).map((id: string) => g(ctx, `/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ isRead: b.valor !== false }) }))); return { ok: true };
    case "bandera": await g(ctx, `/me/messages/${okId(b.id)}`, { method: "PATCH", body: JSON.stringify({ flag: { flagStatus: b.valor === false ? "notFlagged" : "flagged" } }) }); return { ok: true };
    case "hilo": return await boxThread(ctx, b, acc);
    case "mover": return await boxMove(ctx, b, String(b.destino || ""));
    case "eliminar": return await boxMove(ctx, b, "deleteditems");
    case "redactar": return await boxCompose(ctx, b, acc);
    case "pendiente": return await boxPendiente(ctx, b, acc);
    case "adjuntar": return await boxAttach(ctx, b);
    case "trozo": return await boxChunk(b);
    case "enviarBorrador": return await boxSendDraft(ctx, b);
    case "personas": return await boxPeople(ctx, b);
    case "agenda": return await boxAgenda(ctx, b);
    case "conciliar": return await boxConciliar(ctx, acc);
    case "leidoPend": return await boxLeidoPend(ctx, b);
    case "carpetaNueva": return await boxNewFolder(ctx, b);
    case "leerHasta": return await boxReadUntil(ctx, b);
  }
  throw new Error("Operación no válida");
}


async function userFrom(req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const { data } = await db.auth.getUser(tok);
  return data.user || null;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const body = await req.json().catch(() => ({}));
  const user = await userFrom(req);
  if (!user) return json({ error: "Inicia sesión" }, 401);
  const { data: member } = await db.from("members").select("email").eq("email", (user.email || "").toLowerCase()).maybeSingle();
  if (!member) return json({ error: "No eres miembro de Synqalia" }, 403);
  const { data: a } = await db.from("graph_accounts").select("*").eq("owner", user.id).maybeSingle();
  if (!a) return json({ error: "Microsoft 365 no está conectado" }, 400);
  if (body.cuenta === "gmail") return json({ error: "Gmail todavía no está conectado a Synqalia" }, 400);
  try {
    const r: any = await boxAction(await ctxBox(a), body, a);
    if (body.op === "carpetas") r.cuenta = a.upn || null;
    return json(r);
  }
  catch (e) {
    const err = e as any;
    if (err.status === 401) tokCache.delete(user.id);
    const msg = String(err.message || "");
    return json({ error: err.status === 404 ? "Ese correo ya no está en esa carpeta (quizá se movió o se borró)" : msg.slice(0, 300) }, 400);
  }
});
