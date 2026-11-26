// Synqalia · función gmail (25/11/2026): cuentas de Gmail / Google Workspace conectadas (varias por usuario),
// en directo contra la Gmail API, sin copiar el buzón a la base de datos. Misma forma de datos que la función «buzon»
// (Outlook) para que la lista de Correo no distinga de dónde viene cada correo.
//
// Identificadores hacia la web: «g~<idCuenta>~<idGmail>» (mensajes, conversaciones, etiquetas, páginas). Así la web
// sabe a qué función y a qué cuenta va cada operación sin cambiar el resto del código.
//
// Rutas:
//   GET  /gmail/callback            → vuelta de Google (sin sesión de Synqalia; se valida con «state» firmado)
//   POST /gmail  { op, ... }        → con la sesión de Synqalia (Authorization: Bearer …)
// Operaciones: cuentas, conectar, desconectar, carpetas, lista, hilo, abrir, adjunto, leido, bandera, mover, eliminar,
// carpetaNueva, redactar (responder / todos / reenviar / nuevo; enviar o dejar en Borradores; adjuntos en la misma
// petición), personas.
//
// Portable: solo fetch, Web Crypto y Postgres (supabase-js como cliente SQL). Secretos en variables de entorno:
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_KEY (32 bytes en base64), GMAIL_REDIRECT_URI (opcional), APP_URL (opcional).
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const TOKEN_KEY = Deno.env.get("TOKEN_KEY") ?? "";
const REDIRECT = Deno.env.get("GMAIL_REDIRECT_URI") || `${SB_URL}/functions/v1/gmail/callback`;
const APP_URL = (Deno.env.get("APP_URL") || "https://app.synqalia.com").replace(/\/$/, "");
const COMPANY = "provalliance"; // hasta que exista la tabla de empresas (tenants), todos los usuarios son de esta
const SCOPES = "openid email profile https://www.googleapis.com/auth/gmail.modify";
const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMU = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const COLORES = ["#ea4335", "#34a853", "#fbbc04", "#a142f4", "#24c1e0", "#f6aea9"];

const db = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const iso = () => new Date().toISOString();

/* ---------- base64 / base64url ---------- */
const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
function bytesToB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
const b64url = (u: Uint8Array) => bytesToB64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (u: Uint8Array) => new TextDecoder().decode(u);
const b64urlToB64 = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t + "===".slice((t.length + 3) % 4); };

/* ---------- cifrado del token y firma del «state» (Web Crypto, clave en TOKEN_KEY) ---------- */
let keys: { aes: CryptoKey; hmac: CryptoKey } | null = null;
async function getKeys() {
  if (keys) return keys;
  if (!TOKEN_KEY) throw new Error("Falta configurar TOKEN_KEY");
  const raw = b64ToBytes(TOKEN_KEY);
  if (raw.length !== 32) throw new Error("TOKEN_KEY debe tener 32 bytes");
  keys = {
    aes: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    hmac: await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
  };
  return keys;
}
async function encrypt(t: string) {
  const { aes } = await getKeys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, utf8(t)));
  return `${b64url(iv)}.${b64url(c)}`;
}
async function decrypt(s: string) {
  const { aes } = await getKeys();
  const [iv, c] = String(s).split(".");
  return fromUtf8(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(iv) }, aes, b64ToBytes(c))));
}
async function sign(payload: unknown) {
  const { hmac } = await getKeys();
  const p = b64url(utf8(JSON.stringify(payload)));
  const s = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", hmac, utf8(p))));
  return `${p}.${s}`;
}
async function unsign(tok: string): Promise<any> {
  const { hmac } = await getKeys();
  const [p, s] = String(tok || "").split(".");
  if (!p || !s) return null;
  const ok = await crypto.subtle.verify("HMAC", hmac, b64ToBytes(s), utf8(p));
  if (!ok) return null;
  const v = JSON.parse(fromUtf8(b64ToBytes(p)));
  return v.e > Date.now() ? v : null;
}

async function audit(owner: string | null, accion: string, detalle: Record<string, unknown> = {}) {
  await db.from("audit_log").insert({ company_id: COMPANY, owner, accion, detalle }).then(() => null, () => null);
}

