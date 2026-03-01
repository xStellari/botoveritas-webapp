import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

type Body = {
  electionId: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}

function requireEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ---------- Canonical ordering helpers (kept consistent with generate-election-manifest) ----------

type CandidateRow = {
  id: string;
  election_id: string;
  position: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  slate: string | null;
  photo_url: string | null;
  bio: string | null;
};

const POSITION_ORDER = [
  "President",
  "Vice President - Internal",
  "Vice President - External",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "Public Relations Officer",
] as const;

function normalizeWhitespace(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

function normalizePosition(raw: string) {
  const s = normalizeWhitespace(raw);
  const lower = s.toLowerCase();

  // VP variants
  if (lower.includes("vp") || lower.includes("vice president")) {
    if (lower.includes("internal")) return "Vice President - Internal";
    if (lower.includes("external")) return "Vice President - External";
    return "Vice President";
  }

  // PRO variants
  if (lower === "pro" || lower.includes("public relations")) {
    return "Public Relations Officer";
  }

  // Canonical casing for key roles
  if (lower === "president") return "President";
  if (lower === "secretary") return "Secretary";
  if (lower === "treasurer") return "Treasurer";
  if (lower === "auditor") return "Auditor";

  // Default: keep original label (trimmed)
  return s;
}

function positionPriority(normalized: string) {
  const idx = POSITION_ORDER.indexOf(normalized as any);
  return idx >= 0 ? idx : 9999;
}

function splitLegacyName(name: string) {
  const cleaned = normalizeWhitespace(name);
  if (!cleaned) return { first_name: "", last_name: "" };
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first_name: "", last_name: parts[0] };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
}

function candidateSortKey(c: CandidateRow) {
  const ln = normalizeWhitespace(c.last_name ?? "");
  const fn = normalizeWhitespace(c.first_name ?? "");

  if (ln || fn) {
    return { ln: ln.toLowerCase(), fn: fn.toLowerCase() };
  }

  const legacy = splitLegacyName(c.name ?? "");
  return { ln: legacy.last_name.toLowerCase(), fn: legacy.first_name.toLowerCase() };
}

