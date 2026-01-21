import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Human-friendly verification page for BotoVeritas ParticipationNFT receipts.
 *
 * URL: /api/verify/nft/:tokenId   (Vercel Serverless Function)
 *
 * Recommended (later): add a Vercel rewrite so voters can open:
 *   /verify/nft/:tokenId  ->  /api/verify/nft/:tokenId
 */

const CONTRACT_ADDRESS = "0x05fc7e1A6D9c61938090b774151e5DEbdE4f6D0B";

function asInt(v: string) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pad32(hexNo0x: string) {
  return hexNo0x.padStart(64, "0");
}

function toHexTokenId(tokenId: number) {
  return tokenId.toString(16);
}

function extractAddressFrom32B(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 64) return null;
  const addr = clean.slice(24); // last 40 chars
  return "0x" + addr;
}

function jsonRpcBody(method: string, params: unknown[], id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

/**
 * Minimal JSON-RPC eth_call (no ethers dependency)
 */
async function ethCall(rpcUrl: string, to: string, data: string) {
  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonRpcBody("eth_call", [{ to, data }, "latest"])),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`RPC error (${resp.status}): ${t}`);
  }

  const j = (await resp.json()) as any;
  if (j?.error) {
    throw new Error(`RPC error: ${j.error?.message || "Unknown RPC error"}`);
  }
  return j?.result as string;
}

/**
 * Decode ABI-encoded string return value (for tokenURI)
 */
function decodeAbiString(hexResult: string) {
  const hex = hexResult.startsWith("0x") ? hexResult.slice(2) : hexResult;
  if (hex.length < 128) return null;

  // First 32 bytes: offset (ignored)
  // Second 32 bytes: length
  const lenHex = hex.slice(64, 128);
  const len = Number.parseInt(lenHex, 16);
  if (!Number.isFinite(len) || len <= 0) return null;

  const dataHex = hex.slice(128, 128 + len * 2);
  if (dataHex.length < len * 2) return null;

  const bytes = new Uint8Array(dataHex.match(/.{1,2}/g)!.map((b) => Number.parseInt(b, 16)));
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return m;
    }
  });
}

