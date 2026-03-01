import { createClient } from "@supabase/supabase-js";

export type RequireAdminResult = { userId: string };

export async function requireAdmin(opts: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}): Promise<RequireAdminResult> {
  const { req, supabaseUrl, anonKey, serviceRoleKey } = opts;

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!authHeader) throw Object.assign(new Error("Missing Authorization header"), { status: 401 });

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userRes, error: userErr } = await authed.auth.getUser();
  if (userErr) throw Object.assign(new Error(userErr.message), { status: 401 });
  const user = userRes?.user;
  if (!user) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: roleRow, error: roleErr } = await service
    .from("user_roles")
    .select("role,active")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleErr) throw Object.assign(new Error(roleErr.message), { status: 500 });
  if (!roleRow || roleRow.active !== true) {
    throw Object.assign(new Error("Forbidden: admin access required"), { status: 403 });
  }

  return { userId: user.id };
}
