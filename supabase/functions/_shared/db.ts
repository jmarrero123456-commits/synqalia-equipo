// Adaptador de base de datos para el Motor IA. Hoy: funciones SQL vía supabase-js con el rol de servicio.
// En un servidor propio: `select public.ia_reservar(...)` con un cliente pg (mismas funciones, PostgreSQL estándar).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { BaseDatos } from './ia/tipos.ts';

export function baseDatosSupabase(cli: SupabaseClient): BaseDatos {
  return {
    async rpc(funcion, args) {
      const { data, error } = await cli.rpc(funcion, args);
      if (error) throw new Error(error.message);
      return data as any;
    },
  };
}
