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

type Body = {
  toEmail: string;
  voterName?: string;
  electionTitle: string;
  votedAt?: string;
  receiptItems: ReceiptItem[];
  txHash?: string;
  explorerUrl?: string;
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
  txHash?: string;
  explorerUrl?: string;
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

  const txBlock = txHash
    ? `
      <div style="
        margin-top:16px;
        padding:14px;
        border:1px solid #e2e8f0;
        border-radius:12px;
        background:#f8fafc;
      ">
        <div style="font-size:12px;font-weight:800;color:#0f172a;letter-spacing:.08em;text-transform:uppercase;">
          Verification Reference
        </div>
        <div style="margin-top:6px;font-size:12px;color:#475569;line-height:1.6;">
          Use this transaction hash to verify that your vote was recorded on the blockchain.
          This reference does not reveal your selections.
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
        ">${escapeHtml(txHash)}</div>

        ${
          explorerUrl
            ? `<div style="margin-top:10px;">
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
                 ">View transaction</a>
               </div>`
            : ""
        }
      </div>
    `
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
                    <img src="${escapeAttr(logoUrl)}" width="44" alt="FEU" style="display:block;border-radius:8px;" />
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

              ${txBlock}

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
    const logoUrl =
      Deno.env.get("LOGO_URL") || `${appUrl}/FEU_Alabang_logo.png`;

    const votedAtIso = body.votedAt || new Date().toISOString();
    const subject = `Vote Receipt — ${safeStr(body.electionTitle, "Election")}`;

    const txHash = safeStr(body.txHash) || undefined;
    const explorerUrl =
      safeStr(body.explorerUrl) ||
      (txHash ? `https://polygonscan.com/tx/${txHash}` : undefined);

    const html = buildReceiptEmailHtml({
      subject,
      logoUrl,
      voterName: safeStr(body.voterName) || undefined,
      electionTitle: safeStr(body.electionTitle, "Election"),
      votedAtIso,
      receiptItems: body.receiptItems,
      txHash,
      explorerUrl,
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
  } catch (e) {
    return json(500, { ok: false, message: e?.message ?? "Server error" });
  }
});
