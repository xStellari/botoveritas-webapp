// supabase/functions/generate-merkle-proof/index.ts
// BotoVeritas — Merkle proof package generator
//
// ✅ Uses ONLY bare specifiers (compatible with your deno.json import map)
// ✅ Uses generated Database types: supabase/functions/_shared/database.types.ts
// ✅ Mirrors anchor-election-root exactly:
//    - vote ordering
//    - leaf spec (BotoVeritasVoteV1 domain)
//    - keccak256 + sorted-pairs + duplicate-last
//    - CHUNK_SIZE = 512
//
// Purpose:
//   Given a voteId, generate the proof package needed to verify:
//     leaf → chunkRoot → electionRoot (+ optional on-chain match)
//
// Recommended flow (public):
//   1) Call this function with { voteId }
//   2) Feed its output into verify-merkle-proof
//
// ENV (same as your other functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
//
// Optional on-chain anchor verification:
//   AMOY_RPC_URL
//   ELECTION_ROOT_ANCHOR_ADDRESS

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

import type { Database } from "../_shared/database.types.ts";

type Body = {
  voteId: string; // UUID
  verifyAgainstAnchoredRoot?: boolean; // default true
};

type VoteRow = Pick<
  Database["public"]["Tables"]["votes"]["Row"],
  "id" | "voter_id" | "position" | "candidate_id" | "is_abstain" | "election_id"
>;

type ProofPackage = {
  ok: true;

  specVersion: "BV_VOTE_LEAF_V1__CHUNKED_ROOT_V1";
  chunkSize: number;

  voteId: string;
  electionId: string;

  // canonical ordered indices
  leafIndex: number;       // global index among all leaves for election
  chunkIndex: number;      // global chunk index
  indexInChunk: number;    // leaf index inside chunk

  // leaf + proofs
  leaf: string;
  chunkRoot: string;
  leafToChunkProof: string[];

  computedElectionRoot: string;
  chunkToElectionProof: string[];

  // optional on-chain compare
  electionIdBytes32: string;
  onchainElectionRoot?: string;
  matchesOnchain?: boolean;

  details: {
    totalVotes: number;
    totalChunks: number;
    chunkLeafCount: number;
  };
};

type ErrorResp = { ok: false; error: string };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function requireEnvAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  throw new Error(`Missing required secret: ${names.join(" OR ")}`);
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}

