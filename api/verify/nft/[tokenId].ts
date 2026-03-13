import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore
import { ethers } from "ethers";

/**
 * Voter-facing receipt verifier (serverless HTML page)
 *
 * Routes (Vercel rewrite):
 *   /verify/nft/:tokenId  -> /api/verify/nft/[tokenId].ts?tokenId=:tokenId
 *
 * What this page proves (plain language):
 * - Your receipt token exists on-chain (cannot be forged after the fact).
 * - Your receipt details were issued by BotoVeritas.
 * - If voteId is present in metadata, we also verify cryptographically that your vote record
 *   is included in the finalized election audit data (Merkle inclusion against the anchored root).
 *
 * Privacy:
 * - Never shows ballot choices.
 * - voteId is hidden on this page (auditors can view it on the auditor page).
 *
 * Required env (serverless):
 *  - AMOY_RPC_URL
 *  - PARTICIPATION_NFT_ADDRESS
 * Optional (for audit proof badge):
 *  - SUPABASE_URL
 *  - SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
 */

const BASE_SITE = "https://botoveritas.info";

function envAny(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extractTokenId(req: VercelRequest): string | null {
  const q = req.query?.tokenId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const url = req.url || "";
  const parts = url.split("?")[0].split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last || null;
}

function originFromReq(req: VercelRequest) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0].trim();
  if (!host) return BASE_SITE;
  return `${proto}://${host}`;
}

function parseTokenId(raw: string | string[] | undefined) {
  const s = (Array.isArray(raw) ? raw[0] : raw ?? "").toString().trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  try {
    const bi = BigInt(s);
    if (bi <= 0n) return null;
    return bi;
  } catch {
    return null;
  }
}

const NFT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
];

type Meta = {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  electionId?: string;
  voteId?: string;
  voteIds?: string[];
  txHash?: string;
  specVersion?: string;
  verification?: { receiptUrl?: string; auditorVoteUrl?: string };
};

