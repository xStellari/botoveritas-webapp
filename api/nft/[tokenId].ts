import type { VercelRequest, VercelResponse } from "@vercel/node";

function asInt(v: string) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Allow simple testing from anywhere; safe because this endpoint is public by design
  res.setHeader("Access-Control-Allow-Origin", "*");

  const raw = (req.query.tokenId ?? "").toString();
  const tokenId = asInt(raw);

  if (!tokenId) {
    return res.status(400).json({ error: "Invalid tokenId" });
  }

  // ✅ Minimal, non-flashy receipt metadata
  // NOTE: image must be a publicly accessible URL
  const base = "https://botoveritas.info";

  const metadata = {
    name: `BotoVeritas Participation Receipt #${tokenId}`,
    description:
      "Proof-of-participation receipt NFT for BotoVeritas. This NFT confirms that a vote submission was recorded and a receipt token was minted on-chain. No ballot choices are stored in this metadata.",
    image: `${base}/nft/receipt.png`,
    external_url: `${base}`,
    attributes: [
      { trait_type: "Type", value: "Participation Receipt" },
      { trait_type: "System", value: "BotoVeritas" },
      { trait_type: "Network", value: "Polygon Amoy (Testnet)" },
      { trait_type: "Token ID", value: tokenId.toString() },
    ],
  };

  // OpenSea + explorers expect JSON
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60"); // short cache while iterating
  return res.status(200).json(metadata);
}
