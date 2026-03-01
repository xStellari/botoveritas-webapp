import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

type Body = {
  electionId: string; // UUID
  // Optional flags
  strict_chunks_match?: boolean; // default true
  check_onchain?: boolean;       // default true (if envs exist)
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

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

function requireInternal(req: Request) {
  const expected = envAny("INTERNAL_WORKER_KEY");
  if (!expected) throw new Error("Missing INTERNAL_WORKER_KEY secret");
  const got = req.headers.get("x-internal-key") ?? "";
  return got === expected;
}

function requireKioskSecret(req: Request) {
  const expected = requireEnvAny("KIOSK_SECRET", "KIOSK_RECEIPT_SECRET");
  const got = req.headers.get("x-kiosk-secret") || "";
  if (!got || got !== expected) {
    return json(401, { error: "Unauthorized" });
  }
  return null;
}


async function isAdminCaller(req: Request, supabaseUrl: string, anonKey: string, serviceRoleKey?: string | null): Promise<false | true | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return false;

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    console.error("[generate-zk-tally-witness] Invalid token", { error: userErr?.message ?? String(userErr) });
    return json(401, { error: "Invalid token" });
  }

  let roleRow: { role: string } | null = null;
  let roleErr: { message: string } | null = null;

  if (serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const res = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle<{ role: string }>();
    roleRow = res.data ?? null;
    roleErr = res.error ? { message: res.error.message } : null;
  } else {
    const res = await authed
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle<{ role: string }>();
    roleRow = res.data ?? null;
    roleErr = res.error ? { message: res.error.message } : null;
  }

  // Fallback: if service-role lookup returned no row (common when misconfigured), try authed client.
  if (!roleRow && !roleErr) {
    const res2 = await authed
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle<{ role: string }>();
    roleRow = res2.data ?? null;
    roleErr = res2.error ? { message: res2.error.message } : null;
  }

  if (roleErr) {
    console.error("[generate-zk-tally-witness] Role lookup failed", { error: errMsg(roleErr) });
    return json(500, { error: "Failed to validate admin role" });
  }

  return roleRow?.role === "admin";

}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

// ✅ Must match anchor-election-root
const CHUNK_SIZE = 512;

// -------------------- Hashing + Merkle (MUST MATCH ANCHOR) --------------------

function hashUtf8ToBytes32(s: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

function bytes32Zero(): string {
  return "0x" + "00".repeat(32);
}

/**
 * Leaf hash spec (V1):
 * leaf = keccak256( concat(
 *   "BotoVeritasVoteV1",
 *   keccak(electionId),
 *   keccak(voterId),
 *   keccak(position),
 *   keccak(candidateId) OR 0x00..00,
 *   abstainByte
 *  ))
 */
function computeVoteLeaf(args: {
  electionId: string;
  voterId: string;
  position: string;
  candidateId: string | null;
  isAbstain: boolean;
}): string {
  const domain = ethers.toUtf8Bytes("BotoVeritasVoteV1");
  const electionHash = hashUtf8ToBytes32(args.electionId);
  const voterHash = hashUtf8ToBytes32(args.voterId);
  const positionHash = hashUtf8ToBytes32(args.position);
  const candidateHash = args.candidateId
    ? hashUtf8ToBytes32(args.candidateId)
    : bytes32Zero();
  const abstainByte = args.isAbstain ? "0x01" : "0x00";

  const packed = ethers.concat([
    domain,
    electionHash,
    voterHash,
    positionHash,
    candidateHash,
    abstainByte,
  ]);

  return ethers.keccak256(packed);
}

/**
 * Merkle root with:
 * - sorted pairs (min, max) before hashing
 * - duplicate last if odd count at a level
 */
function merkleRootSortedPairs(leaves: string[]): string {
  if (leaves.length === 0) return bytes32Zero();
  if (leaves.length === 1) return leaves[0];

  let level = [...leaves];

  while (level.length > 1) {
    const next: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];

      const a = left.toLowerCase();
      const b = right.toLowerCase();
      const [min, max] = a <= b ? [left, right] : [right, left];

      const parent = ethers.keccak256(ethers.concat([min, max]));
      next.push(parent);
    }

    level = next;
  }

  return level[0];
}

// -------------------- Types --------------------

type ElectionRow = {
  id: string;
  title: string;
  is_final: boolean;
};

type ManifestRow = {
  id: string;
  election_id: string;
  spec_version: string;
  manifest: any;
  manifest_hash: string;
};

type VoteRow = {
  id: string;
  voter_id: string;
  position: string;
  candidate_id: string | null;
  is_abstain: boolean | null;
  election_id: string;
  created_at: string;
};