function stableStringify(value: unknown): string {
  // Deterministic JSON string for hashing (sorts object keys recursively)
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { ok: false, error: "Missing Authorization header" });

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Authed client (caller JWT) — used for identity + admin authorization.
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: "Invalid token" });
    }
    const caller = userData.user;

    // Verify caller is admin using user_roles.
    const { data: roleRow, error: roleErr } = await authed
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (roleErr) return json(500, { ok: false, error: "Failed to verify admin role", details: roleErr.message });
    if (!roleRow || roleRow.role !== "admin") return json(403, { ok: false, error: "Forbidden: admin role required" });

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    const electionId = typeof body?.electionId === "string" ? body.electionId : "";
    if (!electionId || !isUuid(electionId)) return json(400, { ok: false, error: "Invalid electionId" });

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Load election (for metadata + sanity)
    const { data: election, error: eErr } = await service
      .from("elections")
      .select("id, title, is_final, is_archived, is_active, finalized_at")
      .eq("id", electionId)
      .maybeSingle();

    if (eErr) return json(500, { ok: false, error: "Failed to load election", details: eErr.message });
    if (!election) return json(404, { ok: false, error: "Election not found" });
    if (election.is_archived) return json(409, { ok: false, error: "Election is archived" });

    // Load candidates
    const { data: candidatesData, error: cErr } = await service
      .from("candidates")
      .select("id, election_id, position, name, first_name, last_name, slate, photo_url, bio")
      .eq("election_id", electionId);

    if (cErr) return json(500, { ok: false, error: "Failed to load candidates", details: cErr.message });

    const candidates = (candidatesData ?? []) as CandidateRow[];

    // Filter legacy “abstain” candidate if it exists
    const filtered = candidates.filter((c) => normalizeWhitespace(c.name).toLowerCase() !== "abstain");

    // Group by displayed position label (keep original title, but also store normalized)
    const byPosition = new Map<string, CandidateRow[]>();
    for (const c of filtered) {
      const posTitle = normalizeWhitespace(c.position);
      if (!byPosition.has(posTitle)) byPosition.set(posTitle, []);
      byPosition.get(posTitle)!.push(c);
    }

    // Build position blocks with candidate ordering
    const positionBlocks = Array.from(byPosition.entries()).map(([posTitle, list]) => {
      const sortedCandidates = [...list].sort((a, b) => {
        const ak = candidateSortKey(a);
        const bk = candidateSortKey(b);

        if (ak.ln !== bk.ln) return ak.ln.localeCompare(bk.ln);
        if (ak.fn !== bk.fn) return ak.fn.localeCompare(bk.fn);
        return a.id.localeCompare(b.id);
      });

      return {
        title: posTitle, // display title as stored
        normalizedTitle: normalizePosition(posTitle), // canonical category for ordering
        positionKey: posTitle.toLowerCase().replace(/\s+/g, "-"),
        candidates: sortedCandidates.map((c, idx) => ({
          index: idx,
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          name: c.name, // display-only fallback
          slate: c.slate,
          photo_url: c.photo_url,
          bio: c.bio,
        })),
      };
    });

    // Sort positions: required order first, unknown positions alphabetical after
    positionBlocks.sort((a, b) => {
      const ap = positionPriority(a.normalizedTitle);
      const bp = positionPriority(b.normalizedTitle);
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });

    // Build manifest
    const manifest = {
      specVersion: "BV_ELECTION_MANIFEST_V1",
      election: {
        id: election.id,
        title: election.title,
        is_final: true, // finalization implies true
        is_archived: election.is_archived,
      },
      ordering: {
        position_order: POSITION_ORDER,
        position_fallback: "alphabetical",
        candidate_order: ["last_name", "first_name", "id"],
      },
      positions: positionBlocks.map((p, idx) => ({
        index: idx,
        title: p.title,
        normalizedTitle: p.normalizedTitle,
        positionKey: p.positionKey,
        candidates: p.candidates,
      })),
      generatedAt: new Date().toISOString(),
    };

    const manifestString = stableStringify(manifest);
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes(manifestString));

    // Save manifest first. If this fails, we DO NOT lock the election.
    const { error: upErr } = await service
      .from("election_manifests")
      .upsert(
        {
          election_id: electionId,
          spec_version: "BV_ELECTION_MANIFEST_V1",
          manifest,
          manifest_hash: manifestHash,
        } as any,
        { onConflict: "election_id" },
      );

    if (upErr) return json(500, { ok: false, error: "Failed to save manifest", details: upErr.message });

    // Now lock/finalize the election.
    // IMPORTANT RULE: Once finalized, election must no longer be considered active.
    const finalizeUpdate: Record<string, unknown> = {
      is_final: true,
      is_active: false,
    };

    // Only stamp finalized metadata if this is the first finalization.
    if (!election.is_final || !election.finalized_at) {
      finalizeUpdate.finalized_at = new Date().toISOString();
      finalizeUpdate.finalized_by = caller.id;
      finalizeUpdate.finalized_by_email = caller.email ?? null;
    }

    const { error: finErr } = await service
      .from("elections")
      .update(finalizeUpdate as any)
      .eq("id", electionId);

    if (finErr) return json(500, { ok: false, error: "Failed to finalize election", details: finErr.message });

    return json(200, {
      ok: true,
      status: election.is_final ? "finalized_already_manifest_refreshed" : "finalized_manifest_saved",
      electionId,
      manifestHash,
      positionCount: manifest.positions.length,
    });
  } catch (e) {
    console.error("[admin-finalize-election] error:", e);
    return json(500, {
      ok: false,
      error: "Unexpected error",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
