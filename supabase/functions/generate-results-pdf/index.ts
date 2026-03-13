import { serve } from "std/http/server";
import { createClient } from "supabase";
import { ethers } from "ethers";
import {
  PDFDocument,
  PDFPage,
  PDFFont,
  StandardFonts,
  rgb,
} from "pdf-lib";

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

type ElectionVoteChunkRow = {
  chunk_index: number;
  chunk_root: string | null;
};

type ElectionManifestRow = {
  manifest_hash: string | null;
  spec_version?: string | null;
  created_at?: string | null;
};

type Signatory = {
  label: string;
  name: string;
  role?: string | null;
};

type VotesVoterIdRow = { voter_id: string | null };

type Body = {
  mode?: "draft" | "final";
  election_id?: string;
  include_charts?: boolean;
  chart_images?: {
    turnout_donut?: { mime?: string; data_base64: string };
    position_pies?: Record<string, { mime?: string; data_base64: string }>;
  };
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

  // ZKP / commitment verification (optional)
  tally_commitment?: string; // e.g., Merkle root / Poseidon root
  zk_proof_hash?: string; // hash/identifier of the ZK proof artifact
  zk_verifier_contract?: string;
  zk_verification_tx?: string; // tx hash where proof was verified
  public_inputs_hash?: string; // hash of public inputs used by the verifier
  onchain_anchor_tx?: string; // tx hash anchoring the report/tally digest
  onchain_anchor_note?: string; // short description of the anchor (event name, method)

  // BV anchors (optional; if supplied, PDF can compare against computed values)
  election_id_hash_bytes32?: string;
  election_vote_root_bytes32?: string;
  manifest_hash_bytes32?: string;

  // ZK tally artifacts (optional)
  results_hash_bytes32?: string;
  results_uri?: string;

  // On-chain tally submission (optional)
  tally_registry_address?: string;
  tally_submit_tx?: string;
  tally_submitter?: string;
  tally_submitted_at?: string;

  // Public verification URL base (e.g. "https://botoveritas.vercel.app")
  // Used to build the QR code and verify link printed in the PDF.
  app_url?: string;
};

/* =========================
   CORS
========================= */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function _requireKioskSecret(req: Request) {
  const expected =
    Deno.env.get("KIOSK_SECRET") ||
    Deno.env.get("KIOSK_RECEIPT_SECRET") ||
    "";

  const got = (req.headers.get("x-kiosk-secret") ?? "").trim();
  if (!expected || !got || got !== expected) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  return null;
}

async function isAdminCaller(req: Request, supabaseUrl: string, anonKey: string): Promise<false | true | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return false;

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) {
    console.error("[generate-results-pdf] Invalid token", { error: userErr?.message ?? String(userErr) });
    return json(401, { ok: false, error: "Invalid token" });
  }

  const { data: roleRow, error: roleErr } = await authed
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle<{ role: string }>();

  if (roleErr) {
    console.error("[generate-results-pdf] Role lookup failed", { error: roleErr.message });
    return json(500, { ok: false, error: "Failed to validate admin role" });
  }

  return roleRow?.role === "admin";
}



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
  if (!dtISO) return "-";
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

function _clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(n: number, d: number) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}


function ensure0x32(hex: string) {
  const h = String(hex ?? "");
  if (!h) return "";
  return h.startsWith("0x") ? h : `0x${h}`;
}

function toLowerHex32(hex: string) {
  const h = ensure0x32(hex);
  return h ? ("0x" + h.slice(2).toLowerCase()) : "";
}

function keccakPairHashSorted(a: string, b: string) {
  const aa = toLowerHex32(a);
  const bb = toLowerHex32(b);
  if (!aa || !bb) return "";
  const [min, max] = aa <= bb ? [aa, bb] : [bb, aa];
  return ethers.keccak256(ethers.concat([min, max]));
}

function merkleRootSortedPairs(leaves: string[]) {
  const clean = leaves.filter(Boolean).map(toLowerHex32);
  if (clean.length === 0) return "0x" + "00".repeat(32);
  if (clean.length === 1) return clean[0];

  let level = [...clean];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(keccakPairHashSorted(left, right));
    }
    level = next;
  }
  return level[0];
}

function hashUtf8ToBytes32(s: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(s ?? "")));
}