/* ---------- Google OAuth ---------- */
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(j.error_description || j.error || "token"); e.code = j.error; throw e; }
  return j;
}
type Acc = { id: string; owner: string; email: string; nombre?: string; refresh_token: string; color?: string; state: any };
type Ctx = { acc: Acc; token: string };
const tokCache = new Map<string, { token: string; exp: number }>();
async function ctxOf(acc: Acc): Promise<Ctx> {
  const c = tokCache.get(acc.id);
  if (c && c.exp > Date.now() + 120000) return { acc, token: c.token };
  try {
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: await decrypt(acc.refresh_token) });
    tokCache.set(acc.id, { token: tok.access_token, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
    await db.from("gmail_accounts").update({ last_ok: iso(), last_error: null }).eq("id", acc.id).eq("owner", acc.owner);
    return { acc, token: tok.access_token };
  } catch (e) {
    const err = e as any;
    if (err.code === "invalid_grant") {
      await db.from("gmail_accounts").update({ last_error: "revocado" }).eq("id", acc.id).eq("owner", acc.owner);
      throw new Error(`Google ha cortado la conexión de ${acc.email}. Vuelve a conectarla desde la pestaña Gmail.`);
    }
    throw err;
  }
}
async function gm(ctx: Ctx, path: string, init: RequestInit = {}, base = GM) {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.token}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers as any || {}) };
  let r = await fetch(path.startsWith("http") ? path : base + path, { ...init, headers });
  for (let k = 0; k < 3 && (r.status === 429 || r.status >= 500); k++) {
    await new Promise((res) => setTimeout(res, 600 * (k + 1)));
    r = await fetch(path.startsWith("http") ? path : base + path, { ...init, headers });
  }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(`${r.status} ${j?.error?.message || ""}`.trim()); e.status = r.status; throw e; }
  return j;
}
// varias peticiones a la vez, sin pasarse (Gmail limita por usuario)
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
  return out;
}

/* ---------- identificadores hacia la web ---------- */
const PFX = (acc: Acc, id: string) => `g~${acc.id}~${id}`;
function parseRef(v: unknown) {
  const m = /^g~([0-9a-f-]{36})~(.+)$/i.exec(String(v || ""));
  if (!m) throw new Error("Referencia de Gmail no válida");
  return { acc: m[1], id: m[2] };
}
const okGid = (s: string) => { if (!/^[A-Za-z0-9_\-]{1,200}$/.test(s)) throw new Error("Referencia de correo no válida"); return s; };
// la cuenta a la que va una petición: la de los ids, la de la carpeta, la de «next» o la de «cuenta»
function accRef(b: any): string | null {
  const cand = [b.id, b.conv, Array.isArray(b.ids) ? b.ids[0] : null, b.carpeta, b.next, b.cuenta, b.destino].find((x) => /^g~[0-9a-f-]{36}~/i.test(String(x || "")));
  return cand ? parseRef(cand).acc : null;
}

