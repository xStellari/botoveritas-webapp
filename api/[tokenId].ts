import type { VercelRequest, VercelResponse } from "@vercel/node";

function getBaseUrl(req: VercelRequest) {
  // Prefer your canonical domain in production
  // (but still works on preview deployments)
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "").toString();
  const proto = (req.headers["x-forwarded-proto"] ?? "https").toString();

  // If request is already coming from botoveritas.info, use it
  if (host.includes("botoveritas.info")) return "https://botoveritas.info";

  // Otherwise fall back to the current host (preview domains)
  return `${proto}://${host}`;
}

function asIntTokenId(raw: unknown) {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const str = (s ?? "").toString().trim();

  // tokenId must be a positive integer
  if (!/^[0-9]+$/.test(str)) return null;

  // guard against huge numbers; still allow big token IDs, but keep sanity
  // (JS number is fine for typical NFT ranges)
  const n = Number(str);
  if (!Number.isFinite(n) || n < 1) return null;

  return str; // keep as string to avoid precision issues
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const tokenId = asIntTokenId(req.query.tokenId);

  if (!tokenId) {
    res.status(400).json({
      error: "Invalid tokenId. Expected a positive integer.",
    });
    return;
  }

  const baseUrl = getBaseUrl(req);

  // Important: OpenSea/Polygonscan generally re-fetch metadata,
  // but caching helps performance. Keep short while iterating.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");

  const metadata = {
    name: `BotoVeritas Vote Receipt #${tokenId}`,
    description:
      "This NFT is a vote receipt proof minted by BotoVeritas. It is privacy-safe and does not reveal voter identity or ballot selections. It exists to provide immutable, verifiable proof that a receipt was minted on-chain.",
    image: `${baseUrl}/nft/receipt.png`,
    external_url: `${baseUrl}/verify-receipt/${tokenId}`,
    attributes: [
      { trait_type: "Type", value: "Vote Receipt" },
      { trait_type: "Token ID", value: tokenId },
      { trait_type: "Network", value: "Polygon Amoy" },
      { trait_type: "Standard", value: "ERC-721" },
      { trait_type: "Project", value: "BotoVeritas" }
    ]
  };

  res.status(200).json(metadata);
}