async function fetchTextWithTimeout(url: string, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ac.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonSafe(url: string) {
  const r = await fetchTextWithTimeout(url, 8000);
  let json: unknown = null;
  try { json = JSON.parse(r.text); } catch { json = null; }
  return { ok: r.ok, status: r.status, json, text: r.text };
}

type StepState = "loading" | "ok" | "bad" | "warn";

/* ──────────────────────────────────────────────
   SVG ICONS
────────────────────────────────────────────── */
function iconShield(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="1.6"/><path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function iconCheck(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function iconX(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function iconLoader(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function iconExternal(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3h7v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 14L21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconInfo(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 16v-5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function iconLock(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}
function iconHash(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

/* ──────────────────────────────────────────────
   STATUS COMPONENTS
────────────────────────────────────────────── */
function heroStatusBadge(kind: StepState, label: string) {
  const map = {
    ok:      { cls: "hbadge hbadge-ok",   icon: iconCheck() },
    bad:     { cls: "hbadge hbadge-bad",  icon: iconX() },
    warn:    { cls: "hbadge hbadge-warn", icon: iconInfo() },
    loading: { cls: "hbadge hbadge-warn", icon: iconLoader("ic ic-spin") },
  };
  const { cls, icon } = map[kind];
  return `<span class="${cls}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

function verificationStep(kind: StepState, num: string, title: string, subtitle: string) {
  const stateMap = {
    ok:      { bar: "step-bar-ok",   dot: "step-dot-ok",   tag: `<span class="step-tag step-tag-ok">${iconCheck("stag-ic")}<span>Verified</span></span>` },
    bad:     { bar: "step-bar-bad",  dot: "step-dot-bad",  tag: `<span class="step-tag step-tag-bad">${iconX("stag-ic")}<span>Failed</span></span>` },
    warn:    { bar: "step-bar-warn", dot: "step-dot-warn", tag: `<span class="step-tag step-tag-warn">${iconInfo("stag-ic")}<span>Unavailable</span></span>` },
    loading: { bar: "step-bar-warn", dot: "step-dot-warn", tag: `<span class="step-tag step-tag-warn">${iconLoader("stag-ic ic-spin")}<span>Checking</span></span>` },
  };
  const { bar, dot, tag } = stateMap[kind];
  return `<div class="step">
    <div class="step-left">
      <div class="step-num-wrap">
        <div class="step-bar ${bar}"></div>
        <div class="step-dot ${dot}"><span>${escapeHtml(num)}</span></div>
      </div>
    </div>
    <div class="step-body">
      <div class="step-head">
        <div class="step-title">${escapeHtml(title)}</div>
        ${tag}
      </div>
      <div class="step-sub">${escapeHtml(subtitle)}</div>
    </div>
  </div>`;
}

function detailRow(icon: string, label: string, value: string, mono = false) {
  return `<div class="drow">
    <div class="drow-icon">${icon}</div>
    <div class="drow-content">
      <div class="drow-label">${escapeHtml(label)}</div>
      <div class="drow-value${mono ? " drow-mono" : ""}">${escapeHtml(value)}</div>
    </div>
  </div>`;
}

/* ──────────────────────────────────────────────
   HTML PAGE
────────────────────────────────────────────── */
function htmlPage(p: {
  tokenId: string;
  origin: string;
  nftOk: boolean;
  owner?: string | null;
  tokenUri?: string | null;
  meta?: Meta | null;
  inclusion?: { ok: boolean; verified?: boolean; msg?: string } | null;
  errors?: string[];
}) {
  const errs = (p.errors || []).filter(Boolean);
  const hasVoteId = Boolean(p.meta?.voteId);

  const metaName = p.meta?.name || `BotoVeritas Receipt #${p.tokenId}`;
  const metaDesc =
    p.meta?.description ||
    "This receipt confirms your vote submission was recorded. Ballot choices are never stored in this receipt.";
  const imageUrl = p.meta?.image || `${BASE_SITE}/nft/receipt.png`;

  const electionId = p.meta?.electionId || "";
  const txHash = p.meta?.txHash || "";
  const spec = p.meta?.specVersion || "";
  const explorerBase = "https://amoy.polygonscan.com";
  const explorerTx = txHash ? `${explorerBase}/tx/${txHash}` : "";

  const headline = p.nftOk ? "Vote Receipt Verified" : "Receipt Not Found";
  const subhead = p.nftOk
    ? "Your participation has been cryptographically confirmed on the Polygon blockchain."
    : "This receipt token was not found on-chain. Please verify your Token ID and try again.";

  const stepReceipt: StepState = p.nftOk ? "ok" : "bad";
  const stepDetails: StepState = p.meta ? "ok" : "warn";
  const stepAudit: StepState = !hasVoteId
    ? "warn"
    : p.inclusion?.ok && p.inclusion.verified
    ? "ok"
    : p.inclusion?.ok
    ? "bad"
    : "warn";

  const overallOk = stepReceipt === "ok" && stepDetails === "ok";
  const heroKind: StepState = !overallOk ? "bad" : stepAudit === "ok" ? "ok" : "warn";

  const topBadges = [
    heroStatusBadge(stepReceipt, p.nftOk ? "Token On-Chain" : "Token Missing"),
    heroStatusBadge(stepAudit,
      !hasVoteId ? "Audit Unavailable"
      : stepAudit === "ok" ? "Audit Confirmed"
      : stepAudit === "bad" ? "Audit Failed"
      : "Audit Unavailable"
    ),
  ].join("");

  const shortAddr = (s: string) => s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(metaName)} · BotoVeritas</title>
  <meta name="robots" content="noindex,nofollow" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap" rel="stylesheet" />
  <style>
    /* ── TOKENS ── */
    :root {
      --green:       #0B6B3A;
      --green-mid:   #0E7D44;
      --green-light: #E8F5EE;
      --green-muted: rgba(11,107,58,.12);
      --green-line:  rgba(11,107,58,.22);
      --gold:        #C9A227;
      --gold-deep:   #A07B10;
      --gold-light:  #FDF7E3;
      --gold-muted:  rgba(201,162,39,.14);
      --gold-line:   rgba(201,162,39,.30);
      --red:         #C0392B;
      --red-light:   rgba(192,57,43,.10);
      --red-line:    rgba(192,57,43,.25);
      --ink:         #111820;
      --ink-80:      rgba(17,24,32,.80);
      --ink-60:      rgba(17,24,32,.60);
      --ink-40:      rgba(17,24,32,.40);
      --ink-10:      rgba(17,24,32,.08);
      --surface:     #FAFAF8;
      --card:        #FFFFFF;
      --border:      rgba(17,24,32,.09);
      --shadow-sm:   0 2px 8px rgba(17,24,32,.07);
      --shadow-md:   0 8px 32px rgba(17,24,32,.10);
      --shadow-lg:   0 20px 60px rgba(17,24,32,.12);
      --r-sm: 12px;
      --r-md: 18px;
      --r-lg: 24px;
      --r-xl: 32px;
    }

    /* ── RESET ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: var(--ink);
      background: var(--surface);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }

    /* ── LAYOUT ── */
    .page-shell {
      position: relative;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Textured background */
    .page-bg {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(ellipse 900px 500px at 0% 0%, rgba(11,107,58,.08) 0%, transparent 70%),
        radial-gradient(ellipse 700px 400px at 100% 100%, rgba(201,162,39,.07) 0%, transparent 70%),
        var(--surface);
    }
    /* Subtle dot grid */
    .page-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle, rgba(17,24,32,.06) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent);
      -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent);
    }

    .page-content {
      position: relative;
      z-index: 1;
      max-width: 820px;
      margin: 0 auto;
      padding: 0 20px 80px;
    }

    /* ── TOP WORDMARK BAR ── */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 0 0;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 40px;
      animation: slideDown .5s cubic-bezier(.22,1,.36,1) both;
    }
    .wordmark {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .wordmark-shield {
      width: 34px; height: 34px;
      background: linear-gradient(145deg, var(--green), var(--green-mid));
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      color: white;
      box-shadow: 0 4px 12px rgba(11,107,58,.30);
    }
    .wordmark-shield .ic { width: 18px; height: 18px; }
    .wordmark-text {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 17px;
      letter-spacing: -.01em;
      color: var(--ink);
    }
    .wordmark-text span { color: var(--green); }
    .topbar-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--ink-40);
    }

    /* ── HERO ── */
    .hero {
      margin-bottom: 32px;
      animation: fadeUp .55s cubic-bezier(.22,1,.36,1) .08s both;
    }
    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: var(--green);
      margin-bottom: 16px;
    }
    .hero-eyebrow-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--gold);
      flex-shrink: 0;
    }
    .hero-title {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: clamp(32px, 5vw, 52px);
      line-height: 1.08;
      letter-spacing: -.02em;
      color: var(--ink);
      margin-bottom: 14px;
    }
    .hero-title .accent { color: var(--green); }
    .hero-desc {
      font-size: 15px;
      color: var(--ink-60);
      line-height: 1.65;
      max-width: 560px;
      margin-bottom: 20px;
    }
    .hero-badges {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .hbadge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid;
      letter-spacing: .01em;
    }
    .hbadge .ic { width: 14px; height: 14px; }
    .hbadge-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .hbadge-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .hbadge-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }

    /* ── STATUS BANNER ── */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 20px;
      border-radius: var(--r-md);
      border: 1.5px solid;
      margin-bottom: 28px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .14s both;
    }
    .status-banner-ok   { background: var(--green-light); border-color: var(--green-line); }
    .status-banner-warn { background: var(--gold-light);  border-color: var(--gold-line); }
    .status-banner-bad  { background: var(--red-light);   border-color: var(--red-line); }
    .status-banner-icon {
      width: 40px; height: 40px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .status-banner-ok   .status-banner-icon { background: var(--green); color: white; }
    .status-banner-warn .status-banner-icon { background: var(--gold);  color: white; }
    .status-banner-bad  .status-banner-icon { background: var(--red);   color: white; }
    .status-banner-icon .ic { width: 20px; height: 20px; }
    .status-banner-text {}
    .status-banner-title {
      font-weight: 800;
      font-size: 14px;
      letter-spacing: -.01em;
    }
    .status-banner-ok   .status-banner-title { color: var(--green); }
    .status-banner-warn .status-banner-title { color: var(--gold-deep); }
    .status-banner-bad  .status-banner-title { color: var(--red); }
    .status-banner-sub { font-size: 13px; color: var(--ink-60); margin-top: 2px; }

    /* ── SECTION LABEL ── */
    .section-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
      color: var(--ink-40);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ── RECEIPT CARD ── */
    .receipt-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--r-xl);
      box-shadow: var(--shadow-md);
      overflow: hidden;
      margin-bottom: 16px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .18s both;
    }
    .receipt-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 22px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(to right, var(--green-muted), transparent);
    }
    .receipt-card-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .receipt-card-header-left .ic { width: 17px; height: 17px; color: var(--green); }
    .receipt-card-header-title {
      font-weight: 700;
      font-size: 14px;
      color: var(--ink-80);
    }
    .receipt-card-privacy {
      font-size: 11px;
      font-weight: 600;
      color: var(--ink-40);
      letter-spacing: .02em;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .receipt-card-privacy .ic { width: 13px; height: 13px; }
    .receipt-body {
      padding: 22px;
      display: flex;
      gap: 20px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .receipt-img {
      width: 96px; height: 96px;
      border-radius: var(--r-md);
      border: 1px solid var(--border);
      background: var(--ink-10);
      overflow: hidden;
      flex-shrink: 0;
    }
    .receipt-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .receipt-meta { flex: 1; min-width: 220px; }
    .receipt-name {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 19px;
      line-height: 1.25;
      letter-spacing: -.01em;
      color: var(--ink);
      margin-bottom: 8px;
    }
    .receipt-desc {
      font-size: 13px;
      color: var(--ink-60);
      line-height: 1.6;
      margin-bottom: 14px;
    }
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: var(--r-sm);
      font-size: 13px;
      font-weight: 700;
      border: 1.5px solid;
      cursor: pointer;
      transition: all .15s ease;
      text-decoration: none;
    }
    .btn .ic { width: 14px; height: 14px; }
    .btn-outline {
      background: transparent;
      border-color: var(--border);
      color: var(--ink-80);
    }
    .btn-outline:hover { background: var(--ink-10); }
    .btn-green {
      background: var(--green);
      border-color: var(--green);
      color: white;
      box-shadow: 0 4px 16px rgba(11,107,58,.25);
    }
    .btn-green:hover { filter: brightness(1.06); }
    .btn-gold-green {
      background: linear-gradient(110deg, var(--green) 0%, var(--gold-deep) 100%);
      border-color: transparent;
      color: white;
      box-shadow: 0 4px 20px rgba(11,107,58,.22);
    }
    .btn-gold-green:hover { filter: brightness(1.06); }

    /* ── VERIFICATION STEPS ── */
    .steps-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--r-xl);
      box-shadow: var(--shadow-md);
      padding: 22px;
      margin-bottom: 16px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .22s both;
    }
    .steps-list { display: flex; flex-direction: column; gap: 0; }
    .step {
      display: flex;
      gap: 0;
      position: relative;
    }
    .step-left {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 40px;
      flex-shrink: 0;
      margin-right: 16px;
    }
    .step-num-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    .step-dot {
      width: 32px; height: 32px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
      border: 2px solid;
      z-index: 1;
      position: relative;
    }
    .step-dot-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .step-dot-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }
    .step-dot-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .step-bar {
      width: 2px;
      flex: 1;
      min-height: 24px;
      margin: 4px 0;
      border-radius: 99px;
    }
    .step-bar-ok   { background: linear-gradient(to bottom, var(--green-line), transparent); }
    .step-bar-bad  { background: linear-gradient(to bottom, var(--red-line),   transparent); }
    .step-bar-warn { background: linear-gradient(to bottom, var(--gold-line),  transparent); }
    .step:last-child .step-bar { display: none; }
    .step-body { padding: 4px 0 24px; flex: 1; }
    .step:last-child .step-body { padding-bottom: 0; }
    .step-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .step-title { font-size: 14px; font-weight: 700; color: var(--ink); }
    .step-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid;
      letter-spacing: .02em;
      white-space: nowrap;
    }
    .stag-ic { width: 11px; height: 11px; }
    .step-tag-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .step-tag-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }
    .step-tag-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .step-sub { font-size: 12.5px; color: var(--ink-60); line-height: 1.55; }

    /* ── DETAILS CARD ── */
    .details-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--r-xl);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      margin-bottom: 16px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .26s both;
    }
    .details-summary {
      list-style: none;
      cursor: pointer;
      padding: 18px 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      user-select: none;
    }
    .details-summary::-webkit-details-marker { display: none; }
    .details-summary-left {}
    .details-summary-title { font-size: 14px; font-weight: 700; color: var(--ink); }
    .details-summary-sub { font-size: 12px; color: var(--ink-40); margin-top: 2px; }
    .details-toggle {
      padding: 6px 14px;
      border-radius: 999px;
      background: var(--ink-10);
      border: 1px solid var(--border);
      font-size: 11px;
      font-weight: 700;
      color: var(--ink-60);
      white-space: nowrap;
      letter-spacing: .04em;
    }
    .details-body { padding: 0 22px 22px; }
    .drow {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }
    .drow:last-child { border-bottom: none; }
    .drow-icon {
      width: 34px; height: 34px;
      border-radius: 9px;
      background: var(--green-muted);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      color: var(--green);
    }
    .drow-icon .ic { width: 16px; height: 16px; }
    .drow-content {}
    .drow-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--ink-40);
      margin-bottom: 3px;
    }
    .drow-value { font-size: 13.5px; font-weight: 500; color: var(--ink); line-height: 1.45; }
    .drow-mono {
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 12px;
      word-break: break-all;
    }

    /* ── EXPLAINER CARD ── */
    .explainer-card {
      background: linear-gradient(135deg, var(--green-light), rgba(201,162,39,.06));
      border: 1px solid var(--green-line);
      border-radius: var(--r-xl);
      overflow: hidden;
      margin-bottom: 16px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .30s both;
    }
    .explainer-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      padding: 20px 22px 22px;
    }
    @media (max-width: 560px) { .explainer-grid { grid-template-columns: 1fr; } }
    .explainer-item { padding: 0 16px 0 0; }
    .explainer-item:last-child { padding: 0 0 0 16px; border-left: 1px solid var(--green-line); }
    @media (max-width: 560px) {
      .explainer-item:last-child { padding: 16px 0 0; border-left: none; border-top: 1px solid var(--green-line); margin-top: 16px; }
    }
    .explainer-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
      color: var(--green);
      margin-bottom: 8px;
    }
    .explainer-text { font-size: 13px; color: var(--ink-80); line-height: 1.65; }

    /* ── ALERT ── */
    .alert-card {
      display: flex;
      gap: 14px;
      padding: 18px 20px;
      border-radius: var(--r-md);
      border: 1.5px solid var(--red-line);
      background: var(--red-light);
      margin-bottom: 16px;
      animation: fadeUp .5s ease .34s both;
    }
    .alert-icon { color: var(--red); flex-shrink: 0; margin-top: 1px; }
    .alert-icon .ic { width: 18px; height: 18px; }
    .alert-title { font-size: 13px; font-weight: 700; color: var(--red); margin-bottom: 4px; }
    .alert-desc { font-size: 13px; color: var(--ink-80); line-height: 1.55; }
    .alert-errors {
      margin-top: 12px;
      padding: 12px 14px;
      background: rgba(17,24,32,.04);
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 11.5px;
      color: var(--ink-60);
      line-height: 1.7;
      word-break: break-all;
    }

    /* ── KIOSK RETURN BAR ── */
    .kiosk-bar {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--r-xl);
      padding: 20px 22px;
      box-shadow: var(--shadow-md);
      margin-bottom: 16px;
      animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .38s both;
    }
    .kiosk-inner {
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    .kiosk-text { flex: 1; min-width: 180px; }
    .kiosk-title {
      font-weight: 800;
      font-size: 14px;
      color: var(--green);
      letter-spacing: -.01em;
      margin-bottom: 3px;
    }
    .kiosk-sub { font-size: 12px; color: var(--ink-60); }
    .kiosk-timer-wrap {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    .kiosk-timer {
      font-family: 'DM Serif Display', Georgia, serif;
      font-size: 42px;
      line-height: 1;
      color: var(--green);
      letter-spacing: -.03em;
    }
    .kiosk-timer-unit { font-size: 14px; font-weight: 700; color: var(--ink-40); }
    .kiosk-progress-wrap { width: 100%; margin-top: 16px; }
    .kiosk-progress-track {
      height: 6px;
      border-radius: 999px;
      background: var(--ink-10);
      overflow: hidden;
    }
    .kiosk-progress-fill {
      height: 100%;
      width: 100%;
      border-radius: 999px;
      background: linear-gradient(to right, var(--green), var(--gold));
      transition: width .9s linear;
    }

    /* ── ANIMATIONS ── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .ic-spin { animation: spin 1s linear infinite; }

    /* ── RESPONSIVE ── */
    @media (max-width: 520px) {
      .hero-title { font-size: 30px; }
      .kiosk-timer { font-size: 34px; }
      .receipt-body { gap: 14px; }
      .receipt-img { width: 76px; height: 76px; }
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="page-bg"></div>
    <div class="page-content">

      <!-- TOP BAR -->
      <div class="topbar">
        <div class="wordmark">
          <div class="wordmark-shield">${iconShield("ic")}</div>
          <div class="wordmark-text">Boto<span>Veritas</span></div>
        </div>
        <div class="topbar-label">Secure Verification</div>
      </div>

      <!-- HERO -->
      <div class="hero">
        <div class="hero-eyebrow">
          <div class="hero-eyebrow-dot"></div>
          <span>Blockchain Receipt</span>
        </div>
        <h1 class="hero-title">${p.nftOk ? `<span class="accent">Verified.</span> Your vote<br>is on record.` : escapeHtml(headline)}</h1>
        <p class="hero-desc">${escapeHtml(subhead)}</p>
        <div class="hero-badges">${topBadges}</div>
      </div>

      <!-- STATUS BANNER -->
      <div class="status-banner status-banner-${heroKind === "ok" ? "ok" : heroKind === "bad" ? "bad" : "warn"}">
        <div class="status-banner-icon">
          ${heroKind === "ok" ? iconCheck("ic") : heroKind === "bad" ? iconX("ic") : iconInfo("ic")}
        </div>
        <div class="status-banner-text">
          <div class="status-banner-title">${heroKind === "ok" ? "All checks passed" : heroKind === "bad" ? "Verification failed" : "Partial verification"}</div>
          <div class="status-banner-sub">Token ID #${escapeHtml(p.tokenId)} · Polygon Amoy Testnet</div>
        </div>
      </div>

      <!-- RECEIPT -->
      <div class="section-label">Your Receipt</div>
      <div class="receipt-card">
        <div class="receipt-card-header">
          <div class="receipt-card-header-left">
            ${iconShield("ic")}
            <span class="receipt-card-header-title">Participation Receipt</span>
          </div>
          <div class="receipt-card-privacy">${iconLock("ic")}<span>Ballot choices never stored</span></div>
        </div>
        <div class="receipt-body">
          <div class="receipt-img">
            <img src="${escapeHtml(imageUrl)}" alt="Receipt NFT image" loading="eager" />
          </div>
          <div class="receipt-meta">
            <div class="receipt-name">${escapeHtml(metaName)}</div>
            <div class="receipt-desc">${escapeHtml(metaDesc)}</div>
            <div class="btn-row">
              ${explorerTx
                ? `<a class="btn btn-outline" href="${escapeHtml(explorerTx)}" target="_blank" rel="noopener">${iconExternal("ic")}<span>PolygonScan</span></a>`
                : ""}
            </div>
          </div>
        </div>
      </div>

      <!-- STEPS -->
      <div class="section-label">Verification Steps</div>
      <div class="steps-card">
        <div class="steps-list">
          ${verificationStep(stepReceipt, "1", "Receipt token on-chain", "Confirmed on Polygon Amoy — cannot be altered or forged")}
          ${verificationStep(stepDetails, "2", "Metadata issued by BotoVeritas", p.meta ? "Receipt details loaded and authenticated" : "Metadata could not be retrieved")}
          ${verificationStep(stepAudit, "3", "Recorded in final audit dataset", hasVoteId ? "Cryptographically included in the election's official audit Merkle tree" : "Not available for this receipt — no audit code found")}
        </div>
      </div>

      <!-- EXPLAINER -->
      <details class="details-card explainer-card" style="border-radius:var(--r-xl)">
        <summary class="details-summary">
          <div class="details-summary-left">
            <div class="details-summary-title">What does "Recorded in final audit" mean?</div>
            <div class="details-summary-sub">Plain-language explanation — no blockchain background needed</div>
          </div>
          <span class="details-toggle">Expand</span>
        </summary>
        <div class="explainer-grid">
          <div class="explainer-item">
            <div class="explainer-label">In plain language</div>
            <div class="explainer-text">If your receipt includes an audit code, we can confirm it is part of the official dataset used to compute the final results — like a numbered ticket on the official roster.</div>
          </div>
          <div class="explainer-item">
            <div class="explainer-label">Your Privacy</div>
            <div class="explainer-text">This confirms inclusion only. It does not reveal who you voted for, your ballot choices, or any personal information.</div>
          </div>
        </div>
      </details>

      <!-- TECHNICAL DETAILS -->
      <details class="details-card">
        <summary class="details-summary">
          <div class="details-summary-left">
            <div class="details-summary-title">Technical details</div>
            <div class="details-summary-sub">Transaction hash, IDs, and on-chain data</div>
          </div>
          <span class="details-toggle">Expand</span>
        </summary>
        <div class="details-body">
          ${detailRow(iconHash("ic"), "Token ID", p.tokenId, true)}
          ${detailRow(iconShield("ic"), "Owner", p.owner ? p.owner : "Unavailable", true)}
          ${detailRow(iconInfo("ic"), "Election ID", electionId || "Not provided", false)}
          ${detailRow(iconHash("ic"), "Transaction Hash", txHash || "Not provided", true)}
          ${detailRow(iconInfo("ic"), "Spec Version", spec || "Not provided", false)}
          ${detailRow(iconExternal("ic"), "Token URI", p.tokenUri || "Unavailable", true)}
        </div>
      </details>

      <!-- ERRORS -->
      ${errs.length ? `<div class="alert-card">
        <div class="alert-icon">${iconInfo("ic")}</div>
        <div>
          <div class="alert-title">Some checks temporarily unavailable</div>
          <div class="alert-desc">Your receipt may still be valid. Retry later or keep your Token ID as proof of participation.</div>
          <details style="margin-top:10px">
            <summary style="font-size:12px;font-weight:700;color:var(--ink-60);cursor:pointer;letter-spacing:.04em">Show technical details</summary>
            <div class="alert-errors">${errs.map((e) => escapeHtml(e)).join("\n")}</div>
          </details>
        </div>
      </div>` : ""}

      <!-- KIOSK RETURN -->
      <div class="section-label">Kiosk Auto-Return</div>
      <div class="kiosk-bar">
        <div class="kiosk-inner">
          <div class="kiosk-text">
            <div class="kiosk-title">Returning to Home</div>
            <div class="kiosk-sub">This screen will auto-redirect for the next voter.</div>
          </div>
          <div class="kiosk-timer-wrap">
            <div class="kiosk-timer" id="bvTimer">40</div>
            <div class="kiosk-timer-unit">s</div>
          </div>
          <a class="btn btn-gold-green" href="/">${iconCheck("ic")}<span>Go Home Now</span></a>
        </div>
        <div class="kiosk-progress-wrap">
          <div class="kiosk-progress-track">
            <div class="kiosk-progress-fill" id="bvBar"></div>
          </div>
        </div>
      </div>

    </div><!-- /page-content -->
  </div><!-- /page-shell -->

  <script>
    (function () {
      var TOTAL = 40, s = TOTAL;
      var timerEl = document.getElementById('bvTimer');
      var barEl = document.getElementById('bvBar');
      function render() {
        if (timerEl) timerEl.textContent = String(s);
        if (barEl) barEl.style.width = Math.max(0, (s / TOTAL) * 100) + '%';
      }
      render();
      var t = setInterval(function () {
        s -= 1;
        render();
        if (s <= 0) { clearInterval(t); window.location.href = '/'; }
      }, 1000);
    })();
  </script>
</body>
</html>`;
}

/* ──────────────────────────────────────────────
   HANDLER
────────────────────────────────────────────── */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const tokenIdBI = parseTokenId(extractTokenId(req) as any);
  if (!tokenIdBI) return res.status(400).send("Invalid tokenId");

  const origin = originFromReq(req);
  const rpcUrl = envAny("AMOY_RPC_URL");
  const nftAddress = envAny("PARTICIPATION_NFT_ADDRESS");
  const errors: string[] = [];

  let nftOk = false;
  let owner: string | null = null;
  let tokenUri: string | null = null;

  if (!rpcUrl || !nftAddress) {
    errors.push("Missing server configuration (AMOY_RPC_URL or PARTICIPATION_NFT_ADDRESS).");
  } else {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const c = new ethers.Contract(nftAddress, NFT_ABI, provider);
      owner = await c.ownerOf(tokenIdBI);
      nftOk = Boolean(owner);
      try { tokenUri = await c.tokenURI(tokenIdBI); } catch { tokenUri = null; }
    } catch (e) {
      nftOk = false;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  let meta: Meta | null = null;
  try {
    const metaUrl = `${origin}/api/nft/${tokenIdBI.toString()}`;
    const m = await fetchJsonSafe(metaUrl);
    if (m.ok && m.json && typeof m.json === "object") meta = m.json as Meta;
    else errors.push(`Metadata fetch failed (${m.status}).`);
  } catch (e) {
    errors.push(`Metadata fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }

  let inclusion: { ok: boolean; verified?: boolean; msg?: string } | null = null;
  if (meta?.voteId) {
    const supabaseUrl = envAny("SUPABASE_URL");
    const anonKey = envAny("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      inclusion = { ok: false, msg: "Verifier not configured" };
    } else {
      try {
        const endpoint = `${supabaseUrl}/functions/v1/verify-vote-inclusion`;
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ voteId: meta.voteId }),
        });
        const text = await r.text();
        let j: unknown = null;
        try { j = JSON.parse(text); } catch { j = null; }
        if (!r.ok) {
          inclusion = { ok: false, msg: `verify-vote-inclusion failed (${r.status})` };
          errors.push(`verify-vote-inclusion failed (${r.status}): ${typeof text === "string" ? text.slice(0, 240) : ""}`);
        } else {
          inclusion = { ok: true, verified: Boolean((j as { verified?: unknown } | null)?.verified) };
        }
      } catch (e) {
        inclusion = { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(
    htmlPage({ tokenId: tokenIdBI.toString(), origin, nftOk, owner, tokenUri, meta, inclusion, errors })
  );
}
