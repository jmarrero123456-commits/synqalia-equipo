// Synqalia · módulo propio de inicio de sesión del backend.
// Todas las funciones obtienen al usuario de la petición desde aquí; ninguna llama a Supabase Auth directamente.
// Hoy valida el token con Supabase Auth; al migrar a AWS (Cognito u otro) solo cambia este archivo.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface Usuario {
  email: string;        // en minúsculas
  owner: string;        // id del usuario
  nombre: string;
  company_id: string;
  role: string;         // 'admin' | 'member'
  token: string;        // token de sesión (para clientes con RLS)
  metadata: Record<string, unknown>;
}

export class ErrorAuth extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Usuario de la petición, o ErrorAuth (401 sin sesión, 403 si no es miembro de Synqalia). */
export async function usuarioDePeticion(req: Request, admin: SupabaseClient): Promise<Usuario> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErrorAuth(401, 'Inicia sesión');
  const { data: u } = await admin.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (!email || !u?.user) throw new ErrorAuth(401, 'Inicia sesión');
  const { data: m } = await admin.from('members').select('email,name,role,company_id').ilike('email', email).maybeSingle();
  if (!m) throw new ErrorAuth(403, 'No autorizado');
  const md = (u.user.user_metadata || {}) as Record<string, unknown>;
  return {
    email,
    owner: u.user.id,
    nombre: String((m as any).name || md.full_name || email),
    company_id: String((m as any).company_id || 'provalliance'),
    role: String((m as any).role || 'member'),
    token,
    metadata: md,
  };
}
