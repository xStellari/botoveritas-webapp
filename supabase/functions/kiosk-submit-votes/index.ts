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

  // 1) Election must be operational.
  const { data: election, error: electionErr } = await service
    .from("elections")
    .select("id, is_final, is_archived, start_date, end_date")
    .eq("id", electionId)
    .maybeSingle();

  if (electionErr || !election) {
    return json(400, { ok: false, error: "Election not found" });
  }

  if ((election as any).is_final || (election as any).is_archived) {
    return json(409, { ok: false, error: "Election is finalized/archived" });
  }

  const now = new Date();
  const start = new Date((election as any).start_date);
  const end = new Date((election as any).end_date);
  if (start > now || end <= now) {
    return json(409, { ok: false, error: "Election is outside voting period" });
  }

  // 2) Eligibility check (authoritative)
  const { data: eligible, error: eligErr } = await service.rpc(
    "is_voter_eligible_for_election" as any,
    { p_voter_id: voterId, p_election_id: electionId } as any
  );

  if (eligErr) {
    return json(500, { ok: false, error: "Eligibility check failed" });
  }
  if (!eligible) {
    return json(403, { ok: false, error: "Voter not eligible" });
  }

  // 3) Upsert votes (idempotent)
  let rows: any[] = [];
  try {
    rows = selections.map((s) => {
      const position = (s.position ?? "").toString().trim();
      if (!position) throw new Error("Invalid position");

      const isAbstain = Boolean(s.is_abstain);
      const candidateId = isAbstain ? null : (s.candidate_id ?? null);

      if (!isAbstain && candidateId && !isUuid(candidateId)) {
        throw new Error("Invalid candidate_id");
      }

      return {
        voter_id: voterId,
        election_id: electionId,
        position,
        candidate_id: candidateId,
        is_abstain: isAbstain,
      };
    });
  } catch {
    return json(400, { ok: false, error: "Invalid selections" });
  }

  const { error: votesErr } = await service
    .from("votes")
    .upsert(rows as any, { onConflict: "voter_id,election_id,position" });

  if (votesErr) {
    return json(500, { ok: false, error: "Failed to persist votes" });
  }

  // 4) Mark voter as having voted (authoritative gating for ElectionSelection + eligibility RPCs)
  // NOTE: voter_election_status.voter_id is a FK to public.voters(id), so we MUST use the voters UUID.
  const votedAt = new Date().toISOString();
  const { error: statusErr } = await service
    .from("voter_election_status")
    .upsert(
      {
        voter_id: voterId,
        election_id: electionId,
        has_voted: true,
        voted_at: votedAt,
      } as any,
      { onConflict: "voter_id,election_id" }
    );

  if (statusErr) {
    return json(500, { ok: false, error: "Failed to mark voter as voted" });
  }

  return json(200, { ok: true, rotate_secret: rotateSecret ?? null });
}

Deno.serve(handler);
