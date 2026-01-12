// supabase/functions/send-registration-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  voter_id?: string;
  email?: string;

  // OPTIONAL: if you pass these from RegisterVerify, the function won't need DB reads
  fullName?: string;
  orgAffiliations?: string[];
};

// ✅ CORS headers (dev-friendly). You can tighten this later.
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

function formatManila(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- Election status (time-based truth) ---------- */
function getElectionStatus(e: {
  start_date: string;
  end_date: string;
  is_active?: boolean | null;
}) {
  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  const end = new Date(e.end_date).getTime();

  if (Number.isFinite(end) && now > end) return "Closed";
  if (Number.isFinite(start) && now < start) return "Upcoming";
  if (e.is_active === false) return "Paused";
  return "Active";
}

function badgeStyle(status: string) {
  switch (status) {
    case "Active":
      return {
        color: "#065f46",
        bg: "#dcfce7",
        border: "#86efac",
        text: "Active",
      };
    case "Upcoming":
      return {
        color: "#854d0e",
        bg: "#fef9c3",
        border: "#fde047",
        text: "Upcoming",
      };
    case "Closed":
      return {
        color: "#334155",
        bg: "#f1f5f9",
        border: "#cbd5e1",
        text: "Closed",
      };
    case "Paused":
      return {
        color: "#7f1d1d",
        bg: "#fee2e2",
        border: "#fecaca",
        text: "Paused",
      };
    default:
      return {
        color: "#334155",
        bg: "#f1f5f9",
        border: "#cbd5e1",
        text: status,
      };
  }
}

function renderBadge(status: string) {
  const b = badgeStyle(status);
  return `
    <span style="
      display:inline-block;
      font-size:11px;
      font-weight:700;
      color:${b.color};
      background:${b.bg};
      border:1px solid ${b.border};
      padding:4px 10px;
      border-radius:999px;
      letter-spacing:.2px;
      vertical-align:middle;
      white-space:nowrap;
    ">
      ${escapeHtml(b.text)}
    </span>
  `;
}

function buildEmailHtml(params: {
  subject: string;
  logoUrl: string;
  fullName: string;
  orgAffiliations: string[];
  eligibleElections: Array<{
    title: string;
    start_date: string;
    end_date: string;
    is_active?: boolean | null;
  }>;
}) {
  const { subject, logoUrl, fullName, orgAffiliations, eligibleElections } = params;

  const orgPills =
    orgAffiliations.length > 0
      ? orgAffiliations
          .map(
            (o) => `
            <span style="
              display:inline-block;
              margin:4px 6px 0 0;
              padding:4px 10px;
              font-size:11px;
              font-weight:700;
              color:#064e3b;
              background:#ecfdf5;
              border:1px solid #bbf7d0;
              border-radius:999px;
              letter-spacing:.2px;
            ">${escapeHtml(o)}</span>
          `
          )
          .join("")
      : `<span style="font-size:13px; color:#64748b;">None provided</span>`;

  const scheduleBlock =
    eligibleElections.length > 0
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:10px;">
          <thead>
            <tr>
              <th align="left" style="padding:12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;">Election</th>
              <th align="left" style="padding:12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;">Opens</th>
              <th align="left" style="padding:12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#475569;background:#f8fafc;border-bottom:1px solid #e2e8f0;">Closes</th>
            </tr>
          </thead>
          <tbody>
            ${eligibleElections
              .map((e) => {
                const status = getElectionStatus(e);
                const b = badgeStyle(status);

                return `
                  <tr>
                    <td style="padding:12px;border-bottom:1px solid #e5e7eb;">
                      <div style="font-weight:800;font-size:14px;color:#0f172a;line-height:1.4;">
                        ${escapeHtml(e.title)}
                      </div>
                      <div style="
                        display:inline-block;
                        margin-top:8px;
                        font-size:10px;
                        font-weight:700;
                        color:${b.color};
                        background:${b.bg};
                        border:1px solid ${b.border};
                        padding:2px 8px;
                        border-radius:999px;
                        letter-spacing:.2px;
                      ">${escapeHtml(b.text)}</div>
                    </td>
                    <td style="padding:12px;font-size:13px;color:#0f172a;border-bottom:1px solid #e5e7eb;line-height:1.6;">
                      ${escapeHtml(formatManila(e.start_date))}
                    </td>
                    <td style="padding:12px;font-size:13px;color:#0f172a;border-bottom:1px solid #e5e7eb;line-height:1.6;">
                      ${escapeHtml(formatManila(e.end_date))}
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `
      : `<p style="margin:0;color:#64748b;line-height:1.7;">No eligible elections found for your affiliations yet.</p>`;

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

          <tr>
            <td style="background:#064e3b;padding:18px 22px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:56px;vertical-align:middle;">
                    <img src="${escapeHtml(logoUrl)}" width="44" alt="FEU" style="display:block;border-radius:8px;" />
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
                      Registration Confirmed
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 22px;">
              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.7;">
                Hello <strong>${escapeHtml(fullName)}</strong>,
              </p>

              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.7;">
                Your voter registration has been <strong>successfully verified and recorded</strong> in
                <strong>BotoVeritas</strong>.
              </p>

              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.7;">
                Voting will be conducted through the <strong>official on-campus voting kiosk</strong>.
                Kiosk schedules and location will be announced by the respective organizations through their
                <strong>official Facebook pages</strong> or other official communication channels.
              </p>

              <div style="
                margin:18px 0 20px 0;
                padding:14px 14px;
                background:#f0fdf4;
                border:1px solid #bbf7d0;
                border-radius:12px;
                color:#064e3b;
                font-size:13px;
                line-height:1.7;
              ">
                <strong>📍 Important:</strong>
                Kindly bring your school ID on the actual voting day for identity verification.
              </div>

              <h3 style="margin:20px 0 8px 0;font-size:15px;color:#0f172a;letter-spacing:.2px;">
                Registered Organizational Affiliations
              </h3>
              <div style="margin:0 0 14px 0;">
                ${orgPills}
              </div>

              <h3 style="margin:18px 0 10px 0;font-size:15px;color:#0f172a;letter-spacing:.2px;">
                Your Eligible Election Schedule
              </h3>

              ${scheduleBlock}

              <p style="margin:18px 0 0 0;font-size:12px;color:#64748b;line-height:1.6;">
                This is an automated message. Please do not reply.
              </p>
            </td>
          </tr>

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

serve(async (req) => {
  // ✅ Handle browser preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  console.log("send-registration-email invoked", req.method);

  try {
    if (req.method !== "POST") {
      return json(405, { ok: false, message: "Method not allowed. Use POST." });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { ok: false, message: "Invalid JSON body." });
    }

    if (!body?.voter_id && !body?.email) {
      return json(400, { ok: false, message: "Provide either voter_id or email." });
    }

    // Secrets
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SERVICE_ROLE_KEY");
    const resendKey = requireEnv("RESEND_API_KEY");

    const fromEmail =
      Deno.env.get("FROM_EMAIL") || "BotoVeritas <no-reply@botoveritas.info>";

    const appUrl = Deno.env.get("APP_URL") || "https://botoveritas.info";

    const logoUrl =
      Deno.env.get("LOGO_URL") ||
      "${appUrl}/FEU_Alabang_logo.png";

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let voterEmail = safeStr(body.email);
    let fullName = safeStr(body.fullName);
    let orgAffiliations = Array.isArray(body.orgAffiliations) ? body.orgAffiliations : [];

    const voterQuery = supabase
      .from("voters")
      .select("id, email, first_name, middle_name, last_name, suffix, org_affiliations");

    let voter: any = null;

    const tryFetchVoter = async () => {
      if (body.voter_id) {
        const res = await voterQuery.eq("id", body.voter_id).maybeSingle();
        if (res.error) throw new Error(res.error.message);
        if (res.data) return res.data;
      }
      if (body.email) {
        const res = await voterQuery.eq("email", body.email).maybeSingle();
        if (res.error) throw new Error(res.error.message);
        if (res.data) return res.data;
      }
      return null;
    };

    // Retry a bit (optional but safe)
    voter = await tryFetchVoter();
    if (!voter) {
      await sleep(250);
      voter = await tryFetchVoter();
    }
    if (!voter) {
      await sleep(500);
      voter = await tryFetchVoter();
    }

    if (!voter && !voterEmail) {
      return json(404, { ok: false, message: "Voter not found." });
    }

    if (voter) {
      voterEmail = voterEmail || voter.email;

      if (!fullName) {
        fullName = [
          voter.first_name,
          voter.middle_name ? `${voter.middle_name}.` : "",
          voter.last_name,
          voter.suffix || "",
        ]
          .filter(Boolean)
          .join(" ");
      }

      if (orgAffiliations.length === 0 && Array.isArray(voter.org_affiliations)) {
        orgAffiliations = voter.org_affiliations;
      }
    }

    if (!voterEmail) return json(400, { ok: false, message: "Missing target email address." });
    if (!fullName) fullName = "Student";

    const { data: elections, error: electionsErr } = await supabase
      .from("elections")
      .select("title, start_date, end_date, is_active");

    if (electionsErr) throw new Error(electionsErr.message);

    const eligibleElections = (elections || [])
      .filter((e) => {
        if (!orgAffiliations || orgAffiliations.length === 0) return true;
        return orgAffiliations.some((org) =>
          e.title.toLowerCase().includes(String(org).toLowerCase())
        );
      })
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

    const subject = "BotoVeritas — Voter Registration Confirmation & Election Schedule";
    const html = buildEmailHtml({
      subject,
      logoUrl,
      fullName,
      orgAffiliations,
      eligibleElections,
    });

    const minifiedHtml = html
      .replace(/\r?\n/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: voterEmail,
        subject,
        html: minifiedHtml,
      }),
    });

    if (!resendResp.ok) {
      const text = await resendResp.text();
      console.error("Resend error:", text);
      return json(500, { ok: false, message: "Resend failed", details: text });
    }

    console.log("Email sent to:", voterEmail);
    return json(200, { ok: true, to: voterEmail });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-registration-email error:", msg);
    return json(500, { ok: false, message: msg });
  }
});