function assertHex32(label: string, v: string) {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${label} must be 0x-prefixed 32-byte hex`);
  }
}

function toLowerHex32(x: string) {
  return "0x" + x.slice(2).toLowerCase();
}

function hashUtf8ToBytes32(s: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

function bytes32Zero(): string {
  return "0x" + "00".repeat(32);
}

/**
 * Leaf hash spec (V1) — copied from anchor-election-root:
 *
 * leaf = keccak256( concat(
 *   "BotoVeritasVoteV1",
 *   keccak(electionId),
 *   keccak(voterId),
 *   keccak(position),
 *   keccak(candidateId) OR 0x00..00,
 *   abstainByte (0x01 if true else 0x00)
 * ))
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
  const candidateHash = args.candidateId ? hashUtf8ToBytes32(args.candidateId) : bytes32Zero();
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
 * Pair hash (V1) — matches anchor-election-root:
 * - sort by lowercase hex
 * - keccak256(concat(min, max))
 */
function keccakPairHashSorted(a: string, b: string): string {
  const aa = toLowerHex32(a);
  const bb = toLowerHex32(b);
  const [min, max] = aa <= bb ? [aa, bb] : [bb, aa];
  return ethers.keccak256(ethers.concat([min, max]));
}

/**
 * Build Merkle layers using:
 * - sorted-pairs hashing
 * - duplicate-last if odd
 *
 * layers[0] = leaves
 * layers[last][0] = root
 */
function buildMerkleLayers(leaves: string[]): string[][] {
  const layers: string[][] = [];
  let level = leaves.map(toLowerHex32);
  layers.push(level);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(keccakPairHashSorted(left, right));
    }
    level = next;
    layers.push(level);
  }

  return layers;
}

function merkleRootFromLeaves(leaves: string[]): string {
  if (leaves.length === 0) return bytes32Zero();
  if (leaves.length === 1) return toLowerHex32(leaves[0]);
  const layers = buildMerkleLayers(leaves);
  return toLowerHex32(layers[layers.length - 1][0]);
}

function merkleProofForIndex(leaves: string[], leafIndex: number): { proof: string[]; root: string } {
  if (leaves.length === 0) {
    return { proof: [], root: bytes32Zero() };
  }
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error("leafIndex out of range for provided leaves");
  }

  const layers = buildMerkleLayers(leaves);
  const proof: string[] = [];
  let idx = leafIndex;

  for (let level = 0; level < layers.length - 1; level++) {
    const arr = layers[level];
    const siblingIdx = idx ^ 1;
    const sib = siblingIdx < arr.length ? arr[siblingIdx] : arr[idx]; // duplicate-last
    proof.push(toLowerHex32(sib));
    idx = Math.floor(idx / 2);
  }

  const root = toLowerHex32(layers[layers.length - 1][0]);
  return { proof, root };
}

function chunkIndexOf(globalIndex: number, chunkSize: number) {
  return Math.floor(globalIndex / chunkSize);
}

function indexInChunkOf(globalIndex: number, chunkSize: number) {
  return globalIndex % chunkSize;
}

async function readAnchoredElectionRootFromChain(electionId: string): Promise<string> {
  const rpc = Deno.env.get("AMOY_RPC_URL");
  const addr = Deno.env.get("ELECTION_ROOT_ANCHOR_ADDRESS");
  if (!rpc || !addr) throw new Error("Missing AMOY_RPC_URL or ELECTION_ROOT_ANCHOR_ADDRESS env");

  const provider = new ethers.JsonRpcProvider(rpc);
  const abi = ["function electionBallotsRoot(bytes32) view returns (bytes32)"];
  const contract = new ethers.Contract(addr, abi, provider);

  const electionIdBytes32 = hashUtf8ToBytes32(electionId);
  const onchainRoot: string = await contract.electionBallotsRoot(electionIdBytes32);
  assertHex32("onchain election root", onchainRoot);

  return toLowerHex32(onchainRoot);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" } satisfies ErrorResp);

  try {
    const body = (await req.json()) as Partial<Body>;
    const voteId = String(body.voteId ?? "");
    if (!voteId) throw new Error("voteId is required");
    if (!isUuid(voteId)) throw new Error("voteId must be a UUID string");

    const verifyAgainstAnchoredRoot = body.verifyAgainstAnchoredRoot !== false; // default true

    const chunkSize = 512; // locked (matches anchor-election-root)

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const supabaseKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // 1) Load the target vote row (to get electionId, and later compute leaf)
    const { data: targetVote, error: voteErr } = await supabase
      .from("votes")
      .select("id, voter_id, position, candidate_id, is_abstain, election_id")
      .eq("id", voteId)
      .maybeSingle<VoteRow>();

    if (voteErr) throw new Error(`Failed to load vote: ${voteErr.message}`);
    if (!targetVote) throw new Error("Vote not found");

    const electionId = String(targetVote.election_id);

    // 2) Load ALL votes for the election in deterministic order (exactly like anchor-election-root)
    const { data: votesRaw, error: votesErr } = await supabase
      .from("votes")
      .select("id, voter_id, position, candidate_id, is_abstain, election_id")
      .eq("election_id", electionId)
      .order("voter_id", { ascending: true })
      .order("position", { ascending: true })
      .order("candidate_id", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .returns<VoteRow[]>();

    if (votesErr) throw new Error(`Failed to load votes: ${votesErr.message}`);

    const votes = votesRaw ?? [];
    if (votes.length === 0) throw new Error("No votes for this election (cannot generate proof)");

    // 3) Find global index of voteId in the ordered list
    const globalIndex = votes.findIndex((v) => v.id === voteId);
    if (globalIndex < 0) throw new Error("Vote not found in deterministic ordered list (unexpected)");

    // 4) Compute leaf list for the whole election (same spec as anchor)
    const leaves: string[] = votes.map((v) =>
      computeVoteLeaf({
        electionId: String(v.election_id),
        voterId: String(v.voter_id),
        position: String(v.position),
        candidateId: v.candidate_id ? String(v.candidate_id) : null,
        isAbstain: Boolean(v.is_abstain),
      })
    );

    const leaf = leaves[globalIndex];
    assertHex32("leaf", leaf);

    // 5) Chunk math
    const cIndex = chunkIndexOf(globalIndex, chunkSize);
    const indexInChunk = indexInChunkOf(globalIndex, chunkSize);

    const start = cIndex * chunkSize;
    const end = Math.min(start + chunkSize, leaves.length);
    const chunkLeaves = leaves.slice(start, end);

    // leaf → chunkRoot proof
    const { proof: leafToChunkProof, root: chunkRoot } = merkleProofForIndex(chunkLeaves, indexInChunk);

    // 6) chunkRoot → electionRoot proof (build chunkRoots list in chunk order)
    const chunkRoots: string[] = [];
    for (let i = 0; i < leaves.length; i += chunkSize) {
      const slice = leaves.slice(i, Math.min(i + chunkSize, leaves.length));
      chunkRoots.push(merkleRootFromLeaves(slice));
    }

    const totalChunks = chunkRoots.length;
    const { proof: chunkToElectionProof, root: computedElectionRoot } = merkleProofForIndex(chunkRoots, cIndex);

    // Optional: on-chain compare
    const electionIdBytes32 = hashUtf8ToBytes32(electionId);

    let onchainElectionRoot: string | undefined;
    let matchesOnchain: boolean | undefined;

    if (verifyAgainstAnchoredRoot) {
      onchainElectionRoot = await readAnchoredElectionRootFromChain(electionId);
      matchesOnchain = toLowerHex32(onchainElectionRoot) === toLowerHex32(computedElectionRoot);
    }

    const resp: ProofPackage = {
      ok: true,
      specVersion: "BV_VOTE_LEAF_V1__CHUNKED_ROOT_V1",
      chunkSize,

      voteId,
      electionId,

      leafIndex: globalIndex,
      chunkIndex: cIndex,
      indexInChunk,

      leaf,
      chunkRoot,
      leafToChunkProof,

      computedElectionRoot,
      chunkToElectionProof,

      electionIdBytes32,
      onchainElectionRoot,
      matchesOnchain,

      details: {
        totalVotes: votes.length,
        totalChunks,
        chunkLeafCount: chunkLeaves.length,
      },
    };

    return json(200, resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(400, { ok: false, error: msg } satisfies ErrorResp);
  }
});