/* ---------- mensajes: de Gmail a la forma de Synqalia ---------- */
const hdr = (m: any, n: string) => String((m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "");
function decodeWords(s: string) {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, enc, t) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? b64ToBytes(t) : Uint8Array.from(t.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))), (c: string) => c.charCodeAt(0));
      return new TextDecoder(cs).decode(bytes);
    } catch { return t; }
  });
}
function addrs(v: string) {
  const out: { nombre: string; mail: string }[] = [];
  const re = /(?:"?([^"<,]*?)"?\s*)?<([^>]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decodeWords(v || "")))) {
    const mail = (m[2] || m[3] || "").trim();
    if (mail) out.push({ nombre: (m[1] || "").trim().replace(/^'|'$/g, "") || mail, mail });
  }
  return out;
}
function slim(acc: Acc, m: any) {
  const labels: string[] = m.labelIds || [];
  const de = addrs(hdr(m, "From"))[0] || { nombre: "", mail: "" };
  const parts: any[] = [];
  (function walk(p: any) { if (!p) return; parts.push(p); (p.parts || []).forEach(walk); })(m.payload);
  const adj = parts.some((p) => p.filename && p.body?.attachmentId && !/^inline/i.test(String((p.headers || []).find((h: any) => /content-disposition/i.test(h.name))?.value || "")));
  return {
    id: PFX(acc, m.id), asunto: decodeWords(hdr(m, "Subject")) || "(sin asunto)", de, para: addrs(hdr(m, "To")), cc: addrs(hdr(m, "Cc")),
    fecha: new Date(Number(m.internalDate) || Date.parse(hdr(m, "Date")) || Date.now()).toISOString(),
    leido: !labels.includes("UNREAD"), adj, bandera: labels.includes("STARRED"),
    prev: decodeEnt(String(m.snippet || "")).replace(/\s+/g, " ").slice(0, 220), conv: PFX(acc, m.threadId),
    imp: false, borrador: labels.includes("DRAFT"), carpeta: labels.includes("INBOX") ? PFX(acc, "INBOX") : null, verbo: 0,
    cuenta: PFX(acc, "cuenta"), cuentaMail: acc.email, cuentaColor: acc.color || null,
    mio: de.mail.toLowerCase() === acc.email.toLowerCase(),
  };
}
const decodeEnt = (t: string) => t.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/gi, "&");
function htmlToText(h: string) {
  return decodeEnt(String(h || "").replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function cleanHtml(h: string) {
  return String(h || "")
    .replace(/<(script|iframe|object|embed|form|frameset|frame|applet)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '$1="#"')
    .slice(0, 400000);
}
// texto citado de Gmail: <div class="gmail_quote">… / «El … escribió:»
function sinCita(html: string) {
  const i = html.search(/<div[^>]*class="[^"]*gmail_quote[^"]*"|<blockquote[^>]*class="[^"]*gmail_quote|<div[^>]*id="?(x_)?divRplyFwdMsg|<div[^>]*id="?appendonsend/i);
  return i > 0 ? html.slice(0, i) : html;
}
function textoSinCita(t: string) {
  const i = t.search(/\n\s*(El .{5,200}(escribió|wrote):|On .{5,200}wrote:|-{2,}\s*(Mensaje original|Original Message|Forwarded message|Mensaje reenviado)\s*-{2,}|De:\s.+\n\s*(Enviado|Fecha|Sent):)/i);
  return i > 0 ? t.slice(0, i).trim() : t;
}
function partsOf(m: any) {
  const out: any[] = [];
  (function walk(p: any) { if (!p) return; out.push(p); (p.parts || []).forEach(walk); })(m.payload);
  return out;
}
const partHdr = (p: any, n: string) => String((p.headers || []).find((h: any) => h.name.toLowerCase() === n)?.value || "");
const bodyText = (p: any) => {
  if (!p?.body?.data) return "";
  const bytes = b64ToBytes(p.body.data);
  const cs = /charset="?([^";]+)/i.exec(partHdr(p, "content-type"))?.[1] || "utf-8";
  try { return new TextDecoder(cs).decode(bytes); } catch { return fromUtf8(bytes); }
};
function adjuntosDe(acc: Acc, m: any) {
  return partsOf(m).filter((p) => p.filename && p.body?.attachmentId && !/^inline/i.test(partHdr(p, "content-disposition")))
    .map((p) => ({ id: p.partId, nombre: p.filename, tam: p.body.size || 0, tipo: p.mimeType }));
}
async function full(ctx: Ctx, m: any, presupuesto: { n: number }, conCompleto: boolean) {
  const ps = partsOf(m);
  const htmlP = ps.find((p) => p.mimeType === "text/html" && !p.filename);
  const textP = ps.find((p) => p.mimeType === "text/plain" && !p.filename);
  const fullH = htmlP ? bodyText(htmlP) : "";
  const completo = (htmlP ? htmlToText(fullH) : bodyText(textP)).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 40000);
  const nuevo = textoSinCita(htmlP ? htmlToText(sinCita(fullH)) : completo).slice(0, 40000) || completo;
  const conCita = completo.length > nuevo.length + 40;
  let html = fullH ? cleanHtml(sinCita(fullH)) : "";
  let htmlCompleto = fullH && conCita && conCompleto ? cleanHtml(fullH) : "";
  // imágenes internas (cid:) dentro del correo
  if ((html || htmlCompleto) && /cid:/i.test(html + htmlCompleto)) {
    const inl = ps.filter((p) => p.body?.attachmentId && partHdr(p, "content-id") && (p.body.size || 0) < 400000).slice(0, 8);
    for (const p of inl) {
      if (presupuesto.n < (p.body.size || 0)) break;
      const a = await gm(ctx, `/messages/${okGid(m.id)}/attachments/${encodeURIComponent(p.body.attachmentId)}`).catch(() => null);
      if (!a?.data) continue;
      presupuesto.n -= p.body.size || 0;
      const cid = partHdr(p, "content-id").replace(/^<|>$/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const uri = `data:${p.mimeType || "image/png"};base64,${b64urlToB64(a.data)}`;
      html = html.replace(new RegExp(`cid:${cid}`, "gi"), uri); htmlCompleto = htmlCompleto.replace(new RegExp(`cid:${cid}`, "gi"), uri);
    }
  }
  return { cuerpo: nuevo, citado: conCita ? completo : "", html, htmlCompleto, adjuntos: adjuntosDe(ctx.acc, m) };
}
const enlace = (acc: Acc, threadId: string) => `https://mail.google.com/mail/u/${encodeURIComponent(acc.email)}/#all/${threadId}`;

