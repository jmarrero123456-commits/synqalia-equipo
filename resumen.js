/* synqalia · Resumen del grupo de trabajo
   Objetivos (objetivo / conseguido / previsión ponderada), embudo por etapas con probabilidad editable,
   captación, «necesita atención» y «esta semana». Se carga desde index.html (import) y recibe el contexto C. */

const MIGRATED_BEFORE = '2026-11-16T18:30:00Z'; // fechas de updated_at anteriores = importación desde Monday, no son movimiento real
const DAY = 86400000;
const STAGE_TYPES = { open: 'Abierta', won: 'Ganada (firmado)', lost: 'Perdida / descartada', out: 'Fuera del embudo' };

let C; // contexto que pasa index.html
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmtV = (g, n) => (g.metric === 'count' ? Math.round(n).toLocaleString('es-ES') : C.fmtE(Math.round(n)) || '0 €');

/* ---------- etapas ---------- */
export function defStage(g) {
  const t = (g.title || '').toLowerCase();
  if (/firmad|ganad|finalizad|on live|completad/.test(t)) return { type: 'won', prob: 100 };
  if (/descart|perdid|cancel|rechaz/.test(t)) return { type: 'lost', prob: 0 };
  if (/otros temas|^tareas/.test(t)) return { type: 'out', prob: 0 };
  if (/negociaci|loi|reserva|propuesta/.test(t)) return { type: 'open', prob: 50 };
  if (/total proyectos/.test(t)) return { type: 'open', prob: 20 };
  if (/en curso/.test(t)) return { type: 'open', prob: 30 };
  if (/seguimiento/.test(t)) return { type: 'open', prob: 15 };
  if (/filtro/.test(t)) return { type: 'open', prob: 10 };
  if (/stand ?by|fr[ií]o|correo/.test(t)) return { type: 'open', prob: 3 };
  if (/pendiente|nuevo|sin clasificar/.test(t)) return { type: 'open', prob: 5 };
  return g.closed ? { type: 'lost', prob: 0 } : { type: 'open', prob: 10 };
}
export function stageOf(b, gid) {
  const g = b.groups.find((x) => x.id === gid) || { title: '', id: gid };
  const s = b.settings?.stages?.[gid];
  const d = defStage(g);
  return { ...d, ...(s || {}), custom: !!s };
}

/* ---------- datos ---------- */
const lastMove = (it) => {
  const cand = [];
  if (it.updated_at && it.updated_at > MIGRATED_BEFORE) cand.push(it.updated_at);
  if (it.created_at && it.created_at > MIGRATED_BEFORE) cand.push(it.created_at);
  for (const k of ['fecha']) if (it.data?.[k] && /^\d{4}-\d{2}-\d{2}/.test(it.data[k])) cand.push(it.data[k]);
  return cand.sort().pop() || null;
};
const firstDateCol = (b) => b.columns.find((c) => c.type === 'date');
function goalItems(g) {
  const out = [];
  for (const bid of g.board_ids || []) {
    const b = C.board(Number(bid)); if (!b) continue;
    const dc = firstDateCol(b);
    for (const it of C.topItems(b.id)) {
      if (g.filter?.key && g.filter.value && (it.data?.[g.filter.key] || '') !== g.filter.value) continue;
      const st = stageOf(b, it.group_id);
      const d = dc ? it.data?.[dc.key] : null;
      if (st.type === 'won' && d && g.year && String(d).slice(0, 4) !== String(g.year)) continue; // firmado en otro año
      out.push({ it, b, st, v: g.metric === 'count' ? 1 : num(it.data?.[g.value_key]) });
    }
  }
  return out;
}
export function computeGoal(g) {
  const rows = goalItems(g);
  const won = rows.filter((r) => r.st.type === 'won');
  const open = rows.filter((r) => r.st.type === 'open');
  const achieved = won.reduce((a, r) => a + (r.v || 0), 0);
  const weighted = open.reduce((a, r) => a + (r.v || 0) * (r.st.prob / 100), 0);
  const pipeline = open.reduce((a, r) => a + (r.v || 0), 0);
  const forecast = achieved + weighted;
  const now = new Date(); const y = Number(g.year) || now.getFullYear();
  const start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  // desglose por marca (u otra columna de estado común)
  const dimKey = rows.some((r) => r.it.data?.marca) ? 'marca' : null;
  const dims = {};
  if (dimKey) for (const r of rows) {
    if (r.st.type !== 'won' && r.st.type !== 'open') continue;
    const k = r.it.data?.[dimKey] || 'Sin marca';
    const d = (dims[k] ||= { k, won: 0, w: 0, n: 0, col: r.b.columns.find((c) => c.key === dimKey) });
    if (r.st.type === 'won') d.won += r.v || 0; else d.w += (r.v || 0) * (r.st.prob / 100);
    d.n++;
  }
  return {
    rows, won, open, achieved, weighted, pipeline, forecast, elapsed, daysLeft,
    pace: g.target * elapsed,
    wonNoValue: g.metric === 'sum' ? won.filter((r) => r.v == null) : [],
    openNoValue: g.metric === 'sum' ? open.filter((r) => r.v == null && r.st.prob >= 30) : [],
    dims: Object.values(dims).sort((a, b) => (b.won + b.w) - (a.won + a.w)),
  };
}