async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of raw bytes (used to fingerprint the final PDF binary). */
async function sha256BytesHex(input: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer so crypto.subtle.digest accepts it regardless
  // of whether the underlying buffer is a SharedArrayBuffer (Deno / V8 edge cases).
  const plain = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", plain);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds a minimal QR-code SVG for a URL using a simple matrix encoding.
 * This is a lightweight pure-Deno implementation (no external deps).
 * For short URLs it produces a clean, scannable QR code.
 *
 * We use the qr-code-generator CDN-free approach: encode the URL as a
 * Data URI SVG that pdf-lib can embed as a PNG via a QuickChart call.
 */
async function fetchQrPng(url: string): Promise<Uint8Array | null> {
  try {
    const encoded = encodeURIComponent(url);
    const res = await fetch(
      `https://quickchart.io/qr?text=${encoded}&size=200&format=png&margin=1`,
    );
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}


// Canonical position sets per org (single-seat everywhere)
const ORG_CANONICAL_POSITIONS: Record<string, string[]> = {
  ICpEP: [
    "President",
    "Vice President - Internal",
    "Vice President - External",
    "Secretary",
    "Assistant Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "1st Year Batch Representative",
    "2nd Year Batch Representative",
    "3rd Year Batch Representative",
    "4th Year Batch Representative",
    "Director for Publicity and Creatives",
    "Director for Sports",
    "Director for Programs",
  ],
  SCC: [
    "President",
    "Vice President",
    "Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "Director for Creatives",
  ],
  HonSoc: [
    "President",
    "Vice President - Internal",
    "Vice President - External",
    "Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "Directors Board: Creatives & Technical",
    "Directors Board: Secretariat & Documentation",
    "Directors Board: Academics & Sports",
    "Directors Board: Programs & Logistics",
    "Directors Board: Publicity & External Events",
  ],
};

function uniqPreserveOrder(items: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const v = String(it ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}


function normalizeOrgCode(s: string) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

const ORG_ALIASES: Record<string, keyof typeof ORG_CANONICAL_POSITIONS> = {
  "icpep": "ICpEP",
  "icpep.se": "ICpEP",
  "icpep se": "ICpEP",
  "scc": "SCC",
  "student coordinating council": "SCC",
  "student-coordinating-council": "SCC",
  "honsoc": "HonSoc",
  "hon soc": "HonSoc",
  "honor society": "HonSoc",
  "honoursoc": "HonSoc",
};

function inferOrgCodesFromTitle(title: string): Array<keyof typeof ORG_CANONICAL_POSITIONS> {
  const t = normalizeOrgCode(title);
  const out: Array<keyof typeof ORG_CANONICAL_POSITIONS> = [];

  const push = (c: keyof typeof ORG_CANONICAL_POSITIONS) => {
    if (!out.includes(c)) out.push(c);
  };

  if (t.includes("icpep")) push("ICpEP");
  if (t.includes("scc") || t.includes("student coordinating council")) push("SCC");
  if (t.includes("honsoc") || t.includes("hon soc") || t.includes("honor society")) push("HonSoc");

  return out;
}

function getCanonicalPositionsForElection(electionTitle: string, eligibleOrgs: unknown): string[] {
  const list = Array.isArray(eligibleOrgs) ? eligibleOrgs : [];
  const rawCodes = uniqPreserveOrder(list.map((x) => String(x ?? "").trim()).filter(Boolean));

  const mapped = rawCodes
    .map((c) => ORG_ALIASES[normalizeOrgCode(c)] ?? null)
    .filter(Boolean) as Array<keyof typeof ORG_CANONICAL_POSITIONS>;

  const inferred = mapped.length ? mapped : inferOrgCodesFromTitle(electionTitle);

  if (inferred.length === 0) return [];
  return uniqPreserveOrder(inferred.flatMap((c) => ORG_CANONICAL_POSITIONS[c]));
}



function normalizePosition(s: string) {
  // Normalize casing, whitespace, and dash variants so DB values like
  // 'Vice President - Internal' still match the canonical order.
  return String(s ?? "")
    .toLowerCase()
    .replace(/[--]/g, "-")
    .replace(/\s*\-\s*/g, " - ")
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalPositionIndex(position: string, canonicalOrder: string[]) {
  const p = normalizePosition(position);
  if (!p) return -1;
  // Case/whitespace-insensitive match (DB values may differ in casing)
  for (let i = 0; i < canonicalOrder.length; i++) {
    if (normalizePosition(canonicalOrder[i]) === p) return i;
  }
  return -1;
}

function positionRank(posRaw: string, canonicalOrder: string[]) {
  // Prefer canonical ordering when available
  const idx = canonicalPositionIndex(posRaw, canonicalOrder);
  if (idx >= 0) return idx + 1;

  const pos = (posRaw || "").toLowerCase().replace(/\s+/g, " ").trim();

  // Heuristic fallback (legacy / mixed elections)
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

  if (pos === "vp" || (pos.includes("vice") && pos.includes("president"))) return 2;

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

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function embedBase64Image(
  pdf: PDFDocument,
  mime: string | undefined,
  data_base64: string,
) {
  const bytes = base64ToU8(data_base64);
  if ((mime || "").includes("png")) return await pdf.embedPng(bytes);
  // default to jpeg
  return await pdf.embedJpg(bytes);
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

  // --- FEU / BotoVeritas ceremonial header ---
  // Keep geometry predictable: callers expect a safe Y to start body content.
  const bandH = 86;
  const bandY = pageH - bandH;

  // FEU deep green band
  page.drawRectangle({
    x: 0,
    y: bandY,
    width: pageW,
    height: bandH,
    color: rgb(0.02, 0.28, 0.16), // #054827-ish
  });

  // gold trim
  page.drawRectangle({
    x: 0,
    y: bandY - 6,
    width: pageW,
    height: 6,
    color: rgb(0.78, 0.62, 0.20), // gold
  });

  // logo (left)
  const logoBox = 34;
  const logoX = marginX;
  const logoY = pageH - 58;

  if (logoBytes && logoBytes.length > 0) {
    try {
      const img = await embedLogo(pdf, logoBytes);
      const scale = Math.min(logoBox / img.width, logoBox / img.height);
      const w = img.width * scale;
      const h = img.height * scale;

      page.drawImage(img, {
        x: logoX,
        y: logoY,
        width: w,
        height: h,
      });
    } catch {
      // ignore logo failures; header still renders
    }
  }

  // text
  const titleX = marginX + logoBox + 16;

  page.drawText(title, {
    x: titleX,
    y: pageH - 44,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(subtitle, {
    x: titleX,
    y: pageH - 62,
    size: 11,
    font,
    color: rgb(0.92, 0.94, 0.93),
  });

  // divider line under gold trim (subtle)
  page.drawLine({
    start: { x: marginX, y: bandY - 10 },
    end: { x: pageW - marginX, y: bandY - 10 },
    thickness: 1,
    color: rgb(0.88, 0.86, 0.80),
  });

  // Start body content safely below header
  return bandY - 32;
}

function drawSectionTitle(
  page: PDFPage,
  fontBold: PDFFont,
  title: string,
  x: number,
  y: number,
) {
  // Ceremonial section header: gold title + underline
  page.drawText(title, {
    x,
    y,
    size: 18,
    font: fontBold,
    color: rgb(0.78, 0.62, 0.20), // gold
  });

  page.drawLine({
    start: { x, y: y - 6 },
    end: { x: x + 260, y: y - 6 },
    thickness: 2,
    color: rgb(0.78, 0.62, 0.20),
  });

  return y - 18;
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
  // Wrap with support for very long tokens (hashes/URLs) by chunking them.
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let cy = y;

  const flush = () => {
    if (!line) return;
    page.drawText(line, { x, y: cy, size: fontSize, font, color });
    cy -= lineHeight;
    line = "";
  };

  const pushWord = (w: string) => {
    // If a single word is wider than maxWidth, split it into chunks.
    if (font.widthOfTextAtSize(w, fontSize) <= maxWidth) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth) flush();
      line = line ? `${line} ${w}` : w;
      return;
    }

    // Split long word into chunks that fit maxWidth
    let chunk = "";
    for (const ch of w) {
      const testChunk = chunk + ch;
      if (font.widthOfTextAtSize(testChunk, fontSize) > maxWidth) {
        const testLine = line ? `${line} ${chunk}` : chunk;
        if (line && font.widthOfTextAtSize(testLine, fontSize) > maxWidth) flush();
        if (chunk) {
          line = line ? `${line} ${chunk}` : chunk;
          flush();
        }
        chunk = ch;
      } else {
        chunk = testChunk;
      }
    }
    if (chunk) {
      const testLine = line ? `${line} ${line.endsWith(chunk) ? "" : ""}${chunk}` : chunk;
      if (line && font.widthOfTextAtSize(testLine, fontSize) > maxWidth) flush();
      line = line ? `${line} ${chunk}` : chunk;
    }
  };

  for (const w of words) pushWord(w);
  flush();
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

  // Ceremonial metric card: soft tint + gold accent bar
  page.drawRectangle({
    x,
    y: y - h,
    width: w,
    height: h,
    color: rgb(0.95, 0.97, 0.96), // light green tint
    borderColor: rgb(0.90, 0.90, 0.90),
    borderWidth: 1,
  });

  // left gold accent
  page.drawRectangle({
    x,
    y: y - h,
    width: 5,
    height: h,
    color: rgb(0.78, 0.62, 0.20),
  });

  const padX = 14;
  const maxW = w - padX * 2;

  page.drawText(title.toUpperCase(), {
    x: x + padX,
    y: y - 18,
    size: 9,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });

  // Auto-fit the value so it never clips outside the card.
  let valueSize = 20;
  while (valueSize > 12 && fontBold.widthOfTextAtSize(value, valueSize) > maxW) {
    valueSize -= 1;
  }

  if (fontBold.widthOfTextAtSize(value, valueSize) <= maxW) {
    page.drawText(value, {
      x: x + padX,
      y: y - 42,
      size: valueSize,
      font: fontBold,
      color: rgb(0.02, 0.28, 0.16),
    });
  } else {
    // Very long strings (URLs / long network names) -> wrap to 2 lines
    drawParagraph(
      page,
      fontBold,
      value,
      x + padX,
      y - 34,
      maxW,
      11,
      13,
      rgb(0.02, 0.28, 0.16),
    );
  }

  if (footnote) {
    drawParagraph(
      page,
      font,
      footnote,
      x + padX,
      y - h + 16,
      maxW,
      8.5,
      11.5,
      rgb(0.35, 0.35, 0.35),
    );
  }
}


function drawInfoBoxCompact(params: {
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
    color: rgb(0.95, 0.97, 0.96),
    borderColor: rgb(0.90, 0.90, 0.90),
    borderWidth: 1,
  });

  page.drawRectangle({ x, y: y - h, width: 5, height: h, color: rgb(0.78, 0.62, 0.20) });

  page.drawText(title.toUpperCase(), {
    x: x + 14,
    y: y - 18,
    size: 8.6,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });

  drawParagraph(page, fontBold, value || "-", x + 14, y - 36, w - 28, 13.5, 15.5, rgb(0.02, 0.28, 0.16));

  if (footnote) {
    drawParagraph(page, font, footnote, x + 14, y - h + 18, w - 28, 8.2, 10.5, rgb(0.35, 0.35, 0.35));
  }
}

/* =========================
   Handler
========================= */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  // Allow either: (A) authenticated admin, or (B) kiosk secret header (legacy)
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
  if (!supabaseUrl) return json(500, { ok: false, error: "Missing SUPABASE_URL env var" });
  if (!anonKey) return json(500, { ok: false, error: "Missing SUPABASE_ANON_KEY env var" });

  const adminOk = await isAdminCaller(req, supabaseUrl, anonKey);
  if (adminOk instanceof Response) return adminOk;
  if (!adminOk) return json(403, { ok: false, error: 'Forbidden: admin access required' });

  try {
    const body: Body & Record<string, unknown> = await req.json().catch(() => ({} as Body & Record<string, unknown>));

    // Accept both snake_case and camelCase payloads so older/newer callers do not break.
    const election_id =
      typeof body?.election_id === "string"
        ? body.election_id
        : typeof body?.electionId === "string"
          ? body.electionId
          : undefined;
    const mode = (body?.mode === 'final' ? 'final' : 'draft') as 'draft' | 'final';
    // Default to showing charts unless the caller explicitly disables them.
    const includeCharts =
      typeof body?.include_charts === "boolean"
        ? body.include_charts
        : typeof body?.includeCharts === "boolean"
          ? body.includeCharts
          : true;
    const chart_images =
      body?.chart_images ??
      (body?.chartImages as Body["chart_images"] | undefined);

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
    const network = body?.network || "Polygon Amoy";
    // Default switched to Polygon Amoy for defense testing
    const explorer_base =
      body?.explorer_base || "https://amoy.polygonscan.com/tx/";
    const tx_hashes = Array.isArray(body?.tx_hashes)
      ? body.tx_hashes.filter(Boolean).slice(0, 20)
      : [];
    // Parsed for forward-compat; may be rendered later if you decide to include it
    const _contract_address = body?.contract_address || "";
    const _nft_collection = body?.nft_collection || "BotoVeritas Proof-of-Vote";
const tally_commitment = body?.tally_commitment || "";
const zk_proof_hash = body?.zk_proof_hash || "";
let zk_verifier_contract = body?.zk_verifier_contract || "";
let zk_verification_tx = body?.zk_verification_tx || "";
const public_inputs_hash = body?.public_inputs_hash || "";
let onchain_anchor_tx = body?.onchain_anchor_tx || "";

const onchain_anchor_note = body?.onchain_anchor_note || "";

// BV ZK tally anchors (optional)
const election_id_hash_bytes32 = body?.election_id_hash_bytes32 || "";
let election_vote_root_bytes32 = body?.election_vote_root_bytes32 || "";
let manifest_hash_bytes32 = body?.manifest_hash_bytes32 || "";
let results_hash_bytes32 = body?.results_hash_bytes32 || "";
const results_uri = body?.results_uri || "";

// On-chain tally submission (optional)
let tally_registry_address = body?.tally_registry_address || "";
const tally_submit_tx = body?.tally_submit_tx || "";
const tally_submitter = body?.tally_submitter || "";
const tally_submitted_at = body?.tally_submitted_at || "";

    // Public verification base URL - used to build the QR verify link in the PDF.
    // Priority: request body > env var > empty string (QR omitted if empty).
    const app_url = (
      body?.app_url ||
      Deno.env.get("APP_URL") ||
      Deno.env.get("VITE_APP_URL") ||
      ""
    ).replace(/\/$/, ""); // strip trailing slash

    // Supabase (service role)
    // supabaseUrl validated above (admin/kiosk gate)

    const serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) throw new Error("Missing SERVICE_ROLE_KEY secret");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // --- ZK metadata hydration (DB -> PDF) ---
    const [mRes, rRes, pRes] = await Promise.all([
      supabase.from('election_manifests').select('manifest_hash').eq('election_id', election_id).maybeSingle(),
      supabase.from('election_vote_roots').select('election_vote_root').eq('election_id', election_id).maybeSingle(),
      supabase.from('election_tally_proofs').select('status,manifest_hash,election_vote_root,results_hash,tx_hash,chain,registry_address,verifier_address,results_pdf_url,results_json_url,public_signals_json_url,proof_json_url,updated_at').eq('election_id', election_id).maybeSingle(),
    ]);

    const manifestHashDb =
      (mRes.data as { manifest_hash?: string | null } | null)?.manifest_hash ??
      (pRes.data as { manifest_hash?: string | null } | null)?.manifest_hash ??
      null;
    const rootDb =
      (rRes.data as { election_vote_root?: string | null } | null)?.election_vote_root ??
      (pRes.data as { election_vote_root?: string | null } | null)?.election_vote_root ??
      null;
    type ProofDbRow = {
      status?: string | null;
      manifest_hash?: string | null;
      election_vote_root?: string | null;
      results_hash?: string | null;
      tx_hash?: string | null;
      chain?: string | null;
      registry_address?: string | null;
      verifier_address?: string | null;
      results_pdf_url?: string | null;
      results_json_url?: string | null;
      public_signals_json_url?: string | null;
      proof_json_url?: string | null;
      updated_at?: string | null;
    };
    const proofDb = (pRes.data as ProofDbRow | null) ?? null;

    if (!manifest_hash_bytes32 && manifestHashDb) manifest_hash_bytes32 = String(manifestHashDb);
    if (!election_vote_root_bytes32 && rootDb) election_vote_root_bytes32 = String(rootDb);
    if (!results_hash_bytes32 && proofDb?.results_hash) results_hash_bytes32 = String(proofDb.results_hash);

    if (!zk_verification_tx && proofDb?.tx_hash) zk_verification_tx = String(proofDb.tx_hash);
    if (!tally_registry_address && proofDb?.registry_address) tally_registry_address = String(proofDb.registry_address);
    if (!zk_verifier_contract && proofDb?.verifier_address) zk_verifier_contract = String(proofDb.verifier_address);

    // Prefer storing the on-chain anchor as the same verification tx
    if (!onchain_anchor_tx && zk_verification_tx) onchain_anchor_tx = zk_verification_tx;

    if (mode === 'final' && !zk_verification_tx) {
      return json(409, { ok: false, error: 'Final PDF requires an on-chain verification tx_hash. Proof must be submitted first.' });
    }

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
    const fontMono = await pdf.embedFont(StandardFonts.Courier);

      const pageW = 595.28;
      const pageH = 841.89;
      const margin = 48;

      // -------------------------
      // COVER PAGE
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);

        // Background
        page.drawRectangle({
          x: 0,
          y: 0,
          width: pageW,
          height: pageH,
          color: rgb(1, 1, 1),
        });

        // Top ceremonial band (FEU green)
        page.drawRectangle({
          x: 0,
          y: pageH - 260,
          width: pageW,
          height: 260,
          color: rgb(0.02, 0.28, 0.16),
        });

        // Gold trim
        page.drawRectangle({
          x: 0,
          y: pageH - 270,
          width: pageW,
          height: 10,
          color: rgb(0.78, 0.62, 0.20),
        });

        // Centered logo inside the band
        if (logoBytes) {
          try {
            const img = await embedLogo(pdf, logoBytes);
            const targetH = 84;
            const scale = targetH / img.height;
            const w = img.width * scale;
            const h = img.height * scale;
            page.drawImage(img, {
              x: (pageW - w) / 2,
              y: pageH - 210,
              width: w,
              height: h,
            });
          } catch {
            // ignore
          }
        }

        // Main title
        page.drawText("OFFICIAL ELECTION RESULTS REPORT", {
          x: margin,
          y: pageH - 300,
          size: 22,
          font: fontBold,
          color: rgb(0.02, 0.28, 0.16),
        });

        // Election title
        page.drawText(electionTitle, {
          x: margin,
          y: pageH - 330,
          size: 16,
          font: fontBold,
          color: rgb(0.78, 0.62, 0.20),
        });
        const scheduleLine = election
          ? `Election Window: ${fmtShortDate(election.start_date)} to ${fmtShortDate(election.end_date)}`
          : "Election Window: -";

        const generatedLine = `Generated: ${fmtDate(new Date())}`;


        // Meta
        page.drawText(scheduleLine, {
          x: margin,
          y: pageH - 356,
          size: 10.5,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });

        page.drawText(generatedLine, {
          x: margin,
          y: pageH - 372,
          size: 10.5,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });

        // Contents card
        const cardY = pageH - 420;
        const cardH = 220;

        page.drawRectangle({
          x: margin,
          y: cardY - cardH,
          width: pageW - margin * 2,
          height: cardH,
          color: rgb(0.98, 0.98, 0.985),
          borderColor: rgb(0.90, 0.90, 0.90),
          borderWidth: 1,
        });

        // Card header strip
        page.drawRectangle({
          x: margin,
          y: cardY - 42,
          width: pageW - margin * 2,
          height: 42,
          color: rgb(0.02, 0.28, 0.16),
        });

        page.drawText("CONTENTS", {
          x: margin + 16,
          y: cardY - 28,
          size: 12,
          font: fontBold,
          color: rgb(1, 1, 1),
        });

        const items = [
          "1. Executive Summary (Turnout & Methodology)",
          "2. Turnout Distribution by Year Level",
          "3. Results per Position (Pie Distribution + Ranked Table + Summary)",
          "4. Blockchain Verification Summary",
          "5. Zero-Knowledge Proof (ZKP) Verification",
          "6. Certification / Signatures",
        ];

        let iy = cardY - 70;
        for (const it of items) {
          page.drawText("- " + it, {
            x: margin + 18,
            y: iy,
            size: 10.5,
            font,
            color: rgb(0.15, 0.15, 0.15),
          });
          iy -= 18;
        }

        page.drawText(
          "Note: This report is generated from immutable vote records. Percentages are rounded to one decimal place.",
          {
            x: margin,
            y: 70,
            size: 9,
            font,
            color: rgb(0.35, 0.35, 0.35),
            maxWidth: pageW - margin * 2,
          },
        );
      }
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
          subtitle: `${electionTitle} - Overall Turnout: ${
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

                    if (includeCharts) {
            try {
              // Prefer client-provided chart image (avoids Edge CPU timeout + network)
              if (chart_images?.turnout_donut?.data_base64) {
                const img = await embedBase64Image(pdf, chart_images.turnout_donut.mime, chart_images.turnout_donut.data_base64);

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

                // Continue with table rendering using ty
                y = ty;
              } else {
                // No client-provided image - fetch from QuickChart
                const pngBytes = await quickChartPng(donutConfig);
                const img = await pdf.embedPng(pngBytes);
                const imgW = pageW - margin * 2;
                const imgH = (img.height / img.width) * imgW;
                page.drawImage(img, { x: margin, y: y - imgH, width: imgW, height: imgH });
                let ty = y - imgH - 18;
                page.drawLine({ start: { x: margin, y: ty }, end: { x: pageW - margin, y: ty }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
                ty -= 18;
                y = ty;
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
          } else {


            // Charts disabled (reduces CPU/time in Edge Function)


            // Keep the table rendering below; just skip image generation.


            // (No-op)


          }
        }
      }

      // -------------------------
      // RESULTS PER POSITION
      // -------------------------
      const canonicalOrder = getCanonicalPositionsForElection(electionTitle, eligibleOrgs);

      const positionEntries = Array.from(byPosition.entries()).sort(
        ([a], [b]) => {
          const ra = positionRank(a, canonicalOrder);
          const rb = positionRank(b, canonicalOrder);
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
          title: `Results - ${position}`,
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
                if (includeCharts) {
          try {
            // Prefer client-provided chart image (avoids Edge CPU timeout + network)
            if (chart_images?.position_pies && chart_images.position_pies[position]?.data_base64) {
              const img = await embedBase64Image(pdf, chart_images.position_pies[position].mime, chart_images.position_pies[position].data_base64);

              const imgW = pageW - margin * 2;
              const imgH = (img.height / img.width) * imgW;
              imgHUsed = imgH;

              page.drawImage(img, {
                x: margin,
                y: y - imgH,
                width: imgW,
                height: imgH,
              });
            } else {
              // No client-provided image - fetch from QuickChart
              const pngBytes = await quickChartPng(pieConfig);
              const img = await pdf.embedPng(pngBytes);
              const imgW = pageW - margin * 2;
              const imgH = (img.height / img.width) * imgW;
              imgHUsed = imgH;
              page.drawImage(img, { x: margin, y: y - imgH, width: imgW, height: imgH });
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
        } else {

          // Charts disabled (reduces CPU/time in Edge Function)

          // Leave space for content below.

        }

        y = imgHUsed ? y - imgHUsed - 18 : y - 22;

        page.drawRectangle({
          x: margin,
          y: y - 78,
          width: pageW - margin * 2,
          height: 96,
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

        const line1 = `Total ballots: ${totalBallotsPos}`;
        const line2 = `Abstentions: ${abstainCount} (${abstainShare})`;
        const line3 = leaders.length
          ? leaders.length > 1
            ? `Leading candidates (tie): ${leaderNames.join(" - ")} - ${leaderVotes} votes each (${leaderShare})`
            : `Leading candidate: ${leaderNames[0]} - ${leaderVotes} votes (${leaderShare})`
          : "Leading candidate: - (no votes recorded)";

        // Structured formatting: one item per line (wrap-aware)
        drawParagraph(page, font, `- ${line1}`, margin + 12, y - 36, pageW - margin * 2 - 24, 10.2, 14);
        drawParagraph(page, font, `- ${line2}`, margin + 12, y - 50, pageW - margin * 2 - 24, 10.2, 14);
        drawParagraph(page, font, `- ${line3}`, margin + 12, y - 64, pageW - margin * 2 - 24, 10.2, 14);

        y -= 110;

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
      // WINNERS SUMMARY
      // -------------------------
      {
        // -- Collect one winner entry per winning candidate per position ------
        type WinnerEntry = {
          position: string;
          name: string;
          slate: string;
          votes: number;
          total: number;
          isTie: boolean;
        };

        const winnerRows: WinnerEntry[] = [];

        for (const [position, rows] of positionEntries) {
          // exclude the synthetic ABSTAIN row
          const realCandidates = rows.filter(
            (r) => (r.candidate_name || "").trim().toUpperCase() !== "ABSTAIN",
          );
          if (!realCandidates.length) continue;

          const byVotes = realCandidates.slice().sort((a, b) => b.vote_count - a.vote_count);
          const topVotes = byVotes[0]?.vote_count ?? 0;
          if (topVotes <= 0) continue;

          const topCandidates = byVotes.filter((r) => r.vote_count === topVotes);
          const isTie = topCandidates.length > 1;

          const totalBallotsPos =
            rows[0]?.total_ballots_for_position ??
            rows.reduce((a, r) => a + (r.vote_count || 0), 0);
          const abstainCount = rows[0]?.abstain_count ?? 0;
          const candidateBallotsPos = Math.max(0, totalBallotsPos - abstainCount);

          for (const c of topCandidates) {
            winnerRows.push({
              position,
              name: c.candidate_name || "-",
              slate: c.slate || "",
              votes: topVotes,
              total: candidateBallotsPos,
              isTie,
            });
          }
        }

        // -- Pagination: 10 data rows fit between stat cards + table header --
        const ROWS_PER_PAGE = 10;
        const totalWinnerPages = Math.max(1, Math.ceil(winnerRows.length / ROWS_PER_PAGE));

        for (let pageIdx = 0; pageIdx < totalWinnerPages; pageIdx++) {
          const isFirstPage = pageIdx === 0;
          const pageSlice = winnerRows.slice(
            pageIdx * ROWS_PER_PAGE,
            (pageIdx + 1) * ROWS_PER_PAGE,
          );

          const pg = pdf.addPage([pageW, pageH]);
          const yStart = await drawHeader({
            pdf,
            page: pg,
            fontBold,
            font,
            title: "Election Winners Summary",
            subtitle: isFirstPage ? electionTitle : `${electionTitle} (cont.)`,
            logoBytes,
          });

          let y = yStart - 6;

          // -- Intro paragraph (first page only) --
          if (isFirstPage) {
            drawParagraph(
              pg,
              font,
              "This page summarizes the candidate elected to each position based on the highest vote count. " +
              "Tied positions are clearly flagged. Percentages reflect each winner's share of total non-abstain ballots cast for that position.",
              margin,
              y,
              pageW - margin * 2,
              10.5,
              15,
            );
            y -= 54;

            // -- Three stat cards --
            const totalPositions = positionEntries.length;
            const tiePositions = new Set(winnerRows.filter((w) => w.isTie).map((w) => w.position)).size;
            const uncontested = positionEntries.filter(([, rows]) => {
              const real = rows.filter((r) => (r.candidate_name || "").trim().toUpperCase() !== "ABSTAIN");
              return real.length === 1;
            }).length;

            const cW = (pageW - margin * 2 - 20) / 3;
            const cH = 62;

            const drawStatCard = (cx: number, label: string, value: string, sub: string) => {
              // card body
              pg.drawRectangle({ x: cx, y: y - cH, width: cW, height: cH, color: rgb(0.97, 0.98, 0.975), borderColor: rgb(0.87, 0.88, 0.87), borderWidth: 1 });
              // top gold accent bar
              pg.drawRectangle({ x: cx, y: y - 4, width: cW, height: 4, color: rgb(0.78, 0.62, 0.20) });
              // label
              pg.drawText(label.toUpperCase(), { x: cx + 14, y: y - 18, size: 8.2, font, color: rgb(0.35, 0.35, 0.35) });
              // big value
              pg.drawText(value, { x: cx + 14, y: y - 40, size: 22, font: fontBold, color: rgb(0.02, 0.28, 0.16) });
              // sub-label
              drawParagraph(pg, font, sub, cx + 14, y - cH + 15, cW - 28, 8, 10, rgb(0.50, 0.50, 0.50));
            };

            drawStatCard(margin,               "Total Positions",  String(totalPositions), "Positions contested in this election");
            drawStatCard(margin + cW + 10,     "Tied Positions",   String(tiePositions),   "Positions with two or more tied winners");
            drawStatCard(margin + (cW + 10)*2, "Uncontested",      String(uncontested),     "Positions with a single candidate");

            y -= cH + 22;
          }

          // -- Table columns ------------------------------------------------
          // # | Position | Winner | Slate | Votes | Share
          const tableX = margin;
          const tableW = pageW - margin * 2;
          const cNum = tableX + 10;
          const cPos = tableX + 34;
          const cWinner = tableX + 214;
          const cSlate = tableX + 352;
          const cVotesRight = tableX + tableW - 60;
          const cPctRight = tableX + tableW - 10;
          const rowH = 30;

          // -- Table header strip --
          pg.drawRectangle({
            x: tableX, y: y - 26, width: tableW, height: 26,
            color: rgb(0.02, 0.28, 0.16),
          });
          pg.drawRectangle({
            x: tableX, y: y - 27, width: tableW, height: 1,
            color: rgb(0.78, 0.62, 0.20),
          });

          const hdrY = y - 17;
          pg.drawText("#",        { x: cNum,    y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });
          pg.drawText("Position", { x: cPos,    y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });
          pg.drawText("Winner",   { x: cWinner, y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });
          pg.drawText("Slate",    { x: cSlate,  y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });
          const votesHdrW = fontBold.widthOfTextAtSize("Votes", 8.5);
          const pctHdrW = fontBold.widthOfTextAtSize("Share", 8.5);
          pg.drawText("Votes", { x: cVotesRight - votesHdrW, y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });
          pg.drawText("Share", { x: cPctRight - pctHdrW, y: hdrY, size: 8.5, font: fontBold, color: rgb(1,1,1) });

          y -= 32;

          // -- Data rows --
          const globalStart = pageIdx * ROWS_PER_PAGE;

          for (let i = 0; i < pageSlice.length; i++) {
            const w = pageSlice[i];
            const rowNum = globalStart + i + 1;
            const isEven = i % 2 === 1;
            const accentColor = w.isTie ? rgb(0.78, 0.62, 0.20) : rgb(0.02, 0.28, 0.16);

            pg.drawRectangle({
              x: tableX, y: y - rowH, width: tableW, height: rowH,
              color: isEven ? rgb(0.958, 0.970, 0.963) : rgb(1, 1, 1),
              borderColor: rgb(0.90, 0.91, 0.91),
              borderWidth: 0.3,
            });

            pg.drawRectangle({
              x: tableX, y: y - rowH, width: 4, height: rowH,
              color: accentColor,
            });

            const textY = y - rowH / 2 - 4;
            const numStr = String(rowNum);
            pg.drawText(numStr, { x: cNum, y: textY, size: 9, font: fontBold, color: rgb(0.18, 0.18, 0.18) });

            const posStr = w.position.length > 30 ? w.position.slice(0, 28) + "..." : w.position;
            pg.drawText(posStr, { x: cPos, y: textY, size: 9, font, color: rgb(0.18, 0.18, 0.18) });

            const nameColor = w.isTie ? rgb(0.55, 0.36, 0.0) : rgb(0.02, 0.28, 0.16);
            const nameStr = w.name.length > 19 ? w.name.slice(0, 17) + "..." : w.name;
            pg.drawText(nameStr, { x: cWinner, y: textY, size: 9.5, font: fontBold, color: nameColor });

            if (w.isTie) {
              const pillLabel = "TIE";
              const pillFontSize = 6.8;
              const pillPadX = 4;
              const pillTextW = fontBold.widthOfTextAtSize(pillLabel, pillFontSize);
              const pillW = pillTextW + pillPadX * 2;
              const pillH = 12;
              const pillX = Math.min(cSlate - pillW - 8, cWinner + fontBold.widthOfTextAtSize(nameStr, 9.5) + 6);
              const pillY = textY + 2;
              pg.drawRectangle({ x: pillX, y: pillY - pillH + 2, width: pillW, height: pillH, color: rgb(1.0, 0.93, 0.72), borderColor: rgb(0.80, 0.60, 0.10), borderWidth: 0.8 });
              pg.drawText(pillLabel, { x: pillX + pillPadX, y: pillY - pillH + 6, size: pillFontSize, font: fontBold, color: rgb(0.55, 0.36, 0.0) });
            }

            const slateStr = (w.slate || "-").length > 14 ? (w.slate || "-").slice(0, 12) + "..." : (w.slate || "-");
            pg.drawText(slateStr, { x: cSlate, y: textY, size: 8.8, font, color: rgb(0.40, 0.40, 0.40) });

            const vStr = String(w.votes);
            const vW = fontBold.widthOfTextAtSize(vStr, 9.5);
            pg.drawText(vStr, { x: cVotesRight - vW, y: textY, size: 9.5, font: fontBold, color: rgb(0.12, 0.12, 0.12) });

            const pStr = w.total > 0 ? `${((w.votes / w.total) * 100).toFixed(1)}%` : "-";
            const pW = font.widthOfTextAtSize(pStr, 8.8);
            pg.drawText(pStr, { x: cPctRight - pW, y: textY, size: 8.8, font, color: rgb(0.38, 0.38, 0.38) });

            pg.drawLine({
              start: { x: tableX + 4, y: y - rowH },
              end: { x: tableX + tableW, y: y - rowH },
              thickness: 0.4,
              color: rgb(0.88, 0.88, 0.90),
            });

            y -= rowH;
          }

          // -- Footer note --
          drawParagraph(
            pg, font,
            "Winner determination: highest vote count per position, excluding abstentions. " +
            "Percentage = winner votes ÷ total non-abstain ballots for that position.",
            margin, 76, pageW - margin * 2, 8.6, 12, rgb(0.48, 0.48, 0.48),
          );
        }
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
          "This section provides formal on-chain references used to audit election anchoring and verification integrity. It intentionally excludes voter identity and any linkage between a voter and selected candidates.",
          margin,
          y,
          pageW - margin * 2,
        );
        y -= 72;

        // Quick visual summary boxes (audit-friendly)
        const boxTop = y + 26;
        const gap = 12;
        const boxW = (pageW - margin * 2 - gap * 2) / 3;

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "Network",
          value: network || "-",
          footnote: "Blockchain environment",
        });

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin + boxW + gap,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "Explorer Base",
          value: explorer_base ? "Available" : "-",
          footnote: explorer_base || "No explorer configured",
        });

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin + (boxW + gap) * 2,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "Anchor Tx",
          value: onchain_anchor_tx ? "Anchor Recorded" : "Not Anchored",
          footnote: onchain_anchor_tx ? "Tx hash on record" : "Not yet anchored",
        });

        y -= 74;

        const kv = (label: string, value: string) => {
          const v = value || "-";
          const isHex = /^0x[0-9a-fA-F]+$/.test(v) && v.length >= 42;
          const isUrl = /^https?:\/\//.test(v);
          const valueFont = (isHex || isUrl) ? fontMono : font;

          page.drawText(label, {
            x: margin,
            y,
            size: 9.6,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2),
          });

          const valueX = margin + 190;
          const maxW = pageW - margin - valueX;
          const nextY = drawParagraph(page, valueFont, v, valueX, y, maxW, 9.2, 12.2, rgb(0.2, 0.2, 0.2));
          y = nextY - 6;
        };


        // ---- BV anchors (computed from Supabase where possible) ----
        // election_id_hash_bytes32 should be keccak256(utf8(election_id))
        const computedElectionIdHash = hashUtf8ToBytes32(singleElectionId);

        // election_vote_root_bytes32 (root-of-roots of chunk roots)
        let computedElectionVoteRoot = "";
        try {
          const { data: chunkRows, error: chErr }: { data: ElectionVoteChunkRow[] | null; error: unknown } = await supabase
            .from("election_vote_chunks")
            .select("chunk_index, chunk_root")
            .eq("election_id", singleElectionId)
            .order("chunk_index", { ascending: true });

          if (!chErr && Array.isArray(chunkRows) && chunkRows.length) {
            const chunkRoots = chunkRows
              .map((r) => String(r?.chunk_root ?? ""))
              .filter(Boolean);
            computedElectionVoteRoot = merkleRootSortedPairs(chunkRoots);
          }
        } catch {
          // ignore (optional section)
        }

        // manifest_hash_bytes32 from latest election_manifests row
        let computedManifestHash = "";
        try {
          const { data: mRow, error: mErr }: { data: ElectionManifestRow | null; error: unknown } = await supabase
            .from("election_manifests")
            .select("manifest_hash, spec_version, created_at")
            .eq("election_id", singleElectionId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!mErr && mRow?.manifest_hash) computedManifestHash = String(mRow.manifest_hash);
        } catch {
          // ignore
        }

        // Prefer user-provided anchors (if supplied) but show computed values too (skeptical/audit mode)
        const electionIdHashShown = election_id_hash_bytes32 || computedElectionIdHash;
        const electionVoteRootShown = election_vote_root_bytes32 || computedElectionVoteRoot;
        const manifestHashShown = manifest_hash_bytes32 || computedManifestHash;

        const mismatchNote = (label: string, provided: string, computed: string) => {
          if (!provided || !computed) return;
          if (provided.toLowerCase() !== computed.toLowerCase()) {
            kv(`${label} (Mismatch):`, "On-Chain Anchor Recorded value does not match computed value");
          }
        };

        kv("Network:", network);
        kv("Explorer Base URL:", explorer_base);
        if (tally_registry_address) kv("Tally Registry:", tally_registry_address);
        if (zk_verifier_contract) kv("Verifier Contract:", zk_verifier_contract);

        kv("Election ID Hash (bytes32):", electionIdHashShown);
        mismatchNote("Election ID Hash", election_id_hash_bytes32 || "", computedElectionIdHash);

        if (electionVoteRootShown) {
          kv("Election Vote Root (bytes32):", electionVoteRootShown);
          mismatchNote("Election Vote Root", election_vote_root_bytes32 || "", computedElectionVoteRoot);
        } else {
          kv("Election Vote Root (bytes32):", "- (run anchor-election-root first)");
        }

        if (manifestHashShown) {
          kv("Manifest Hash (bytes32):", manifestHashShown);
          mismatchNote("Manifest Hash", manifest_hash_bytes32 || "", computedManifestHash);
        } else {
          kv("Manifest Hash (bytes32):", "- (run generate-election-manifest first)");
        }

        if (results_hash_bytes32) kv("Results Hash (bytes32):", results_hash_bytes32);
        if (results_uri) kv("Results URI:", results_uri);

        if (tally_submit_tx) kv("submitTally Tx:", tally_submit_tx);
        if (tally_submitter) kv("Submitted By:", tally_submitter);
        if (tally_submitted_at) kv("Submitted At:", fmtShortDate(tally_submitted_at));

        if (tally_commitment) kv("Tally Commitment:", tally_commitment);
        if (zk_proof_hash) kv("ZK Proof Hash/ID:", zk_proof_hash);
        if (public_inputs_hash) kv("Public Inputs Hash:", public_inputs_hash);
        if (zk_verification_tx) kv("Proof Verification Tx:", zk_verification_tx);
        if (onchain_anchor_tx) kv("Report Anchor Tx:", onchain_anchor_tx);
        if (onchain_anchor_note) kv("Anchor Note:", onchain_anchor_note);


// Deterministic digest of the data used to build this PDF (helps external audit/anchoring).
// Note: includes totals and per-position tallies, but no voter identifiers.
const digestPayload = JSON.stringify({
  election_id: singleElectionId,
  election_title: electionTitle,
  election_window: { start: election?.start_date ?? null, end: election?.end_date ?? null },
  generated_at: new Date().toISOString(),
  totals: {
    eligible_voters: eligibleVoters,
    voters_who_voted: votersWhoVoted,
    vote_rows_recorded: totalVoteRows,
  },
  tallies: tallyRows.map((r) => ({
    position: r.position,
    candidate_id: r.candidate_id,
    candidate_name: r.candidate_name,
    slate: r.slate,
    vote_count: r.vote_count,
    abstain_count: r.abstain_count ?? 0,
    total_ballots_for_position: r.total_ballots_for_position ?? null,
  })),
});

const reportDigest = await sha256Hex(digestPayload);
kv("Report Digest (SHA-256):", reportDigest);

y -= 10;
drawSectionTitle(page, fontBold, "Verification Notes", margin, y);
        y -= 18;

        
        const bullets = [
          "Election Vote Root is computed from immutable vote leaves via chunked Merkle roots (root-of-roots).",
          "Election ID Hash binds the on-chain record to the election UUID (keccak256 of the UUID string).",
          "Manifest Hash binds the ordered candidate manifest used to generate the ZK circuit.",
          "Results Hash binds the published results.json content to the ZK public inputs (Poseidon-fold).",
          "If submitTally was performed, the ElectionTallyRegistry record (and its tx) proves the verifier accepted the proof for these anchors.",
        ];

        for (const b of bullets) {
          y = drawParagraph(
            page,
            font,
            `- ${b}`,
            margin,
            y,
            pageW - margin * 2,
            9.5,
            12,
            rgb(0.2, 0.2, 0.2),
          );
          y -= 2;
        }

        y -= 12;
        drawSectionTitle(
          page,
          fontBold,
          "Included Transaction Hashes",
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
              ? `${h.slice(0, 12)}...${h.slice(-10)}`
              : h;
            page.drawText(`- ${short}`, {
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

      // -------------------------
      // ZERO-KNOWLEDGE PROOF (ZKP) VERIFICATION
      // -------------------------
      {
        const page = pdf.addPage([pageW, pageH]);
        const yStart = await drawHeader({
          pdf,
          page,
          fontBold,
          font,
          title: "Zero-Knowledge Proof (ZKP) Verification",
          subtitle: electionTitle,
          logoBytes,
        });

        let y = yStart - 6;

        drawParagraph(
          page,
          font,
          "This section summarizes the zero-knowledge proof (ZKP) artifacts that attest the published tally is cryptographically consistent with recorded vote commitments, without disclosing voter identity or ballot selections.",
          margin,
          y,
          pageW - margin * 2,
        );
        y -= 68;

        // ---- Recompute BV anchors (for audit display; no voter data) ----
        const computedElectionIdHash = hashUtf8ToBytes32(singleElectionId);

        let computedElectionVoteRoot = "";
        try {
          const { data: chunkRows, error: chErr }: {
            data: ElectionVoteChunkRow[] | null;
            error: unknown;
          } = await supabase
            .from("election_vote_chunks")
            .select("chunk_index, chunk_root")
            .eq("election_id", singleElectionId)
            .order("chunk_index", { ascending: true });

          if (!chErr && Array.isArray(chunkRows) && chunkRows.length) {
            const chunkRoots = chunkRows
              .map((r) => String(r?.chunk_root ?? ""))
              .filter(Boolean);
            computedElectionVoteRoot = merkleRootSortedPairs(chunkRoots);
          }
        } catch {
          // ignore
        }

        let computedManifestHash = "";
        try {
          const { data: mRow, error: mErr }: {
            data: ElectionManifestRow | null;
            error: unknown;
          } = await supabase
            .from("election_manifests")
            .select("manifest_hash, spec_version, created_at")
            .eq("election_id", singleElectionId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!mErr && mRow?.manifest_hash) computedManifestHash = String(mRow.manifest_hash);
        } catch {
          // ignore
        }

        const electionIdHashShown = election_id_hash_bytes32 || computedElectionIdHash;
        const electionVoteRootShown = election_vote_root_bytes32 || computedElectionVoteRoot;
        const manifestHashShown = manifest_hash_bytes32 || computedManifestHash;

        const zkpReady = Boolean(
          manifestHashShown &&
            electionIdHashShown &&
            (electionVoteRootShown || computedElectionVoteRoot) &&
            (results_hash_bytes32 || tally_commitment || zk_proof_hash || zk_verification_tx || tally_submit_tx),
        );

        // Top summary boxes
        const boxTop = y + 18;
        const gap = 12;
        const boxW = (pageW - margin * 2 - gap * 2) / 3;

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "ZKP Artifacts",
          value: zkpReady ? "Available" : "Partial",
          footnote: "Based on provided fields",
        });

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin + boxW + gap,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "Verifier",
          value: zk_verifier_contract ? "Available" : "-",
          footnote: zk_verifier_contract ? "Contract / verifier ref" : "No verifier set",
        });

        drawInfoBoxCompact({
          page,
          fontBold,
          font,
          x: margin + (boxW + gap) * 2,
          y: boxTop,
          w: boxW,
          h: 64,
          title: "On-chain Proof Tx",
          value: zk_verification_tx ? "Anchor Recorded" : "Not Anchored",
          footnote: zk_verification_tx ? "Tx hash on record" : "Not yet anchored",
        });

        y -= 74;

        drawSectionTitle(page, fontBold, "Public Inputs / Anchors", margin, y);
        y -= 18;

        const kv2 = (label: string, value: string) => {
          const v = value || "-";
          const isHex = /^0x[0-9a-fA-F]+$/.test(v) && v.length >= 42;
          const isUrl = /^https?:\/\//.test(v);
          const valueFont = (isHex || isUrl) ? fontMono : font;

          page.drawText(label, {
            x: margin,
            y,
            size: 9.6,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2),
          });

          const valueX = margin + 210;
          const maxW = pageW - margin - valueX;
          const nextY = drawParagraph(page, valueFont, v, valueX, y, maxW, 9.2, 12.2, rgb(0.2, 0.2, 0.2));
          y = nextY - 6;
        };

        kv2("Election ID Hash (bytes32):", electionIdHashShown);
        kv2(
          "Election Vote Root (bytes32):",
          electionVoteRootShown || "- (run anchor-election-root first)",
        );
        kv2(
          "Manifest Hash (bytes32):",
          manifestHashShown || "- (run generate-election-manifest first)",
        );
        if (tally_commitment) kv2("Tally Commitment:", tally_commitment);
        if (results_hash_bytes32) kv2("Results Hash (bytes32):", results_hash_bytes32);
        if (results_uri) kv2("Results URI:", results_uri);
        if (public_inputs_hash) kv2("Public Inputs Hash:", public_inputs_hash);

        y -= 8;

        const hasArtifacts = Boolean(
          zk_proof_hash ||
            zk_verifier_contract ||
            zk_verification_tx ||
            tally_registry_address ||
            tally_submit_tx ||
            tally_submitter ||
            tally_submitted_at,
        );

        if (hasArtifacts) {
          drawSectionTitle(page, fontBold, "Verification Artifacts", margin, y);
          y -= 18;

          if (zk_proof_hash) kv2("ZK Proof Hash/ID:", zk_proof_hash);
          if (zk_verifier_contract) kv2("Verifier Contract:", zk_verifier_contract);
          if (zk_verification_tx) kv2("Proof Verification Tx:", zk_verification_tx);
          if (tally_registry_address) kv2("Tally Registry:", tally_registry_address);
          if (tally_submit_tx) kv2("submitTally Tx:", tally_submit_tx);
          if (tally_submitter) kv2("Submitted By:", tally_submitter);
          if (tally_submitted_at) kv2("Submitted At:", fmtShortDate(tally_submitted_at));
        } else {
          drawSectionTitle(page, fontBold, "Verification Artifacts", margin, y);
          y -= 18;
          y = drawParagraph(
            page,
            font,
            "No proof artifacts were provided to the PDF generator for this election (e.g., proof hash, verifier reference, or verification transaction).",
            margin,
            y,
            pageW - margin * 2,
            9.5,
            12,
            rgb(0.35, 0.35, 0.35),
          );
          y -= 6;
        }

        y -= 6;
        drawSectionTitle(page, fontBold, "How to Verify", margin, y);
        y -= 18;

        const steps = [
          "Confirm the Election ID Hash matches keccak256(election UUID).",
          "Confirm the Election Vote Root matches the root-of-roots derived from vote chunk roots.",
          "Confirm the Manifest Hash matches the manifest used to build the ZK circuit inputs.",
          "If provided, open the Proof Verification Tx in the explorer and confirm the verifier accepted the proof.",
          "If submitTally was performed, confirm the registry record references the same anchors / results hash.",
        ];

        for (const s of steps) {
          y = drawParagraph(
            page,
            font,
            `- ${s}`,
            margin,
            y,
            pageW - margin * 2,
            9.5,
            12,
            rgb(0.2, 0.2, 0.2),
          );
          y -= 2;
          if (y < 90) break;
        }
      }


      // SIGNATURE / CERTIFICATION
      // -------------------------
      {
        const list: Signatory[] = signatories.length > 0
          ? signatories
          : [
            // Group Members
            { label: "Prepared by", name: "Caubat, Isaac A.", role: "Group Member" },
            { label: "Prepared by", name: "Creencia, Jego Angelo M.", role: "Group Member" },
            { label: "Prepared by", name: "Cervantes, Lance Owen Miguel", role: "Group Member" },
            { label: "Prepared by", name: "Gomez, Jonas T.", role: "Group Member" },
            { label: "Prepared by", name: "Leopando, Deric Lei A.", role: "Group Member" },
            // Officials
            { label: "Noted by", name: "Engr. Honeylet D. Grimaldo", role: "Thesis Adviser" },
            { label: "Noted by", name: "Juan Dela Cruz", role: "COMELEC Chairman" },
            { label: "Noted by", name: "Maria Clara", role: "SADU Director" },
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

          const y = topY - 24;
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
            "-";

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

          y -= 110;
          i += 2;
        }
      }

      // Add page numbers
      const pages = pdf.getPages();
      for (let i = 0; i < pages.length; i++) {
        drawPageNumber(pages[i], font, i + 1, pages.length);
      }

      // -----------------------------------------------------------------------
      // DOCUMENT INTEGRITY PAGE
      // -----------------------------------------------------------------------
      // The hash CANNOT be printed inside the PDF it is hashing (chicken-and-egg:
      // adding the hash to the page changes the bytes, invalidating the hash).
      //
      // Correct flow:
      //   1. Draw the integrity page with the QR / verify URL but NO hash value
      //   2. Save the complete final PDF -> compute SHA-256 of those exact bytes
      //   3. Store hash in DB so the verify page can compare against it
      //   4. Return the same bytes to the user
      //
      // The verify URL/QR tells users where to go; the website does the comparison.
      // -----------------------------------------------------------------------

      // Step 1 - build the public verify URL and QR code
      const verifyUrl = app_url
        ? `${app_url}/results/${singleElectionId}`
        : "";

      // Fetch QR PNG (best-effort; skipped if no verifyUrl or network error)
      let qrBytes: Uint8Array | null = null;
      if (verifyUrl) {
        qrBytes = await fetchQrPng(verifyUrl);
      }

      const generatedAt = new Date().toISOString();

      // Step 2 - draw the integrity attestation page (no hash printed here)
      {
        const intPage = pdf.addPage([pageW, pageH]);

        // Full-page white background
        intPage.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(1, 1, 1) });

        // Top band (FEU green)
        intPage.drawRectangle({ x: 0, y: pageH - 90, width: pageW, height: 90, color: rgb(0.02, 0.28, 0.16) });
        // Gold trim
        intPage.drawRectangle({ x: 0, y: pageH - 96, width: pageW, height: 6, color: rgb(0.78, 0.62, 0.20) });

        intPage.drawText("Document Integrity Attestation", {
          x: margin, y: pageH - 46,
          size: 18, font: fontBold, color: rgb(1, 1, 1),
        });
        intPage.drawText(electionTitle, {
          x: margin, y: pageH - 68,
          size: 11, font, color: rgb(0.85, 0.92, 0.87),
        });

        let iy = pageH - 118;

        // -- What is this page? --
        iy = drawParagraph(
          intPage, font,
          "This page allows anyone to verify that this PDF has not been altered since it was " +
          "officially generated by BotoVeritas. Scan the QR code or visit the URL below, then " +
          "drop this PDF file onto the verification page. The site will compute the file's " +
          "SHA-256 fingerprint in your browser and compare it against the official record.",
          margin, iy, pageW - margin * 2, 10.5, 15,
        );
        iy -= 20;

        // -- How to verify box --
        const howBoxH = 130;
        intPage.drawRectangle({
          x: margin, y: iy - howBoxH,
          width: pageW - margin * 2, height: howBoxH,
          color: rgb(0.97, 0.98, 0.97),
          borderColor: rgb(0.78, 0.62, 0.20),
          borderWidth: 1.5,
        });
        intPage.drawRectangle({
          x: margin, y: iy - howBoxH,
          width: 6, height: howBoxH,
          color: rgb(0.78, 0.62, 0.20),
        });

        intPage.drawText("HOW TO VERIFY THIS DOCUMENT", {
          x: margin + 16, y: iy - 20,
          size: 9, font: fontBold, color: rgb(0.25, 0.25, 0.25),
        });

        const steps = [
          "1. Scan the QR code or visit the verification URL on this page.",
          "2. On the verification page, drop this PDF file into the upload area.",
          "3. The site checks the file fingerprint against the official record.",
          "   Match  -> document is authentic and unmodified.",
          "   No match -> the file has been altered since it was generated.",
        ];

        let stepY = iy - 38;
        for (const step of steps) {
          stepY = drawParagraph(intPage, step.startsWith(" ") ? fontMono : font, step, margin + 16, stepY, pageW - margin * 2 - 32, 9.5, 13);
          stepY -= 1;
        }

        iy -= howBoxH + 22;

        // -- QR code + verify URL --
        if (verifyUrl) {
          intPage.drawText("OFFICIAL RESULTS - ONLINE VERIFICATION", {
            x: margin, y: iy,
            size: 10, font: fontBold, color: rgb(0.02, 0.28, 0.16),
          });
          intPage.drawLine({
            start: { x: margin, y: iy - 6 },
            end: { x: margin + 310, y: iy - 6 },
            thickness: 1.5, color: rgb(0.78, 0.62, 0.20),
          });
          iy -= 22;

          iy = drawParagraph(
            intPage, font,
            "Scan the QR code or visit the URL below to view live official results and verify this PDF. " +
            "If vote counts here differ from what is on that page, trust the website - it reflects the immutable database record.",
            margin, iy, pageW - margin * 2, 10, 14,
          );
          iy -= 16;

          // QR code (left column)
          const qrSize = 120;
          const qrX = margin;
          const qrY = iy - qrSize;

          if (qrBytes) {
            try {
              const qrImg = await pdf.embedPng(qrBytes);
              intPage.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });
            } catch {
              intPage.drawRectangle({ x: qrX, y: qrY, width: qrSize, height: qrSize, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
              intPage.drawText("QR unavailable", { x: qrX + 10, y: qrY + qrSize / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
            }
          } else {
            intPage.drawRectangle({ x: qrX, y: qrY, width: qrSize, height: qrSize, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
            intPage.drawText("QR unavailable", { x: qrX + 10, y: qrY + qrSize / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
          }

          // URL + election ID (right column)
          const urlX = qrX + qrSize + 18;
          const urlMaxW = pageW - margin - urlX;
          let urlY = iy - 14;

          intPage.drawText("Verify at:", { x: urlX, y: urlY, size: 9, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
          urlY -= 16;
          // Draw URL in fixed-width chunks so no PDF reader truncates the clickable
          // region at a soft line-wrap boundary (the root cause of the short-URL bug).
          {
            const urlFontSize = 9;
            const urlLineH = 13;
            const charsPerLine = Math.floor(urlMaxW / (urlFontSize * 0.52));
            for (let ci = 0; ci < verifyUrl.length; ci += charsPerLine) {
              intPage.drawText(verifyUrl.slice(ci, ci + charsPerLine), {
                x: urlX, y: urlY, size: urlFontSize, font: fontMono, color: rgb(0.02, 0.18, 0.40),
              });
              urlY -= urlLineH;
            }
            urlY -= 4;
          }

          intPage.drawText("Election ID:", { x: urlX, y: urlY, size: 9, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
          urlY -= 14;
          drawParagraph(intPage, fontMono, singleElectionId, urlX, urlY, urlMaxW, 8.5, 12, rgb(0.35, 0.35, 0.35));
          urlY -= 14;

          intPage.drawText("Generated:", { x: urlX, y: urlY, size: 9, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
          urlY -= 14;
          drawParagraph(intPage, fontMono, generatedAt, urlX, urlY, urlMaxW, 8.5, 12, rgb(0.35, 0.35, 0.35));

          iy = qrY - 16;
        }

        // -- Footer note --
        const noteY = Math.min(iy - 10, 90);
        drawParagraph(
          intPage, font,
          "This attestation page was generated automatically by BotoVeritas. " +
          "Always cross-check against the online results page if you have any doubt about this document.",
          margin, noteY, pageW - margin * 2, 8.5, 12, rgb(0.5, 0.5, 0.5),
        );

        intPage.drawText("BotoVeritas . Document Integrity Attestation", {
          x: margin, y: 28, size: 8, font, color: rgb(0.6, 0.6, 0.6),
        });
        intPage.drawText(`Generated: ${generatedAt}`, {
          x: pageW - margin - 200, y: 28, size: 8, font: fontMono, color: rgb(0.6, 0.6, 0.6),
        });
      }

      // Step 3 - save the COMPLETE final PDF (integrity page included)
      // then hash THESE bytes - this is exactly what the user downloads
      const pdfBytes = await pdf.save();
      const pdfSha256 = await sha256BytesHex(pdfBytes);

      // Step 4 - persist the hash so the verify page can compare against it
      try {
        await supabase
          .from("election_result_pdf_hashes")
          .upsert(
            {
              election_id: singleElectionId,
              pdf_sha256: pdfSha256,
              generated_at: generatedAt,
              mode,
            },
            { onConflict: "election_id,mode" },
          );
      } catch {
        // Non-fatal: table may not exist yet. Run migration_pdf_hashes.sql first.
      }

      return { pdfBytes, electionTitle, pdfSha256 };
    };

    const { pdfBytes, electionTitle, pdfSha256 } = await buildSingleElectionPdf(election_id);
    const filename = `${safeFilename(electionTitle)}_Results_Report.pdf`;

    return new Response(u8ToArrayBuffer(pdfBytes), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Expose the hash so the admin UI can display / store it without re-downloading the file
        "X-PDF-SHA256": pdfSha256,
        "Access-Control-Expose-Headers": "X-PDF-SHA256",
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