// supabase/functions/admin-audit-log/index.ts
// BotoVeritas — Admin-only audit log writer (service-role insert)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";

// Local Json type for Edge Functions. Avoids coupling to generated exports.
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
  entity_id: string; // must be UUID (admin_audit_logs.entity_id is uuid)
  details?: Json;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  };
}

function json(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "*";

  // Preflight must return quickly and must not depend on env vars.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json(origin, 405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("[admin-audit-log] Server misconfigured", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasAnonKey: Boolean(anonKey),
      hasServiceKey: Boolean(serviceKey),
    });
    return json(origin, 500, { ok: false, error: "Server misconfigured" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(origin, 401, { ok: false, error: "Missing Authorization header" });
  }

  // Authed client (caller JWT) — used for identity + admin authorization.
  const authed = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    console.error("[admin-audit-log] Invalid token", {
      error: userErr?.message ?? String(userErr),
    });
    return json(origin, 401, { ok: false, error: "Invalid token" });
  }

  const caller = userData.user;

  // Verify caller is admin using user_roles.
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
    return json(origin, 500, { ok: false, error: roleErr.message });
  }

  if (!roleRow || roleRow.role !== "admin") {
    console.warn("[admin-audit-log] Not authorized", { user_id: caller.id });
    return json(origin, 403, { ok: false, error: "Not authorized" });
  }

  let body: AuditLogBody;
  try {
    body = (await req.json()) as AuditLogBody;
  } catch {
    return json(origin, 400, { ok: false, error: "Invalid JSON body" });
  }

  const action = (body.action ?? "").trim();
  const entityType = (body.entity_type ?? "").trim();
  // May be normalized below if the UI sends a non-UUID identifier.
  let entityId = (body.entity_id ?? "").trim();

  if (!action || !entityType || !entityId) {
    return json(origin, 400, {
      ok: false,
      error: "action, entity_type, and entity_id are required",
    });
  }

  if (action.length > 100 || entityType.length > 100) {
    return json(origin, 400, { ok: false, error: "action/entity_type too long" });
  }


  // entity_id in the DB is UUID (NOT NULL). Some UI actions (like toggles)
  // may naturally use non-UUID identifiers (e.g., "registration", "global").
  // In that case we generate a UUID for storage and preserve the original
  // identifier in details for traceability.
  const rawDetails = body.details;
  const detailsObj =
    rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
      ? (rawDetails as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  if (!isUuid(entityId)) {
    const originalEntityId = String(entityId);
    entityId = crypto.randomUUID();
    detailsObj["_original_entity_id"] = originalEntityId;
  }

  const details: Json = detailsObj as Json;


  // Service client (server-side insert; RLS policy allows service_role inserts).
  const service = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: inserted, error: insertErr } = await service
    .from("admin_audit_logs")
    .insert({
      admin_id: caller.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    })
    .select("id, created_at")
    .maybeSingle();

  if (insertErr) {
    console.error("[admin-audit-log] insert failed", {
      message: insertErr.message,
      code: (insertErr as any).code,
      hint: (insertErr as any).hint,
      details: (insertErr as any).details,
    });
    return json(origin, 500, { ok: false, error: insertErr.message });
  }

  return json(origin, 200, { ok: true, inserted });
});
