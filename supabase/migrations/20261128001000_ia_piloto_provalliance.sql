-- Synqalia · piloto de Provalliance (28/11/2026): IA básica con 6 € de coste al mes por usuario (600 créditos).
insert into public.ia_empresa (company_id, creditos_basica_usuario) values ('provalliance', 600)
on conflict (company_id) do update set creditos_basica_usuario = 600, updated_at = now();
insert into public.audit_log (company_id, owner, accion, detalle)
values ('provalliance', null, 'ia.config', jsonb_build_object('creditos_basica_usuario', 600, 'motivo', 'piloto'));
