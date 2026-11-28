// Pruebas del Motor IA común (sin red ni base de datos): deno test supabase/functions/_shared/ia/motor.test.ts
import { crearMotor } from './motor.ts';
import type { EstadoIA, ProveedorIA, Registro, RepositorioIA } from './tipos.ts';
import { ErrorIA } from './tipos.ts';

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

function escenario(e: Partial<EstadoIA>, respuesta: any = { ok: true, respuesta: { content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 30000, output_tokens: 1000 } } }) {
  const registros: Registro[] = [];
  const modelosPedidos: string[] = [];
  const estado: EstadoIA = { activa: true, nivel: 'basica', bloqueado: false, al_agotar: 'ahorro', usuario_limite: 400, usuario_usados: 0, empresa_total: 4000, empresa_usados: 0, recarga_auto: false, recargas: 0, recarga_max_mes: 3, ...e };
  const repo: RepositorioIA = {
    estado: async () => estado,
    registrar: async (r) => { registros.push(r); return { recarga: false }; },
    precios: async () => ({ 'claude-sonnet-5-5': { entrada_usd: 2, salida_usd: 10, cache_escritura_usd: 2.5, cache_lectura_usd: 0.1 }, 'claude-haiku-5-5': { entrada_usd: 0.1, salida_usd: 0.5, cache_escritura_usd: 0.125, cache_lectura_usd: 0.01 }, 'claude-opus-5-5': { entrada_usd: 4, salida_usd: 20, cache_escritura_usd: 5, cache_lectura_usd: 0.2 } }),
  };
  const proveedor: ProveedorIA = { nombre: 'prueba', enviar: async (m) => { modelosPedidos.push(m); return typeof respuesta === 'function' ? respuesta(m) : respuesta; } };
  const motor = crearMotor({ env: () => undefined, repo, proveedor, log: () => {} });
  return { motor, registros, modelosPedidos };
}
const ctx = { company_id: 'provalliance', email: 'a@b.es' };
const pet = { messages: [{ role: 'user', content: 'hola' }] };

Deno.test('básica usa Sonnet y descuenta el coste en créditos', async () => {
  const { motor, registros, modelosPedidos } = escenario({});
  const r = await motor.ejecutar(ctx, 'prueba', 'basica', pet);
  assert(modelosPedidos[0] === 'claude-sonnet-5-5', 'modelo');
  // 30.000 × 2 + 1.000 × 10 = 0,07 $ → 0,0602 € → 6,02 créditos
  assert(Math.abs(registros[0].coste_usd - 0.07) < 1e-9, 'coste ' + registros[0].coste_usd);
  assert(Math.abs(registros[0].creditos - 6.02) < 1e-6, 'créditos ' + registros[0].creditos);
  assert(r.saldo.usuario_pct_restante === 98, 'pct ' + r.saldo.usuario_pct_restante);
});

Deno.test('avanzada sin contratar → no_contratada', async () => {
  const { motor, registros } = escenario({});
  let codigo = '';
  try { await motor.ejecutar(ctx, 'prueba', 'avanzada', pet); } catch (e) { codigo = (e as ErrorIA).codigo; }
  assert(codigo === 'no_contratada', codigo);
  assert(registros.length === 0, 'no debe registrar');
});

Deno.test('avanzada contratada usa Opus', async () => {
  const { motor, modelosPedidos } = escenario({ nivel: 'avanzada', usuario_limite: 800 });
  await motor.ejecutar(ctx, 'prueba', 'avanzada', pet);
  assert(modelosPedidos[0] === 'claude-opus-5-5', modelosPedidos[0]);
});

Deno.test('saldo agotado con «ahorro» → Haiku y nivel ahorro', async () => {
  const { motor, registros, modelosPedidos } = escenario({ usuario_usados: 400 });
  const r = await motor.ejecutar(ctx, 'prueba', 'basica', pet);
  assert(modelosPedidos[0] === 'claude-haiku-5-5', modelosPedidos[0]);
  assert(r.ahorro && registros[0].nivel === 'ahorro', 'ahorro');
});

Deno.test('saldo de empresa agotado con «parar» → sin_saldo', async () => {
  const { motor } = escenario({ empresa_usados: 4000, al_agotar: 'parar' });
  let codigo = '';
  try { await motor.ejecutar(ctx, 'prueba', 'basica', pet); } catch (e) { codigo = (e as ErrorIA).codigo; }
  assert(codigo === 'sin_saldo', codigo);
});

Deno.test('usuario bloqueado → bloqueado', async () => {
  const { motor } = escenario({ bloqueado: true });
  let codigo = '';
  try { await motor.ejecutar(ctx, 'prueba', 'basica', pet); } catch (e) { codigo = (e as ErrorIA).codigo; }
  assert(codigo === 'bloqueado', codigo);
});

Deno.test('proveedor sin saldo → registra el fallo con su motivo', async () => {
  const { motor, registros } = escenario({}, { ok: false, status: 400, mensaje: 'Your credit balance is too low' });
  let codigo = '';
  try { await motor.ejecutar(ctx, 'prueba', 'basica', pet); } catch (e) { codigo = (e as ErrorIA).codigo; }
  assert(codigo === 'sin_saldo_proveedor', codigo);
  assert(registros.length === 1 && registros[0].ok === false && registros[0].codigo_error === 'sin_saldo_proveedor', 'registro del fallo');
});

Deno.test('modelo sin precio → se cobra al precio del más caro', async () => {
  const { motor, registros } = escenario({}, (m: string) => ({ ok: true, respuesta: { content: [], usage: { input_tokens: 1_000_000, output_tokens: 0 }, model: m } }));
  // fuerza un modelo desconocido vía fondo con variable
  const m2 = crearMotor({ env: (k) => (k === 'IA_MODELO_FONDO' ? 'modelo-raro' : undefined), repo: { estado: async () => ({ activa: true, nivel: 'basica', bloqueado: false, al_agotar: 'ahorro', usuario_limite: 400, usuario_usados: 0, empresa_total: 400, empresa_usados: 0, recarga_auto: false, recargas: 0, recarga_max_mes: 3 }), registrar: async (r) => { registros.push(r); return { recarga: false }; }, precios: async () => ({ 'claude-opus-5-5': { entrada_usd: 4, salida_usd: 20, cache_escritura_usd: 5, cache_lectura_usd: 0.2 } }) }, proveedor: { nombre: 'x', enviar: async () => ({ ok: true, respuesta: { content: [], usage: { input_tokens: 1_000_000, output_tokens: 0 } } }) }, log: () => {} });
  await m2.ejecutar(ctx, 'prueba', 'fondo', pet);
  assert(registros[registros.length - 1].coste_usd === 4, 'coste ' + registros[registros.length - 1].coste_usd);
  void motor;
});
