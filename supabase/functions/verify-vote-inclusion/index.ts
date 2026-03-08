// supabase/functions/verify-vote-inclusion/index.ts
// BotoVeritas — Single-call public vote inclusion verifier
//
// Goal: One endpoint for the UI/demo.
//   Input:  { voteId }
//   Output: { ok, verified, ... } with anchored on-chain match.
//
// Internals (mirrors your existing pipeline):
//   - Deterministic vote ordering (same as anchor-election-root)
//   - Leaf spec: "BotoVeritasVoteV1" + keccak( electionId, voterId, position, candidateId/0, abstainByte )
//   - Merkle: sorted-pairs + duplicate-last
//   - CHUNK_SIZE = 512
//   - DB chunk root source-of-truth: election_vote_chunks (must exist, meaning election was anchored)
//   - On-chain source-of-truth for electionRoot: ELECTION_ROOT_ANCHOR_ADDRESS.electionBallotsRoot(electionIdBytes32)
//
// Public endpoint: YES (no secret header).
// If you later want to restrict, add the same REQUIRE_KIOSK_SECRET gate you used elsewhere.

import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

import type { Database } from "../_shared/database.types.ts";
import {
  BV_VOTE_CHUNK_SPEC_V1,
  CHUNK_SIZE,
  assertHex32,
  toLowerHex32,
  bytes32Zero,
  hashUtf8ToBytes32,
  computeVoteLeaf,
  buildMerkleLayers,
  merkleRootFromLeaves,
  merkleProofForIndex,
  chunkIndexOf,
  indexInChunkOf,
  applyCanonicalVoteOrder,
} from "../_shared/bvCrypto.ts";

type Body = {
  voteId: string; // UUID
};

type ErrorResp = { ok: false; error: string };

type VoteRow = Pick<
  Database["public"]["Tables"]["votes"]["Row"],
  "id" | "voter_id" | "position" | "candidate_id" | "is_abstain" | "election_id"
>;

type ChunkRow = Pick<
  Database["public"]["Tables"]["election_vote_chunks"]["Row"],
  "chunk_root" | "leaf_count" | "spec_version"
>;

type ReceiptRow = Pick<
  Database["public"]["Tables"]["voter_election_status"]["Row"],
  "nft_token_id" | "tx_hash"
>;

type SuccessResp = {
  ok: true;
  verified: boolean;

  voteId: string;
  electionId: string;
  specVersion: string;
  chunkSize: number;

  // Optional receipt linkage (helps auditors jump back to the receipt)
  receiptTokenId: string | null;
  receiptTxHash: string | null;

  // Indices
  leafIndex: number;
  chunkIndex: number;
  indexInChunk: number;

  // Hashes
  leaf: string;
  expectedChunkRoot: string;
  computedChunkRoot: string;

  computedElectionRoot: string;
  anchoredElectionRoot: string;
  anchoredMatches: boolean;

  // Proofs (returned for transparency/debug; can be removed later)
  leafToChunkProof: string[];
  chunkToElectionProof: string[];

  details: {
    totalVotes: number;
    totalChunks: number;
    dbLeafCount: number;
  };
};

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


async function readReceiptMeta(
  supabase: ReturnType<typeof createClient<Database>>,
  electionId: string,
  voterId: string,
): Promise<{ receiptTokenId: string | null; receiptTxHash: string | null }> {
  const { data, error } = await supabase
    .from("voter_election_status")
    .select("nft_token_id, tx_hash")
    .eq("election_id", electionId)
    .eq("voter_id", voterId)
    .maybeSingle<ReceiptRow>();

  if (error) {
    // Soft-fail: do not block verification if receipt linkage is missing
    return { receiptTokenId: null, receiptTxHash: null };
  }

  return {
    receiptTokenId: data?.nft_token_id ? String(data.nft_token_id) : null,
    receiptTxHash: data?.tx_hash ? String(data.tx_hash) : null,
  };
}