type ChunkDbRow = {
  election_id: string;
  chunk_index: number;
  leaf_count: number;
  chunk_root: string;
  spec_version: string;
};

type TallyCandidate = {
  id: string;
  name: string;
  slate?: string | null;
  index: number;
};

type TallyPosition = {
  index: number;
  title: string;
  normalizedTitle?: string;
  positionKey?: string;
  candidates: TallyCandidate[];
};

// -------------------- Helpers --------------------

function normalizeWhitespace(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

function bytes32ToFieldDec(hex: string): string {
  const h = String(hex || "").toLowerCase();
  const clean = h.startsWith("0x") ? h : `0x${h}`;
  return BigInt(clean).toString(10);
}

function ensure0x(hex: string): string {
  const h = String(hex || "");
  return h.startsWith("0x") ? h : `0x${h}`;
}

// Builds a deterministic tally template from manifest
function extractPositionsFromManifest(manifest: any): TallyPosition[] {
  const positions = Array.isArray(manifest?.positions) ? manifest.positions : [];
  return positions.map((p: any) => {
    const candidates = Array.isArray(p?.candidates) ? p.candidates : [];
    return {
      index: Number(p?.index ?? 0),
      title: String(p?.title ?? ""),
      normalizedTitle: p?.normalizedTitle ? String(p.normalizedTitle) : undefined,
      positionKey: p?.positionKey ? String(p.positionKey) : undefined,
      candidates: candidates.map((c: any) => ({
        index: Number(c?.index ?? 0),
        id: String(c?.id ?? ""),
        name: String(c?.name ?? ""),
        slate: c?.slate ?? null,
      })),
    };
  });
}

const ELECTION_ROOT_ANCHOR_ABI = [
  "function isElectionRootAnchored(bytes32 electionId) external view returns (bool)",
  "function electionBallotsRoot(bytes32 electionId) external view returns (bytes32)",
];

// -------------------- Edge Function --------------------

serve(async (req: Request) => {
    if (!requireInternal(req)) {
      return json(401, { error: "Unauthorized" });
    }

  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    const electionId = typeof body?.electionId === "string" ? body.electionId : "";

    if (!electionId || !isUuid(electionId)) {
      return json(400, { error: "Invalid electionId" });
    }

    const strictChunksMatch = body?.strict_chunks_match !== false; // default true
    const checkOnchain = body?.check_onchain !== false;            // default true

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const anonKey = requireEnvAny("SUPABASE_ANON_KEY", "ANON_KEY");

    // Auth strategy:
    // - If caller provides an Authorization Bearer token, require that they are an admin (do NOT require kiosk secret).
    // - If no Authorization token is provided (kiosk/automation callers), fall back to kiosk secret.
    const serviceRoleKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");
    const hasAuth = !!(req.headers.get("Authorization") ?? "");
    const adminOk = hasAuth ? await isAdminCaller(req, supabaseUrl, anonKey, serviceRoleKey) : false;
    if (adminOk instanceof Response) return adminOk;

    if (hasAuth) {
      if (!adminOk) return json(403, { error: "Forbidden", reason: "Not admin" });
    } else {
      const authErr = requireKioskSecret(req);
      if (authErr) return authErr;
    }

    const serviceRoleRequired = requireEnvAny("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleRequired, {
      auth: { persistSession: false },
    });

    // 1) Load election + require finalized (to match anchoring rules)
    const { data: election, error: eErr } = await (supabase as any)
      .from("elections")
      .select("id,title,is_final")
      .eq("id", electionId)
      .maybeSingle();

    if (eErr) return json(500, { error: "Failed to load election", details: errMsg(eErr) });
    if (!election) return json(404, { error: "Election not found" });

    const electionRow = election as ElectionRow;
    if (!electionRow.is_final) {
      return json(409, {
        error: "Election is not finalized",
        hint: "Finalize the election first. ZK witness must bind to a final election.",
      });
    }

    // 2) Load manifest (must exist & be canonical)
    const { data: manifestRow, error: mErr } = await (supabase as any)
      .from("election_manifests")
      .select("id,election_id,spec_version,manifest,manifest_hash")
      .eq("election_id", electionId)
      .maybeSingle();

    if (mErr) return json(500, { error: "Failed to load manifest", details: errMsg(mErr) });
    if (!manifestRow) {
      return json(404, {
        error: "Election manifest not found",
        hint: "Run anchor-election-root (it generates manifest) or generate-election-manifest first.",
      });
    }

    const manifest = manifestRow as ManifestRow;
    const manifestHash = String(manifest.manifest_hash || "");

    if (!manifestHash || !manifestHash.startsWith("0x") || manifestHash.length !== 66) {
      return json(500, {
        error: "Invalid manifest_hash stored",
        details: { manifest_hash: manifestHash },
        hint: "manifest_hash should be a 32-byte keccak hex (0x + 64 hex chars).",
      });
    }

    const manifestPositions = extractPositionsFromManifest(manifest.manifest);

    // Build quick lookup: positionTitle -> {candidateId -> candidateIndex}
    const posMap = new Map<string, { posIndex: number; candMap: Map<string, number> }>();
    for (const p of manifestPositions) {
      const key = normalizeWhitespace(p.title);
      const candMap = new Map<string, number>();
      for (const c of p.candidates) candMap.set(String(c.id), Number(c.index));
      posMap.set(key, { posIndex: Number(p.index), candMap });
    }

    // 3) Load votes in deterministic order (MUST MATCH anchor-election-root)
    const { data: votesRaw, error: vErr } = await (supabase as any)
      .from("votes")
      .select("id,voter_id,position,candidate_id,is_abstain,election_id,created_at")
      .eq("election_id", electionId)
      .order("voter_id", { ascending: true })
      .order("position", { ascending: true })
      .order("candidate_id", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (vErr) return json(500, { error: "Failed to load votes", details: errMsg(vErr) });

    const votes = (votesRaw ?? []) as VoteRow[];

    if (votes.length === 0) {
      return json(409, {
        error: "No votes found for this election",
        hint: "Cannot generate ZK witness for an empty election.",
      });
    }

    // 4) Compute vote leaves
    const leaves = votes.map((v) =>
      computeVoteLeaf({
        electionId: v.election_id,
        voterId: v.voter_id,
        position: v.position,
        candidateId: v.candidate_id ?? null,
        isAbstain: !!v.is_abstain,
      })
    );

    // 5) Chunk leaves -> chunkRoots
    const chunkRoots: string[] = [];
    const computedChunkRows: Array<{ chunk_index: number; leaf_count: number; chunk_root: string }> = [];

    for (let i = 0; i < leaves.length; i += CHUNK_SIZE) {
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const chunkLeaves = leaves.slice(i, i + CHUNK_SIZE);
      const chunkRoot = merkleRootSortedPairs(chunkLeaves);

      chunkRoots.push(chunkRoot);
      computedChunkRows.push({
        chunk_index: chunkIndex,
        leaf_count: chunkLeaves.length,
        chunk_root: chunkRoot,
      });
    }

    // 6) electionRoot = MerkleRoot(chunkRoots)
    const electionRootComputed = merkleRootSortedPairs(chunkRoots);

    // 6.1) Load persisted canonical election root (if available)
    let electionRoot = electionRootComputed;
    let dbRootCheck: any = null;
    const { data: dbRootRow, error: dbRootErr } = await (supabase as any)
      .from("election_vote_roots")
      .select("election_id,election_vote_root,chunk_count,computed_at")
      .eq("election_id", electionId)
      .maybeSingle();

    if (dbRootErr) {
      dbRootCheck = { status: "skipped", reason: "Failed to load election_vote_roots", details: errMsg(dbRootErr) };
    } else if (dbRootRow && (dbRootRow as any).election_vote_root) {
      const stored = ensure0x(String((dbRootRow as any).election_vote_root));
      const matches = stored.toLowerCase() === electionRootComputed.toLowerCase();
      dbRootCheck = { status: "present", matches_computed: matches, stored_root: stored, computed_root: electionRootComputed };
      // Prefer stored root for public inputs (canonical), but keep mismatch info for debugging
      electionRoot = stored;
      if (!matches && strictChunksMatch) {
        return json(409, {
          error: "Persisted election root does not match computed root",
          electionId,
          stored_root: stored,
          computed_root: electionRootComputed,
          hint: "Re-run anchor-election-root for this election (or disable strict_chunks_match).",
        });
      }
    } else {
      dbRootCheck = { status: "missing", warning: "No election_vote_roots row found; using computed root." };
    }


    // 7) Optional: compare against DB chunks (from election_vote_chunks)
    let dbChunkCheck: any = null;

    const { data: dbChunksRaw, error: dbChunksErr } = await (supabase as any)
      .from("election_vote_chunks")
      .select("election_id,chunk_index,leaf_count,chunk_root,spec_version")
      .eq("election_id", electionId)
      .order("chunk_index", { ascending: true });

    if (dbChunksErr) {
      dbChunkCheck = {
        status: "skipped",
        reason: "Failed to load election_vote_chunks",
        details: errMsg(dbChunksErr),
      };
    } else {
      const dbChunks = (dbChunksRaw ?? []) as ChunkDbRow[];

      // If table empty, we still allow witness generation (but warn)
      if (!dbChunks.length) {
        dbChunkCheck = {
          status: "missing",
          warning: "No election_vote_chunks rows found. Anchor may not have been executed for this election.",
        };
      } else {
        const mismatches: any[] = [];
        const len = Math.max(dbChunks.length, computedChunkRows.length);

        for (let i = 0; i < len; i++) {
          const db = dbChunks[i];
          const co = computedChunkRows[i];

          if (!db || !co) {
            mismatches.push({
              chunk_index: i,
              db: db ?? null,
              computed: co ?? null,
              reason: "Chunk count mismatch",
            });
            continue;
          }

          const rootMatch = String(db.chunk_root).toLowerCase() === String(co.chunk_root).toLowerCase();
          const leafMatch = Number(db.leaf_count) === Number(co.leaf_count);

          if (!rootMatch || !leafMatch) {
            mismatches.push({
              chunk_index: i,
              db: { chunk_root: db.chunk_root, leaf_count: db.leaf_count, spec_version: db.spec_version },
              computed: { chunk_root: co.chunk_root, leaf_count: co.leaf_count, spec_version: "BV_VOTE_LEAF_V1__CHUNKED_ROOT_V1" },
              rootMatch,
              leafMatch,
            });
          }
        }

        dbChunkCheck = mismatches.length
          ? { status: "mismatch", mismatches, dbChunkCount: dbChunks.length, computedChunkCount: computedChunkRows.length }
          : { status: "match", dbChunkCount: dbChunks.length, computedChunkCount: computedChunkRows.length };
      }
    }

    if (strictChunksMatch && dbChunkCheck?.status === "mismatch") {
      return json(409, {
        error: "Computed chunks do not match persisted election_vote_chunks",
        hint: "This indicates different ordering/hashing rules. Regenerate chunks by re-running anchor-election-root with the canonical rules.",
        dbChunkCheck,
      dbRootCheck,
      });
    }

    // 8) Optional: check on-chain root (read-only)
    let onchainCheck: any = { status: "skipped" };

    const rpcUrl = envAny("AMOY_RPC_URL");
    const anchorAddress = envAny("ELECTION_ROOT_ANCHOR_ADDRESS");

    const electionIdBytes32 = hashUtf8ToBytes32(electionId);

    if (checkOnchain && rpcUrl && anchorAddress) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(anchorAddress, ELECTION_ROOT_ANCHOR_ABI, provider);

        const anchored: boolean = await contract.isElectionRootAnchored(electionIdBytes32);
        if (!anchored) {
          onchainCheck = { status: "not_anchored", anchored: false, anchorAddress };
        } else {
          const onchainRoot: string = await contract.electionBallotsRoot(electionIdBytes32);
          const matches = String(onchainRoot).toLowerCase() === String(electionRoot).toLowerCase();
          onchainCheck = { status: "anchored", anchored: true, anchorAddress, onchainRoot, matches };
        }
      } catch (e) {
        onchainCheck = {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          hint: "Ensure AMOY_RPC_URL and ELECTION_ROOT_ANCHOR_ADDRESS are correct and reachable.",
        };
      }
    } else if (checkOnchain) {
      onchainCheck = {
        status: "skipped",
        reason: "Missing AMOY_RPC_URL or ELECTION_ROOT_ANCHOR_ADDRESS",
      };
    }

    // 9) Compute tallies based on manifest ordering
    // Output arrays: tallies[positionIndex][candidateIndex] = count, plus abstain per position
    const positionCount = manifestPositions.length;

    // For each position, size = number of candidates
    const candidateCounts: number[][] = manifestPositions.map((p) =>
      new Array(p.candidates.length).fill(0)
    );
    const abstainCounts: number[] = new Array(positionCount).fill(0);

    // Also track unknown votes (should be 0 if manifest matches ballots)
    const unknown: Array<{
      vote_id: string;
      position: string;
      candidate_id: string | null;
      is_abstain: boolean;
      reason: string;
    }> = [];

    for (const v of votes) {
      const posTitle = normalizeWhitespace(v.position);
      const entry = posMap.get(posTitle);

      if (!entry) {
        unknown.push({
          vote_id: v.id,
          position: v.position,
          candidate_id: v.candidate_id ?? null,
          is_abstain: !!v.is_abstain,
          reason: "Position not found in manifest",
        });
        continue;
      }

      const pIdx = entry.posIndex;

      if (!!v.is_abstain) {
        abstainCounts[pIdx] = (abstainCounts[pIdx] ?? 0) + 1;
        continue;
      }

      const candId = v.candidate_id ?? null;
      if (!candId) {
        unknown.push({
          vote_id: v.id,
          position: v.position,
          candidate_id: null,
          is_abstain: !!v.is_abstain,
          reason: "Non-abstain vote with null candidate_id",
        });
        continue;
      }

      const cIdx = entry.candMap.get(String(candId));
      if (cIdx === undefined) {
        unknown.push({
          vote_id: v.id,
          position: v.position,
          candidate_id: candId,
          is_abstain: !!v.is_abstain,
          reason: "Candidate not found in manifest for position",
        });
        continue;
      }

      candidateCounts[pIdx][cIdx] = (candidateCounts[pIdx][cIdx] ?? 0) + 1;
    }

    // 10) Build witness payload
    const foldVector = (() => {
      const out: number[] = [];
      for (let i = 0; i < abstainCounts.length; i++) {
        out.push(abstainCounts[i] ?? 0);
        const row = candidateCounts[i] ?? [];
        for (const c of row) out.push(c ?? 0);
      }
      return out;
    })();

    // 10.1) Compute resultsHashField in-edge (deployment-ready)
    // Must match zk/scripts/compute-results-hash.ts + generated circuit.
    const resultsCommitDomainField = "123456789";
    const { computeResultsHashField } = await import("../_shared/poseidonFold.ts");
    const resultsHashField = await computeResultsHashField({
      domain: resultsCommitDomainField,
      electionIdHashField: bytes32ToFieldDec(electionIdBytes32),
      electionVoteRootField: bytes32ToFieldDec(ensure0x(electionRoot)),
      manifestHashField: bytes32ToFieldDec(ensure0x(manifestHash)),
      foldVector,
    });

    const witness = {
      specVersion: "BV_ZK_TALLY_WITNESS_V1",
      election: {
        id: electionRow.id,
        title: electionRow.title,
        is_final: electionRow.is_final,
      },
      commitments: {
        electionIdBytes32,   // keccak(utf8(uuid))
        manifestHash,        // stored keccak(stableStringify(manifest))
        chunkSize: CHUNK_SIZE,
        totalLeaves: leaves.length,
        chunkCount: chunkRoots.length,
        computedElectionRoot: electionRootComputed,
        electionRoot: electionRoot,
      },
      publicInputs: {
        // snarkjs publicSignals want field elements (decimal strings)
        // Order (BV_TALLY_PROOF_V1):
        // [0] electionIdHash
        // [1] electionVoteRoot
        // [2] manifestHash
        // [3] resultsHash  (computed during proving; NOT computed in this edge function)
        electionIdHashField: bytes32ToFieldDec(electionIdBytes32),
        electionVoteRootField: bytes32ToFieldDec(ensure0x(electionRoot)),
        manifestHashField: bytes32ToFieldDec(ensure0x(manifestHash)),
        // Domain constant used by zk/circuits/tally.circom Poseidon fold
        resultsCommitDomainField,
        resultsHashField,
      },
      circuitInputs: {
        // Maps 1:1 with generated zk/circuits/tally.circom signals
        abstain: abstainCounts,
        countsByPosition: candidateCounts,
        // Flattened in fold order: (abstain0, counts0..., abstain1, counts1..., ...)
        foldVector,
      },
      integrity: {
        dbChunkCheck,
      dbRootCheck,
        onchainCheck,
        unknownVoteCount: unknown.length,
        unknownVotesPreview: unknown.slice(0, 10), // keep response light
      },
      tally: {
        positionCount,
        // Provide manifest positions with candidate metadata (to keep the witness self-contained)
        positions: manifestPositions.map((p, i) => ({
          index: p.index,
          title: p.title,
          normalizedTitle: p.normalizedTitle,
          positionKey: p.positionKey,
          candidates: p.candidates.map((c) => ({
            index: c.index,
            id: c.id,
            name: c.name,
            slate: c.slate ?? null,
            votes: candidateCounts[i]?.[c.index] ?? 0,
          })),
          abstain: abstainCounts[i] ?? 0,
          totalBallotsForPosition:
            (candidateCounts[i]?.reduce((a, b) => a + b, 0) ?? 0) + (abstainCounts[i] ?? 0),
        })),
        // Circuit-friendly raw arrays (index-aligned)
        candidateCounts,
        abstainCounts,
      },
      generatedAt: new Date().toISOString(),
    };

    return json(200, {
      status: "ok",
      witness,
    });
  } catch (e) {
    console.error("generate-zk-tally-witness error:", e);
    return json(500, {
      error: "Unexpected error",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});