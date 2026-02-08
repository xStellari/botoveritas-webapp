import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument,
  PDFPage,
  PDFFont,
  StandardFonts,
  rgb,
} from "npm:pdf-lib@1.17.1";

/* =========================
   Types
========================= */
type VoteTallyRow = {
  election_id: string;
  election_title?: string | null;
  position: string;
  candidate_id?: string | null;
  candidate_name: string;
  slate?: string | null;
  vote_count: number;
  abstain_count?: number | null;
  total_ballots_for_position?: number | null;
};

type ElectionRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  eligible_orgs: string[] | null;
  is_final?: boolean | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  finalized_by_email?: string | null;
};

type YearLevelRow = { year_level: string; voter_count: number };

type Signatory = {
  label: string;
  name: string;
  role?: string | null;
};

type VotesVoterIdRow = { voter_id: string | null };

type Body = {
  election_id?: string;
  logo_url?: string;

  // Signatories (preferred)
  signatories?: Signatory[];

  // Back-compat signatories
  prepared_by?: string;
  prepared_by_title?: string;
  noted_by?: string;
  noted_by_title?: string;

  // Blockchain summary options (optional)
  network?: string;
  explorer_base?: string;
  tx_hashes?: string[];
  contract_address?: string;
  nft_collection?: string;
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

/* =========================
   Helpers
========================= */
function fmtDate(dt = new Date()) {
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtShortDate(dtISO?: string | null) {
  if (!dtISO) return "—";
  const d = new Date(dtISO);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function safeFilename(s: string) {
  return (s || "Election").replace(/\s+/g, "_").replace(/[^\w\-]+/g, "");
}

function groupBy<T>(arr: T[], keyFn: (x: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(n: number, d: number) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function positionRank(posRaw: string) {
  const pos = (posRaw || "").toLowerCase().replace(/\s+/g, " ").trim();

  // President -> VP-Internal -> VP-External -> Secretary -> Treasurer -> Auditor -> PRO
  if (pos === "president") return 1;

  if (
    (pos.includes("vp") && pos.includes("internal")) ||
    (pos.includes("vice") &&
      pos.includes("president") &&
      pos.includes("internal"))
  )
    return 2;

  if (
    (pos.includes("vp") && pos.includes("external")) ||
    (pos.includes("vice") &&
      pos.includes("president") &&
      pos.includes("external"))
  )
    return 3;

  if (pos === "secretary" || pos.includes("secretary")) return 4;
  if (pos === "treasurer" || pos.includes("treasurer")) return 5;
  if (pos === "auditor" || pos.includes("auditor")) return 6;

  if (
    pos === "pro" ||
    pos.includes("p.r.o") ||
    (pos.includes("public") && pos.includes("relations"))
  )
    return 7;

  return 999;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status}: ${url} ${t.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * QuickChart via POST (avoids URL length limits).
 * Returns PNG bytes.
 */
async function quickChartPng(
  config: Record<string, unknown>,
): Promise<Uint8Array> {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      width: 1000,
      height: 520,
      format: "png",
      backgroundColor: "white",
      chart: config,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`QuickChart error ${res.status}: ${t.slice(0, 300)}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

function u8ToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // Copy to force a real ArrayBuffer (avoids ArrayBuffer | SharedArrayBuffer typing)
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

function drawPageNumber(
  page: PDFPage,
  font: PDFFont,
  idx: number,
  total: number,
) {
  const pageW = page.getWidth();
  const marginX = 48;
  const y = 20;

  const txt = `Page ${idx} of ${total}`;
  const size = 9;

  const textWidth = font.widthOfTextAtSize(txt, size);
  page.drawText(txt, {
    x: pageW - marginX - textWidth,
    y,
    size,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });

  page.drawText("Generated by BotoVeritas", {
    x: marginX,
    y,
    size,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
}

async function embedLogo(pdf: PDFDocument, logoBytes: Uint8Array) {
  // Try PNG first, then JPG
  try {
    return await pdf.embedPng(logoBytes);
  } catch {
    return await pdf.embedJpg(logoBytes);
  }
}

async function drawHeader(params: {
  pdf: PDFDocument;
  page: PDFPage;
  fontBold: PDFFont;
  font: PDFFont;
  title: string;
  subtitle: string;
  logoBytes?: Uint8Array | null;
}) {
  const { pdf, page, fontBold, font, title, subtitle, logoBytes } = params;

  const pageW = page.getWidth();
  const pageH = page.getHeight();

  const marginX = 48;
  const headerTopY = pageH - 40;
  const headerLineY = pageH - 70;

  // light band
  page.drawRectangle({
    x: 0,
    y: pageH - 92,
    width: pageW,
    height: 92,
    color: rgb(0.98, 0.98, 0.985),
  });

  // Logo
  if (logoBytes && logoBytes.length > 0) {
    try {
      const img = await embedLogo(pdf, logoBytes);
      const logoH = 30;
      const logoW = (img.width / img.height) * logoH;

      page.drawImage(img, {
        x: marginX,
        y: pageH - 68,
        width: logoW,
        height: logoH,
      });
    } catch {
      // ignore logo failures
    }
  }

  page.drawText(title, {
    x: marginX + 110,
    y: headerTopY,
    size: 12.5,
    font: fontBold,
    color: rgb(0.12, 0.18, 0.14),
  });

  page.drawText(subtitle, {
    x: marginX + 110,
    y: headerTopY - 16,
    size: 9.5,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  page.drawLine({
    start: { x: marginX, y: headerLineY },
    end: { x: pageW - marginX, y: headerLineY },
    thickness: 1,
    color: rgb(0.86, 0.86, 0.88),
  });

  return headerLineY - 18;
}

function drawSectionTitle(
  page: PDFPage,
  fontBold: PDFFont,
  title: string,
  x: number,
  y: number,
) {
  page.drawText(title, {
    x,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0.12, 0.18, 0.14),
  });
}

function drawParagraph(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize = 10.5,
  lineHeight = 14,
  color = rgb(0.2, 0.2, 0.2),
) {
  // simple wrap
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const wWidth = font.widthOfTextAtSize(test, fontSize);
    if (wWidth > maxWidth) {
      page.drawText(line, { x, y: cy, size: fontSize, font, color });
      cy -= lineHeight;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: cy, size: fontSize, font, color });
    cy -= lineHeight;
  }
  return cy;
}

function drawInfoBox(params: {
  page: PDFPage;
  fontBold: PDFFont;
  font: PDFFont;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  value: string;
  footnote?: string;
}) {
  const { page, fontBold, font, x, y, w, h, title, value, footnote } = params;

  page.drawRectangle({
    x,
    y: y - h,
    width: w,
    height: h,
    borderColor: rgb(0.86, 0.86, 0.88),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  page.drawText(title, {
    x: x + 12,
    y: y - 18,
    size: 9.5,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });

  page.drawText(value, {
    x: x + 12,
    y: y - 42,
    size: 18,
    font: fontBold,
    color: rgb(0.12, 0.18, 0.14),
  });

  if (footnote) {
    page.drawText(footnote, {
      x: x + 12,
      y: y - h + 12,
      size: 8.8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }
}

/* =========================
   Handler
========================= */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: Body = await req.json().catch(() => ({} as Body));

    const election_id = body?.election_id;

    // Deployment decision: require election_id (no "all elections" export)
    if (!election_id) {
      return new Response(
        JSON.stringify({ error: "election_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Branding: allow override, otherwise use secrets
    const logo_url =
      body?.logo_url ||
      Deno.env.get("LOGO_URL") ||
      Deno.env.get("FEU_LOGO_URL") ||
      "";

    // Signatories (preferred)
    let signatories: Signatory[] = Array.isArray(body?.signatories)
      ? body.signatories.filter((s) => s?.label && s?.name)
      : [];

    // Back-compat signatories
    const prepared_by = body?.prepared_by || "";
    const prepared_by_title = body?.prepared_by_title || "Prepared by";
    const noted_by = body?.noted_by || "";
    const noted_by_title = body?.noted_by_title || "Noted by";

    if (!signatories.length && (prepared_by || noted_by)) {
      signatories = [
        ...(prepared_by
          ? [
            {
              label: prepared_by_title,
              name: prepared_by,
              role: "Prepared by",
            },
          ]
          : []),
        ...(noted_by
          ? [
            {
              label: noted_by_title,
              name: noted_by,
              role: "Noted by",
            },
          ]
          : []),
      ];
    }

    // Blockchain summary options (optional)
    const network = body?.network || "Polygon (Proof-of-Vote via NFT)";
    // Default switched to Polygon Amoy for defense testing
    const explorer_base =
      body?.explorer_base || "https://amoy.polygonscan.com/tx/";
    const tx_hashes = Array.isArray(body?.tx_hashes)
      ? body.tx_hashes.filter(Boolean).slice(0, 20)
      : [];
    const contract_address = body?.contract_address || "";
    const nft_collection = body?.nft_collection || "BotoVeritas Proof-of-Vote";

    // Supabase (service role)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL env var");

    const serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) throw new Error("Missing SERVICE_ROLE_KEY secret");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const buildSingleElectionPdf = async (singleElectionId: string) => {
      // Election metadata
      const { data: electionMeta, error: electionErr } = await supabase
        .from("elections")
        .select(
          "id,title,start_date,end_date,eligible_orgs,is_final,finalized_at,finalized_by,finalized_by_email",
        )
        .eq("id", singleElectionId)
        .maybeSingle();

      if (electionErr) throw new Error(`elections: ${electionErr.message}`);
      const election = electionMeta as ElectionRow | null;

      // Pull tallies (vote_tally_view)
      const { data: tallies, error: talliesErr } = await supabase
        .from("vote_tally_view")
        .select(
          "election_id,election_title,position,candidate_id,candidate_name,slate,vote_count,abstain_count,total_ballots_for_position",
        )
        .eq("election_id", singleElectionId);

      if (talliesErr) throw new Error(`vote_tally_view: ${talliesErr.message}`);

      const tallyRows = (tallies ?? []) as VoteTallyRow[];
      if (!tallyRows.length) {
        throw new Error("No tally data found for election_id");
      }

      const electionTitle =
        election?.title ?? tallyRows[0]?.election_title ?? "Election";

      // Year-level turnout (RPC)
      let yearLevelRows: YearLevelRow[] = [];
      const { data: ylData, error: ylErr } = await supabase.rpc(
        "year_level_turnout_for_election",
        { p_election_id: singleElectionId },
      );
      if (!ylErr && Array.isArray(ylData)) {
        yearLevelRows = ylData as YearLevelRow[];
      }

      // Total vote rows (optional metric)
      const { count: totalVoteRows, error: totalVoteRowsErr } = await supabase
        .from("votes")
        .select("*", { count: "exact", head: true })
        .eq("election_id", singleElectionId);

      if (totalVoteRowsErr) {
        throw new Error(`votes count: ${totalVoteRowsErr.message}`);
      }

      // Distinct voters who voted
      const { data: voterIdRows, error: voterIdsErr } = await supabase
        .from("votes")
        .select("voter_id")
        .eq("election_id", singleElectionId);

      if (voterIdsErr) throw new Error(`votes voter_id: ${voterIdsErr.message}`);

      const distinctVoterIds = new Set<string>();
      for (const r of (voterIdRows ?? []) as VotesVoterIdRow[]) {
        if (r?.voter_id) distinctVoterIds.add(String(r.voter_id));
      }
      const votersWhoVoted = distinctVoterIds.size;

      // Eligible voters:
      // - if eligible_orgs empty => all voters
      // - else => DB-native overlap: org_affiliations && eligible_orgs
      let eligibleVoters = 0;
      const eligibleOrgs = Array.isArray(election?.eligible_orgs)
        ? election.eligible_orgs.filter(Boolean)
        : [];

      if (eligibleOrgs.length === 0) {
        const { count, error } = await supabase
          .from("voters")
          .select("*", { count: "exact", head: true });
        if (error) throw new Error(`voters count: ${error.message}`);
        eligibleVoters = count ?? 0;
      } else {
        const { count, error } = await supabase
          .from("voters")
          .select("*", { count: "exact", head: true })
          .overlaps("org_affiliations", eligibleOrgs);

        if (error) {
          throw new Error(`voters eligible overlap count: ${error.message}`);
        }

        eligibleVoters = count ?? 0;
      }

      const turnoutRate = eligibleVoters
        ? (votersWhoVoted / eligibleVoters) * 100
        : 0;

      const byPosition = groupBy(tallyRows, (r) => r.position || "General");

      // Fetch logo bytes (optional)
      let logoBytes: Uint8Array | null = null;
      if (logo_url) {
        try {
          logoBytes = await fetchBytes(logo_url);
        } catch {
          logoBytes = null;
        }
      }

      // PDF setup (A4)
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

      const pageW = 595.28;
      const pageH = 841.89;
      const margin = 48;

      // -------------------------
      // COVER PAGE
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);

        page.drawRectangle({
          x: 0,
          y: pageH - 240,
          width: pageW,
          height: 240,
          color: rgb(0.98, 0.98, 0.985),
        });

        if (logoBytes) {
          try {
            const img = await embedLogo(pdf, logoBytes);
            const h = 46;
            const w = (img.width / img.height) * h;
            page.drawImage(img, {
              x: margin,
              y: pageH - 120,
              width: w,
              height: h,
            });
          } catch {
            // ignore
          }
        }

        page.drawText("BotoVeritas", {
          x: margin,
          y: pageH - 160,
          size: 20,
          font: fontBold,
          color: rgb(0.12, 0.18, 0.14),
        });

        page.drawText("Election Results Report (PDF Export)", {
          x: margin,
          y: pageH - 188,
          size: 12,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });

        page.drawText(electionTitle, {
          x: margin,
          y: pageH - 270,
          size: 22,
          font: fontBold,
          color: rgb(0.12, 0.18, 0.14),
        });

        const scheduleLine = election
          ? `Election Window: ${fmtShortDate(election.start_date)}  to  ${
            fmtShortDate(election.end_date)
          }`
          : "Election Window: —";

        page.drawText(scheduleLine, {
          x: margin,
          y: pageH - 300,
          size: 10.5,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });

        page.drawText(`Generated: ${fmtDate(new Date())}`, {
          x: margin,
          y: pageH - 322,
          size: 10.5,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });

        drawSectionTitle(page, fontBold, "Contents", margin, pageH - 380);

        const items = [
          "1. Executive Summary (Turnout & Methodology)",
          "2. Turnout Distribution by Year Level",
          "3. Results per Position (Pie Distribution + Ranked Table + Summary)",
          "4. Blockchain Verification Summary",
          "5. Certification / Signatures",
        ];

        let y = pageH - 410;
        for (const it of items) {
          page.drawText(`• ${it}`, {
            x: margin,
            y,
            size: 11,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          y -= 18;
        }

        const foot =
          "Note: This report is generated from immutable vote records. Percentages are rounded to one decimal place.";
        drawParagraph(
          page,
          font,
          foot,
          margin,
          90,
          pageW - margin * 2,
          9.2,
          13,
          rgb(0.45, 0.45, 0.45),
        );
      }

      // -------------------------
      // EXECUTIVE SUMMARY
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);
        const yStart = await drawHeader({
          pdf,
          page,
          fontBold,
          font,
          title: "Executive Summary",
          subtitle: electionTitle,
          logoBytes,
        });

        let y = yStart - 6;

        drawParagraph(
          page,
          font,
          "This section summarizes participation metrics and explains how turnout is computed for this election. The turnout rate helps contextualize results by showing the proportion of eligible voters who cast at least one ballot during the election window.",
          margin,
          y,
          pageW - margin * 2,
        );
        y -= 70;

        const boxW = (pageW - margin * 2 - 18) / 2;
        const boxH = 80;

        drawInfoBox({
          page,
          fontBold,
          font,
          x: margin,
          y,
          w: boxW,
          h: boxH,
          title: "Eligible Voters",
          value: String(eligibleVoters),
          footnote: eligibleOrgs.length
            ? `Eligibility: ${eligibleOrgs.join(", ")}`
            : "Eligibility: Open to all",
        });

        drawInfoBox({
          page,
          fontBold,
          font,
          x: margin + boxW + 18,
          y,
          w: boxW,
          h: boxH,
          title: "Voters Who Voted (Distinct)",
          value: String(votersWhoVoted),
          footnote: "Count of unique voter IDs with >= 1 vote row",
        });

        y -= boxH + 14;

        drawInfoBox({
          page,
          fontBold,
          font,
          x: margin,
          y,
          w: boxW,
          h: boxH,
          title: "Turnout Rate",
          value: `${turnoutRate.toFixed(1)}%`,
          footnote: "Rounded to 1 decimal place",
        });

        drawInfoBox({
          page,
          fontBold,
          font,
          x: margin + boxW + 18,
          y,
          w: boxW,
          h: boxH,
          title: "Vote Rows Recorded",
          value: String(totalVoteRows ?? 0),
          footnote: "Count of vote rows in the database for this election",
        });

        y -= boxH + 26;

        drawSectionTitle(page, fontBold, "Turnout Rate Calculation", margin, y);
        y -= 20;

        const calcText =
          "Turnout rate is computed as the percentage of eligible voters who participated in the election: " +
          "Turnout Rate = (Distinct Voters Who Voted ÷ Eligible Voters) × 100. " +
          "A voter is considered to have voted if their voter ID appears at least once in the vote records for this election.";
        y = drawParagraph(page, font, calcText, margin, y, pageW - margin * 2);

        y -= 10;
        const example =
          `For this election: Turnout Rate = (${votersWhoVoted} ÷ ${
            eligibleVoters || 0
          }) × 100 = ${turnoutRate.toFixed(1)}%.`;
        drawParagraph(
          page,
          font,
          example,
          margin,
          y,
          pageW - margin * 2,
          10.5,
          14,
          rgb(0.2, 0.2, 0.2),
        );
      }

      // -------------------------
      // TURNOUT BY YEAR LEVEL
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);
        const yStart = await drawHeader({
          pdf,
          page,
          fontBold,
          font,
          title: "Turnout Distribution by Year Level",
          subtitle: `${electionTitle} • Overall Turnout: ${
            turnoutRate.toFixed(1)
          }%`,
          logoBytes,
        });

        let y = yStart - 6;

        drawParagraph(
          page,
          font,
          "The donut chart below shows how participating voters are distributed across year levels. Counts represent distinct voters who cast at least one ballot in this election.",
          margin,
          y,
          pageW - margin * 2,
        );

        y -= 58;

        if (!yearLevelRows.length) {
          page.drawText(
            "No year-level turnout data available (ensure RPC year_level_turnout_for_election exists).",
            {
              x: margin,
              y,
              size: 11,
              font,
              color: rgb(0.4, 0.2, 0.2),
            },
          );
        } else {
          const labels = yearLevelRows.map((r) => r.year_level);
          const values = yearLevelRows.map((r) => r.voter_count);

          const donutConfig = {
            type: "doughnut",
            data: { labels, datasets: [{ data: values }] },
            options: {
              plugins: {
                legend: { position: "right" },
                title: { display: false },
              },
              cutout: "55%",
            },
          };

          try {
            const pngBytes = await quickChartPng(
              donutConfig as Record<string, unknown>,
            );
            const img = await pdf.embedPng(pngBytes);

            const imgW = pageW - margin * 2;
            const imgH = (img.height / img.width) * imgW;

            page.drawImage(img, {
              x: margin,
              y: y - imgH,
              width: imgW,
              height: imgH,
            });

            let ty = y - imgH - 18;

            page.drawLine({
              start: { x: margin, y: ty },
              end: { x: pageW - margin, y: ty },
              thickness: 1,
              color: rgb(0.9, 0.9, 0.92),
            });
            ty -= 18;

            page.drawText("Year Level", {
              x: margin,
              y: ty,
              size: 11,
              font: fontBold,
            });
            page.drawText("Distinct Voters", {
              x: pageW - margin - 140,
              y: ty,
              size: 11,
              font: fontBold,
            });
            ty -= 14;

            const totalYL = values.reduce((a, b) => a + b, 0);

            for (const row of yearLevelRows.slice(0, 25)) {
              const share = totalYL ? `(${pct(row.voter_count, totalYL)})` : "";
              page.drawText(`${row.year_level}`, {
                x: margin,
                y: ty,
                size: 10,
                font,
              });
              page.drawText(`${row.voter_count} ${share}`, {
                x: pageW - margin - 140,
                y: ty,
                size: 10,
                font,
              });
              ty -= 14;
              if (ty < 80) break;
            }

            const top = yearLevelRows.slice().sort((a, b) =>
              b.voter_count - a.voter_count
            )[0];
            if (top) {
              const note =
                `Interpretation: The highest participation was recorded from ${top.year_level} with ${top.voter_count} distinct voters ${
                  totalYL ? pct(top.voter_count, totalYL) : ""
                }.`;
              drawParagraph(
                page,
                font,
                note,
                margin,
                clamp(ty - 10, 80, 200),
                pageW - margin * 2,
                10.2,
                14,
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            page.drawText(`Chart error: ${msg}`, {
              x: margin,
              y,
              size: 11,
              font,
              color: rgb(0.4, 0.2, 0.2),
            });
          }
        }
      }

      // -------------------------
      // RESULTS PER POSITION
      // -------------------------
      const positionEntries = Array.from(byPosition.entries()).sort(
        ([a], [b]) => {
          const ra = positionRank(a);
          const rb = positionRank(b);
          if (ra !== rb) return ra - rb;
          return String(a).localeCompare(String(b));
        },
      );

      for (const [position, rows] of positionEntries) {
        const page = pdf.addPage([pageW, pageH]);
        const yStart = await drawHeader({
          pdf,
          page,
          fontBold,
          font,
          title: `Results — ${position}`,
          subtitle: electionTitle,
          logoBytes,
        });

        let y = yStart - 6;

        const totalBallotsPos =
          rows[0]?.total_ballots_for_position ??
            rows.reduce((a, r) => a + (r.vote_count || 0), 0);
        const abstainCount = rows[0]?.abstain_count ?? 0;

        const sorted = rows.slice().sort((a, b) => b.vote_count - a.vote_count);
        const leaderVotes = sorted[0]?.vote_count ?? 0;
        const leaders = sorted.filter(
          (r) => r.vote_count === leaderVotes && leaderVotes > 0,
        );

        const effectiveVotes = (r: VoteTallyRow) => {
          const name = (r.candidate_name || "").trim().toUpperCase();
          return name === "ABSTAIN" ? (abstainCount || 0) : (r.vote_count || 0);
        };

        const tableSorted = rows.slice().sort((a, b) => {
          const da = effectiveVotes(a);
          const db = effectiveVotes(b);
          if (db !== da) return db - da;
          return String(a.candidate_name || "").localeCompare(
            String(b.candidate_name || ""),
          );
        });

        const leaderNames = leaders.map((l) =>
          l.slate ? `${l.candidate_name} (${l.slate})` : l.candidate_name
        );

        const leaderShare = totalBallotsPos
          ? pct(leaderVotes, totalBallotsPos)
          : "0.0%";
        const abstainShare = totalBallotsPos
          ? pct(abstainCount, totalBallotsPos)
          : "0.0%";

        const intro =
          "The pie chart summarizes the vote distribution for this position. " +
          "The ranked table provides the vote counts per candidate. " +
          "A brief interpretation is provided for reporting and documentation purposes.";
        y = drawParagraph(page, font, intro, margin, y, pageW - margin * 2);
        y -= 10;

        const pieLabels: string[] = [];
        const pieValues: number[] = [];

        for (const r of rows) {
          const name = (r.candidate_name || "").trim();
          if (name.toUpperCase() === "ABSTAIN") continue;
          pieLabels.push(name);
          pieValues.push(r.vote_count || 0);
        }
        if ((abstainCount || 0) > 0) {
          pieLabels.push("ABSTAIN");
          pieValues.push(abstainCount || 0);
        }

        const pieConfig = {
          type: "pie",
          data: { labels: pieLabels, datasets: [{ data: pieValues }] },
          options: {
            plugins: {
              legend: { position: "right" },
              title: { display: false },
            },
          },
        };

        let imgHUsed = 0;
        try {
          const pngBytes = await quickChartPng(
            pieConfig as Record<string, unknown>,
          );
          const img = await pdf.embedPng(pngBytes);

          const imgW = pageW - margin * 2;
          const imgH = (img.height / img.width) * imgW;
          imgHUsed = imgH;

          page.drawImage(img, {
            x: margin,
            y: y - imgH,
            width: imgW,
            height: imgH,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          page.drawText(`Chart error: ${msg}`, {
            x: margin,
            y,
            size: 11,
            font,
            color: rgb(0.4, 0.2, 0.2),
          });
        }

        y = imgHUsed ? y - imgHUsed - 18 : y - 22;

        page.drawRectangle({
          x: margin,
          y: y - 78,
          width: pageW - margin * 2,
          height: 78,
          color: rgb(0.985, 0.985, 0.99),
          borderColor: rgb(0.9, 0.9, 0.92),
          borderWidth: 1,
        });

        page.drawText("Summary & Interpretation", {
          x: margin + 12,
          y: y - 18,
          size: 11,
          font: fontBold,
          color: rgb(0.12, 0.18, 0.14),
        });

        const summaryText =
          `Total ballots for this position: ${totalBallotsPos}. ` +
          `Abstentions: ${abstainCount} (${abstainShare}). ` +
          (leaders.length
            ? leaders.length > 1
              ? `Leading candidates (tie): ${leaderNames.join(" • ")} with ${leaderVotes} votes each (${leaderShare}).`
              : `Leading candidate: ${leaderNames[0]} with ${leaderVotes} votes (${leaderShare}).`
            : "No leading candidate identified (no votes recorded for any candidate).");

        drawParagraph(
          page,
          font,
          summaryText,
          margin + 12,
          y - 36,
          pageW - margin * 2 - 24,
          10.2,
          14,
        );

        y -= 92;

        drawSectionTitle(page, fontBold, "Ranked Results", margin, y);
        y -= 18;

        const colRank = margin;
        const colName = margin + 50;
        const colSlate = pageW - margin - 190;
        const colVotes = pageW - margin - 70;

        page.drawText("Rank", { x: colRank, y, size: 11, font: fontBold });
        page.drawText("Candidate", { x: colName, y, size: 11, font: fontBold });
        page.drawText("Slate", { x: colSlate, y, size: 11, font: fontBold });
        page.drawText("Votes", { x: colVotes, y, size: 11, font: fontBold });
        y -= 12;

        page.drawLine({
          start: { x: margin, y },
          end: { x: pageW - margin, y },
          thickness: 1,
          color: rgb(0.9, 0.9, 0.92),
        });
        y -= 14;

        for (let i = 0; i < tableSorted.length; i++) {
          const r = tableSorted[i];
          const displayVotes = effectiveVotes(r);

          page.drawText(String(i + 1), { x: colRank, y, size: 10, font });
          page.drawText(String(r.candidate_name).slice(0, 36), {
            x: colName,
            y,
            size: 10,
            font,
          });
          page.drawText(String(r.slate ?? "").slice(0, 18), {
            x: colSlate,
            y,
            size: 10,
            font,
          });
          page.drawText(String(displayVotes), { x: colVotes, y, size: 10, font });

          y -= 14;
          if (y < 88) break;
        }

        const methodNote =
          "Method note: Vote counts are derived from immutable vote records. Percentages in the summary use total ballots for the position as denominator.";
        drawParagraph(
          page,
          font,
          methodNote,
          margin,
          76,
          pageW - margin * 2,
          9.2,
          13,
          rgb(0.45, 0.45, 0.45),
        );
      }

      // -------------------------
      // BLOCKCHAIN VERIFICATION SUMMARY
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);
        const yStart = await drawHeader({
          pdf,
          page,
          fontBold,
          font,
          title: "Blockchain Verification Summary",
          subtitle: electionTitle,
          logoBytes,
        });

        let y = yStart - 6;

        drawParagraph(
          page,
          font,
          "This section provides an audit-oriented summary of how vote submissions may be verified on a public blockchain explorer. The report intentionally does not include voter identity or any linkage between voter and selected candidates.",
          margin,
          y,
          pageW - margin * 2,
        );
        y -= 72;

        const kv = (label: string, value: string) => {
          page.drawText(label, {
            x: margin,
            y,
            size: 10.5,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2),
          });
          page.drawText(value || "—", {
            x: margin + 130,
            y,
            size: 10.5,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          y -= 18;
        };

        kv("Network:", network);
        kv("NFT Collection:", nft_collection);
        if (contract_address) kv("Contract Address:", contract_address);
        kv("Explorer Base URL:", explorer_base);

        y -= 10;
        drawSectionTitle(page, fontBold, "Verification Notes", margin, y);
        y -= 18;

        const bullets = [
          "Each vote submission is represented by a blockchain transaction hash (Tx Hash).",
          "A Tx Hash can be searched on the explorer to verify timestamp, immutability, and inclusion in the chain.",
          "This report may include sample hashes for demonstration or audit. If hashes are not supplied, the verifier may refer to system logs or the on-chain record set.",
        ];

        for (const b of bullets) {
          page.drawText(`• ${b}`, {
            x: margin,
            y,
            size: 10.5,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          y -= 14;
        }

        y -= 12;
        drawSectionTitle(
          page,
          fontBold,
          "Included Transaction Hashes (Optional)",
          margin,
          y,
        );
        y -= 16;

        if (!tx_hashes.length) {
          drawParagraph(
            page,
            font,
            "No transaction hashes were provided to the PDF generator. To include them, pass tx_hashes[] from the admin dashboard when generating this report.",
            margin,
            y,
            pageW - margin * 2,
            10.5,
            14,
            rgb(0.4, 0.2, 0.2),
          );
        } else {
          for (const h of tx_hashes) {
            if (y < 90) break;
            const short = h.length > 66
              ? `${h.slice(0, 12)}…${h.slice(-10)}`
              : h;
            page.drawText(`• ${short}`, {
              x: margin,
              y,
              size: 10.5,
              font,
              color: rgb(0.2, 0.2, 0.2),
            });
            y -= 14;
          }

          y -= 10;
          drawParagraph(
            page,
            font,
            "Usage: append a hash to the Explorer Base URL above (base + hash) to open the transaction details page.",
            margin,
            y,
            pageW - margin * 2,
            10.2,
            14,
            rgb(0.35, 0.35, 0.35),
          );
        }
      }

      // -------------------------
      // SIGNATURE / CERTIFICATION
      // -------------------------
      {
        const list: Signatory[] = signatories.length > 0
          ? signatories
          : [
            {
              label: "Prepared by",
              name: "__________________________",
              role: "Group Member",
            },
            {
              label: "Noted by",
              name: "__________________________",
              role: "Thesis Adviser",
            },
          ];

        const isGroupMember = (s: Signatory) => {
          const lbl = (s.label || "").toLowerCase();
          const role = (s.role || "").toLowerCase();
          return lbl.includes("prepared") && role.includes("group");
        };

        const groupMembers = list.filter(isGroupMember);
        const others = list.filter((s) => !isGroupMember(s));

        const makePage = async (title: string) => {
          const p = pdf.addPage([pageW, pageH]);
          const yStart = await drawHeader({
            pdf,
            page: p,
            fontBold,
            font,
            title,
            subtitle: electionTitle,
            logoBytes,
          });
          return { page: p, yStart };
        };

        const drawSigLineBlock = (
          page: PDFPage,
          x: number,
          topY: number,
          w: number,
          heading: string,
          name: string,
          role: string,
        ) => {
          page.drawText(`${heading}:`, {
            x,
            y: topY,
            size: 11,
            font: fontBold,
            color: rgb(0.12, 0.18, 0.14),
          });

          const lineY = topY - 30;
          page.drawLine({
            start: { x, y: lineY },
            end: { x: x + w, y: lineY },
            thickness: 1,
            color: rgb(0.25, 0.25, 0.25),
          });

          page.drawText(name, {
            x,
            y: lineY - 16,
            size: 11.5,
            font: fontBold,
            color: rgb(0.12, 0.12, 0.12),
          });

          page.drawText(role || "", {
            x,
            y: lineY - 32,
            size: 10,
            font,
            color: rgb(0.45, 0.45, 0.45),
          });
        };

        const drawGroupedMembers = (
          page: PDFPage,
          x: number,
          topY: number,
          w: number,
          members: Signatory[],
        ) => {
          page.drawText("Prepared by (Group Members):", {
            x,
            y: topY,
            size: 11,
            font: fontBold,
            color: rgb(0.12, 0.18, 0.14),
          });

          const colGap = 30;
          const colW = (w - colGap) / 2;

          let y = topY - 24;
          for (let i = 0; i < members.length; i++) {
            const m = members[i];
            const col = i % 2;
            const row = Math.floor(i / 2);

            const bx = x + (col === 0 ? 0 : colW + colGap);
            const by = y - row * 72;

            page.drawLine({
              start: { x: bx, y: by - 18 },
              end: { x: bx + colW, y: by - 18 },
              thickness: 1,
              color: rgb(0.25, 0.25, 0.25),
            });

            page.drawText(m.name, {
              x: bx,
              y: by - 34,
              size: 11,
              font: fontBold,
              color: rgb(0.12, 0.12, 0.12),
            });

            page.drawText(m.role || "Group Member", {
              x: bx,
              y: by - 50,
              size: 10,
              font,
              color: rgb(0.45, 0.45, 0.45),
            });
          }

          const rows = Math.ceil(members.length / 2);
          return topY - 24 - rows * 72;
        };

        let { page, yStart } = await makePage("Certification / Signatures");
        let y = yStart - 6;

        // Layout constants (declared BEFORE first use)
        const contentW = pageW - margin * 2;
        const colGap = 40;
        const colW = (contentW - colGap) / 2;

        drawParagraph(
          page,
          font,
          "The undersigned certify that this report was generated by the BotoVeritas system and is based on recorded vote data for the specified election. This certification page is intended for documentation and academic reporting purposes.",
          margin,
          y,
          pageW - margin * 2,
        );
        y -= 70;

        if (election?.is_final) {
          const needed = 86;
          if (y - needed < 90) {
            const next = await makePage("Certification / Signatures (cont.)");
            page = next.page;
            y = next.yStart - 6;
          }

          page.drawText("Election Finalization", {
            x: margin,
            y,
            size: 12,
            font: fontBold,
            color: rgb(0.12, 0.18, 0.14),
          });
          y -= 18;

          const finalizedBy = election.finalized_by_email ||
            election.finalized_by ||
            "—";

          page.drawText(`Finalized by: ${finalizedBy}`, {
            x: margin,
            y,
            size: 11,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          y -= 14;

          page.drawText(`Finalized at: ${fmtShortDate(election.finalized_at)}`, {
            x: margin,
            y,
            size: 11,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          y -= 16;

          page.drawLine({
            start: { x: margin, y },
            end: { x: margin + contentW, y },
            thickness: 1,
            color: rgb(0.85, 0.87, 0.86),
          });
          y -= 14;
        }

        if (groupMembers.length) {
          const minNeeded = 120 + Math.ceil(groupMembers.length / 2) * 72;
          if (y - minNeeded < 90) {
            const next = await makePage("Certification / Signatures (cont.)");
            page = next.page;
            y = next.yStart - 6;
          }

          y = drawGroupedMembers(page, margin, y, contentW, groupMembers) - 18;
        }

        let i = 0;
        while (i < others.length) {
          const rowNeeded = 92;
          if (y - rowNeeded < 90) {
            const next = await makePage("Certification / Signatures (cont.)");
            page = next.page;
            y = next.yStart - 6;
          }

          const left = others[i];
          const right = others[i + 1];

          drawSigLineBlock(
            page,
            margin,
            y,
            colW,
            left.label || "Signatory",
            left.name || "__________________________",
            left.role || "",
          );

          if (right) {
            drawSigLineBlock(
              page,
              margin + colW + colGap,
              y,
              colW,
              right.label || "Signatory",
              right.name || "__________________________",
              right.role || "",
            );
          }

          y -= 92;
          i += 2;
        }
      }

      // Add page numbers
      const pages = pdf.getPages();
      for (let i = 0; i < pages.length; i++) {
        drawPageNumber(pages[i], font, i + 1, pages.length);
      }

      const pdfBytes = await pdf.save();
      return { pdfBytes, electionTitle };
    };

    const { pdfBytes, electionTitle } = await buildSingleElectionPdf(election_id);
    const filename = `${safeFilename(electionTitle)}_Results_Report.pdf`;

    return new Response(u8ToArrayBuffer(pdfBytes), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: unknown) {
    console.error("generate-results-pdf error:", err);
    const message = err instanceof Error ? err.message : String(err);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