async function readDbChunkMeta(
  supabase: ReturnType<typeof createClient<Database>>,
  electionId: string,
  chunkIndex: number,
) {
  const { data, error } = await supabase
    .from("election_vote_chunks")
    .select("chunk_root, leaf_count, spec_version")
    .eq("election_id", electionId)
    .eq("chunk_index", chunkIndex)
    .maybeSingle<ChunkRow>();

  if (error) throw new Error(`DB error reading election_vote_chunks: ${error.message}`);
  if (!data) throw new Error("Chunk not found for electionId + chunkIndex");

  assertHex32("DB chunk_root", data.chunk_root);

  return {
    expectedChunkRoot: toLowerHex32(String(data.chunk_root)),
    dbLeafCount: Number(data.leaf_count ?? 0),
    specVersion: String(data.spec_version ?? ""),
  };
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

    const chunkSize = CHUNK_SIZE; // locked

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const supabaseKey = requireEnvAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY");

    const supabase = createClient<Database>(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    // 1) Load the target vote
    const { data: targetVote, error: voteErr } = await supabase
      .from("votes")
      .select("id, voter_id, position, candidate_id, is_abstain, election_id")
      .eq("id", voteId)
      .maybeSingle<VoteRow>();

    if (voteErr) throw new Error(`Failed to load vote: ${voteErr.message}`);
    if (!targetVote) throw new Error("Vote not found");

    const electionId = String(targetVote.election_id);

    const receiptMeta = await readReceiptMeta(supabase, electionId, String(targetVote.voter_id));

    // 2) Load ALL votes for election in the exact deterministic order (same as anchor-election-root)
    const { data: votesRaw, error: votesErr } = await applyCanonicalVoteOrder(
      supabase
        .from("votes")
        .select("id, voter_id, position, candidate_id, is_abstain, election_id")
        .eq("election_id", electionId)
    ).returns<VoteRow[]>();

    if (votesErr) throw new Error(`Failed to load votes: ${votesErr.message}`);

    const votes = votesRaw ?? [];
    if (votes.length == 0) throw new Error("No votes for this election");

    const leafIndex = votes.findIndex((v) => v.id === voteId);
    if (leafIndex < 0) throw new Error("Vote not found in deterministic ordered list (unexpected)");

    // 3) Compute ALL leaves (same spec as anchor)
    const leaves = votes.map((v) =>
      computeVoteLeaf({
        electionId: String(v.election_id),
        voterId: String(v.voter_id),
        position: String(v.position),
        candidateId: v.candidate_id ? String(v.candidate_id) : null,
        isAbstain: Boolean(v.is_abstain),
      })
    );

    const leaf = leaves[leafIndex];
    assertHex32("leaf", leaf);

    // 4) Chunk math + leaf→chunk proof
    const chunkIndex = chunkIndexOf(leafIndex, chunkSize);
    const indexInChunk = indexInChunkOf(leafIndex, chunkSize);

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, leaves.length);
    const chunkLeaves = leaves.slice(start, end);

    const { proof: leafToChunkProof, root: computedChunkRoot } = merkleProofForIndex(chunkLeaves, indexInChunk);

    // 5) DB chunk root (trusted reference; must exist, meaning election was anchored)
    const dbChunk = await readDbChunkMeta(supabase, electionId, chunkIndex);

    if (dbChunk.specVersion !== BV_VOTE_CHUNK_SPEC_V1) {
      return json(409, {
        ok: false,
        error: `Spec version mismatch: expected ${BV_VOTE_CHUNK_SPEC_V1} but got ${dbChunk.specVersion}`,
      } satisfies ErrorResp);
    }
    const expectedChunkRoot = dbChunk.expectedChunkRoot;

    const leafValid = toLowerHex32(computedChunkRoot) === toLowerHex32(expectedChunkRoot);

    // 6) chunk→election proof + computed election root
    const chunkRoots: string[] = [];
    for (let i = 0; i < leaves.length; i += chunkSize) {
      const slice = leaves.slice(i, Math.min(i + chunkSize, leaves.length));
      chunkRoots.push(merkleRootFromLeaves(slice));
    }

    const totalChunks = chunkRoots.length;
    const { proof: chunkToElectionProof, root: computedElectionRoot } = merkleProofForIndex(chunkRoots, chunkIndex);

    // 7) on-chain anchor root (trusted reference)
    const anchoredElectionRoot = await readAnchoredElectionRootFromChain(electionId);
    const anchoredMatches = toLowerHex32(anchoredElectionRoot) === toLowerHex32(computedElectionRoot);

    const verified = leafValid && anchoredMatches;

    const resp: SuccessResp = {
      ok: true,
      verified,
      voteId,
      electionId,
      specVersion: dbChunk.specVersion,
      chunkSize,

      receiptTokenId: receiptMeta.receiptTokenId,
      receiptTxHash: receiptMeta.receiptTxHash,

      leafIndex,
      chunkIndex,
      indexInChunk,

      leaf: toLowerHex32(leaf),
      expectedChunkRoot,
      computedChunkRoot: toLowerHex32(computedChunkRoot),

      computedElectionRoot: toLowerHex32(computedElectionRoot),
      anchoredElectionRoot,
      anchoredMatches,

      leafToChunkProof,
      chunkToElectionProof,

      details: {
        totalVotes: votes.length,
        totalChunks,
        dbLeafCount: dbChunk.dbLeafCount,
      },
    };

    return json(200, resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(400, { ok: false, error: msg } satisfies ErrorResp);
  }
});