function buildHtml(params: {
  tokenId: number;
  status: "verified" | "not_found" | "error";
  headline: string;
  bodyText: string;
  tokenOwner?: string;
  tokenUri?: string;
  metadata?: any;
  advancedTokenUrl: string;
}) {
  const { tokenId, status, headline, bodyText, tokenOwner, tokenUri, metadata, advancedTokenUrl } =
    params;

  const base = "https://botoveritas.info";
  const badgeBg =
    status === "verified" ? "#DCFCE7" : status === "not_found" ? "#FEF3C7" : "#FEE2E2";
  const badgeFg =
    status === "verified" ? "#166534" : status === "not_found" ? "#92400E" : "#991B1B";
  const badgeText = status === "verified" ? "Verified" : status === "not_found" ? "Not Found" : "Error";

  const imgUrl = metadata?.image || `${base}/nft/receipt.png`;
  const name = metadata?.name || `BotoVeritas Participation Receipt #${tokenId}`;
  const desc =
    metadata?.description ||
    "This page confirms a vote receipt NFT exists on the blockchain. No ballot choices are shown.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Verify Vote Receipt #${tokenId} • BotoVeritas</title>
  <meta name="robots" content="noindex" />
</head>
<body style="margin:0;background:#f1f5f9;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5;color:#0f172a;">
  <div style="max-width:760px;margin:0 auto;padding:28px 16px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:44px;height:44px;border-radius:12px;background:#064e3b;display:flex;align-items:center;justify-content:center;color:white;font-weight:900;">
        BV
      </div>
      <div>
        <div style="font-weight:900;font-size:16px;">BotoVeritas</div>
        <div style="font-size:12px;color:#475569;">Vote Receipt Verification • FEU Alabang</div>
      </div>
      <div style="margin-left:auto;display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:${badgeBg};color:${badgeFg};font-size:12px;font-weight:800;">
        ${badgeText}
      </div>
    </div>

    <div style="background:white;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.06);">
      <div style="padding:18px 18px 0 18px;">
        <h1 style="margin:0;font-size:22px;letter-spacing:-.2px;">${escapeHtml(headline)}</h1>
        <p style="margin:8px 0 0 0;color:#475569;font-size:14px;">${escapeHtml(bodyText)}</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr;gap:14px;padding:18px;">
        <div style="display:flex;gap:14px;align-items:flex-start;">
          <img src="${escapeHtml(imgUrl)}" alt="Vote receipt" width="88" height="88" style="border-radius:14px;border:1px solid #e2e8f0;background:#fff;object-fit:cover;" />
          <div style="flex:1;">
            <div style="font-weight:900;">${escapeHtml(name)}</div>
            <div style="margin-top:4px;color:#64748b;font-size:13px;">${escapeHtml(desc)}</div>
          </div>
        </div>

        <div style="border:1px solid #e2e8f0;border-radius:14px;background:#f8fafc;padding:14px;">
          <div style="font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#0f172a;">What this means</div>
          <ul style="margin:10px 0 0 0;padding:0 0 0 18px;color:#475569;font-size:13px;">
            <li>No technical knowledge required — this page is enough.</li>
            <li>This proof cannot be altered once recorded on the blockchain.</li>
            <li>Your vote choices remain private (only proof is shown).</li>
          </ul>
        </div>

        <div style="display:grid;grid-template-columns:1fr;gap:10px;">
          <div style="border:1px solid #e2e8f0;border-radius:14px;background:white;padding:14px;">
            <div style="font-size:12px;color:#64748b;">Receipt Token ID</div>
            <div style="font-weight:900;font-size:16px;">#${tokenId}</div>
          </div>

          ${
            tokenOwner
              ? `<div style="border:1px solid #e2e8f0;border-radius:14px;background:white;padding:14px;">
                  <div style="font-size:12px;color:#64748b;">Token Owner (on-chain)</div>
                  <div style="margin-top:6px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;font-size:12px;word-break:break-all;">${escapeHtml(
                    tokenOwner
                  )}</div>
                </div>`
              : ""
          }

          ${
            tokenUri
              ? `<div style="border:1px solid #e2e8f0;border-radius:14px;background:white;padding:14px;">
                  <div style="font-size:12px;color:#64748b;">Token Metadata URL</div>
                  <div style="margin-top:6px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;font-size:12px;word-break:break-all;">${escapeHtml(
                    tokenUri
                  )}</div>
                </div>`
              : ""
          }
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;border-top:1px solid #e2e8f0;padding-top:14px;">
          <div style="font-size:12px;color:#64748b;">
            Network: <strong style="color:#0f172a;">Polygon Amoy (Testnet)</strong>
          </div>

          <a href="${escapeHtml(advancedTokenUrl)}" style="display:inline-flex;align-items:center;gap:8px;background:#064e3b;color:white;text-decoration:none;padding:10px 12px;border-radius:12px;font-weight:900;font-size:13px;">
            Advanced: View on Polygonscan
          </a>
        </div>
      </div>
    </div>

    <div style="margin-top:14px;font-size:12px;color:#94a3b8;text-align:center;">
      © ${new Date().getFullYear()} BotoVeritas
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const raw = (req.query.tokenId ?? "").toString();
  const tokenId = asInt(raw);

  if (!tokenId) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(
      buildHtml({
        tokenId: 0,
        status: "error",
        headline: "Invalid receipt link",
        bodyText: "The receipt number in this link is not valid.",
        advancedTokenUrl: `https://amoy.polygonscan.com/token/${CONTRACT_ADDRESS}?a=0`,
      })
    );
  }

  const rpcUrl = process.env.AMOY_RPC_URL || "";
  if (!rpcUrl) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(
      buildHtml({
        tokenId,
        status: "error",
        headline: "Verification unavailable",
        bodyText: "The server is missing the AMOY_RPC_URL configuration.",
        advancedTokenUrl: `https://amoy.polygonscan.com/token/${CONTRACT_ADDRESS}?a=${tokenId}`,
      })
    );
  }

  const ownerOfSelector = "0x6352211e"; // ownerOf(uint256)
  const tokenUriSelector = "0xc87b56dd"; // tokenURI(uint256)

  const tokenIdPadded = pad32(toHexTokenId(tokenId));

  try {
    // ownerOf(tokenId)
    const ownerRes = await ethCall(rpcUrl, CONTRACT_ADDRESS, ownerOfSelector + tokenIdPadded);
    const owner = extractAddressFrom32B(ownerRes);

    if (!owner || owner === "0x0000000000000000000000000000000000000000") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(
        buildHtml({
          tokenId,
          status: "not_found",
          headline: "Receipt not found",
          bodyText:
            "We could not find this receipt token on the blockchain. Double-check the link from your email.",
          advancedTokenUrl: `https://amoy.polygonscan.com/token/${CONTRACT_ADDRESS}?a=${tokenId}`,
        })
      );
    }

    // tokenURI(tokenId) (best-effort)
    let tokenUri: string | undefined;
    try {
      const uriRes = await ethCall(rpcUrl, CONTRACT_ADDRESS, tokenUriSelector + tokenIdPadded);
      const decoded = decodeAbiString(uriRes);
      if (decoded) tokenUri = decoded;
    } catch {
      // ignore — ownerOf already proves existence
    }

    // Fetch metadata (best-effort)
    let metadata: any | undefined;
    if (tokenUri) {
      try {
        const metaResp = await fetch(tokenUri, { method: "GET" });
        if (metaResp.ok) {
          metadata = await metaResp.json();
        }
      } catch {
        // ignore
      }
    }

    const advancedTokenUrl = `https://amoy.polygonscan.com/token/${CONTRACT_ADDRESS}?a=${tokenId}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).send(
      buildHtml({
        tokenId,
        status: "verified",
        headline: "Vote Receipt Verified",
        bodyText:
          "This page confirms your vote receipt NFT exists on the blockchain. Your ballot choices are not shown here.",
        tokenOwner: owner,
        tokenUri,
        metadata,
        advancedTokenUrl,
      })
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(502).send(
      buildHtml({
        tokenId,
        status: "error",
        headline: "Verification error",
        bodyText:
          "We couldn't verify this receipt right now. Please try again later, or use the Advanced link below.",
        advancedTokenUrl: `https://amoy.polygonscan.com/token/${CONTRACT_ADDRESS}?a=${tokenId}`,
      }) + `<!-- debug: ${escapeHtml(message)} -->`
    );
  }
}
