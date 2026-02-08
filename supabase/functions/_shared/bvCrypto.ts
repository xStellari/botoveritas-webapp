// supabase/functions/_shared/bvCrypto.ts
// Canonical crypto + merkle helpers for BotoVeritas vote-leaf v1 and chunked roots.
// Keep this as the single source of truth to avoid spec drift across Edge Functions.

import { ethers } from "ethers";

// Spec/version constants (must remain stable once published)
export const BV_VOTE_CHUNK_SPEC_V1 = "BV_VOTE_LEAF_V1__CHUNKED_ROOT_V1";
export const BV_ELECTION_MANIFEST_V1 = "BV_ELECTION_MANIFEST_V1";

// ✅ Chunking constant (LOCKED)
export const CHUNK_SIZE = 512;

export function assertHex32(label: string, v: string) {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${label} must be 0x-prefixed 32-byte hex`);
  }
}

export function toLowerHex32(x: string) {
  return "0x" + x.slice(2).toLowerCase();
}

export function bytes32Zero(): string {
  return "0x" + "00".repeat(32);
}

/** bytes32 key (keccak(utf8(s))) used throughout BV */
export function hashUtf8ToBytes32(s: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
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
 * ))
 */
export function computeVoteLeaf(args: {
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

  const packed = ethers.concat([domain, electionHash, voterHash, positionHash, candidateHash, abstainByte]);
  return ethers.keccak256(packed);
}

/** Pair hash: sorted-pairs keccak256(concat(min,max)) */
export function keccakPairHashSorted(a: string, b: string): string {
  const aa = toLowerHex32(a);
  const bb = toLowerHex32(b);
  const [min, max] = aa <= bb ? [aa, bb] : [bb, aa];
  return ethers.keccak256(ethers.concat([min, max]));
}

/** Build layers with sorted pairs + duplicate-last */
export function buildMerkleLayers(leaves: string[]): string[][] {
  const layers: string[][] = [];
  let level = leaves.map(toLowerHex32);
  layers.push(level);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate-last
      next.push(keccakPairHashSorted(left, right));
    }
    level = next;
    layers.push(level);
  }

  return layers;
}

export function merkleRootFromLeaves(leaves: string[]): string {
  if (leaves.length === 0) return bytes32Zero();
  if (leaves.length === 1) return toLowerHex32(leaves[0]);
  const layers = buildMerkleLayers(leaves);
  return toLowerHex32(layers[layers.length - 1][0]);
}

export function merkleProofForIndex(leaves: string[], leafIndex: number): { proof: string[]; root: string } {
  if (leaves.length === 0) return { proof: [], root: bytes32Zero() };
  if (leafIndex < 0 || leafIndex >= leaves.length) throw new Error("leafIndex out of range for provided leaves");

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

  return { proof, root: toLowerHex32(layers[layers.length - 1][0]) };
}

export function chunkIndexOf(globalIndex: number, chunkSize: number) {
  return Math.floor(globalIndex / chunkSize);
}

export function indexInChunkOf(globalIndex: number, chunkSize: number) {
  return globalIndex % chunkSize;
}

/** Back-compat helper name used in existing code */
export function merkleRootSortedPairs(leaves: string[]): string {
  return merkleRootFromLeaves(leaves);
}
