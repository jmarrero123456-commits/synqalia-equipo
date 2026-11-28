// Synqalia · Motor IA común · acceso a datos con Supabase.
// Solo llama a funciones SQL estándar (ia_estado, ia_registrar) y lee ia_precios: al migrar a RDS se sustituye
// por un repositorio con PostgreSQL directo que llame a las mismas funciones.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Contexto, EstadoIA, Precio, Registro, RepositorioIA } from './tipos.ts';

export function repoSupabase(admin: SupabaseClient): RepositorioIA {
  return {
    async estado(ctx: Contexto, periodo: string) {
      const { data, error } = await admin.rpc('ia_estado', { p_company: ctx.company_id, p_email: ctx.email, p_periodo: periodo });
      if (error) throw new Error('ia_estado: ' + error.message);
      return data as EstadoIA;
    },
    async registrar(r: Registro) {
      const { data, error } = await admin.rpc('ia_registrar', {
        p_company: r.company_id, p_email: r.email, p_periodo: r.periodo, p_funcion: r.funcion, p_nivel: r.nivel, p_modelo: r.modelo,
        p_tokens_entrada: r.tokens_entrada, p_tokens_salida: r.tokens_salida, p_cache_lectura: r.cache_lectura, p_cache_escritura: r.cache_escritura,
        p_coste_usd: r.coste_usd, p_creditos: r.creditos, p_ok: r.ok, p_codigo_error: r.codigo_error, p_ms: r.ms,
      });
      if (error) throw new Error('ia_registrar: ' + error.message);
      return (data || { recarga: false }) as { recarga: boolean };
    },
    async precios() {
      const { data, error } = await admin.from('ia_precios').select('modelo,entrada_usd,salida_usd,cache_escritura_usd,cache_lectura_usd');
      if (error) throw new Error('ia_precios: ' + error.message);
      const out: Record<string, Precio> = {};
      for (const p of data || []) {
        out[(p as any).modelo] = {
          entrada_usd: Number((p as any).entrada_usd), salida_usd: Number((p as any).salida_usd),
          cache_escritura_usd: Number((p as any).cache_escritura_usd), cache_lectura_usd: Number((p as any).cache_lectura_usd),
        };
      }
      return out;
    },
  };
}
