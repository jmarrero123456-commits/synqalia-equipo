-- Synqalia · Motor IA: tarifas de respaldo por familia de modelo (copia de la migración aplicada el 28/11/2026, 00:24 UTC)
insert into public.ia_tarifas (proveedor, patron, usd_entrada_mtok, usd_salida_mtok, eur_por_usd, vigente_desde, nota)
select v.* from (values
  (null::text, 'sonnet', 3::numeric, 15::numeric, 0.89::numeric, '2026-11-01'::timestamptz, 'Respaldo familia Sonnet'),
  (null, 'opus', 5, 25, 0.89, '2026-11-01', 'Respaldo familia Opus'),
  (null, 'haiku', 1, 5, 0.89, '2026-11-01', 'Respaldo familia Haiku'),
  (null, 'fable', 10, 50, 0.89, '2026-11-01', 'Respaldo familia Fable')
) v(proveedor, patron, a, b, c, d, e)
where not exists (select 1 from public.ia_tarifas t where t.patron = v.patron);
