/* synqalia · adjuntos en tareas y «Compartir con Synqalia» desde el móvil (28/11/2026)
   - Android: Compartir → Synqalia (app instalada). El service worker guarda los archivos en el dispositivo
     (caché «sq-share») y abre mi.html#compartir; aquí se elige «Nueva tarea» o «Añadir a una tarea».
   - Los archivos se suben con el módulo propio de archivos (claude.use('assets'): hoy Supabase Storage, mañana S3)
     y la tarea guarda adjuntos: [{id, nombre, tipo, tam, fecha}]. Se abren con enlace firmado que caduca en 1 h.
   - En la ficha de la tarea: lista de adjuntos, abrir, quitar y «Adjuntar archivo». */
(() => {
  const MAX = 25 * 1024 * 1024, MAXN = 10;
  const SHARE = 'sq-share';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const icon = (tipo, nombre) => /pdf/i.test(tipo) || /\.pdf$/i.test(nombre) ? 'PDF' : /^image\//.test(tipo) ? 'IMG' : /sheet|excel|csv/i.test(tipo) || /\.(xlsx?|csv)$/i.test(nombre) ? 'XLS' : /word|document/i.test(tipo) || /\.docx?$/i.test(nombre) ? 'DOC' : /presentation|powerpoint/i.test(tipo) ? 'PPT' : 'ARC';
  const T = () => window.__sqTasks;
  const assets = () => window.claude.use('assets');
  const lista = (t) => (Array.isArray(t && t.adjuntos) ? t.adjuntos : []);

  async function subir(files) {
    const a = await assets(), out = [];
    for (const f of files) {
      if (f.size > MAX) throw new Error('«' + f.name + '» pasa de 25 MB');
      const r = await a.upload(f);
      out.push({ id: r.id, nombre: f.name || 'archivo', tipo: f.type || 'application/octet-stream', tam: f.size, fecha: new Date().toISOString() });
    }
    return out;
  }
  async function abrir(adj) {
    const w = window.open('', '_blank');
    try { const u = await (await assets()).url(adj.id); if (w) w.location.href = u; else location.href = u; }
    catch (e) { if (w) w.close(); alert('No se ha podido abrir el archivo.'); }
  }
  async function anadir(tid, nuevos) {
    const t = T().get(tid); if (!t) throw new Error('No encuentro la tarea');
    return T().update(tid, { adjuntos: lista(t).concat(nuevos).slice(-50) });
  }

  /* ---------- en la tarjeta: chips con los adjuntos ---------- */
  function chips(t) {
    const L = lista(t); if (!L.length) return null;
    const box = document.createElement('div'); box.className = 'adj-chips';
    L.slice(0, 3).forEach((a) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'adj-chip'; b.title = 'Abrir ' + a.nombre;
      b.innerHTML = '<span class="adj-ic">' + icon(a.tipo, a.nombre) + '</span><span class="adj-n">' + esc(a.nombre) + '</span>';
      b.addEventListener('click', (e) => { e.stopPropagation(); abrir(a); });
      box.appendChild(b);
    });
    if (L.length > 3) { const m = document.createElement('span'); m.className = 'adj-more'; m.textContent = '+' + (L.length - 3); box.appendChild(m); }
    return box;
  }

  /* ---------- en la ficha: lista, quitar y adjuntar ---------- */
  function editor(t) {
    const wrap = document.createElement('div'); wrap.className = 'field wide adj-edit';
    const h = document.createElement('label'); h.textContent = 'Archivos'; wrap.appendChild(h);
    const ul = document.createElement('div'); ul.className = 'adj-list'; wrap.appendChild(ul);
    const msg = document.createElement('span'); msg.className = 'adj-msg'; msg.setAttribute('aria-live', 'polite');
    function pintar() {
      const cur = T().get(t.id) || t; ul.replaceChildren();
      if (!lista(cur).length) { const e = document.createElement('div'); e.className = 'adj-empty'; e.textContent = 'Sin archivos.'; ul.appendChild(e); }
      lista(cur).forEach((a) => {
        const r = document.createElement('div'); r.className = 'adj-row';
        r.innerHTML = '<span class="adj-ic">' + icon(a.tipo, a.nombre) + '</span><button type="button" class="adj-open">' + esc(a.nombre) + '</button><span class="adj-sz">' + kb(a.tam || 0) + '</span><button type="button" class="adj-x" aria-label="Quitar ' + esc(a.nombre) + '">×</button>';
        r.querySelector('.adj-open').onclick = () => abrir(a);
        r.querySelector('.adj-x').onclick = async () => {
          if (!confirm('¿Quitar «' + a.nombre + '» de la tarea?')) return;
          const now = T().get(t.id) || t;
          await T().update(t.id, { adjuntos: lista(now).filter((x) => x.id !== a.id) });
          assets().then((s) => s.delete(a.id)).catch(() => {});
          setTimeout(pintar, 300);
        };
        ul.appendChild(r);
      });
    }
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.hidden = true;
    const add = document.createElement('button'); add.type = 'button'; add.className = 'btn ghost adj-add'; add.textContent = '📎 Adjuntar archivo';
    add.onclick = () => inp.click();
    inp.onchange = async () => {
      const files = [...inp.files].slice(0, MAXN); inp.value = ''; if (!files.length) return;
      add.disabled = true; msg.textContent = 'Subiendo…';
      try { await anadir(t.id, await subir(files)); msg.textContent = files.length > 1 ? files.length + ' archivos añadidos' : 'Archivo añadido'; setTimeout(pintar, 400); }
      catch (e) { msg.textContent = 'No se ha podido subir: ' + e.message; }
      finally { add.disabled = false; }
    };
    const row = document.createElement('div'); row.className = 'adj-tools'; row.append(add, msg, inp); wrap.appendChild(row);
    pintar();
    return wrap;
  }
  window.__sqAdj = { chips, editor, abrir };

  /* ---------- recibir lo compartido desde el móvil ---------- */
  async function leerCompartido() {
    if (!('caches' in window)) return null;
    const c = await caches.open(SHARE);
    const m = await c.match('/__share/meta'); if (!m) return null;
    const meta = await m.json();
    const files = [];
    for (const f of meta.files || []) {
      const r = await c.match(f.k); if (!r) continue;
      files.push(new File([await r.blob()], f.nombre, { type: f.tipo }));
    }
    return { meta, files };
  }
  async function borrarCompartido() { try { await caches.delete(SHARE); } catch (e) {} }

  function hoyISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  async function dialogo(sh) {
    const { meta, files } = sh;
    const enlace = !files.length && (meta.url || /https?:\/\//.test(meta.text)) ? (meta.url || (meta.text.match(/https?:\/\/\S+/) || [''])[0]) : '';
    if (!files.length && !enlace && !meta.text) { await borrarCompartido(); return; }
    const base = files.length ? files[0].name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim() : (meta.title || meta.text || 'Revisar enlace').slice(0, 120);
    const back = document.createElement('div'); back.className = 'adj-back';
    back.innerHTML = `<form class="adj-dlg" role="dialog" aria-modal="true" aria-labelledby="adj-t">
      <h3 id="adj-t">Guardar en una tarea</h3>
      <div class="adj-files">${files.map((f) => `<div class="adj-row"><span class="adj-ic">${icon(f.type, f.name)}</span><span class="adj-open">${esc(f.name)}</span><span class="adj-sz">${kb(f.size)}</span></div>`).join('') || `<div class="adj-row"><span class="adj-ic">URL</span><span class="adj-open">${esc(enlace || meta.text)}</span></div>`}</div>
      <div class="adj-seg" role="tablist"><button type="button" class="on" data-m="nueva">Nueva tarea</button><button type="button" data-m="existe">Añadir a una tarea</button></div>
      <div data-p="nueva"><label for="adj-tt">Tarea</label><input id="adj-tt" autocomplete="off">
        <div class="adj-two"><div><label for="adj-pr">Prioridad</label><select id="adj-pr"><option>Mega</option><option>Alta</option><option selected>Media</option><option>Baja</option></select></div>
        <div><label for="adj-fe">Para</label><input id="adj-fe" type="date"></div></div></div>
      <div data-p="existe" hidden><label for="adj-q">Busca la tarea</label><input id="adj-q" placeholder="Escribe parte del título" autocomplete="off"><div class="adj-res" role="listbox"></div></div>
      <div class="adj-msg" aria-live="polite"></div>
      <div class="adj-acts"><button type="button" class="btn ghost" data-a="x">Cancelar</button><button type="submit" class="btn primary" data-a="ok">Crear tarea</button></div>
    </form>`;
    document.body.appendChild(back);
    const $ = (s) => back.querySelector(s);
    let modo = 'nueva', elegida = null;
    $('#adj-tt').value = base.charAt(0).toUpperCase() + base.slice(1);
    $('#adj-fe').value = hoyISO();
    back.querySelectorAll('.adj-seg button').forEach((b) => b.onclick = () => {
      modo = b.dataset.m; back.querySelectorAll('.adj-seg button').forEach((x) => x.classList.toggle('on', x === b));
      back.querySelectorAll('[data-p]').forEach((p) => { p.hidden = p.dataset.p !== modo; });
      $('[data-a=ok]').textContent = modo === 'nueva' ? 'Crear tarea' : 'Añadir';
      if (modo === 'existe') { buscar(); $('#adj-q').focus(); }
    });
    const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    function buscar() {
      const q = norm($('#adj-q').value).trim(), box = $('.adj-res'); box.replaceChildren();
      const all = (T().abiertas() || []).filter((t) => !q || norm(t.titulo + ' ' + (t.persona || '')).includes(q))
        .sort((a, b) => String(b.editada || b.creada || '').localeCompare(String(a.editada || a.creada || ''))).slice(0, 8);
      if (!all.length) { box.innerHTML = '<div class="adj-empty">No hay tareas abiertas con ese texto.</div>'; return; }
      all.forEach((t) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'adj-opt' + (elegida === t.id ? ' on' : ''); b.setAttribute('role', 'option');
        b.innerHTML = '<b>' + esc(t.titulo) + '</b>' + (t.persona ? '<span>' + esc(t.persona) + '</span>' : '');
        b.onclick = () => { elegida = t.id; buscar(); };
        box.appendChild(b);
      });
    }
    $('#adj-q').oninput = () => { elegida = null; buscar(); };
    const cerrar = async (borrar) => { back.remove(); if (borrar) await borrarCompartido(); try { if (location.hash === '#compartir') history.replaceState(null, '', location.pathname + '#tareas'); } catch (e) {} };
    $('[data-a=x]').onclick = () => cerrar(true);
    $('form').onsubmit = async (e) => {
      e.preventDefault();
      const ok = $('[data-a=ok]'), msg = $('.adj-msg');
      if (modo === 'existe' && !elegida) { msg.textContent = 'Elige la tarea.'; return; }
      if (modo === 'nueva' && !$('#adj-tt').value.trim()) { msg.textContent = 'Escribe el nombre de la tarea.'; return; }
      ok.disabled = true; msg.textContent = files.length ? 'Subiendo ' + (files.length > 1 ? files.length + ' archivos' : 'el archivo') + '…' : 'Guardando…';
      try {
        const adj = files.length ? await subir(files) : [];
        let tid = elegida;
        if (modo === 'nueva') {
          tid = await T().add({ titulo: $('#adj-tt').value.trim(), detalle: enlace || (files.length ? '' : meta.text), prioridad: $('#adj-pr').value, vence: $('#adj-fe').value, extra: adj.length ? { adjuntos: adj, origen: 'compartido' } : { origen: 'compartido' } });
          if (!tid) throw new Error('no se pudo crear la tarea');
        } else {
          if (adj.length) await anadir(tid, adj);
          if (enlace) { const t = T().get(tid); await T().update(tid, { detalle: ((t && t.detalle ? t.detalle + '\n' : '') + enlace).slice(0, 1000) }); }
        }
        await cerrar(true);
        setTimeout(() => { try { T().open(tid); } catch (e2) {} }, 500);
      } catch (err) { ok.disabled = false; msg.textContent = 'No se ha podido guardar: ' + err.message; }
    };
    setTimeout(() => { const i = $('#adj-tt'); i.focus(); i.select(); }, 60);
  }

  async function main() {
    if (!window.__sqReady) return;
    await window.__sqReady;
    const go = async () => {
      if (window.__sqOffline) return;
      if (document.querySelector('.adj-back')) return;
      let sh = null; try { sh = await leerCompartido(); } catch (e) {}
      if (!sh) { if (location.hash === '#compartir') try { history.replaceState(null, '', location.pathname + '#tareas'); } catch (e) {} return; }
      if (Date.now() - (sh.meta.fecha || 0) > 2 * 864e5) { await borrarCompartido(); return; } // olvidado hace días
      // esperar a que las tareas estén cargadas
      for (let i = 0; i < 40 && !(T() && T().get); i++) await new Promise((r) => setTimeout(r, 150));
      dialogo(sh);
    };
    go();
    window.addEventListener('hashchange', () => { if (location.hash === '#compartir') go(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main); else main();
})();