/* ---------- carpetas (etiquetas) ---------- */
const SYS = [["INBOX", "Recibidos"], ["STARRED", "Destacados"], ["SENT", "Enviados"], ["DRAFT", "Borradores"], ["SPAM", "Spam"], ["TRASH", "Papelera"]];
async function carpetas(ctx: Ctx) {
  const all = (await gm(ctx, "/labels"))?.labels || [];
  const user = all.filter((l: any) => l.type === "user" && l.labelListVisibility !== "labelHide").slice(0, 60);
  const want = [...SYS.map(([id]) => id), ...user.map((l: any) => l.id)];
  const det = await pool(want, 8, (id) => gm(ctx, `/labels/${encodeURIComponent(id)}`).catch(() => null));
  const out: any[] = [];
  SYS.forEach(([id, nombre], i) => { const d = det[i]; if (d) out.push({ id: PFX(ctx.acc, id), nombre, sys: true, gwk: id, noLeidos: id === "SENT" || id === "DRAFT" || id === "TRASH" ? 0 : d.messagesUnread || 0, total: id === "DRAFT" ? d.messagesTotal || 0 : d.messagesTotal || 0 }); });
  user.forEach((l: any, k: number) => { const d = det[SYS.length + k]; out.push({ id: PFX(ctx.acc, l.id), nombre: l.name, noLeidos: d?.messagesUnread || 0, total: d?.messagesTotal || 0 }); });
  return { carpetas: out, cuenta: ctx.acc.email };
}