/* ---------- carga ---------- */
export async function loadGoals(ctx) {
  C = ctx || C;
  const { data, error } = await C.sb.from('goals').select('*').order('sort').order('id');
  C.S.goals = error ? [] : data || [];
  return C.S.goals;
}
const goalsOf = (sid) => (C.S.goals || []).filter((g) => g.space_id === sid);

/* ---------- estilos ---------- */
function css() {
  if (document.getElementById('rs-css')) return;
  const s = document.createElement('style'); s.id = 'rs-css';
  s.textContent = `
  .rs-goal { display:grid; gap:14px; }
  .rs-goal .gh { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .rs-goal .gh h3 { font-size:18px; } .rs-goal .gh .sub { flex:1; }
  .rs-nums { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
  .rs-nums div { background:var(--soft); border-radius:10px; padding:10px 12px; display:grid; gap:2px; }
  .rs-nums b { font:400 26px/1.1 var(--display); font-variant-numeric:tabular-nums; }
  .rs-nums span { color:var(--muted); font-size:12.5px; }
  .rs-nums .ok b { color:var(--ok); } .rs-nums .bad b { color:var(--bad); } .rs-nums .warn b { color:var(--warn); }
  .rs-track { position:relative; height:18px; background:var(--soft); border-radius:9px; overflow:visible; margin:8px 0 22px; }
  .rs-track .a { position:absolute; left:0; top:0; bottom:0; background:var(--ok); border-radius:9px 0 0 9px; }
  .rs-track .w { position:absolute; top:0; bottom:0; background:color-mix(in srgb, var(--ok) 35%, transparent); }
  .rs-track .m { position:absolute; top:-5px; bottom:-5px; width:2px; background:var(--ink); }
  .rs-track .m span { position:absolute; top:26px; transform:translateX(-50%); font-size:11px; color:var(--muted); white-space:nowrap; }
  .rs-track .p { position:absolute; top:-5px; bottom:-5px; width:0; border-left:2px dashed var(--warn); }
  .rs-track .p span { position:absolute; top:-18px; transform:translateX(-50%); font-size:11px; color:var(--warn); white-space:nowrap; }
  .rs-legend { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--muted); }
  .rs-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; vertical-align:-1px; margin-right:4px; }
  .rs-say { margin:0; font-size:14px; line-height:1.55; }
  .rs-chips { display:flex; gap:8px; flex-wrap:wrap; }
  .rs-chip { border:1px solid var(--line); background:var(--panel); border-radius:999px; padding:4px 11px; font-size:12.5px; cursor:pointer; }
  .rs-chip.warn { border-color:var(--warn); color:var(--warn); } .rs-chip:hover { border-color:var(--accent); }
  .rs-dim { display:grid; grid-template-columns:minmax(90px,140px) minmax(0,1fr) 170px; gap:10px; align-items:center; font-size:13px; padding:3px 0; }
  .rs-dim .t2 { position:relative; height:10px; background:var(--soft); border-radius:5px; overflow:hidden; }
  .rs-dim .t2 .a { position:absolute; left:0; top:0; bottom:0; background:var(--ok); }
  .rs-dim .t2 .w { position:absolute; top:0; bottom:0; background:color-mix(in srgb, var(--ok) 35%, transparent); }
  .rs-dim .v { text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
  table.rs-st { width:100%; border-collapse:collapse; font-size:13px; }
  table.rs-st th { text-align:left; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); font-weight:700; padding:6px 6px; border-bottom:1px solid var(--line); }
  table.rs-st td { padding:7px 6px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  table.rs-st tr[data-g] { cursor:pointer; } table.rs-st tr[data-g]:hover td { background:var(--soft); }
  table.rs-st td.n, table.rs-st th.n { text-align:right; }
  table.rs-st .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; }
  table.rs-st tr.tot td { font-weight:700; border-bottom:0; }
  .rs-sec { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); font-weight:700; margin:6px 0 -4px; }
  .rs-empty { border:1px dashed var(--line); border-radius:14px; padding:18px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .rs-empty p { margin:0; flex:1; min-width:220px; color:var(--muted); font-size:14px; }
  .rs-mini { display:grid; gap:6px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; cursor:pointer; }
  .rs-mini:hover { border-color:var(--accent); }
  .rs-mini .l { display:flex; justify-content:space-between; gap:10px; font-size:13px; flex-wrap:wrap; } .rs-mini .l span { color:var(--muted); }
  .rs-mini .rs-track { margin:2px 0 0; height:10px; }
  .gm-row { display:grid; gap:10px; border:1px solid var(--line); border-radius:12px; padding:12px; }
  .gm-row .two { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .gm-row .bx { display:flex; gap:14px; flex-wrap:wrap; font-size:14px; }
  .gm-row .bx label { display:inline-flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0; font-weight:500; color:var(--ink); font-size:14px; }
  .stg-r { display:grid; grid-template-columns:minmax(0,1fr) 190px 80px 40px; gap:8px; align-items:center; font-size:13px; padding:4px 0; border-bottom:1px solid var(--line); }
  .stg-r .n { color:var(--muted); text-align:right; }
  .stg-r input[type=number] { width:100%; }
  @media (max-width:700px) { .rs-nums { grid-template-columns:1fr 1fr; } .rs-dim { grid-template-columns:90px minmax(0,1fr); } .rs-dim .v { grid-column:1/-1; text-align:left; } .stg-r { grid-template-columns:1fr 1fr; } .gm-row .two { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(s);
}

/* ---------- piezas de pantalla ---------- */
function trackHtml(g, r, small = false) {
  const max = Math.max(g.target || 0, r.forecast, 1) * 1.04;
  const a = (r.achieved / max) * 100, w = (r.weighted / max) * 100, t = (g.target / max) * 100, p = (r.pace / max) * 100;
  return `<div class="rs-track"><div class="a" style="width:${a}%"></div><div class="w" style="left:${a}%;width:${w}%"></div>
    ${g.target ? `<div class="m" style="left:${t}%">${small ? '' : `<span>Objetivo ${fmtV(g, g.target)}</span>`}</div>` : ''}
    ${g.target && r.elapsed < 1 && r.elapsed > 0 ? `<div class="p" style="left:${p}%">${small ? '' : `<span>Ritmo a hoy ${fmtV(g, r.pace)}</span>`}</div>` : ''}</div>`;
}
function sayHtml(g, r) {
  const gap = g.target - r.achieved; const fgap = r.forecast - g.target;
  const parts = [];
  if (!g.target) return '<p class="rs-say">Aún no hay cifra de objetivo. Pulsa «Objetivos» para ponerla.</p>';
  if (gap <= 0) parts.push(`<b>Objetivo conseguido</b>: llevas ${fmtV(g, r.achieved)} (${pct(r.achieved, g.target)} %).`);
  else {
    parts.push(`Faltan <b>${fmtV(g, gap)}</b> para el objetivo${r.daysLeft ? ` en los ${r.daysLeft} días que quedan de ${g.year}` : ''}.`);
    const vsPace = r.achieved - r.pace;
    if (r.elapsed > 0 && r.elapsed < 1) parts.push(vsPace >= 0 ? `Vas <b>por delante del ritmo</b> (${fmtV(g, vsPace)} sobre lo que tocaría a hoy).` : `Vas <b>${fmtV(g, -vsPace)} por detrás del ritmo</b> que tocaría a hoy (${fmtV(g, r.pace)}).`);
    parts.push(fgap >= 0 ? `Con la cartera ponderada se llegaría a ${fmtV(g, r.forecast)}: <b>se cumpliría</b>.` : `Con la cartera ponderada se llegaría a ${fmtV(g, r.forecast)}: <b>faltarían ${fmtV(g, -fgap)}</b> de nuevas operaciones o de avanzar las que hay.`);
  }
  return `<p class="rs-say">${parts.join(' ')}</p>`;
}
function goalCard(g, r) {
  const ok = g.target > 0 && r.forecast >= g.target;
  const noT = !(g.target > 0);
  const boards = (g.board_ids || []).map((id) => C.board(Number(id))?.name).filter(Boolean).join(' + ');
  const filt = g.filter?.key && g.filter.value ? ` · solo ${g.filter.value}` : '';
  const chips = [];
  if (r.wonNoValue.length) chips.push(`<button class="rs-chip warn" data-nov="won-${g.id}">${r.wonNoValue.length} firmados sin ${esc(colTitle(g))}</button>`);
  if (r.openNoValue.length) chips.push(`<button class="rs-chip warn" data-nov="open-${g.id}">${r.openNoValue.length} en negociación sin ${esc(colTitle(g))}</button>`);
  const maxD = Math.max(1, ...r.dims.map((d) => d.won + d.w));
  return `<div class="card rs-goal">
    <div class="gh"><h3>${esc(g.title)}</h3><p class="sub">${esc(boards)}${esc(filt)} · ${g.metric === 'count' ? 'nº de operaciones' : 'suma de «' + esc(colTitle(g)) + '»'}</p></div>
    <div class="rs-nums">
      <div><b>${fmtV(g, g.target)}</b><span>Objetivo ${esc(String(g.year || ''))}</span></div>
      <div class="${!noT && r.achieved >= g.target ? 'ok' : ''}"><b>${fmtV(g, r.achieved)}</b><span>Firmado${noT ? '' : ` · ${pct(r.achieved, g.target)} %`} · ${r.won.length} operaciones</span></div>
      <div class="${noT ? '' : ok ? 'ok' : 'warn'}"><b>${fmtV(g, r.forecast)}</b><span>Previsión de cierre${noT ? '' : ` · ${pct(r.forecast, g.target)} %`}</span></div>
      ${noT ? '<div><b>—</b><span>Sin cifra de objetivo</span></div>' : `<div class="${ok ? 'ok' : 'bad'}"><b>${ok ? '+' : '−'}${fmtV(g, Math.abs(r.forecast - g.target))}</b><span>${ok ? 'Margen sobre objetivo' : 'Hueco a cubrir'}</span></div>`}
    </div>
    <div>${trackHtml(g, r)}<div class="rs-legend"><span><i style="background:var(--ok)"></i>Firmado</span><span><i style="background:color-mix(in srgb, var(--ok) 35%, transparent)"></i>Cartera ponderada (${fmtV(g, r.weighted)} de ${fmtV(g, r.pipeline)} en juego)</span><span><i style="background:var(--warn)"></i>Ritmo lineal a hoy</span></div></div>
    ${sayHtml(g, r)}
    ${chips.length ? `<div class="rs-chips">${chips.join('')}</div>` : ''}
    ${r.dims.length ? `<div><div class="rs-sec" style="margin-bottom:6px">Por marca · firmado + previsión</div>${r.dims.map((d) => `<div class="rs-dim"><span>${C.pill(d.col, d.k)}</span><div class="t2"><div class="a" style="width:${(d.won / maxD) * 100}%"></div><div class="w" style="left:${(d.won / maxD) * 100}%;width:${(d.w / maxD) * 100}%"></div></div><span class="v">${fmtV(g, d.won)} + ${fmtV(g, d.w)}</span></div>`).join('')}</div>` : ''}
  </div>`;
}
const esc = (s) => C.esc(s);
function colTitle(g) {
  for (const id of g.board_ids || []) { const c = C.board(Number(id))?.columns.find((x) => x.key === g.value_key); if (c) return c.title.toLowerCase(); }
  return g.value_key || 'valor';
}
function stagesCard(b, g) {
  const its = C.topItems(b.id);
  const vk = g?.value_key && b.columns.some((c) => c.key === g.value_key) ? g.value_key : b.columns.find((c) => c.type === 'number' && /canon|importe|valor/i.test(c.title))?.key;
  let tn = 0, tv = 0, tw = 0;
  const rows = b.groups.map((gr) => {
    const st = stageOf(b, gr.id); const gi = its.filter((i) => i.group_id === gr.id);
    const v = vk ? gi.reduce((a, i) => a + (num(i.data?.[vk]) || 0), 0) : 0;
    const w = st.type === 'won' ? v : st.type === 'open' ? v * st.prob / 100 : 0;
    if (st.type === 'open' || st.type === 'won') { tn += gi.length; tv += v; tw += w; }
    return `<tr data-g="${esc(gr.id)}" data-b="${b.id}"><td><span class="dot" style="background:${esc(gr.color || '#579bfc')}"></span>${esc(gr.title)}</td><td>${st.type === 'open' ? st.prob + ' %' : `<span class="tag muted">${st.type === 'won' ? 'Ganada' : st.type === 'lost' ? 'Perdida' : 'Fuera'}</span>`}</td><td class="n">${gi.length}</td>${vk ? `<td class="n">${v ? C.fmtE(v) : '—'}</td><td class="n">${w ? C.fmtE(Math.round(w)) : '—'}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="card" style="align-content:start"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div><h3>Embudo · ${esc(b.name)}</h3><p class="sub">Etapas del tablero con su probabilidad de firma</p></div><button class="btn sm" data-stages="${b.id}">Ajustar etapas</button></div>
    <table class="rs-st"><thead><tr><th>Etapa</th><th>Prob.</th><th class="n">Nº</th>${vk ? '<th class="n">Valor</th><th class="n">Ponderado</th>' : ''}</tr></thead><tbody>${rows}
    <tr class="tot"><td>Total en juego + firmado</td><td></td><td class="n">${tn}</td>${vk ? `<td class="n">${C.fmtE(tv)}</td><td class="n">${C.fmtE(Math.round(tw))}</td>` : ''}</tr></tbody></table></div>`;
}
function leadsCard(b) {
  const its = C.topItems(b.id);
  const d30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const nuevos = its.filter((i) => (i.data?.fecha || i.created_at || '').slice(0, 10) >= d30);
  const won = its.filter((i) => stageOf(b, i.group_id).type === 'won');
  const open = its.filter((i) => stageOf(b, i.group_id).type === 'open');
  const order = b.groups.filter((g) => stageOf(b, g.id).type === 'open');
  const max = Math.max(1, ...order.map((g) => its.filter((i) => i.group_id === g.id).length));
  return `<div class="card" style="align-content:start"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div><h3>Captación · ${esc(b.name)}</h3><p class="sub">${nuevos.length} leads nuevos en 30 días · ${open.length} vivos · ${won.length} firmados</p></div><button class="btn sm" data-stages="${b.id}">Ajustar etapas</button></div>
    <div class="bars">${order.map((g) => { const n = its.filter((i) => i.group_id === g.id).length; return `<div class="bar" data-b="${b.id}" data-g="${esc(g.id)}"><span>${esc(g.title)} <span class="sub">· ${stageOf(b, g.id).prob} %</span></span><div class="track"><div class="fill" style="width:${(n / max) * 100}%;background:${esc(g.color || '#579bfc')}"></div></div><span class="v">${n}</span></div>`; }).join('')}</div></div>`;
}
function attentionCard(sid) {
  const rows = [];
  const now = Date.now();
  const gb = new Set(goalsOf(sid).flatMap((g) => (g.board_ids || []).map(Number)));
  for (const b of C.S.boards.filter((x) => x.space_id === sid && (gb.has(x.id) || x.kind === 'leads' || x.kind === 'pipeline'))) {
    for (const it of C.topItems(b.id)) {
      const st = stageOf(b, it.group_id); if (st.type !== 'open' || st.prob < 10) continue;
      const lm = lastMove(it); if (!lm) continue;
      const days = Math.floor((now - new Date(lm)) / DAY);
      const lim = st.prob >= 30 ? 21 : 30;
      if (days > lim) rows.push({ it, b, st, days, why: `${days} días sin movimiento · ${C.groupOf(b, it.group_id)?.title || ''} (${st.prob} %)` });
    }
  }
  rows.sort((a, z) => z.st.prob - a.st.prob || z.days - a.days);
  if (!rows.length) return '';
  return `<div class="card" style="align-content:start"><h3>Parados</h3><p class="sub">Operaciones y leads vivos sin movimiento: más de 21 días si están avanzados (≥ 30 %), más de 30 días si no. Se mide por la última edición en synqalia o la fecha de la ficha.</p>
    <div class="rows">${rows.slice(0, 12).map((a) => `<div class="r" data-open="${a.it.id}"><span class="t">${esc(a.it.name)} <span class="tag muted">${esc(a.b.name)}</span></span><span class="tag late">${a.days} d</span><span class="d">${esc(a.why)}</span></div>`).join('')}</div>${rows.length > 12 ? `<p class="sub">Y ${rows.length - 12} más.</p>` : ''}</div>`;
}
async function weekCard(sid, host) {
  const ids = C.S.boards.filter((b) => b.space_id === sid).map((b) => b.id);
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const { data } = await C.sb.from('activity').select('*').in('board_id', ids).gte('created_at', since).order('created_at', { ascending: false }).limit(300);
  const el = host.querySelector('#rs-week'); if (!el) return;
  const acts = data || [];
  const won = [], moved = [], created = [];
  for (const a of acts) {
    const b = C.board(a.board_id); if (!b) continue;
    if (a.action === 'create') created.push(a);
    const mv = a.detail?._group;
    if (mv) {
      const to = stageOf(b, mv[1]);
      const e = { a, b, from: C.groupOf(b, mv[0])?.title || '—', to: C.groupOf(b, mv[1])?.title || '—' };
      if (to.type === 'won') won.push(e); else moved.push(e);
    }
  }
  const line = (e) => `<div class="r" data-open="${e.a.item_id}"><span class="t">${esc(e.a.item_name || '')} <span class="tag muted">${esc(e.b.name)}</span></span><span class="tag muted">${C.ago(e.a.created_at)}</span><span class="d">${esc(e.from)} → <b>${esc(e.to)}</b> · ${esc(C.member(e.a.actor_email)?.name.split(' ')[0] || e.a.actor_email || '')}</span></div>`;
  el.innerHTML = `<div class="rs-nums" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="${won.length ? 'ok' : ''}"><b>${won.length}</b><span>Pasan a ganada / firmada</span></div><div><b>${moved.length}</b><span>Cambios de etapa</span></div><div><b>${created.length}</b><span>Altas nuevas</span></div></div>
    ${won.length + moved.length ? `<div class="rows">${[...won, ...moved].slice(0, 10).map(line).join('')}</div>` : '<p class="sub">Sin cambios de etapa en los últimos 7 días.</p>'}`;
  el.querySelectorAll('[data-open]').forEach((r) => r.onclick = () => { const id = +r.dataset.open; if (C.S.items.find((i) => i.id === id)) C.openItem(id); });
}

/* ---------- pantalla: Resumen del grupo de trabajo ---------- */
export async function renderResumen(el, sid, ctx) {
  C = ctx || C; css();
  if (!C.S.goals) await loadGoals();
  const s = C.space(sid);
  const who = C.S.spaceMembers.filter((m) => m.space_id === sid).map((m) => C.member(m.email)?.name).filter(Boolean).join(', ');
  const goals = goalsOf(sid);
  const bs = C.S.boards.filter((b) => b.space_id === sid);
  const goalBoards = new Set(goals.flatMap((g) => (g.board_ids || []).map(Number)));
  const pipeBoards = bs.filter((b) => goalBoards.has(b.id));
  const leadBoards = bs.filter((b) => b.kind === 'leads' && !goalBoards.has(b.id));
  let h = `<div class="page">${C.headHtml(s?.name || 'Grupo de trabajo', esc([s?.description, who].filter(Boolean).join(' · ')), `<button class="btn sm" id="rs-goals">Objetivos</button><button class="btn sm" id="rs-stg">Etapas</button>`)}`;
  if (goals.length) {
    h += `<div class="rs-sec">Objetivos</div>`;
    h += goals.map((g) => goalCard(g, computeGoal(g))).join('');
  } else {
    h += `<div class="rs-empty"><p>Este grupo de trabajo aún no tiene objetivos. Pon uno (por ejemplo, canon firmado del año o nº de aperturas) y verás aquí objetivo, firmado y previsión.</p><button class="btn primary" id="rs-goals2">+ Añadir objetivo</button></div>`;
  }
  const cards = [...pipeBoards.map((b) => stagesCard(b, goals.find((g) => (g.board_ids || []).map(Number).includes(b.id)))), ...leadBoards.map(leadsCard), attentionCard(sid), `<div class="card" style="align-content:start"><h3>Esta semana</h3><p class="sub">Lo que se ha movido en los últimos 7 días</p><div id="rs-week"><div class="empty">Cargando…</div></div></div>`].filter(Boolean);
  if (cards.length) h += `<div class="rs-sec">Cómo va la cartera</div><div class="grid2">${cards.join('')}</div>`;
  h += `<div class="rs-sec">Detalle de los tableros</div><div id="rs-detail"></div></div>`;
  el.innerHTML = h;
  C.renderHomeInto(el.querySelector('#rs-detail'), sid);
  bind(el, sid);
  weekCard(sid, el);
}
function bind(el, sid) {
  const openBoard = (bid, gid) => { const b = C.board(bid); C.S.filters[bid] = { ...(C.S.filters[bid] || {}), q: '', person: null, status: null, late: false, group: gid || null, closed: !!gid && !!C.groupOf(b, gid)?.closed }; C.go({ kind: 'board', id: bid }); };
  el.querySelectorAll('tr[data-g], .bar[data-g]').forEach((r) => { if (!r.onclick) r.onclick = () => openBoard(+r.dataset.b, r.dataset.g); });
  el.querySelectorAll('[data-stages]').forEach((x) => x.onclick = () => editStages(sid, +x.dataset.stages));
  el.querySelectorAll('[data-open]').forEach((r) => { if (!r.onclick) r.onclick = () => C.openItem(+r.dataset.open); });
  el.querySelectorAll('[data-nov]').forEach((x) => x.onclick = () => {
    const [kind, id] = x.dataset.nov.split('-'); const g = (C.S.goals || []).find((z) => z.id === +id); if (!g) return;
    const r = computeGoal(g); const list = kind === 'won' ? r.wonNoValue : r.openNoValue;
    listModal(`${list.length} ${kind === 'won' ? 'firmados' : 'en negociación'} sin ${colTitle(g)}`, 'Ábrelos y rellena el valor para que cuenten en el objetivo y en la previsión.', list);
  });
  const g1 = el.querySelector('#rs-goals'), g2 = el.querySelector('#rs-goals2');
  if (g1) g1.onclick = () => editGoals(sid); if (g2) g2.onclick = () => editGoals(sid);
  const st = el.querySelector('#rs-stg'); if (st) st.onclick = () => editStages(sid);
}
function listModal(title, sub, list) {
  const r = document.getElementById('modal-root');
  r.innerHTML = `<div class="modal"><div class="box" style="width:min(560px,100%);max-height:85vh;overflow:auto"><h3>${esc(title)}</h3><p class="msg" style="margin:0">${esc(sub)}</p>
    <div class="rows">${list.map((x) => `<div class="r" data-open="${x.it.id}"><span class="t">${esc(x.it.name)}</span><span class="tag muted">${esc(x.b.name)}</span><span class="d">${esc(C.groupOf(x.b, x.it.group_id)?.title || '')}${x.it.data?.marca ? ' · ' + esc(x.it.data.marca) : ''}</span></div>`).join('')}</div>
    <div style="display:flex;justify-content:flex-end"><button class="btn" id="cx">Cerrar</button></div></div></div>`;
  r.querySelector('#cx').onclick = () => { r.innerHTML = ''; };
  r.querySelectorAll('[data-open]').forEach((x) => x.onclick = () => { r.innerHTML = ''; C.openItem(+x.dataset.open); });
}

/* ---------- editar etapas ---------- */
function editStages(sid, onlyBoard) {
  const bs = C.S.boards.filter((b) => b.space_id === sid && (!onlyBoard || b.id === onlyBoard));
  const r = document.getElementById('modal-root');
  const work = Object.fromEntries(bs.map((b) => [b.id, Object.fromEntries(b.groups.map((g) => [g.id, { ...stageOf(b, g.id) }]))]));
  r.innerHTML = `<div class="modal"><div class="box" style="width:min(640px,100%);max-height:88vh;overflow:auto"><h3>Etapas y probabilidad de firma</h3>
    <p class="msg" style="margin:0">Cada fase del tablero es una etapa. «Ganada» suma como firmado; las abiertas suman a la previsión con su %. Las fases se crean, renombran y ordenan desde el tablero (⋯ → Editar fases).</p>
    ${bs.map((b) => `<div><div class="rs-sec" style="margin:10px 0 4px">${esc(b.name)}</div>${b.groups.map((g) => { const s = work[b.id][g.id]; return `<div class="stg-r"><span><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(g.color || '#579bfc')};margin-right:6px"></span>${esc(g.title)}</span>
      <select class="input" data-ty="${b.id}|${esc(g.id)}">${Object.entries(STAGE_TYPES).map(([k, t]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="input" type="number" min="0" max="100" step="5" value="${s.type === 'open' ? s.prob : ''}" ${s.type === 'open' ? '' : 'disabled'} data-pr="${b.id}|${esc(g.id)}" title="% de probabilidad">
      <span class="n">${C.topItems(b.id).filter((i) => i.group_id === g.id).length}</span></div>`; }).join('')}</div>`).join('')}
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="cx">Cancelar</button><button class="btn primary" id="ok">Guardar</button></div></div></div>`;
  r.querySelectorAll('[data-ty]').forEach((x) => x.onchange = () => {
    const [bid, gid] = x.dataset.ty.split('|'); const s = work[bid][gid]; s.type = x.value;
    const pr = r.querySelector(`[data-pr="${CSS.escape(x.dataset.ty)}"]`);
    if (s.type === 'open') { pr.disabled = false; if (!pr.value) pr.value = s.prob = 10; } else { pr.disabled = true; pr.value = ''; s.prob = s.type === 'won' ? 100 : 0; }
  });
  r.querySelectorAll('[data-pr]').forEach((x) => x.oninput = () => { const [bid, gid] = x.dataset.pr.split('|'); work[bid][gid].prob = Math.max(0, Math.min(100, Math.round(+x.value || 0))); });
  r.querySelector('#cx').onclick = () => { r.innerHTML = ''; };
  r.querySelector('#ok').onclick = async () => {
    r.innerHTML = '';
    for (const b of bs) {
      const stages = Object.fromEntries(Object.entries(work[b.id]).map(([gid, s]) => [gid, { type: s.type, prob: s.type === 'open' ? s.prob : s.type === 'won' ? 100 : 0 }]));
      await C.saveBoard(b, { settings: { ...(b.settings || {}), stages } });
    }
    C.toast('Etapas guardadas'); C.renderMain();
  };
}

/* ---------- editar objetivos ---------- */
function editGoals(sid) {
  const bs = C.S.boards.filter((b) => b.space_id === sid);
  const year = new Date().getFullYear();
  let gs = goalsOf(sid).map((g) => ({ ...g, board_ids: (g.board_ids || []).map(Number), filter: { ...(g.filter || {}) } }));
  const removed = [];
  const numCols = (ids) => { const m = new Map(); for (const id of ids) for (const c of C.board(id)?.columns || []) if (c.type === 'number') m.set(c.key, c.title); return [...m]; };
  const stCols = (ids) => { const m = new Map(); for (const id of ids) for (const c of C.board(id)?.columns || []) if (c.type === 'status') { const e = m.get(c.key) || { title: c.title, opts: new Set() }; (c.options || []).forEach((o) => e.opts.add(o.label)); m.set(c.key, e); } return m; };
  const r = document.getElementById('modal-root');
  const draw = () => {
    r.innerHTML = `<div class="modal"><div class="box" style="width:min(640px,100%);max-height:88vh;overflow:auto"><h3>Objetivos de ${esc(C.space(sid)?.name || '')}</h3>
      <p class="msg" style="margin:0">Los puede cambiar cualquier persona del grupo de trabajo. El firmado se calcula con las etapas «ganadas» de los tableros que marques.</p>
      ${gs.map((g, i) => { const nc = numCols(g.board_ids); const sc = stCols(g.board_ids); const fopts = g.filter.key ? [...(sc.get(g.filter.key)?.opts || [])] : []; return `<div class="gm-row">
        <div class="two"><label class="field"><span>Nombre</span><input class="input" data-f="title" data-i="${i}" value="${esc(g.title)}"></label>
        <label class="field"><span>Año</span><input class="input" type="number" data-f="year" data-i="${i}" value="${esc(g.year || year)}"></label></div>
        <div class="two"><label class="field"><span>Qué se mide</span><select class="input" data-f="metric" data-i="${i}"><option value="sum" ${g.metric === 'sum' ? 'selected' : ''}>Suma de una columna (€)</option><option value="count" ${g.metric === 'count' ? 'selected' : ''}>Nº de operaciones</option></select></label>
        ${g.metric === 'sum' ? `<label class="field"><span>Columna</span><select class="input" data-f="value_key" data-i="${i}">${nc.length ? nc.map(([k, t]) => `<option value="${esc(k)}" ${g.value_key === k ? 'selected' : ''}>${esc(t)}</option>`).join('') : '<option value="">(los tableros marcados no tienen columnas numéricas)</option>'}</select></label>` : '<span></span>'}</div>
        <label class="field"><span>Objetivo</span><input class="input" type="number" min="0" step="any" data-f="target" data-i="${i}" value="${esc(g.target ?? '')}"></label>
        <div class="field"><span>Tableros que cuentan</span><div class="bx">${bs.map((b) => `<label><input type="checkbox" data-bd="${b.id}" data-i="${i}" ${g.board_ids.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div></div>
        <div class="two"><label class="field"><span>Filtrar por (opcional)</span><select class="input" data-f="fkey" data-i="${i}"><option value="">Sin filtro</option>${[...sc].map(([k, e]) => `<option value="${esc(k)}" ${g.filter.key === k ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
        ${g.filter.key ? `<label class="field"><span>Valor</span><select class="input" data-f="fval" data-i="${i}"><option value="">—</option>${fopts.map((o) => `<option ${g.filter.value === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : '<span></span>'}</div>
        <div style="display:flex;justify-content:flex-end"><button class="btn ghost sm danger" data-del="${i}">Quitar objetivo</button></div></div>`; }).join('')}
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><button class="btn" id="ga">+ Añadir objetivo</button><span><button class="btn" id="cx">Cancelar</button> <button class="btn primary" id="ok">Guardar</button></span></div></div></div>`;
    r.querySelectorAll('[data-f]').forEach((x) => x.onchange = () => {
      const g = gs[+x.dataset.i], f = x.dataset.f;
      if (f === 'fkey') { g.filter = x.value ? { key: x.value, value: '' } : {}; return draw(); }
      if (f === 'fval') { g.filter.value = x.value; return; }
      g[f] = f === 'target' || f === 'year' ? Number(x.value) : x.value;
      if (f === 'metric') { if (g.metric === 'sum' && !g.value_key) g.value_key = numCols(g.board_ids)[0]?.[0] || null; draw(); }
    });
    r.querySelectorAll('[data-bd]').forEach((x) => x.onchange = () => {
      const g = gs[+x.dataset.i], id = +x.dataset.bd;
      g.board_ids = x.checked ? [...new Set([...g.board_ids, id])] : g.board_ids.filter((z) => z !== id);
      if (g.metric === 'sum' && !numCols(g.board_ids).some(([k]) => k === g.value_key)) g.value_key = numCols(g.board_ids)[0]?.[0] || null;
      draw();
    });
    r.querySelectorAll('[data-del]').forEach((x) => x.onclick = () => { const [g] = gs.splice(+x.dataset.del, 1); if (g.id) removed.push(g.id); draw(); });
    r.querySelector('#ga').onclick = () => {
      const pb = bs.filter((b) => b.columns.some((c) => c.type === 'number')).map((b) => b.id).slice(0, 1);
      const vk = numCols(pb)[0]?.[0] || null;
      gs.push({ space_id: sid, title: vk ? `${numCols(pb)[0][1]} firmado ${year}` : `Operaciones firmadas ${year}`, metric: vk ? 'sum' : 'count', value_key: vk, board_ids: pb.length ? pb : bs.slice(0, 1).map((b) => b.id), filter: {}, year, target: 0, sort: gs.length });
      draw();
    };
    r.querySelector('#cx').onclick = () => { r.innerHTML = ''; };
    r.querySelector('#ok').onclick = async () => {
      for (const g of gs) if (!g.title?.trim() || !g.board_ids.length || (g.metric === 'sum' && !g.value_key)) return C.toast('Cada objetivo necesita nombre, al menos un tablero y la columna a sumar');
      r.innerHTML = '';
      try {
        if (removed.length) { const { error } = await C.sb.from('goals').delete().in('id', removed); if (error) throw error; }
        for (const [i, g] of gs.entries()) {
          const row = { space_id: sid, title: g.title.trim(), metric: g.metric, value_key: g.metric === 'sum' ? g.value_key : null, board_ids: g.board_ids, filter: g.filter?.key && g.filter.value ? g.filter : {}, year: Number(g.year) || year, target: Number(g.target) || 0, sort: i, updated_by: C.S.me.email.toLowerCase(), updated_at: new Date().toISOString() };
          const { error } = g.id ? await C.sb.from('goals').update(row).eq('id', g.id) : await C.sb.from('goals').insert(row);
          if (error) throw error;
        }
        await loadGoals(); C.toast('Objetivos guardados'); C.renderMain();
      } catch (e) { C.err(e); }
    };
  };
  draw();
}

/* ---------- tira de objetivos para el Resumen de todo el equipo ---------- */
export function goalsStrip(sid, ctx) {
  C = ctx || C; css();
  const gs = goalsOf(sid); if (!gs.length) return '';
  return `<div class="grid2">${gs.map((g) => { const r = computeGoal(g); return `<div class="rs-mini" data-space="${esc(sid)}"><div class="l"><b>${esc(g.title)}</b><span>${fmtV(g, r.achieved)} firmado · previsión ${fmtV(g, r.forecast)} · objetivo ${fmtV(g, g.target)}</span></div>${trackHtml(g, r, true)}</div>`; }).join('')}</div>`;
}
