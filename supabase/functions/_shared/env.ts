// Variables de entorno sin atarse al entorno de ejecución: funciona en Deno (Supabase) y en Node (servidor propio).
export function env(nombre: string): string | undefined {
  const g = globalThis as any;
  const v = g.Deno?.env?.get?.(nombre) ?? g.process?.env?.[nombre];
  return v === '' ? undefined : v;
}