/* ---------- lista ---------- */
async function lista(ctx: Ctx, b: any) {
  let p: any;
  if (b.next) {
    const { id } = parseRef(b.next);
    p = JSON.parse(fromUtf8(b64ToBytes(id)));
  } else {
    const label = b.carpeta ? parseRef(b.carpeta).id : "INBOX";
    const qs: string[] = [];
    const q = String(b.q || "").replace(/["\\]/g, " ").trim().slice(0, 120);
    if (q) qs.push(q); else qs.push("newer_than:90d");
    if (b.ver === "noleidos") qs.push("is:unread");
    if (b.bandera) qs.push("is:starred");
    if (b.adjuntos) qs.push("has:attachment");
    p = { label: q ? null : okGid(label), q: qs.join(" "), t: "" };
  }
  const u = new URLSearchParams({ maxResults: "40", q: p.q });
  if (p.label) u.set("labelIds", p.label);
  if (p.t) u.set("pageToken", p.t);
  if (p.label === "SPAM" || p.label === "TRASH") u.set("includeSpamTrash", "true");
  const j = await gm(ctx, `/messages?${u}`);
  const ids: string[] = (j?.messages || []).map((m: any) => m.id);
  const meta = "&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date";
  const ms = await pool(ids, 10, (id) => gm(ctx, `/messages/${okGid(id)}?format=metadata${meta}`).catch(() => null));
  const items = ms.filter(Boolean).map((m) => slim(ctx.acc, m)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const next = j?.nextPageToken ? PFX(ctx.acc, b64url(utf8(JSON.stringify({ ...p, t: j.nextPageToken })))) : null;
  return { items, next };
}

/* ---------- hilo / abrir / adjunto ---------- */
async function hilo(ctx: Ctx, b: any) {
  const tid = okGid(parseRef(b.conv).id);
  const ligero = b.ligero === true;
  const t = await gm(ctx, `/threads/${tid}?format=${ligero ? "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date" : "full"}`);
  const msgs = (t?.messages || []).filter((m: any) => !(m.labelIds || []).includes("DRAFT")).sort((x: any, y: any) => Number(y.internalDate) - Number(x.internalDate));
  const presupuesto = { n: 3 * 1024 * 1024 };
  const out = await Promise.all(msgs.map(async (m: any, i: number) => {
    const s = slim(ctx.acc, m);
    if (ligero) return s;
    return { ...s, ...(await full(ctx, m, presupuesto, i === 0)), enlace: enlace(ctx.acc, m.threadId) };
  }));
  if (b.marcar !== false && !ligero && msgs.some((m: any) => (m.labelIds || []).includes("UNREAD"))) {
    await gm(ctx, `/threads/${tid}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) }).catch(() => null);
    for (const m of out) m.leido = true;
  }
  return { mensajes: out };
}
async function abrir(ctx: Ctx, b: any) {
  const id = okGid(parseRef(b.id).id);
  const m = await gm(ctx, `/messages/${id}?format=full`);
  if ((m.labelIds || []).includes("UNREAD") && b.marcar !== false) await gm(ctx, `/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) }).catch(() => null);
  const f = await full(ctx, m, { n: 3 * 1024 * 1024 }, true);
  return { ...slim(ctx.acc, m), leido: true, cuerpo: f.citado || f.cuerpo, adjuntos: f.adjuntos, enlace: enlace(ctx.acc, m.threadId) };
}
async function adjunto(ctx: Ctx, b: any) {
  const id = okGid(parseRef(b.id).id);
  const m = await gm(ctx, `/messages/${id}?format=full`);
  const p = partsOf(m).find((x) => x.partId === String(b.aid));
  if (!p?.body?.attachmentId) throw new Error("No se encuentra ese adjunto");
  if ((p.body.size || 0) > 12 * 1024 * 1024) throw new Error("El adjunto es muy grande; ábrelo en Gmail");
  const a = await gm(ctx, `/messages/${id}/attachments/${encodeURIComponent(p.body.attachmentId)}`);
  return { nombre: p.filename, tipo: p.mimeType || "application/octet-stream", b64: b64urlToB64(a.data) };
}

/* ---------- marcar, destacar, mover ---------- */
const idList = (b: any) => (Array.isArray(b.ids) && b.ids.length ? b.ids : [b.id]).slice(0, 50).map((x: string) => okGid(parseRef(x).id));
async function modify(ctx: Ctx, ids: string[], add: string[], remove: string[]) {
  if (!ids.length) return;
  await gm(ctx, `/messages/batchModify`, { method: "POST", body: JSON.stringify({ ids, addLabelIds: add, removeLabelIds: remove }) });
}
async function mover(ctx: Ctx, b: any) {
  const ids = idList(b);
  const d = String(b.destino || "");
  if (d === "deleteditems" || /~TRASH$/.test(d)) { await pool(ids, 5, (id) => gm(ctx, `/messages/${id}/trash`, { method: "POST" })); return { ok: true, movidos: ids.length }; }
  if (d === "archive") { await modify(ctx, ids, [], ["INBOX"]); return { ok: true, movidos: ids.length }; }
  if (d !== "inbox" && d !== "junkemail" && !/^g~/.test(d)) throw new Error("Este correo es de Gmail: para moverlo a una etiqueta, ábrelo desde la pestaña Gmail");
  const label = d === "inbox" ? "INBOX" : d === "junkemail" ? "SPAM" : okGid(parseRef(d).id);
  // mover = poner la etiqueta y quitarla de Recibidos (como «Mover a» de Gmail)
  await modify(ctx, ids, [label], label === "INBOX" ? ["SPAM", "TRASH"] : ["INBOX"]);
  return { ok: true, movidos: ids.length };
}
async function carpetaNueva(ctx: Ctx, b: any) {
  const nombre = String(b.nombre || "").trim().slice(0, 120);
  if (!nombre) throw new Error("Pon un nombre a la carpeta");
  const l = await gm(ctx, `/labels`, { method: "POST", body: JSON.stringify({ name: nombre, labelListVisibility: "labelShow", messageListVisibility: "show" }) })
    .catch((e) => { if (e.status === 409) throw new Error(`Ya tienes una etiqueta «${nombre}»`); throw e; });
  return { id: PFX(ctx.acc, l.id), nombre: l.name };
}

/* ---------- redactar (MIME) ---------- */
const escH = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) => `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:small">${String(t || "").split(/\n/).map((l) => escH(l) || "<br>").join("<br>")}</div>`;
const addrList = (s: unknown) => String(s || "").split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(x));
const encWord = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${bytesToB64(utf8(s))}?=`;
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
async function firmaDe(ctx: Ctx): Promise<string> {
  const st = ctx.acc.state || {};
  if (st.firma_at && Date.now() - new Date(st.firma_at).getTime() < 7 * 864e5) return st.firma || "";
  let firma = "";
  try {
    const j = await gm(ctx, `/settings/sendAs`);
    const me = (j?.sendAs || []).find((x: any) => x.isPrimary) || (j?.sendAs || [])[0];
    firma = String(me?.signature || "");
    if (me?.displayName && !ctx.acc.nombre) await db.from("gmail_accounts").update({ nombre: me.displayName }).eq("id", ctx.acc.id).eq("owner", ctx.acc.owner);
  } catch { /* sin firma */ }
  await db.from("gmail_accounts").update({ state: { ...st, firma, firma_at: iso() } }).eq("id", ctx.acc.id).eq("owner", ctx.acc.owner);
  return firma;
}
async function redactar(ctx: Ctx, b: any) {
  const tipo = String(b.tipo || "");
  const enviar = b.enviar === true;
  if (b.programar) throw new Error("Gmail no deja programar el envío desde otra aplicación. Envíalo ahora o guárdalo en Borradores.");
  const texto = String(b.texto || "").trimEnd();
  const firma = await firmaDe(ctx);
  let to: string[] = addrList(b.para), cc: string[] = addrList(b.cc), asunto = String(b.asunto || "").slice(0, 250);
  let threadId = "", inReply = "", refs = "", cita = "";
  if (tipo !== "nuevo") {
    if (!["responder", "todos", "reenviar"].includes(tipo)) throw new Error("Tipo de respuesta no válido");
    const id = okGid(parseRef(b.id).id);
    const m = await gm(ctx, `/messages/${id}?format=full`);
    threadId = m.threadId;
    inReply = hdr(m, "Message-ID") || hdr(m, "Message-Id");
    refs = [hdr(m, "References"), inReply].filter(Boolean).join(" ").trim();
    const subj = decodeWords(hdr(m, "Subject"));
    const yo = ctx.acc.email.toLowerCase();
    if (tipo === "reenviar") asunto = /^(rv|fwd?):/i.test(subj) ? subj : `RV: ${subj}`;
    else {
      asunto = /^(re):/i.test(subj) ? subj : `RE: ${subj}`;
      if (b.destinatarios !== true) {
        const from = addrs(hdr(m, "Reply-To") || hdr(m, "From")).map((x) => x.mail);
        to = tipo === "todos" ? [...from, ...addrs(hdr(m, "To")).map((x) => x.mail)] : from;
        if (tipo === "todos") cc = [...addrs(hdr(m, "Cc")).map((x) => x.mail), ...cc];
      }
      to = to.filter((x) => x.toLowerCase() !== yo); cc = cc.filter((x) => x.toLowerCase() !== yo && !to.includes(x));
    }
    const f = await full(ctx, m, { n: 0 }, true);
    const original = f.htmlCompleto || f.html || toHtml(f.citado || f.cuerpo);
    const de = addrs(hdr(m, "From"))[0];
    const fecha = new Date(Number(m.internalDate)).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "short" });
    cita = tipo === "reenviar"
      ? `<br><div class="gmail_quote">---------- Mensaje reenviado ---------<br>De: ${escH(de?.nombre || "")} &lt;${escH(de?.mail || "")}&gt;<br>Fecha: ${escH(fecha)}<br>Asunto: ${escH(subj)}<br>Para: ${escH(hdr(m, "To"))}<br><br>${original}</div>`
      : `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">El ${escH(fecha)}, ${escH(de?.nombre || de?.mail || "")} &lt;${escH(de?.mail || "")}&gt; escribió:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${original}</blockquote></div>`;
    // al reenviar van también los adjuntos del original
    if (tipo === "reenviar") {
      const ps = partsOf(m).filter((p) => p.filename && p.body?.attachmentId).slice(0, 10);
      b.__fwd = await pool(ps, 3, async (p: any) => {
        const a = await gm(ctx, `/messages/${id}/attachments/${encodeURIComponent(p.body.attachmentId)}`);
        return { nombre: p.filename, tipo: p.mimeType, b64: b64urlToB64(a.data), inline: !!partHdr(p, "content-id"), cid: partHdr(p, "content-id").replace(/^<|>$/g, "") };
      });
    }
  }
  if (enviar && !to.length) throw new Error(tipo === "reenviar" ? "Falta a quién reenviarlo («Para»)" : "Falta al menos un destinatario en «Para»");
  if (enviar && !texto && tipo !== "reenviar") throw new Error("El correo está vacío");
  const adj = [...(Array.isArray(b.adjuntos) ? b.adjuntos : []), ...(b.__fwd || [])].slice(0, 30);
  const total = adj.reduce((s: number, a: any) => s + Math.floor(String(a.b64 || "").length * 0.75), 0);
  if (total > 24 * 1024 * 1024) throw new Error("Los adjuntos pasan de 25 MB, el máximo de Gmail");
  const imgs = adj.filter((a: any) => a.inline && a.cid && /^[A-Za-z0-9._@-]{1,120}$/.test(a.cid) && (b.adjuntos || []).includes(a))
    .map((a: any) => `<div><img src="cid:${a.cid}" style="max-width:100%;height:auto"></div>`).join("");
  const html = `<html><body>${toHtml(texto)}${imgs}${firma ? `<br><div class="gmail_signature">${firma}</div>` : ""}${cita}</body></html>`;
  const plain = `${texto}\n`;
  const B1 = "sq_mixed_" + crypto.randomUUID(), B2 = "sq_alt_" + crypto.randomUUID();
  const nombre = ctx.acc.nombre ? `${encWord(ctx.acc.nombre)} <${ctx.acc.email}>` : ctx.acc.email;
  const L: string[] = [
    `From: ${nombre}`, ...(to.length ? [`To: ${to.join(", ")}`] : []), ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encWord(asunto)}`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    ...(inReply && tipo !== "reenviar" ? [`In-Reply-To: ${inReply}`, `References: ${refs}`] : []),
    `Content-Type: multipart/mixed; boundary="${B1}"`, "",
    `--${B1}`, `Content-Type: multipart/alternative; boundary="${B2}"`, "",
    `--${B2}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(bytesToB64(utf8(plain))),
    `--${B2}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(bytesToB64(utf8(html))),
    `--${B2}--`,
  ];
  for (const a of adj) {
    const fn = String(a.nombre || "archivo").replace(/["\r\n]/g, "").slice(0, 200);
    const ct = /^[\w.+-]+\/[\w.+-]+$/.test(String(a.tipo || "")) ? a.tipo : "application/octet-stream";
    L.push(`--${B1}`, `Content-Type: ${ct}; name="${encWord(fn)}"`, `Content-Disposition: ${a.inline && a.cid ? "inline" : "attachment"}; filename="${encWord(fn)}"`,
      ...(a.inline && a.cid ? [`Content-ID: <${String(a.cid).replace(/[<>\r\n]/g, "")}>`] : []), "Content-Transfer-Encoding: base64", "", wrap76(String(a.b64 || "").replace(/\s/g, "")));
  }
  L.push(`--${B1}--`, "");
  const raw = L.join("\r\n");
  // subida multipart (admite hasta 35 MB y mantiene el hilo con threadId)
  const BB = "sq_up_" + crypto.randomUUID();
  const meta = enviar ? (threadId ? { threadId } : {}) : { message: threadId ? { threadId } : {} };
  const body = `--${BB}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${BB}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--${BB}--`;
  const r = await gm(ctx, enviar ? `/messages/send?uploadType=multipart` : `/drafts?uploadType=multipart`, { method: "POST", body: utf8(body), headers: { "Content-Type": `multipart/related; boundary=${BB}` } }, GMU);
  if (enviar) {
    await audit(ctx.acc.owner, "gmail.enviar", { cuenta: ctx.acc.email, tipo, para: to.length, cc: cc.length, adjuntos: adj.length });
    return { enviado: true, programado: null };
  }
  return { borrador: true, enlace: `https://mail.google.com/mail/u/${encodeURIComponent(ctx.acc.email)}/#drafts?compose=${r?.message?.id || ""}` };
}

