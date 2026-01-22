import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/* =========================
   Types
========================= */
type ReceiptItem = {
  position: string;
  choiceName: string; // already masked or "ABSTAIN"
  choiceId?: string | null;
  isAbstain?: boolean;
};

type ReceiptTx = {
  electionId: string;
  electionName?: string;
  txHash: string;
  tokenId?: string;
  reused?: boolean;
  mode?: string;

  // Historically used for "View on Polygonscan" (tx link)
  explorerTxUrl?: string;
};

type Body = {
  toEmail: string;
  voterName?: string;
  electionTitle: string;
  votedAt?: string;
  receiptItems: ReceiptItem[];

  // Backward-compatible single receipt
  txHash?: string;
  explorerUrl?: string;

  // ✅ NEW: optional tokenId for single-receipt (older clients)
  tokenId?: string;

  // Forward-compatible multi-receipt (per-election minting)
  receipts?: ReceiptTx[];
};

/* =========================
   CORS
========================= */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* =========================
   Utils
========================= */
function requireEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required secret: ${name}`);
  return v;
}

function safeStr(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
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

function escapeAttr(str: string) {
  return escapeHtml(str).replace(/`/g, "&#096;");
}

function formatManila(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isLikelyTokenId(v?: string) {
  if (!v) return false;
  const s = v.trim();
  if (!s) return false;
  // Accept numeric strings only (ERC-721 tokenId)
  return /^[0-9]+$/.test(s);
}

const AMOY_POLYGONSCAN_TX_BASE = "https://amoy.polygonscan.com/tx/";

/* =========================
   Email Template
========================= */
function buildReceiptEmailHtml(params: {
  subject: string;
  logoUrl: string;
  voterName?: string;
  electionTitle: string;
  votedAtIso: string;
  receiptItems: ReceiptItem[];

  // Backward-compatible single receipt
  txHash?: string;
  explorerUrl?: string;

  // ✅ NEW: single tokenId (older clients)
  singleTokenId?: string;

  // Multi-receipt
  receipts?: ReceiptTx[];

  // Verification base URL (human-friendly page)
  verifyBaseUrl: string;
}) {
  const {
    subject,
    logoUrl,
    voterName,
    electionTitle,
    votedAtIso,
    receiptItems,
    txHash,
    explorerUrl,
    singleTokenId,
    receipts,
    verifyBaseUrl,
  } = params;

  const votedAt = formatManila(votedAtIso);

  const rowsHtml =
    receiptItems.length > 0
      ? receiptItems
          .map((it) => {
            const position = escapeHtml(safeStr(it.position, "—"));
            const choice = escapeHtml(safeStr(it.choiceName, "—"));

            return `
              <tr>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
                  <div style="font-size:13px;font-weight:700;color:#0f172a;line-height:1.35;">
                    ${position}
                  </div>
                </td>
                <td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
                  <div style="font-size:13px;color:#0f172a;line-height:1.55;font-weight:700;">
                    ${choice}
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="2" style="padding:14px;color:#64748b;font-size:13px;">
            No selections found.
          </td>
        </tr>
      `;

  // Normalize multi-receipts
  const normalizedReceipts: ReceiptTx[] = Array.isArray(receipts)
    ? receipts
        .filter((r) => typeof r?.txHash === "string" && r.txHash.startsWith("0x"))
        .map((r) => ({
          electionId: safeStr(r.electionId),
          electionName: safeStr(r.electionName) || undefined,
          txHash: safeStr(r.txHash),
          tokenId: safeStr(r.tokenId) || undefined,
          reused: typeof r.reused === "boolean" ? r.reused : undefined,
          mode: safeStr(r.mode) || undefined,
          explorerTxUrl:
            safeStr(r.explorerTxUrl) ||
            (safeStr(r.txHash).startsWith("0x")
              ? `${AMOY_POLYGONSCAN_TX_BASE}${safeStr(r.txHash)}`
              : undefined),
        }))
    : [];

  const hasMulti = normalizedReceipts.length > 1;

  // ✅ Prefer tokenId from receipts[0] if only one receipt exists
  const effectiveSingleTokenId =
    safeStr(singleTokenId) ||
    (normalizedReceipts.length === 1 ? safeStr(normalizedReceipts[0]?.tokenId) : "");

  const hasSingleToken = isLikelyTokenId(effectiveSingleTokenId);
  const singleVerifyUrl = hasSingleToken
    ? `${verifyBaseUrl}${encodeURIComponent(effectiveSingleTokenId)}`
    : "";

  const hasAny =
    normalizedReceipts.length > 0 || (!!txHash && txHash.startsWith("0x"));

  // Multi-receipt verification blocks (preferred)
  const multiBlocks = normalizedReceipts.length
    ? `
      <div style="
        margin-top:16px;
        padding:14px;
        border:1px solid #e2e8f0;
        border-radius:12px;
        background:#f8fafc;
      ">
        <div style="font-size:12px;font-weight:800;color:#0f172a;letter-spacing:.08em;text-transform:uppercase;">
          Verify Vote Receipt${hasMulti ? "s" : ""}
        </div>

        <div style="margin-top:8px;font-size:12px;color:#475569;line-height:1.7;">
          Tap the button below to confirm your vote receipt NFT${hasMulti ? "s exist" : " exists"} on the blockchain.
          No technical knowledge required.
        </div>

        <ul style="margin:10px 0 0 0;padding:0 0 0 18px;color:#475569;font-size:12px;line-height:1.7;">
          <li>This record cannot be altered once recorded.</li>
          <li>This verification does <strong>not</strong> reveal your selections.</li>
        </ul>

        <div style="margin-top:12px;">
          ${normalizedReceipts
            .map((r) => {
              const title = escapeHtml(r.electionName || "Election");
              const proof = escapeHtml(r.txHash);
              const tokenId = safeStr(r.tokenId) || "";
              const hasToken = isLikelyTokenId(tokenId);

              // ✅ PRIMARY: your verifier page (NOT polygonscan)
              const verifyUrl = hasToken
                ? `${verifyBaseUrl}${encodeURIComponent(tokenId)}`
                : "";

              // ✅ OPTIONAL: polygonscan as Advanced
              const advancedTxUrl = r.explorerTxUrl ? escapeAttr(r.explorerTxUrl) : "";

              const tokenBadge = hasToken
                ? `<span style="
                    display:inline-block;
                    margin-left:8px;
                    background:#e2e8f0;
                    color:#0f172a;
                    padding:2px 8px;
                    border-radius:999px;
                    font-size:11px;
                    font-weight:700;
                  ">Token #${escapeHtml(tokenId)}</span>`
                : "";

              const primaryButton = verifyUrl
                ? `<a href="${escapeAttr(verifyUrl)}" style="
                     display:inline-block;
                     background:#064e3b;
                     color:#ffffff;
                     text-decoration:none;
                     padding:8px 10px;
                     border-radius:10px;
                     font-size:12px;
                     font-weight:800;
                     letter-spacing:.2px;
                   ">Verify Vote Receipt</a>`
                : "";

              const advancedLink = advancedTxUrl
                ? `<a href="${advancedTxUrl}" style="
                     display:inline-block;
                     margin-left:8px;
                     color:#064e3b;
                     text-decoration:none;
                     font-size:12px;
                     font-weight:800;
                   ">Advanced</a>`
                : "";

              return `
                <div style="
                  margin-top:10px;
                  background:#ffffff;
                  border:1px solid #e2e8f0;
                  border-radius:12px;
                  padding:12px;
                ">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <div style="font-size:13px;font-weight:800;color:#0f172a;">
                      ${title}${tokenBadge}
                    </div>
                    <div style="display:flex;align-items:center;gap:0;">
                      ${primaryButton}
                      ${advancedLink}
                    </div>
                  </div>

                  <div style="
                    margin-top:10px;
                    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                    font-size:12px;
                    word-break:break-all;
                    background:#ffffff;
                    border:1px dashed #cbd5e1;
                    padding:10px;
                    border-radius:10px;
                    color:#0f172a;
                  "><span style="font-weight:800;color:#0f172a;">Proof ID:</span> ${proof}</div>

                  ${
                    verifyUrl
                      ? `<div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
                           If the button doesn't open, copy this link:
                           <span style="word-break:break-all;">${escapeHtml(verifyUrl)}</span>
                         </div>`
                      : `<div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
                           Verification link unavailable (missing token ID). You may still use the Advanced link.
                         </div>`
                  }
                </div>
              `;
            })
            .join("")}
        </div>

        <div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.6;">
          Tip: You can open these links on your phone or personal device anytime.
        </div>
      </div>
    `
    : "";

  // ✅ Single receipt fallback (older clients)
  // FIX: show "Verify Vote Receipt" to your verifier page if tokenId exists.
  const singleBlock =
    !normalizedReceipts.length && txHash
      ? `
      <div style="
        margin-top:16px;
        padding:14px;
        border:1px solid #e2e8f0;
        border-radius:12px;
        background:#f8fafc;
      ">
        <div style="font-size:12px;font-weight:800;color:#0f172a;letter-spacing:.08em;text-transform:uppercase;">
          Verify Vote Receipt
        </div>

        <div style="margin-top:8px;font-size:12px;color:#475569;line-height:1.7;">
          This email includes a proof reference. Your vote choices remain private.
        </div>

        <ul style="margin:10px 0 0 0;padding:0 0 0 18px;color:#475569;font-size:12px;line-height:1.7;">
          <li>This record cannot be altered once recorded.</li>
          <li>This verification does <strong>not</strong> reveal your selections.</li>
        </ul>

        <div style="
          margin-top:12px;
          font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          font-size:12px;
          word-break:break-all;
          background:#ffffff;
          border:1px dashed #cbd5e1;
          padding:10px;
          border-radius:10px;
          color:#0f172a;
        "><span style="font-weight:800;color:#0f172a;">Proof ID:</span> ${escapeHtml(txHash)}</div>

        ${
          singleVerifyUrl
            ? `
              <div style="margin-top:12px;">
                <a href="${escapeAttr(singleVerifyUrl)}" style="
                  display:inline-block;
                  background:#064e3b;
                  color:#ffffff;
                  text-decoration:none;
                  padding:10px 12px;
                  border-radius:10px;
                  font-size:12px;
                  font-weight:800;
                  letter-spacing:.2px;
                ">Verify Vote Receipt</a>
                ${
                  explorerUrl
                    ? `<a href="${escapeAttr(explorerUrl)}" style="
                         display:inline-block;
                         margin-left:8px;
                         color:#064e3b;
                         text-decoration:none;
                         font-size:12px;
                         font-weight:800;
                       ">Advanced</a>`
                    : ""
                }
              </div>
              <div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
                If the button doesn't open, copy this link:
                <span style="word-break:break-all;">${escapeHtml(singleVerifyUrl)}</span>
              </div>
            `
            : `
              ${
                explorerUrl
                  ? `<div style="margin-top:12px;">
                       <a href="${escapeAttr(explorerUrl)}" style="
                         display:inline-block;
                         background:#064e3b;
                         color:#ffffff;
                         text-decoration:none;
                         padding:10px 12px;
                         border-radius:10px;
                         font-size:12px;
                         font-weight:800;
                         letter-spacing:.2px;
                       ">Advanced: View on Polygonscan</a>
                     </div>
                     <div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
                       Verification link unavailable (missing token ID). You may still use the Advanced link.
                     </div>`
                  : `<div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
                       Verification link unavailable (missing token ID).
                     </div>`
              }
            `
        }

        <div style="margin-top:8px;font-size:11px;color:#64748b;line-height:1.6;">
          Tip: You can open these links on your phone or personal device anytime.
        </div>
      </div>
    `
      : "";

  const verificationSection = hasAny
    ? normalizedReceipts.length
      ? multiBlocks
      : singleBlock
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>

<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0;">
    <tr>
      <td align="center">
        <table width="640" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- Header -->
          <tr>
            <td style="background:#064e3b;padding:18px 22px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:56px;vertical-align:middle;">
                    <img src="${escapeAttr(
                      logoUrl
                    )}" width="44" alt="FEU" style="display:block;border-radius:8px;" />
                  </td>

                  <td style="vertical-align:middle;">
                    <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.3px;">
                      BotoVeritas
                    </div>
                    <div style="color:#d1fae5;font-size:12px;margin-top:2px;">
                      Secure Student Election System • FEU Alabang
                    </div>
                  </td>

                  <td align="right" style="vertical-align:middle;">
                    <div style="
                      display:inline-block;
                      background:rgba(255,255,255,0.12);
                      border:1px solid rgba(255,255,255,0.18);
                      color:#ffffff;
                      padding:6px 10px;
                      border-radius:999px;
                      font-size:11px;
                      font-weight:700;
                      letter-spacing:.2px;
                    ">
                      Vote Receipt
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 22px;">
              <div style="font-size:16px;font-weight:900;color:#0f172a;letter-spacing:.2px;margin:0 0 6px 0;">
                Vote submission confirmed
              </div>

              <div style="font-size:13px;color:#475569;line-height:1.7;margin:0 0 14px 0;">
                ${
                  voterName
                    ? `Hello <strong style="color:#0f172a;">${escapeHtml(
                        voterName
                      )}</strong>, your vote has been recorded for the election below.`
                    : `Your vote has been recorded for the election below.`
                }
              </div>

              <!-- Verification explainer -->
              <div style="
                border:1px solid #e2e8f0;
                border-radius:12px;
                padding:14px;
                background:#ffffff;
                margin:0 0 14px 0;
              ">
                <div style="font-size:12px;font-weight:800;color:#0f172a;letter-spacing:.08em;text-transform:uppercase;">
                  What this receipt means
                </div>
                <div style="margin-top:8px;font-size:12px;color:#475569;line-height:1.7;">
                  This email includes verification link${hasMulti ? "s" : ""} that prove your vote receipt NFT${
                    hasMulti ? "s exist" : " exists"
                  } on the blockchain.
                </div>
                <ul style="margin:10px 0 0 0;padding:0 0 0 18px;color:#475569;font-size:12px;line-height:1.7;">
                  <li>No technical knowledge required — just open the link.</li>
                  <li>The record cannot be altered once recorded.</li>
                  <li>Your vote choices remain private (only proof is shown).</li>
                </ul>
              </div>

              <!-- Details -->
              <div style="
                border:1px solid #e2e8f0;
                border-radius:12px;
                padding:14px;
                background:#ffffff;
                margin:0 0 14px 0;
              ">
                <div style="font-size:12px;font-weight:800;color:#0f172a;letter-spacing:.08em;text-transform:uppercase;">
                  Receipt details
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#475569;width:140px;">Election</td>
                    <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:700;">
                      ${escapeHtml(electionTitle)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#475569;">Submitted</td>
                    <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:700;">
                      ${escapeHtml(votedAt)}
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Privacy note -->
              <div style="font-size:12px;color:#64748b;line-height:1.6;margin:0 0 10px 0;">
                Selections shown below are partially masked for privacy.
              </div>

              <!-- Selections -->
              <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <thead>
                    <tr>
                      <th align="left" style="padding:12px 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                        Position
                      </th>
                      <th align="left" style="padding:12px 14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                        Selected
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </div>

              ${verificationSection}

              <div style="margin-top:16px;font-size:12px;color:#64748b;line-height:1.6;">
                This is an automated message. Please do not reply.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:12px;font-size:12px;color:#94a3b8;background:#f8fafc;">
              © ${new Date().getFullYear()} BotoVeritas
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* =========================
   Handler
========================= */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json(405, { ok: false, message: "Method not allowed" });
    }

    const body = (await req.json()) as Body;

    if (!body.toEmail || !body.electionTitle || !Array.isArray(body.receiptItems)) {
      return json(400, {
        ok: false,
        message: "Missing required fields: toEmail, electionTitle, receiptItems[]",
      });
    }

    const resendKey = requireEnv("RESEND_API_KEY");
    const fromEmail =
      Deno.env.get("FROM_EMAIL") || "BotoVeritas <no-reply@botoveritas.info>";

    const appUrl = Deno.env.get("APP_URL") || "https://botoveritas.info";
    const logoUrl = Deno.env.get("LOGO_URL") || `${appUrl}/FEU_Alabang_logo.png`;

    // ✅ Verification page base (your route)
    const verifyBaseUrl = `${appUrl}/api/verify/nft/`;

    const votedAtIso = body.votedAt || new Date().toISOString();
    const subject = `Vote Receipt — ${safeStr(body.electionTitle, "Election")}`;

    const txHash = safeStr(body.txHash) || undefined;

    // Prefer caller-provided explorerUrl; else default to Amoy Polygonscan tx link
    const explorerUrl =
      safeStr(body.explorerUrl) ||
      (txHash ? `${AMOY_POLYGONSCAN_TX_BASE}${txHash}` : undefined);

    const receipts = Array.isArray(body.receipts) ? body.receipts : undefined;

    // ✅ NEW: allow single tokenId for older clients
    const singleTokenId = safeStr(body.tokenId) || undefined;

    const html = buildReceiptEmailHtml({
      subject,
      logoUrl,
      voterName: safeStr(body.voterName) || undefined,
      electionTitle: safeStr(body.electionTitle, "Election"),
      votedAtIso,
      receiptItems: body.receiptItems,
      txHash,
      explorerUrl,
      receipts,
      singleTokenId,
      verifyBaseUrl,
    });

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [body.toEmail],
        subject,
        html,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return json(502, { ok: false, message: "Resend error", detail: errText });
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, message: message || "Server error" });
  }
});
