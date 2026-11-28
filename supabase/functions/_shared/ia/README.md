# Motor IA común de Synqalia

Toda la IA de Synqalia pasa por `preguntar()` (motor.ts). Ninguna función llama al proveedor directamente.

## Flujo
1. **Reserva** (`ia_reservar`, SQL): usuario de la empresa, plan activo, techo de seguridad y saldo. Si no hay saldo o límite para el nivel *avanzado*, devuelve el *básico* (`degradado`). Aparta un coste estimado mientras dura la llamada.
2. **Llamada** al proveedor de `IA_PROVEEDOR` (`anthropic` | `bedrock`), con hasta 3 intentos si está saturada.
3. **Liquidación** (`ia_liquidar`, SQL): tokens reales → coste (tabla `ia_tarifas`) → se descuenta de la bolsa del mes, después del extra y, lo que sobre, queda como exceso (solo básico). Crea los avisos del 80 % y 100 % (`ia_avisos`, una vez por mes) para los administradores de la empresa.

## Tablas
`empresas`, `ia_planes`, `ia_saldo`, `ia_movimientos`, `ia_consumo`, `ia_tarifas`, `ia_avisos` (migración `20261128000000_motor_ia.sql`).

## Variables de entorno
| Variable | Uso |
|---|---|
| `IA_PROVEEDOR` | `anthropic` (por defecto) o `bedrock` |
| `ANTHROPIC_API_KEY` | API directa |
| `IA_MODELO_BASICO` / `IA_MODELO_AVANZADO` | por defecto `claude-sonnet-5-5` / `claude-opus-5-5` (`ANTHROPIC_MODEL` sigue valiendo para el básico) |
| `AWS_REGION` | por defecto `eu-central-1` (Fráncfort) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | credenciales de Bedrock |
| `IA_BEDROCK_MODELO_BASICO` / `IA_BEDROCK_MODELO_AVANZADO` | id del modelo o perfil de inferencia UE |

## Cambiar a Bedrock
Dar de alta las variables de AWS y `IA_BEDROCK_MODELO_*` y poner `IA_PROVEEDOR=bedrock`. Si Bedrock cobra distinto, añadir filas en `ia_tarifas` con `proveedor = 'bedrock'`.

## Portabilidad
`ia/` es TypeScript sin dependencias de Supabase, Vercel ni Deno (probado en Deno y en Node 22). Lo único de Supabase es `auth.ts` (sesión) y `db.ts` (llamada a las funciones SQL), que se sustituyen al migrar.

## Códigos de error
`no_autorizado`, `sin_plan`, `tope`, `saturada`, `demasiadas_peticiones`, `servicio_no_disponible` (incluye «el proveedor se ha quedado sin crédito», que queda en `ia_consumo.codigo_error = 'proveedor_sin_saldo'`), `configuracion`, `modelo`, `formato`, `peticion`, `interno`. La respuesta de error es `{ error: <texto para la pantalla>, code }`.