/* ---------- personas (de tus correos de Gmail) ---------- */
async function personas(ctx: Ctx, b: any) {
  const q = String(b.q || "").replace(/["\\()]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return { personas: [] };
  const j = await gm(ctx, `/messages?maxResults=15&q=${encodeURIComponent(`from:${q} OR to:${q} OR cc:${q}`)}`).catch(() => null);
  const ms = await pool((j?.messages || []).map((m: any) => m.id), 8, (id: string) => gm(ctx, `/messages/${okGid(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`).catch(() => null));
  const seen = new Map<string, { nombre: string; mail: string }>();
  const ql = q.toLowerCase();
  for (const m of ms) if (m) for (const p of [...addrs(hdr(m, "From")), ...addrs(hdr(m, "To")), ...addrs(hdr(m, "Cc"))])
    if (p.mail.toLowerCase() !== ctx.acc.email.toLowerCase() && (p.mail.toLowerCase().includes(ql) || p.nombre.toLowerCase().includes(ql)) && !seen.has(p.mail.toLowerCase())) seen.set(p.mail.toLowerCase(), p);
  return { personas: [...seen.values()].slice(0, 8) };
}

/* ---------- cuentas ---------- */
const pub = (a: any) => ({ id: a.id, ref: `g~${a.id}~cuenta`, email: a.email, nombre: a.nombre || null, color: a.color, conectada: a.last_error !== "revocado", desde: a.connected_at });
async function cuentas(owner: string) {
  const { data } = await db.from("gmail_accounts").select("id,email,nombre,color,connected_at,last_error").eq("company_id", COMPANY).eq("owner", owner).order("connected_at");
  return { cuentas: (data || []).map(pub), configurado: !!(CLIENT_ID && CLIENT_SECRET && TOKEN_KEY) };
}
async function conectar(owner: string, b: any) {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("Falta terminar la configuración de Google (cliente OAuth). En cuanto esté, podrás conectar Gmail.");
  const state = await sign({ o: owner, e: Date.now() + 10 * 60000, n: crypto.randomUUID(), h: String(b.hint || "").slice(0, 200) });
  const u = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES, access_type: "offline",
    include_granted_scopes: "true", prompt: "consent select_account", state,
  });
  if (b.hint && /@/.test(String(b.hint))) u.set("login_hint", String(b.hint));
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${u}` };
}
async function desconectar(owner: string, b: any) {
  const id = parseRef(b.cuenta).acc;
  const { data: a } = await db.from("gmail_accounts").select("*").eq("company_id", COMPANY).eq("owner", owner).eq("id", id).maybeSingle();
  if (!a) return { ok: true };
  try { const rt = await decrypt(a.refresh_token); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: "POST" }); } catch { /* ya no valía */ }
  await db.from("gmail_accounts").delete().eq("company_id", COMPANY).eq("owner", owner).eq("id", id);
  tokCache.delete(id);
  await audit(owner, "gmail.desconectar", { cuenta: a.email });
  return { ok: true };
}
async function callback(url: URL) {
  const back = (q: string) => Response.redirect(`${APP_URL}/mi.html?${q}#correo`, 302);
  const err = url.searchParams.get("error");
  const st = await unsign(url.searchParams.get("state") || "").catch(() => null);
  if (!st) return back("gmail=error&motivo=caducado");
  if (err) return back(`gmail=error&motivo=${encodeURIComponent(err === "access_denied" ? "cancelado" : err)}`);
  try {
    const tok = await tokenRequest({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: REDIRECT });
    if (!String(tok.scope || "").includes("gmail.modify")) return back("gmail=error&motivo=permisos");
    const u = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    const email = String(u.email || "").toLowerCase();
    if (!email) return back("gmail=error&motivo=sin-correo");
    const { data: prev } = await db.from("gmail_accounts").select("id,refresh_token,color").eq("company_id", COMPANY).eq("owner", st.o).eq("email", email).maybeSingle();
    if (!tok.refresh_token && !prev) return back("gmail=error&motivo=sin-permiso-offline");
    const { count } = await db.from("gmail_accounts").select("id", { count: "exact", head: true }).eq("company_id", COMPANY).eq("owner", st.o);
    const row = {
      company_id: COMPANY, owner: st.o, email, nombre: u.name || null, scopes: tok.scope,
      refresh_token: tok.refresh_token ? await encrypt(tok.refresh_token) : prev!.refresh_token,
      color: prev?.color || COLORES[(count || 0) % COLORES.length], connected_at: iso(), last_ok: iso(), last_error: null,
    };
    const { data: saved, error } = await db.from("gmail_accounts").upsert(row, { onConflict: "owner,email" }).select("id").single();
    if (error) throw error;
    tokCache.set(saved.id, { token: tok.access_token, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000 });
    await audit(st.o, "gmail.conectar", { cuenta: email });
    return back(`gmail=ok&cuenta=${encodeURIComponent(`g~${saved.id}~cuenta`)}`);
  } catch (e) {
    console.error("gmail callback", (e as Error).message);
    return back("gmail=error&motivo=google");
  }
}

