import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

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

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-secret",
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

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

/**
 * Canonical bytes32 hashes (must remain stable forever once adopted)
 */
function hashUtf8ToBytes32(s: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

function bytes32Zero(): string {
  return "0x" + "00".repeat(32);
}

/**
 * Leaf hash spec:
 * leaf = keccak256( concat(
 *   "BotoVeritasVoteV1",
 *   keccak(electionId),
 *   keccak(voterId),
 *   keccak(position),
 *   keccak(candidateId) OR 0x00..00,
 *   abstainByte
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

const ELECTION_ROOT_ANCHOR_ABI = [
  "function anchorElectionBallotsRoot(bytes32 electionId, bytes32 merkleRoot) external",
  "function isElectionRootAnchored(bytes32 electionId) external view returns (bool)",
  "function electionBallotsRoot(bytes32 electionId) external view returns (bytes32)",
  "event ElectionBallotsRootAnchored(bytes32 indexed electionId, bytes32 indexed merkleRoot, address indexed anchoredBy)",
];

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const authErr = requireKioskSecret(req);
    if (authErr) return authErr;

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const serviceRole = requireEnvAny("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    const electionId = typeof body?.electionId === "string" ? body.electionId : "";

    if (!electionId || !isUuid(electionId)) {
      return json(400, { error: "Invalid electionId" });
    }

    // 1) Ensure election is final (locks votes via your triggers)
    const { data: electionRow, error: electionErr } = await supabase
      .from("elections")
      .select("id, is_final")
      .eq("id", electionId)
      .maybeSingle();

    if (electionErr) {
      return json(500, { error: "Failed to load election", details: electionErr.message });
    }
    if (!electionRow) {
      return json(404, { error: "Election not found" });
    }
    if (!electionRow.is_final) {
      return json(409, {
        error: "Election is not finalized",
        hint: "Finalize the election first before anchoring the ballot root.",
      });
    }

    // 2) Load all votes in a deterministic order (typed)
    const { data: votes, error: votesErr } = await supabase
      .from("votes")
      .select("id, voter_id, position, candidate_id, is_abstain, election_id")
      .eq("election_id", electionId)
      .order("voter_id", { ascending: true })
      .order("position", { ascending: true })
      .order("candidate_id", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true }) as { data: VoteRow[] | null; error: unknown };

    if (votesErr) {
      const msg = votesErr instanceof Error ? votesErr.message : String(votesErr);
      return json(500, { error: "Failed to load votes", details: msg });
    }

    if (!votes || votes.length === 0) {
      return json(409, {
        error: "No votes found for this election",
        hint: "Cannot anchor an empty election. Ensure vote rows exist.",
      });
    }

    // 3) Compute leaves + root
    const leaves = votes.map((v: VoteRow) =>
      computeVoteLeaf({
        electionId: v.election_id,
        voterId: v.voter_id,
        position: v.position,
        candidateId: v.candidate_id ?? null,
        isAbstain: !!v.is_abstain,
      })
    );

    const root = merkleRootSortedPairs(leaves);

    // 4) Anchor on-chain
    const rpcUrl = requireEnvAny("AMOY_RPC_URL");
    const ownerPk = requireEnvAny("ANCHOR_OWNER_PRIVATE_KEY", "MINTER_PRIVATE_KEY");
    const anchorAddress = requireEnvAny("ELECTION_ROOT_ANCHOR_ADDRESS");

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(ownerPk, provider);
    const contract = new ethers.Contract(anchorAddress, ELECTION_ROOT_ANCHOR_ABI, wallet);

    const electionIdBytes32 = hashUtf8ToBytes32(electionId);

    // Idempotency: if already anchored, return existing root (and verify it matches)
    const alreadyAnchored: boolean = await contract.isElectionRootAnchored(electionIdBytes32);
    if (alreadyAnchored) {
      const onchainRoot: string = await contract.electionBallotsRoot(electionIdBytes32);
      const matches = onchainRoot.toLowerCase() === root.toLowerCase();

      return json(200, {
        status: "already_anchored",
        electionId,
        electionIdBytes32,
        computedRoot: root,
        onchainRoot,
        matches,
        leafCount: leaves.length,
        warning: matches
          ? null
          : "On-chain root differs from computed root. This indicates different leaf rules/order were used previously.",
      });
    }

    const tx = await contract.anchorElectionBallotsRoot(electionIdBytes32, root);
    const receipt = await tx.wait();

    const explorerBase = envAny("AMOY_EXPLORER_BASE") || "https://amoy.polygonscan.com";
    const txHash = receipt?.hash || tx.hash;

    return json(200, {
      status: "anchored",
      electionId,
      electionIdBytes32,
      merkleRoot: root,
      leafCount: leaves.length,
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
