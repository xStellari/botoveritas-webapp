// supabase/functions/admin-force-end-session/index.ts
// BotoVeritas — Admin-only force-end a voter session (testing / recovery)
//
// Purpose
// - Allows an ADMIN to immediately expire a voter's active session without granting broad DELETE permissions.
// - Designed for testing (don't mint/gas) and recovery (browser crash/power loss/abandon).
//
// CORS
// - Handles OPTIONS preflight with a 204 + required headers.
// - Echoes request Origin when present to satisfy stricter browsers during local dev.

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../_shared/database.types.ts";

type Body = {
  voterId: string;
  reason?: string;
};

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";

  return {
    // Echo the Origin when available (works better for localhost + preflight)
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, status: number, payload: unknown) {
  const corsHeaders = buildCorsHeaders(req);
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isUuid(v: string): boolean {
  // Postgres will validate strictly; this is just quick feedback.
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  // ✅ CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, 405, { ok: false, error: "Method not allowed. Use POST." });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json(req, 500, {
        ok: false,
        error:
          "Server misconfigured: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(req, 401, {
        ok: false,
        error: "Missing Authorization bearer token.",
      });
    }

    // Caller-scoped client for auth + role check
    const supabaseUserClient = createClient<Database>(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUserClient.auth
      .getUser();

    if (userErr || !userData?.user) {
      return json(req, 401, {
        ok: false,
        error: "Unauthorized: invalid or expired session.",
        details: userErr?.message ?? null,
      });
    }

    const userId = userData.user.id;

    const { data: roleRow, error: roleErr } = await supabaseUserClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) {
      return json(req, 500, {
        ok: false,
        error: "Failed to verify admin role.",
        details: roleErr.message,
      });
    }

    if (!roleRow) {
      return json(req, 403, {
        ok: false,
        error: "Forbidden: admin role required.",
      });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(req, 400, { ok: false, error: "Invalid JSON body." });
    }

    const voterId = (body?.voterId ?? "").trim();
    const reason = (body?.reason ?? "").trim();

    if (!voterId || !isUuid(voterId)) {
      return json(req, 400, {
        ok: false,
        error: "Invalid voterId (expected UUID).",
      });
    }

    // Service-role client to perform the intervention + logs
    const supabaseAdmin = createClient<Database>(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 1) expire the session
    const { data: upd, error: updErr } = await supabaseAdmin
      .from("voter_sessions")
      .update({ expires_at: new Date().toISOString() })
      .eq("voter_id", voterId)
      .select("voter_id")
      .maybeSingle();

    if (updErr) {
      return json(req, 500, {
        ok: false,
        error: "Failed to force-end session.",
        details: updErr.message,
      });
    }

    const updated = !!upd;

    // 2) session log (best-effort)
    const { error: sessLogErr } = await supabaseAdmin
      .from("voter_session_logs")
      .insert({
        voter_id: voterId,
        action: "admin_force_end",
        kiosk_id: null,
        ip_address: null,
        user_agent: null,
      });

    // 3) audit log (best-effort)
    const { error: auditErr } = await supabaseAdmin
      .from("admin_audit_logs")
      .insert({
        admin_id: userId,
        action: "FORCE_END_SESSION",
        entity_type: "voter_sessions",
        entity_id: voterId,
        details: {
          voter_id: voterId,
          reason: reason || null,
          updated,
        },
      });

    return json(req, 200, {
      ok: true,
      ended: { voterId, updated },
      warnings: {
        sessionLog: sessLogErr?.message ?? null,
        auditLog: auditErr?.message ?? null,
      },
    });
  } catch (e) {
    return json(req, 500, {
      ok: false,
      error: "Unexpected server error.",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
