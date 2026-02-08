// supabase/functions/verify-merkle-proof/index.ts
// BotoVeritas — Merkle inclusion verification (leaf → chunkRoot → electionRoot)
//
// ✅ Uses ONLY bare specifiers (works with your deno.json imports map)
// ✅ Uses generated Database types (supabase/functions/_shared/database.types.ts)
// ✅ Matches your anchor-election-root implementation:
//    - keccak256 hashing
//    - sorted-pairs (lexicographic) before hashing
//    - "duplicate last if odd" at each Merkle level
//    - CHUNK_SIZE = 512 (default; configurable via env)
//
// Verifies:
//   1) leaf ∈ chunkRoot   (chunkProof, leafIndex)
//   2) chunkRoot ∈ electionRoot (electionProof, chunkIndex) OR compute electionRoot from DB
//   3) (optional) electionRoot matches on-chain anchored root (contract.electionBallotsRoot)
//
// -----------------------------------------------------------------------------
// Required DB table:
//   public.election_vote_chunks(
//     election_id uuid,
//     chunk_index int,
//     leaf_count int,
//     chunk_root text,
//     spec_version text,
//     ...
//   )
//
// Optional on-chain anchor verification (same env names as anchor-election-root):
//   AMOY_RPC_URL
//   ELECTION_ROOT_ANCHOR_ADDRESS
//
// Contract method expected:
//   electionBallotsRoot(bytes32 electionIdBytes32) -> bytes32
//
// -----------------------------------------------------------------------------
// ENV:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (or SERVICE_ROLE_KEY)
//   CHUNK_SIZE                  default "512"
//
// Optional auth hardening (OFF by default because you chose public):
//   REQUIRE_KIOSK_SECRET="true" and pass header x-kiosk-secret
//   KIOSK_SECRET or KIOSK_RECEIPT_SECRET
// -----------------------------------------------------------------------------

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

import type { Database } from "../_shared/database.types.ts";

type VerifyRequest = {
  electionId: string;        // UUID
  chunkIndex: number;        // which chunk the leaf belongs to
  leafIndex: number;         // index inside the chunk (0-based)
  leaf: string;              // 0x-prefixed 32-byte hex commitment

  // Merkle proof for leaf → chunkRoot
  chunkProof: string[];

  // Optional: provide expected chunkRoot (we STILL verify against DB chunk_root)
  chunkRoot?: string;

  // Merkle proof for chunkRoot → electionRoot (siblings)
  electionProof?: string[];

  // Optional: provide electionRoot (required when electionProof is provided)
  electionRoot?: string;

  // If true, compute electionRoot from DB chunk roots (ignores electionProof)
  computeElectionRootFromDb?: boolean;

  // If true, compare electionRoot to on-chain anchored root
  verifyAgainstAnchoredRoot?: boolean;
};

