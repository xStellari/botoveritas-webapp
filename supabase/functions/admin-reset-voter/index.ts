// supabase/functions/admin-reset-voter/index.ts
// BotoVeritas — Admin-only voter reset for a FINAL election (testing / maintenance)
//
// Purpose
// - Lets an ADMIN reset a specific voter's participation for a specific election
//   even when `elections.is_final = true`, without weakening the FINAL lock for normal writes.
//
// How it works
// - Validates caller is authenticated and has app_role = 'admin' (public.user_roles).
// - Uses a service-role Supabase client to call the DB function:
//     public.admin_reset_voter_for_election(p_election_id uuid, p_voter_id uuid)
//   which sets a transaction-scoped bypass flag and deletes:
//     - public.votes rows for that voter+election
//     - public.voter_election_status row for that voter+election
//
// Security
// - Caller must be authenticated AND have user_roles.role = 'admin'.
// - The destructive DB operation is executed only with the service role key.
// - Never expose service key to clients.
//
// Request
//   POST { electionId: string (uuid), voterId: string (uuid) }
//
// Response
//   200 { ok: true, reset: { electionId, voterId } }
//   4xx/5xx { ok: false, error: string, details?: any }

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../_shared/database.types.ts";

type Body = {
  electionId: string;
  voterId: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isUuid(v: string): boolean {
  // Simple UUID v4-ish check; Postgres will still validate strictly.
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json(405, {
        ok: false,
        error: "Method not allowed. Use POST.",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json(500, {
        ok: false,
        error:
          "Server misconfigured: missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.",
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, {
        ok: false,
        error: "Missing Authorization bearer token.",
      });
    }

    // Caller-scoped client (uses the user's JWT) for auth + role check
    const supabaseUserClient = createClient<Database>(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUserClient.auth
      .getUser();

    if (userErr || !userData?.user) {
      return json(401, {
        ok: false,
        error: "Unauthorized: invalid or expired session.",
        details: userErr?.message ?? null,
      });
    }

    const userId = userData.user.id;

    // Admin gate via public.user_roles (enum app_role: 'admin' | 'voter')
    const { data: roleRow, error: roleErr } = await supabaseUserClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) {
      return json(500, {
        ok: false,
        error: "Failed to check admin role.",
        details: roleErr.message,
      });
    }

    if (!roleRow) {
      return json(403, {
        ok: false,
        error: "Forbidden: admin role required.",
      });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, {
        ok: false,
        error: "Invalid JSON body.",
      });
    }

    const electionId = (body?.electionId ?? "").trim();
    const voterId = (body?.voterId ?? "").trim();

    if (!electionId || !voterId) {
      return json(400, {
        ok: false,
        error: "Missing required fields: electionId, voterId.",
      });
    }

    if (!isUuid(electionId) || !isUuid(voterId)) {
      return json(400, {
        ok: false,
        error: "Invalid UUID format for electionId or voterId.",
      });
    }

    // Service-role client executes the reset RPC
    const supabaseAdmin = createClient<Database>(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // NOTE:
    // Your generated Database type only lists RPC functions known at generation time.
    // Since `admin_reset_voter_for_election` is newly added, TypeScript will reject it.
    // This cast is safe because Postgres will validate the function name + args at runtime.
    const { error: rpcErr } = await supabaseAdmin.rpc(
      "admin_reset_voter_for_election" as unknown as any,
      {
        p_election_id: electionId,
        p_voter_id: voterId,
      } as any,
    );

    if (rpcErr) {
      return json(500, {
        ok: false,
        error: "Reset failed.",
        details: rpcErr.message,
      });
    }

    return json(200, {
      ok: true,
      reset: { electionId, voterId },
    });
  } catch (e) {
    return json(500, {
      ok: false,
      error: "Unexpected server error.",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
