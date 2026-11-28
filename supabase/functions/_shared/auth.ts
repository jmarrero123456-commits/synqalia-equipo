// lib/auth de las funciones: TODO acceso a usuarios y sesiones pasa por aquí. Hoy usa Supabase Auth;
// al migrar (p. ej. a Cognito) solo cambia este archivo.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { env } from './env.ts';

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  companyId: string;
  rol: string;
  token: string;
}

let _admin: SupabaseClient | null = null;
export function clienteServicio(): SupabaseClient {
  if (!_admin) _admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  return _admin;
}

// Usuario de la petición (cabecera Authorization: Bearer …) con su empresa. null si no hay sesión o no es miembro.
export async function usuarioDePeticion(req: Request): Promise<Usuario | null | 'no_miembro'> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const admin = clienteServicio();
  const { data: u } = await admin.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (!email || !u?.user) return null;
  const { data: m } = await admin.from('members').select('email,name,role,company_id').ilike('email', email).maybeSingle();
  if (!m) return 'no_miembro';
  return {
    id: u.user.id, email, token,
    nombre: String((m as any).name || u.user.user_metadata?.full_name || email),
    companyId: String((m as any).company_id || ''), rol: String((m as any).role || 'member'),
  };
}
