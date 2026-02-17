// supabase/functions/admin-audit-log/index.ts
// BotoVeritas — Admin-only audit log writer

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";

// Local Json type for Edge Functions. This avoids relying on generated type exports
// that may differ across Supabase codegen versions.
type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type AuditLogBody = {
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Json;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Helps confirm requests are reaching this function (visible in Logs).
  console.log("[admin-audit-log] request received", {
    method: req.method,
    hasAuth: Boolean(req.headers.get("Authorization")),
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("[admin-audit-log] Server misconfigured", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasAnonKey: Boolean(anonKey),
      hasServiceKey: Boolean(serviceKey),
    });
    return json(500, { ok: false, error: "Server misconfigured" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(401, { ok: false, error: "Missing Authorization header" });
  }

  // Authed client (caller JWT) — used only for identity + admin check.
  const authed = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    console.error("[admin-audit-log] Invalid token", {
      error: userErr?.message ?? String(userErr),
    });
    return json(401, { ok: false, error: "Invalid token" });
  }

  const caller = userData.user;

  // Verify caller is admin using user_roles (source of truth).
  const { data: roleRow, error: roleErr } = await authed
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (roleErr) {
    console.error("[admin-audit-log] Failed to read user_roles", {
      user_id: caller.id,
      error: roleErr.message,
    });
    return json(500, { ok: false, error: roleErr.message });
  }

  if (!roleRow || roleRow.role !== "admin") {
    console.warn("[admin-audit-log] Not authorized", { user_id: caller.id });
    return json(403, { ok: false, error: "Not authorized" });
  }

  let body: AuditLogBody;
  try {
    body = (await req.json()) as AuditLogBody;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const action = (body.action ?? "").trim();
  const entityType = (body.entity_type ?? "").trim();
  const entityId = (body.entity_id ?? "").trim();

  if (!action || !entityType || !entityId) {
    return json(400, { ok: false, error: "action, entity_type, and entity_id are required" });
  }

  if (action.length > 100 || entityType.length > 100) {
    return json(400, { ok: false, error: "action/entity_type too long" });
  }

  if (!isUuid(entityId)) {
    return json(400, { ok: false, error: "entity_id must be a UUID" });
  }

  const details: Json = body.details ?? {};

  // Service client (server-side insert)
  const service = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { error: insertErr } = await service.from("admin_audit_logs").insert({
    admin_id: caller.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });

  if (insertErr) {
    console.error("[admin-audit-log] insert failed", {
      message: insertErr.message,
      code: (insertErr as any).code,
      hint: (insertErr as any).hint,
      details: (insertErr as any).details,
    });
    return json(500, { ok: false, error: insertErr.message });
  }

  return json(200, { ok: true });
}
