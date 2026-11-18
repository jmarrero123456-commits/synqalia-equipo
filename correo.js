// Synqalia · Correo — separador arrastrable entre la lista de correos y el correo abierto (solo PC, ≥1100 px).
// El ancho se guarda en este navegador. Doble clic (o tecla Inicio) vuelve al ancho normal; flechas ← → lo ajustan.
(() => {
  const KEY = 'sq-mail-list-w', DEF = 380, MIN = 260, PANE_MIN = 460;
  const split = document.getElementById('mail-split'), bar = document.getElementById('mail-resizer');
  if (!split || !bar) return;
  const read = () => { try { return parseInt(localStorage.getItem(KEY), 10) || DEF; } catch (e) { return DEF; } };
  const save = (w) => { try { localStorage.setItem(KEY, String(w)); } catch (e) {} };
  const clamp = (w) => { const max = Math.max(MIN, split.clientWidth - PANE_MIN - 7); return Math.round(Math.min(Math.max(w, MIN), max)); };
  const apply = (w) => { split.style.setProperty('--mail-list-w', w + 'px'); bar.setAttribute('aria-valuenow', String(w)); return w; };
  let width = read(); apply(width);
  const refit = () => { if (split.clientWidth) apply(clamp(width)); };
  if (window.ResizeObserver) new ResizeObserver(refit).observe(split); else window.addEventListener('resize', refit);

  let x0 = 0, w0 = 0, id = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); id = e.pointerId; bar.setPointerCapture(id);
    x0 = e.clientX; w0 = split.querySelector('#mail-list').getBoundingClientRect().width;
    bar.classList.add('drag'); document.body.classList.add('sq-resizing');
  });
  bar.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; width = apply(clamp(w0 + e.clientX - x0)); });
  const end = (e) => {
    if (e.pointerId !== id) return; id = null;
    bar.classList.remove('drag'); document.body.classList.remove('sq-resizing'); save(width);
  };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => { width = apply(clamp(DEF)); save(width); });
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowLeft') width = apply(clamp(width - step));
    else if (e.key === 'ArrowRight') width = apply(clamp(width + step));
    else if (e.key === 'Home') width = apply(clamp(DEF));
    else return;
    e.preventDefault(); save(width);
  });
})();