type VerifyResponse = {
  ok: boolean;
  chunkSize: number;

  leafValid: boolean;
  expectedChunkRoot: string;
  computedChunkRoot: string;

  electionValid?: boolean;
  expectedElectionRoot?: string;
  computedElectionRoot?: string;

  anchoredElectionRoot?: string;
  anchoredMatches?: boolean;

  details?: Record<string, unknown>;
  error?: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
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

function requireKioskSecretIfEnabled(req: Request) {
  const enabled = (Deno.env.get("REQUIRE_KIOSK_SECRET") ?? "").toLowerCase() === "true";
  if (!enabled) return null;

  const expected = requireEnvAny("KIOSK_SECRET", "KIOSK_RECEIPT_SECRET");
  const got = req.headers.get("x-kiosk-secret") || "";
  if (!got || got !== expected) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  return null;
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}

function assertHex32(label: string, v: string) {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${label} must be 0x-prefixed 32-byte hex`);
  }
}

function assertProof(label: string, arr: unknown) {
  if (!Array.isArray(arr)) throw new Error(`${label} must be an array`);
  for (let i = 0; i < arr.length; i++) {
    assertHex32(`${label}[${i}]`, String(arr[i]));
  }
}

function toLowerHex32(x: string) {
  return "0x" + x.slice(2).toLowerCase();
}

/**
 * Canonical bytes32 key for electionId (same as anchor-election-root):
 *   bytes32 electionIdBytes32 = keccak256(utf8Bytes(electionIdString))
 */
function hashUtf8ToBytes32(s: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

/**
 * Pair hash (same as anchor-election-root):
 * - sort by lowercase hex
 * - hash keccak256(concat(min, max))
 */
function keccakPairHashSorted(a: string, b: string): string {
  const aa = toLowerHex32(a);
  const bb = toLowerHex32(b);
  const [min, max] = aa <= bb ? [aa, bb] : [bb, aa];
  return ethers.keccak256(ethers.concat([min, max]));
}

/**
 * Merkle root (same as anchor-election-root):
 * - sorted pairs
 * - duplicate last if odd
 */
function merkleRootSortedPairsDuplicateLast(leaves: string[]): string {
  if (leaves.length === 0) return "0x" + "00".repeat(32);
  if (leaves.length === 1) return toLowerHex32(leaves[0]);

  let level = leaves.map(toLowerHex32);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(keccakPairHashSorted(left, right));
    }
    level = next;
  }
  return toLowerHex32(level[0]);
}

/**
 * Compute root by applying proof siblings.
 * With sorted-pairs, left/right order doesn't matter, so we don't need direction bits.
 * (index remains in the API for future upgrades and external callers.)
 */
function merkleRootFromProof(leaf: string, _index: number, proof: string[]): string {
  let acc = toLowerHex32(leaf);
  for (const sib of proof) {
    acc = keccakPairHashSorted(acc, toLowerHex32(sib));
  }
  return toLowerHex32(acc);
}

type ChunkMetaPick = Pick<
  Database["public"]["Tables"]["election_vote_chunks"]["Row"],
  "chunk_root" | "leaf_count" | "spec_version"
>;

async function readChunkRootFromDb(
  supabase: ReturnType<typeof createClient<Database>>,
  electionId: string,
  chunkIndex: number,
) {
  const { data, error } = await supabase
    .from("election_vote_chunks")
    .select("chunk_root, leaf_count, spec_version")
    .eq("election_id", electionId)
    .eq("chunk_index", chunkIndex)
    .maybeSingle<ChunkMetaPick>();

  if (error) throw new Error(`DB error reading election_vote_chunks: ${error.message}`);
  if (!data?.chunk_root) throw new Error("Chunk not found for electionId + chunkIndex");

  const chunkRoot = String(data.chunk_root);
  assertHex32("DB chunk_root", chunkRoot);

  return {
    chunkRoot: toLowerHex32(chunkRoot),
    leafCount: Number(data.leaf_count ?? 0),
    specVersion: data.spec_version ? String(data.spec_version) : null,
  };
}

type ChunkRootPick = Pick<Database["public"]["Tables"]["election_vote_chunks"]["Row"], "chunk_root" | "chunk_index">;

async function readAllChunkRootsFromDb(
  supabase: ReturnType<typeof createClient<Database>>,
  electionId: string,
) {
  const { data, error } = await supabase
    .from("election_vote_chunks")
    .select("chunk_index, chunk_root")
    .eq("election_id", electionId)
    .order("chunk_index", { ascending: true })
    .returns<ChunkRootPick[]>();

  if (error) throw new Error(`DB error reading chunk roots: ${error.message}`);

  const rows = data ?? [];
  if (!rows.length) throw new Error("No chunk roots found for electionId");

  return rows.map((r) => {
    const root = String(r.chunk_root);
    assertHex32("chunk_root", root);
    return toLowerHex32(root);
  });
}

async function readAnchoredElectionRootFromChain(electionId: string): Promise<string> {
  const rpc = Deno.env.get("AMOY_RPC_URL");
  const addr = Deno.env.get("ELECTION_ROOT_ANCHOR_ADDRESS");
  if (!rpc || !addr) throw new Error("Missing AMOY_RPC_URL or ELECTION_ROOT_ANCHOR_ADDRESS env");

  const provider = new ethers.JsonRpcProvider(rpc);

  // Minimal ABI required for read
  const abi = ["function electionBallotsRoot(bytes32) view returns (bytes32)"];

  const contract = new ethers.Contract(addr, abi, provider);
  const electionIdBytes32 = hashUtf8ToBytes32(electionId);

  const onchainRoot: string = await contract.electionBallotsRoot(electionIdBytes32);
  assertHex32("onchain election root", onchainRoot);

  return toLowerHex32(onchainRoot);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });

  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

    const authResp = requireKioskSecretIfEnabled(req);
    if (authResp) return authResp;

    const body = (await req.json()) as Partial<VerifyRequest>;

    const electionId = String(body.electionId ?? "");
    const chunkIndex = Number(body.chunkIndex);
    const leafIndex = Number(body.leafIndex);
    const leaf = String(body.leaf ?? "");

    if (!electionId) throw new Error("electionId is required");
    if (!isUuid(electionId)) throw new Error("electionId must be a UUID string");
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error("chunkIndex must be a non-negative integer");
    if (!Number.isInteger(leafIndex) || leafIndex < 0) throw new Error("leafIndex must be a non-negative integer");

    assertHex32("leaf", leaf);
    assertProof("chunkProof", body.chunkProof);

    if (body.chunkRoot) assertHex32("chunkRoot", String(body.chunkRoot));
    if (body.electionProof) assertProof("electionProof", body.electionProof);
    if (body.electionRoot) assertHex32("electionRoot", String(body.electionRoot));

    const chunkSize = Number(Deno.env.get("CHUNK_SIZE") ?? "512");

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const supabaseKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Always trust DB chunk root (prevents client bypass)
    const dbChunk = await readChunkRootFromDb(supabase, electionId, chunkIndex);
    const expectedChunkRoot = dbChunk.chunkRoot;

    const computedChunkRoot = merkleRootFromProof(leaf, leafIndex, body.chunkProof ?? []);
    const leafValid = computedChunkRoot === expectedChunkRoot;

    // Election root
    const computeElectionRootFromDb = Boolean(body.computeElectionRootFromDb);
    const hasElectionProof = Array.isArray(body.electionProof) && body.electionProof.length > 0;

    let expectedElectionRoot: string | undefined = body.electionRoot ? toLowerHex32(String(body.electionRoot)) : undefined;
    let computedElectionRoot: string | undefined;
    let electionValid: boolean | undefined;

    if (computeElectionRootFromDb) {
      const chunkRoots = await readAllChunkRootsFromDb(supabase, electionId);
      computedElectionRoot = merkleRootSortedPairsDuplicateLast(chunkRoots);
      expectedElectionRoot = expectedElectionRoot ?? computedElectionRoot;
      electionValid = computedElectionRoot === expectedElectionRoot;
    } else if (hasElectionProof) {
      if (!expectedElectionRoot) throw new Error("electionRoot is required when electionProof is provided");

      computedElectionRoot = merkleRootFromProof(expectedChunkRoot, chunkIndex, body.electionProof ?? []);
      electionValid = computedElectionRoot === expectedElectionRoot;
    }

    // Optional anchored check
    let anchoredElectionRoot: string | undefined;
    let anchoredMatches: boolean | undefined;

    if (body.verifyAgainstAnchoredRoot) {
      anchoredElectionRoot = await readAnchoredElectionRootFromChain(electionId);
      if (expectedElectionRoot) anchoredMatches = anchoredElectionRoot === expectedElectionRoot;
      else if (computedElectionRoot) anchoredMatches = anchoredElectionRoot === computedElectionRoot;
    }

    const ok =
      leafValid &&
      (electionValid === undefined ? true : electionValid) &&
      (anchoredMatches === undefined ? true : anchoredMatches);

    const resp: VerifyResponse = {
      ok,
      chunkSize,
      leafValid,
      expectedChunkRoot,
      computedChunkRoot,
      electionValid,
      expectedElectionRoot,
      computedElectionRoot,
      anchoredElectionRoot,
      anchoredMatches,
      details: {
        chunkIndex,
        leafIndex,
        dbLeafCount: dbChunk.leafCount,
        dbSpecVersion: dbChunk.specVersion,
        mode: computeElectionRootFromDb ? "computeElectionRootFromDb" : hasElectionProof ? "electionProof" : "leafOnly",
      },
    };

    return json(200, resp as unknown as Record<string, unknown>);
  } catch (e) {
    console.error("verify-merkle-proof error:", e);
    return json(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
