import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { requireAdmin } from "../_shared/requireAdmin.ts";

import {
  BV_VOTE_CHUNK_SPEC_V1,
  BV_ELECTION_MANIFEST_V1,
  CHUNK_SIZE,
  hashUtf8ToBytes32,
  bytes32Zero,
  computeVoteLeaf,
  merkleRootSortedPairs,
} from "../_shared/bvCrypto.ts";

type Body = {
  electionId: string; // UUID string
};


type VoteRow = {
  id: string;
  voter_id: string;
  position: string;
  candidate_id: string | null;
  is_abstain: boolean | null;
  election_id: string;
};

type ChunkRowUpsert = {
  election_id: string;
  chunk_index: number;
  leaf_count: number;
  chunk_root: string;
  spec_version: string;
};

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

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return null;
}

function requireEnvAny(...names: string[]) {
  const v = envAny(...names);
  if (!v) throw new Error(`Missing required secret: ${names.join(" OR ")}`);
  return v;
}

function requireKioskSecret(req: Request) {
  const expected = requireEnvAny("KIOSK_SECRET", "KIOSK_RECEIPT_SECRET");
  const got = req.headers.get("x-kiosk-secret") || "";
  if (!got || got !== expected) {
    return json(401, { error: "Unauthorized" });
  }
  return null;
}


async function isAdminCaller(req: Request, supabaseUrl: string, anonKey: string): Promise<false | true | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return false;

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    console.error("[anchor-election-root] Invalid token", { error: userErr?.message ?? String(userErr) });
    return json(401, { error: "Invalid token" });
  }

  const { data: roleRow, error: roleErr } = await authed
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle<{ role: string }>();

  if (roleErr) {
    console.error("[anchor-election-root] Role lookup failed", { error: roleErr.message });
    return json(500, { error: "Failed to validate admin role" });
  }

  return roleRow?.role === "admin";
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}


// -------------------- Manifest generation (bound to anchoring) --------------------

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

  if (lower.includes("vp") || lower.includes("vice president")) {
    if (lower.includes("internal")) return "Vice President - Internal";
    if (lower.includes("external")) return "Vice President - External";
    return "Vice President";
  }

  if (lower === "pro" || lower.includes("public relations")) {
    return "Public Relations Officer";
  }

  if (lower === "president") return "President";
  if (lower === "secretary") return "Secretary";
  if (lower === "treasurer") return "Treasurer";
  if (lower === "auditor") return "Auditor";

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

  if (ln || fn) return { ln: ln.toLowerCase(), fn: fn.toLowerCase() };

  const legacy = splitLegacyName(c.name ?? "");
  return { ln: legacy.last_name.toLowerCase(), fn: legacy.first_name.toLowerCase() };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

