// Synqalia · Motor IA común · arranque en las funciones de Supabase.
// Es el único archivo que lee Deno.env: el motor recibe el entorno como función y no sabe dónde corre.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { crearMotor } from './motor.ts';
import { proveedorDesdeEntorno } from './proveedores.ts';
import { repoSupabase } from './repo-supabase.ts';

export { ErrorIA } from './tipos.ts';
export type { Nivel, PeticionIA, RespuestaIA } from './tipos.ts';
export type { Motor, Resultado, SaldoVisible } from './motor.ts';

const env = (k: string) => Deno.env.get(k);

export function motorIA(admin: SupabaseClient) {
  return crearMotor({ env, repo: repoSupabase(admin), proveedor: proveedorDesdeEntorno(env) });
}

/** ¿Hay proveedor configurado? (para el «ping» de la app). */
export function iaConfigurada() {
  return (env('IA_PROVEEDOR') || 'anthropic') === 'anthropic' ? !!env('ANTHROPIC_API_KEY') : false;
}

/** Nivel pedido por la app: solo 'avanzada' si lo pide expresamente; el resto, básica. */
export function nivelDe(v: unknown): 'basica' | 'avanzada' {
  return v === 'avanzada' ? 'avanzada' : 'basica';
}
