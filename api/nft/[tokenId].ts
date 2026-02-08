import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * BotoVeritas ERC-721 Metadata Endpoint (Receipt NFTs)
 *
 * Guarantees:
 * - Returns safe, voter-facing receipt metadata.
 * - Does NOT include ballot choices, candidate IDs, or any preference signal.
 * - When server-side Supabase service-role env vars are present, adds *opaque* auditor identifiers
 *   (electionId, voteId(s), txHash) that enable independent verification.
 *
 * Privacy notes:
 * - voteId is a random UUID for a vote row; it reveals no ballot choice by itself.
 * - No voter identity is returned.
 * - This endpoint is public and intended for verifiability.
 */

/**
 * ERC-721 metadata endpoint for BotoVeritas participation receipt NFTs.
 *
 * Route (per vercel.json):
 *   /api/nft/:tokenId  ->  /api/nft/[tokenId].ts?tokenId=:tokenId
 *
 * Enrichment behavior:
 * - Always returns safe, voter-facing metadata (no ballot choices, no voter identity).
 * - If server-side Supabase service role env vars are present, also includes:
 *   electionId, txHash, specVersion, voteId (and voteIds only if multiple),
 *   plus verification links (receipt + auditor vote verification).
 *
 * Required env for enrichment (serverless only):
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY   (or SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY)
 */

function asInt(v: string) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function envAny(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

type MetadataAttribute = { trait_type: string; value: string };

type ReceiptMetadata = {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: MetadataAttribute[];

  // Auditor-grade identifiers (opaque; do not reveal ballot choices or voter identity)
  electionId?: string;
  voteId?: string;
  voteIds?: string[];
  txHash?: string;
  specVersion?: string;
  verification?: {
    receiptUrl: string;
    auditorVoteUrl: string;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Public metadata endpoint by design
  res.setHeader("Access-Control-Allow-Origin", "*");

  const raw = (req.query.tokenId ?? "").toString();
  const tokenId = asInt(raw);

  if (!tokenId) {
    return res.status(400).json({ error: "Invalid tokenId" });
  }

  // Base (non-sensitive) receipt metadata
  const base = "https://botoveritas.info";

  // Optional enrichment via Supabase service role (server-side only)
  const supabaseUrl = envAny("SUPABASE_URL");
  const serviceRole = envAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE");

  let electionId: string | null = null;
  let voteIds: string[] = [];
  let primaryVoteId: string | null = null;
  let txHash: string | null = null;

  if (supabaseUrl && serviceRole) {
    try {
      const supabase = createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false },
      });

      // 1) Find the receipt row by tokenId
      const { data: statusRow } = await supabase
        .from("voter_election_status")
        .select("voter_id,election_id,tx_hash,nft_token_id")
        .eq("nft_token_id", tokenId.toString())
        .maybeSingle();

      if (statusRow?.voter_id && statusRow?.election_id) {
        electionId = String(statusRow.election_id);
        txHash = statusRow.tx_hash ? String(statusRow.tx_hash) : null;

        // 2) Pull vote row IDs for this voter+election (no ballot choices included)
        const { data: voteRows } = await supabase
          .from("votes")
          .select("id,created_at")
          .eq("voter_id", statusRow.voter_id)
          .eq("election_id", statusRow.election_id)
          .order("created_at", { ascending: true });

        if (Array.isArray(voteRows) && voteRows.length > 0) {
          voteIds = voteRows
            .map((r) => (r && typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : null))
            .filter((id): id is string => typeof id === "string");

          primaryVoteId = voteIds[0] ?? null;
        }
      }
    } catch {
      // Swallow enrichment errors — base metadata should still work reliably
    }
  }

  const metadata: ReceiptMetadata = {
    name: `BotoVeritas Participation Receipt #${tokenId}`,
    description:
      "Proof-of-participation receipt NFT for BotoVeritas. This NFT confirms that a vote submission was recorded and a receipt token was minted on-chain. No ballot choices are stored in this metadata.",
    image: `${base}/nft/receipt.png`,
    external_url: `${base}/verify/nft/${tokenId}`,
    attributes: [
      { trait_type: "Type", value: "Participation Receipt" },
      { trait_type: "System", value: "BotoVeritas" },
      { trait_type: "Network", value: "Polygon Amoy (Testnet)" },
      { trait_type: "Token ID", value: tokenId.toString() },
    ],
  };

  // If we found enrichment, attach it
  if (electionId) {
    metadata.electionId = electionId;
    metadata.txHash = txHash ?? undefined;
    metadata.specVersion = "BV_VOTE_LEAF_V1__CHUNKED_ROOT_V1";

    if (primaryVoteId) metadata.voteId = primaryVoteId;
    if (voteIds.length > 1) metadata.voteIds = voteIds;

    metadata.verification = {
      receiptUrl: `${base}/verify/nft/${tokenId}`,
      auditorVoteUrl: primaryVoteId ? `${base}/verify/vote/${primaryVoteId}` : `${base}/verify/vote`,
    };
  }

  // Metadata is fairly stable; short cache while you're iterating, can increase later.
  res.setHeader("Cache-Control", "public, max-age=120");
  return res.status(200).json(metadata);
}