async function generateAndUpsertManifest(args: {
  supabase: any; // ✅ avoid Supabase "never" typing inside Edge Function
  electionId: string;
  electionTitle: string;
  isFinal: boolean;
}): Promise<{ manifestHash: string; positionCount: number }> {
  const { supabase, electionId, electionTitle, isFinal } = args;

  const { data: candidatesData, error: cErr } = await supabase
    .from("candidates")
    .select("id, election_id, position, name, first_name, last_name, slate, photo_url, bio")
    .eq("election_id", electionId);

  if (cErr) throw new Error(`Failed to load candidates: ${cErr.message}`);

  const candidates = (candidatesData ?? []) as CandidateRow[];
  const filtered = candidates.filter((c) => normalizeWhitespace(c.name).toLowerCase() !== "abstain");

  const byPosition = new Map<string, CandidateRow[]>();
  for (const c of filtered) {
    const posTitle = normalizeWhitespace(c.position);
    if (!byPosition.has(posTitle)) byPosition.set(posTitle, []);
    byPosition.get(posTitle)!.push(c);
  }

  const positionBlocks = Array.from(byPosition.entries()).map(([posTitle, list]) => {
    const sortedCandidates = [...list].sort((a, b) => {
      const ak = candidateSortKey(a);
      const bk = candidateSortKey(b);
      if (ak.ln !== bk.ln) return ak.ln.localeCompare(bk.ln);
      if (ak.fn !== bk.fn) return ak.fn.localeCompare(bk.fn);
      return a.id.localeCompare(b.id);
    });

    return {
      title: posTitle,
      normalizedTitle: normalizePosition(posTitle),
      positionKey: posTitle.toLowerCase().replace(/\s+/g, "-"),
      candidates: sortedCandidates.map((c, idx) => ({
        index: idx,
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        name: c.name,
        slate: c.slate,
        photo_url: c.photo_url,
        bio: c.bio,
      })),
    };
  });

  positionBlocks.sort((a, b) => {
    const ap = positionPriority(a.normalizedTitle);
    const bp = positionPriority(b.normalizedTitle);
    if (ap !== bp) return ap - bp;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  const manifest = {
    specVersion: BV_ELECTION_MANIFEST_V1,
    election: { id: electionId, title: electionTitle, is_final: isFinal },
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

  const { error: upErr } = await supabase
    .from("election_manifests")
    .upsert(
      {
        election_id: electionId,
        spec_version: BV_ELECTION_MANIFEST_V1,
        manifest,
        manifest_hash: manifestHash,
      },
      { onConflict: "election_id" },
    );

  if (upErr) throw new Error(`Failed to save manifest: ${upErr.message}`);

  return { manifestHash, positionCount: manifest.positions.length };
}

// -------------------- On-chain anchor --------------------

const ELECTION_ROOT_ANCHOR_ABI = [
  // ZK v2 canonical anchor (root + manifest)
  "function anchorElection(bytes32 electionId, bytes32 merkleRoot, bytes32 manifestHash) external",
  "function anchorElectionBallotsRoot(bytes32 electionId, bytes32 merkleRoot) external",
  "function isElectionRootAnchored(bytes32 electionId) external view returns (bool)",
  "function electionBallotsRoot(bytes32 electionId) external view returns (bytes32)",
  "function electionManifestHash(bytes32 electionId) external view returns (bytes32)",
];

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY", "ANON_KEY");

    // Allow either: (A) authenticated admin, or (B) kiosk secret header (legacy)
    const adminOk = await isAdminCaller(req, supabaseUrl, anonKey);
    if (adminOk instanceof Response) return adminOk;
    if (!adminOk) {
      const authErr = requireKioskSecret(req);
      if (authErr) return authErr;
    }

    const serviceRole = requireEnvAny("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

    try {
      await requireAdmin({ req, supabaseUrl, anonKey, serviceRoleKey: serviceRole });
    } catch (e: any) {
      const status = e?.status ?? 500;
      return json(status, { error: e?.message ?? String(e) });
    }
    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    const electionId = typeof body?.electionId === "string" ? body.electionId : "";

    if (!electionId || !isUuid(electionId)) {
      return json(400, { error: "Invalid electionId" });
    }

    // 1) Ensure election is final
    const { data: electionRow, error: electionErr } = await (supabase as any)
      .from("elections")
      .select("id, title, is_final")
      .eq("id", electionId)
      .maybeSingle();

    if (electionErr) return json(500, { error: "Failed to load election", details: electionErr.message });
    if (!electionRow) return json(404, { error: "Election not found" });

    if (!electionRow.is_final) {
      return json(409, {
        error: "Election is not finalized",
        hint: "Finalize the election first before anchoring the ballot root.",
      });
    }

    // 2) Prevent re-anchoring: once a root is stored, it is immutable
    const { data: existingRoot, error: erErr } = await supabase
      .from("election_vote_roots")
      .select("election_id, election_vote_root, computed_at")
      .eq("election_id", electionId)
      .maybeSingle();

    if (erErr) return json(500, { error: "Failed to check existing election root", details: erErr.message });
    if (existingRoot) {
      return json(409, {
        error: "Election vote root already exists for this election",
        election_vote_root: existingRoot.election_vote_root,
      });
    }

    // 3) Generate + upsert canonical manifest FIRST
    let manifestHash = "";
    let manifestPositionCount = 0;

    try {
      const res = await generateAndUpsertManifest({
        supabase: supabase as any,
        electionId,
        electionTitle: electionRow.title,
        isFinal: !!electionRow.is_final,
      });
      manifestHash = res.manifestHash;
      manifestPositionCount = res.positionCount;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json(500, {
        error: "Failed to generate election manifest",
        details: msg,
        hint: "Ensure election_manifests exists and candidates are readable for this election.",
      });
    }

    // 3) Load votes in deterministic order
    const { data: votesRaw, error: votesErr } = await (supabase as any)
      .from("votes")
      .select("id, voter_id, position, candidate_id, is_abstain, election_id")
      .eq("election_id", electionId)
      .order("voter_id", { ascending: true })
      .order("position", { ascending: true })
      .order("candidate_id", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (votesErr) return json(500, { error: "Failed to load votes", details: votesErr.message });

    const votes = (votesRaw ?? []) as VoteRow[];

    if (votes.length === 0) {
      return json(409, {
        error: "No votes found for this election",
        hint: "Cannot anchor an empty election. Ensure vote rows exist.",
      });
    }

    // 4) votes -> leaves
    const leaves = votes.map((v) =>
      computeVoteLeaf({
        electionId: v.election_id,
        voterId: v.voter_id,
        position: v.position,
        candidateId: v.candidate_id ?? null,
        isAbstain: !!v.is_abstain,
      })
    );

    // 5) chunk leaves -> chunkRoots
    const chunkRoots: string[] = [];
    const chunkRows: ChunkRowUpsert[] = [];

    for (let i = 0; i < leaves.length; i += CHUNK_SIZE) {
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const chunkLeaves = leaves.slice(i, i + CHUNK_SIZE);
      const chunkRoot = merkleRootSortedPairs(chunkLeaves);

      chunkRoots.push(chunkRoot);

      chunkRows.push({
        election_id: electionId,
        chunk_index: chunkIndex,
        leaf_count: chunkLeaves.length,
        chunk_root: chunkRoot,
        spec_version: BV_VOTE_CHUNK_SPEC_V1,
      });
    }

    // 6) electionRoot = MerkleRoot(chunkRoots)
    const electionRoot = merkleRootSortedPairs(chunkRoots);

    // 7) persist chunk metadata
    const { error: chunkUpsertErr } = await (supabase as any)
      .from("election_vote_chunks")
      .upsert(chunkRows, { onConflict: "election_id,chunk_index" });

    if (chunkUpsertErr) {
      return json(500, {
        error: "Failed to persist election vote chunks",
        details: chunkUpsertErr.message,
        hint: "Ensure public.election_vote_chunks table exists (Step 4.1 SQL).",
      });
    }


    // 7.5) persist canonical election vote root (for ZK public inputs)
    const { error: rootUpsertErr } = await (supabase as any)
      .from("election_vote_roots")
      .upsert(
        {
          election_id: electionId,
          election_vote_root: electionRoot,
          chunk_count: chunkRows.length,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "election_id" },
      );

    if (rootUpsertErr) {
      return json(500, {
        error: "Failed to persist election vote root",
        details: rootUpsertErr.message,
        hint: "Ensure public.election_vote_roots table exists (you created it).",
      });
    }

    // 8) anchor on-chain
    const rpcUrl = requireEnvAny("AMOY_RPC_URL");
    const ownerPk = requireEnvAny("ANCHOR_OWNER_PRIVATE_KEY", "MINTER_PRIVATE_KEY");
    const anchorAddress = requireEnvAny("ELECTION_ROOT_ANCHOR_ADDRESS");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(ownerPk, provider);
    const contract = new ethers.Contract(anchorAddress, ELECTION_ROOT_ANCHOR_ABI, wallet);

    const electionIdBytes32 = hashUtf8ToBytes32(electionId);

    const alreadyAnchored: boolean = await contract.isElectionRootAnchored(electionIdBytes32);

    if (alreadyAnchored) {
      const onchainRoot: string = await contract.electionBallotsRoot(electionIdBytes32);
      let onchainManifest: string | null = null;
      try {
        onchainManifest = await contract.electionManifestHash(electionIdBytes32);
      } catch {
        // Legacy deployments may not have manifest anchoring.
        onchainManifest = null;
      }
      const matches = onchainRoot.toLowerCase() === electionRoot.toLowerCase();
      const manifestMatches = onchainManifest
        ? onchainManifest.toLowerCase() === manifestHash.toLowerCase()
        : null;

      return json(200, {
        status: "already_anchored",
        mode: "root_of_roots",
        electionId,
        electionIdBytes32,
        manifestHash,
        manifestPositionCount,
        chunkSize: CHUNK_SIZE,
        totalLeaves: leaves.length,
        chunkCount: chunkRoots.length,
        computedElectionRoot: electionRoot,
        onchainElectionRoot: onchainRoot,
        onchainManifestHash: onchainManifest,
        matches,
        manifestMatches,
        warning: matches
          ? null
          : "On-chain root differs from computed root. This indicates different anchoring rules were used previously.",
      });
    }

    // Prefer ZK v2 canonical anchor (root + manifest). Fall back to legacy root-only anchor.
    let tx: any;
    try {
      tx = await contract.anchorElection(electionIdBytes32, electionRoot, manifestHash);
    } catch (e) {
      console.warn("[anchor-election-root] anchorElection unavailable, falling back to anchorElectionBallotsRoot", e);
      tx = await contract.anchorElectionBallotsRoot(electionIdBytes32, electionRoot);
    }
    const receipt = await tx.wait();

    const explorerBase = envAny("AMOY_EXPLORER_BASE") || "https://amoy.polygonscan.com";
    const txHash = receipt?.hash || tx.hash;

    return json(200, {
      status: "anchored",
      mode: "root_of_roots",
      electionId,
      electionIdBytes32,
      manifestHash,
      manifestPositionCount,
      chunkSize: CHUNK_SIZE,
      totalLeaves: leaves.length,
      chunkCount: chunkRoots.length,
      electionRoot,
      txHash,
      explorerTxUrl: `${explorerBase}/tx/${txHash}`,
    });
  } catch (e) {
    console.error("anchor-election-root error:", e);
    return json(500, {
      error: "Unexpected error",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