/* ---------- servidor ---------- */
async function userFrom(req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const { data } = await db.auth.getUser(tok);
  return data.user || null;
}
async function accion(ctx: Ctx, b: any) {
  switch (b.op) {
    case "carpetas": return await carpetas(ctx);
    case "lista": return await lista(ctx, b);
    case "hilo": return await hilo(ctx, b);
    case "abrir": return await abrir(ctx, b);
    case "adjunto": return await adjunto(ctx, b);
    case "leido": { const v = b.valor !== false; await modify(ctx, idList(b), v ? [] : ["UNREAD"], v ? ["UNREAD"] : []); return { ok: true }; }
    case "bandera": { const v = b.valor !== false; await modify(ctx, idList(b), v ? ["STARRED"] : [], v ? [] : ["STARRED"]); return { ok: true }; }
    case "mover": return await mover(ctx, b);
    case "eliminar": return await mover(ctx, { ...b, destino: "deleteditems" });
    case "carpetaNueva": return await carpetaNueva(ctx, b);
    case "redactar": return await redactar(ctx, b);
    case "personas": return await personas(ctx, b);
  }
  throw new Error("Esta operación todavía no está disponible para Gmail");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/callback")) return await callback(url);
  if (req.method !== "POST") return json({ error: "método" }, 405);
  const body = await req.json().catch(() => ({}));
  const user = await userFrom(req);
  if (!user) return json({ error: "Inicia sesión" }, 401);
  const { data: member } = await db.from("members").select("email").eq("email", (user.email || "").toLowerCase()).maybeSingle();
  if (!member) return json({ error: "No eres miembro de Synqalia" }, 403);
  try {
    if (body.op === "cuentas") return json(await cuentas(user.id));
    if (body.op === "conectar") return json(await conectar(user.id, body));
    if (body.op === "desconectar") return json(await desconectar(user.id, body));
    const accId = accRef(body);
    if (!accId) return json({ error: "Falta la cuenta de Gmail" }, 400);
    const { data: a } = await db.from("gmail_accounts").select("*").eq("company_id", COMPANY).eq("owner", user.id).eq("id", accId).maybeSingle();
    if (!a) return json({ error: "Esa cuenta de Gmail no está conectada" }, 400);
    return json(await accion(await ctxOf(a as Acc), body));
  } catch (e) {
    const err = e as any;
    if (err.status === 401) tokCache.clear();
    return json({ error: err.status === 404 ? "Ese correo ya no está ahí (quizá se movió o se borró)" : String(err.message || "").slice(0, 300) }, 400);
  }
});
