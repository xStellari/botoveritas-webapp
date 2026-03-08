// supabase/functions/kiosk-submit-votes/index.ts
// Option 3: service-only vote persistence gated by kiosk approval.
//
// Responsibilities:
// - Validate kiosk (approved + secret)
// - Validate election operational (not final/archived; within window)
// - Validate eligibility via RPC (is_voter_eligible_for_election)
// - UPSERT votes (idempotent)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { json, kioskCorsHeaders, requireKioskAuth } from "../_shared/kioskAuth.ts";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type Selection = {
  position: string;
  candidate_id: string | null;
  is_abstain: boolean;
};

type Body = {
  voter_id?: string;
  election_id?: string;
  selections?: Selection[];
};

function hasDuplicatePositions(selections: Selection[]): boolean {
  const seen = new Set<string>();
  for (const s of selections) {
    const key = String(s.position ?? "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: kioskCorsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: "Server misconfigured" });
  }

  const service = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const auth = await requireKioskAuth(req, service as any);
  if (auth instanceof Response) return auth;
  const rotateSecret = (auth as any).rotate_secret as string | undefined;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const voterId = (body.voter_id ?? "").trim();
  const electionId = (body.election_id ?? "").trim();
  const selections = Array.isArray(body.selections) ? body.selections : [];

  if (!voterId || !electionId || !isUuid(voterId) || !isUuid(electionId)) {
    return json(400, { ok: false, error: "voter_id and election_id must be UUIDs" });
  }

  if (selections.length === 0) {
    return json(400, { ok: false, error: "selections is required" });
  }

  if (hasDuplicatePositions(selections)) {
    return json(400, { ok: false, error: "Duplicate positions are not allowed" });
  }

  const normalizedSelections: Selection[] = [];
  try {
    for (const s of selections) {
      const position = String(s.position ?? "").trim();
      if (!position) throw new Error("Invalid position");

      const isAbstain = Boolean(s.is_abstain);
      const candidateId = isAbstain ? null : (s.candidate_id ?? null);

      if (!isAbstain && (!candidateId || !isUuid(String(candidateId)))) {
        throw new Error("Invalid candidate_id");
      }

      normalizedSelections.push({
        position,
        candidate_id: candidateId,
        is_abstain: isAbstain,
      });
    }
  } catch {
    return json(400, { ok: false, error: "Invalid selections" });
  }

  const { data: submitResult, error: submitErr } = await service.rpc(
    "kiosk_submit_ballot" as any,
    {
      p_voter_id: voterId,
      p_election_id: electionId,
      p_selections: normalizedSelections as any,
    } as any
  );

  if (submitErr) {
    const message = submitErr.message || "Failed to submit ballot";
    if (/not found/i.test(message) || /invalid position/i.test(message) || /duplicate positions/i.test(message) || /candidate not in election position/i.test(message) || /missing candidate/i.test(message)) {
      return json(400, { ok: false, error: message });
    }
    if (/not eligible/i.test(message)) {
      return json(403, { ok: false, error: message });
    }
    if (/outside voting period|paused|finalized|archived/i.test(message)) {
      return json(409, { ok: false, error: message });
    }
    return json(500, { ok: false, error: message });
  }

  return json(200, {
    ok: true,
    rotate_secret: rotateSecret ?? null,
    result: submitResult ?? null,
  });
}

Deno.serve(handler);
