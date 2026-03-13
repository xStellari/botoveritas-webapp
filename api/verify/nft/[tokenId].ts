import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore
import { ethers } from "ethers";

/**
 * Voter-facing receipt verifier — /api/verify/nft/[tokenId].ts
 *
 * Route (Vercel rewrite):
 *   /verify/nft/:tokenId -> /api/verify/nft/[tokenId].ts?tokenId=:tokenId
 *
 * What this page proves:
 *  1. Your receipt token exists on-chain (ownerOf succeeds on Polygon Amoy).
 *  2. Your receipt metadata was issued by BotoVeritas (/api/nft/[tokenId]).
 *  3. At least one of your vote rows is included in the finalized election
 *     audit dataset (Merkle inclusion via verify-vote-inclusion edge function).
 *
 * Privacy:
 *  - Never shows ballot choices or candidate IDs.
 *  - voteId(s) are hidden on this page; auditors use /verify/vote/:voteId.
 *
 * Required env:
 *  - AMOY_RPC_URL
 *  - PARTICIPATION_NFT_ADDRESS
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY  (used for verify-vote-inclusion — NOT the anon key)
 *
 * Key fixes vs. previous version:
 *  - Uses SERVICE_ROLE_KEY (not ANON_KEY) when calling verify-vote-inclusion.
 *    The edge function requires service-role auth; anon key caused silent 401s.
 *  - Tries ALL voteIds from metadata, not just voteIds[0].
 *    A voter has one row per position; any one verified = audit step passes.
 *  - Surfaces inclusion error details in the debug accordion instead of
 *    silently collapsing to "Unavailable".
 *  - Distinguishes "election not yet anchored" (warn) from "inclusion failed" (bad).
 */

const BASE_SITE = "https://botoveritas.info";

/* ─────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────── */
function envAny(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

function escapeHtml(s: string): string {
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
  const parts = (req.url || "").split("?")[0].split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

function originFromReq(req: VercelRequest): string {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0].trim();
  return host ? `${proto}://${host}` : BASE_SITE;
}

function parseTokenId(raw: string | string[] | undefined): bigint | null {
  const s = (Array.isArray(raw) ? raw[0] : raw ?? "").toString().trim();
  if (!s || !/^\d+$/.test(s)) return null;
  try {
    const bi = BigInt(s);
    return bi > 0n ? bi : null;
  } catch {
    return null;
  }
}

async function fetchJsonSafe(url: string, init?: RequestInit, timeoutMs = 10_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: r.ok, status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */
const NFT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
];

type Meta = {
  name?: string;
  description?: string;
  image?: string;
  electionId?: string;
  voteId?: string;
  voteIds?: string[];
  txHash?: string;
  specVersion?: string;
  verification?: { receiptUrl?: string; auditorVoteUrl?: string };
};

type InclusionResult = {
  status: "verified" | "failed" | "unavailable" | "not_anchored";
  msg?: string;
};

type StepState = "ok" | "bad" | "warn";

/* ─────────────────────────────────────────────
   INCLUSION CHECK
   Tries each voteId in order; resolves on first
   verified=true, or returns the last failure.
───────────────────────────────────────────── */
async function checkInclusion(
  voteIds: string[],
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<InclusionResult> {
  if (voteIds.length === 0) {
    return { status: "unavailable", msg: "No vote IDs in metadata" };
  }

  const endpoint = `${supabaseUrl}/functions/v1/verify-vote-inclusion`;
  let lastMsg = "";

  for (const voteId of voteIds) {
    let resp: { ok: boolean; status: number; json: unknown; text: string };
    try {
      resp = await fetchJsonSafe(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Service-role key required — anon key causes 401 on this edge function
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ voteId }),
        },
        12_000,
      );
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : String(e);
      continue;
    }

    const body = resp.json as Record<string, unknown> | null;

    if (!resp.ok) {
      // 409 = spec version mismatch or election not yet anchored on-chain
      if (resp.status === 409) return { status: "not_anchored" };
      lastMsg = `HTTP ${resp.status}: ${String(body?.error ?? resp.text.slice(0, 200))}`;
      continue;
    }

    if (body?.verified === true) return { status: "verified" };

    // verified=false means leaf computed but didn't match anchored root
    lastMsg = `Inclusion check returned verified=false for voteId ${voteId}`;
  }

  return { status: "failed", msg: lastMsg || "All vote IDs failed inclusion check" };
}

/* ─────────────────────────────────────────────
   SVG ICONS
───────────────────────────────────────────── */
const ic = {
  shield: (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="1.6"/><path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check:  (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  x:      (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  info:   (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 16v-5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  lock:   (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  ext:    (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3h7v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 14L21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  hash:   (cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

/* ─────────────────────────────────────────────
   UI COMPONENTS
───────────────────────────────────────────── */
function heroBadge(state: StepState, label: string): string {
  const cfg: Record<StepState, { cls: string; icon: string }> = {
    ok:   { cls: "hbadge hbadge-ok",   icon: ic.check() },
    bad:  { cls: "hbadge hbadge-bad",  icon: ic.x() },
    warn: { cls: "hbadge hbadge-warn", icon: ic.info() },
  };
  const { cls, icon } = cfg[state];
  return `<span class="${cls}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

function stepRow(state: StepState, num: string, title: string, sub: string): string {
  const cfg: Record<StepState, { bar: string; dot: string; tag: string }> = {
    ok:   { bar: "step-bar-ok",   dot: "step-dot-ok",   tag: `<span class="step-tag step-tag-ok">${ic.check("stag-ic")}<span>Verified</span></span>` },
    bad:  { bar: "step-bar-bad",  dot: "step-dot-bad",  tag: `<span class="step-tag step-tag-bad">${ic.x("stag-ic")}<span>Failed</span></span>` },
    warn: { bar: "step-bar-warn", dot: "step-dot-warn", tag: `<span class="step-tag step-tag-warn">${ic.info("stag-ic")}<span>Unavailable</span></span>` },
  };
  const { bar, dot, tag } = cfg[state];
  return `<div class="step">
    <div class="step-left">
      <div class="step-num-wrap">
        <div class="step-bar ${bar}"></div>
        <div class="step-dot ${dot}"><span>${escapeHtml(num)}</span></div>
      </div>
    </div>
    <div class="step-body">
      <div class="step-head">
        <div class="step-title">${escapeHtml(title)}</div>${tag}
      </div>
      <div class="step-sub">${escapeHtml(sub)}</div>
    </div>
  </div>`;
}

function detailRow(icon: string, label: string, value: string, mono = false): string {
  return `<div class="drow">
    <div class="drow-icon">${icon}</div>
    <div class="drow-content">
      <div class="drow-label">${escapeHtml(label)}</div>
      <div class="drow-value${mono ? " drow-mono" : ""}">${escapeHtml(value)}</div>
    </div>
  </div>`;
}

function accordion(title: string, sub: string, body: string, extraClass = ""): string {
  return `<details class="details-card${extraClass ? " " + extraClass : ""}">
    <summary class="details-summary">
      <div class="details-summary-left">
        <div class="details-summary-title">${escapeHtml(title)}</div>
        <div class="details-summary-sub">${escapeHtml(sub)}</div>
      </div>
      <span class="details-toggle">Expand</span>
    </summary>
    ${body}
  </details>`;
}

/* ─────────────────────────────────────────────
   HTML PAGE
───────────────────────────────────────────── */
function htmlPage(p: {
  tokenId: string;
  nftOk: boolean;
  owner: string | null;
  tokenUri: string | null;
  meta: Meta | null;
  inclusion: InclusionResult | null;
  errors: string[];
}): string {
  const errs = p.errors.filter(Boolean);

  const metaName = p.meta?.name || `BotoVeritas Receipt #${p.tokenId}`;
  const metaDesc = p.meta?.description || "This receipt confirms your vote submission was recorded. Ballot choices are never stored in this receipt.";
  const imageUrl = p.meta?.image || `${BASE_SITE}/nft/receipt.png`;
  const electionId = p.meta?.electionId || "";
  const txHash = p.meta?.txHash || "";
  const spec = p.meta?.specVersion || "";
  const explorerTx = txHash ? `https://amoy.polygonscan.com/tx/${txHash}` : "";

  // ── Step states ──
  const stepReceipt: StepState = p.nftOk ? "ok" : "bad";
  const stepDetails: StepState = p.meta ? "ok" : "warn";

  const hasVoteIds = Boolean(p.meta?.voteId || (p.meta?.voteIds?.length ?? 0) > 0);

  let stepAudit: StepState;
  let auditSubtitle: string;

  if (!hasVoteIds) {
    stepAudit = "warn";
    auditSubtitle = "No audit code found in this receipt — election may not be finalized yet";
  } else if (p.inclusion === null) {
    stepAudit = "warn";
    auditSubtitle = "Audit check could not run — verifier not configured";
  } else {
    switch (p.inclusion.status) {
      case "verified":
        stepAudit = "ok";
        auditSubtitle = "Cryptographically confirmed in the election's official audit Merkle tree";
        break;
      case "not_anchored":
        stepAudit = "warn";
        auditSubtitle = "Election has not been anchored on-chain yet — check back after results are finalized";
        break;
      case "failed":
        stepAudit = "bad";
        auditSubtitle = "Vote record was not found in the finalized audit dataset";
        break;
      case "unavailable":
        stepAudit = "warn";
        auditSubtitle = p.inclusion.msg ?? "";
        break;
    }
  }

  const overallOk = stepReceipt === "ok" && stepDetails === "ok";
  const heroState: StepState = !overallOk ? "bad" : stepAudit === "ok" ? "ok" : "warn";

  const heroTitle = p.nftOk
    ? `<span class="accent">Verified.</span> Your vote<br>is on record.`
    : "Receipt Not Found";
  const heroDesc = p.nftOk
    ? "Your participation has been cryptographically confirmed on the Polygon blockchain."
    : "This receipt token was not found on-chain. Please verify your Token ID and try again.";

  const badgeAuditLabel =
    stepAudit === "ok"  ? "Audit Confirmed" :
    stepAudit === "bad" ? "Audit Failed" :
    p.inclusion?.status === "not_anchored" ? "Not Yet Anchored" :
    "Audit Unavailable";

  const bannerTitle =
    heroState === "ok"  ? "All checks passed" :
    heroState === "bad" ? "Verification failed" :
    "Partial verification";

  // Debug lines for the error accordion
  const debugLines: string[] = [];
  if (p.inclusion && p.inclusion.status !== "verified") {
    debugLines.push(`Inclusion status: ${p.inclusion.status}`);
    if (p.inclusion.msg) debugLines.push(`Detail: ${p.inclusion.msg}`);
  }
  debugLines.push(...errs);

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
    :root {
      --green:       #0B6B3A;
      --green-mid:   #0E7D44;
      --green-light: #E8F5EE;
      --green-muted: rgba(11,107,58,.12);
      --green-line:  rgba(11,107,58,.22);
      --gold:        #C9A227;
      --gold-deep:   #A07B10;
      --gold-light:  #FDF7E3;
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
      --r-sm: 12px; --r-md: 18px; --r-lg: 24px; --r-xl: 32px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
      font-size: 15px; line-height: 1.6; color: var(--ink);
      background: var(--surface); min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }

    .page-shell { position: relative; min-height: 100vh; overflow-x: hidden; }
    .page-bg {
      position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background:
        radial-gradient(ellipse 900px 500px at 0% 0%, rgba(11,107,58,.08) 0%, transparent 70%),
        radial-gradient(ellipse 700px 400px at 100% 100%, rgba(201,162,39,.07) 0%, transparent 70%),
        var(--surface);
    }
    .page-bg::after {
      content: ''; position: absolute; inset: 0;
      background-image: radial-gradient(circle, rgba(17,24,32,.06) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent);
      -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent);
    }
    .page-content { position: relative; z-index: 1; max-width: 820px; margin: 0 auto; padding: 0 20px 80px; }

    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 0 16px; border-bottom: 1px solid var(--border); margin-bottom: 40px;
      animation: slideDown .5s cubic-bezier(.22,1,.36,1) both;
    }
    .wordmark { display: flex; align-items: center; gap: 10px; }
    .wordmark-shield {
      width: 34px; height: 34px; background: linear-gradient(145deg, var(--green), var(--green-mid));
      border-radius: 9px; display: flex; align-items: center; justify-content: center;
      color: white; box-shadow: 0 4px 12px rgba(11,107,58,.30);
    }
    .wordmark-shield .ic { width: 18px; height: 18px; }
    .wordmark-text { font-family: 'DM Serif Display', Georgia, serif; font-size: 17px; letter-spacing: -.01em; }
    .wordmark-text span { color: var(--green); }
    .topbar-label { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-40); }

    .hero { margin-bottom: 32px; animation: fadeUp .55s cubic-bezier(.22,1,.36,1) .08s both; }
    .hero-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--green); margin-bottom: 16px; }
    .hero-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex-shrink: 0; }
    .hero-title { font-family: 'DM Serif Display', Georgia, serif; font-size: clamp(32px, 5vw, 52px); line-height: 1.08; letter-spacing: -.02em; color: var(--ink); margin-bottom: 14px; }
    .hero-title .accent { color: var(--green); }
    .hero-desc { font-size: 15px; color: var(--ink-60); line-height: 1.65; max-width: 560px; margin-bottom: 20px; }
    .hero-badges { display: flex; gap: 10px; flex-wrap: wrap; }
    .hbadge { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid; letter-spacing: .01em; }
    .hbadge .ic { width: 14px; height: 14px; }
    .hbadge-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .hbadge-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .hbadge-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }

    .status-banner { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-radius: var(--r-md); border: 1.5px solid; margin-bottom: 28px; animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .14s both; }
    .status-banner-ok   { background: var(--green-light); border-color: var(--green-line); }
    .status-banner-warn { background: var(--gold-light);  border-color: var(--gold-line); }
    .status-banner-bad  { background: var(--red-light);   border-color: var(--red-line); }
    .status-banner-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .status-banner-ok   .status-banner-icon { background: var(--green); color: white; }
    .status-banner-warn .status-banner-icon { background: var(--gold);  color: white; }
    .status-banner-bad  .status-banner-icon { background: var(--red);   color: white; }
    .status-banner-icon .ic { width: 20px; height: 20px; }
    .status-banner-title { font-weight: 800; font-size: 14px; letter-spacing: -.01em; }
    .status-banner-ok   .status-banner-title { color: var(--green); }
    .status-banner-warn .status-banner-title { color: var(--gold-deep); }
    .status-banner-bad  .status-banner-title { color: var(--red); }
    .status-banner-sub { font-size: 13px; color: var(--ink-60); margin-top: 2px; }

    .section-label { font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-40); margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
    .section-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }

    .receipt-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-xl); box-shadow: var(--shadow-md); overflow: hidden; margin-bottom: 16px; animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .18s both; }
    .receipt-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 22px; border-bottom: 1px solid var(--border); background: linear-gradient(to right, var(--green-muted), transparent); }
    .receipt-card-header-left { display: flex; align-items: center; gap: 10px; }
    .receipt-card-header-left .ic { width: 17px; height: 17px; color: var(--green); }
    .receipt-card-header-title { font-weight: 700; font-size: 14px; color: var(--ink-80); }
    .receipt-card-privacy { font-size: 11px; font-weight: 600; color: var(--ink-40); letter-spacing: .02em; display: flex; align-items: center; gap: 5px; }
    .receipt-card-privacy .ic { width: 13px; height: 13px; }
    .receipt-body { padding: 22px; display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
    .receipt-img { width: 96px; height: 96px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--ink-10); overflow: hidden; flex-shrink: 0; }
    .receipt-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .receipt-meta { flex: 1; min-width: 220px; }
    .receipt-name { font-family: 'DM Serif Display', Georgia, serif; font-size: 19px; line-height: 1.25; letter-spacing: -.01em; color: var(--ink); margin-bottom: 8px; }
    .receipt-desc { font-size: 13px; color: var(--ink-60); line-height: 1.6; margin-bottom: 14px; }
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: var(--r-sm); font-size: 13px; font-weight: 700; border: 1.5px solid; cursor: pointer; transition: all .15s ease; text-decoration: none; }
    .btn .ic { width: 14px; height: 14px; }
    .btn-outline { background: transparent; border-color: var(--border); color: var(--ink-80); }
    .btn-outline:hover { background: var(--ink-10); }
    .btn-gold-green { background: linear-gradient(110deg, var(--green) 0%, var(--gold-deep) 100%); border-color: transparent; color: white; box-shadow: 0 4px 20px rgba(11,107,58,.22); }
    .btn-gold-green:hover { filter: brightness(1.06); }

    .steps-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-xl); box-shadow: var(--shadow-md); padding: 22px; margin-bottom: 16px; animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .22s both; }
    .steps-list { display: flex; flex-direction: column; }
    .step { display: flex; position: relative; }
    .step-left { display: flex; flex-direction: column; align-items: center; width: 40px; flex-shrink: 0; margin-right: 16px; }
    .step-num-wrap { display: flex; flex-direction: column; align-items: center; width: 100%; }
    .step-dot { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; border: 2px solid; z-index: 1; position: relative; }
    .step-dot-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .step-dot-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }
    .step-dot-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .step-bar { width: 2px; flex: 1; min-height: 24px; margin: 4px 0; border-radius: 99px; }
    .step-bar-ok   { background: linear-gradient(to bottom, var(--green-line), transparent); }
    .step-bar-bad  { background: linear-gradient(to bottom, var(--red-line),   transparent); }
    .step-bar-warn { background: linear-gradient(to bottom, var(--gold-line),  transparent); }
    .step:last-child .step-bar { display: none; }
    .step-body { padding: 4px 0 24px; flex: 1; }
    .step:last-child .step-body { padding-bottom: 0; }
    .step-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
    .step-title { font-size: 14px; font-weight: 700; color: var(--ink); }
    .step-tag { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid; letter-spacing: .02em; white-space: nowrap; }
    .stag-ic { width: 11px; height: 11px; }
    .step-tag-ok   { background: var(--green-light); border-color: var(--green-line); color: var(--green); }
    .step-tag-bad  { background: var(--red-light);   border-color: var(--red-line);   color: var(--red); }
    .step-tag-warn { background: var(--gold-light);  border-color: var(--gold-line);  color: var(--gold-deep); }
    .step-sub { font-size: 12.5px; color: var(--ink-60); line-height: 1.55; }

    .details-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-xl); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: 16px; animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .26s both; }
    .details-summary { list-style: none; cursor: pointer; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; gap: 12px; user-select: none; }
    .details-summary::-webkit-details-marker { display: none; }
    .details-summary-title { font-size: 14px; font-weight: 700; color: var(--ink); }
    .details-summary-sub { font-size: 12px; color: var(--ink-40); margin-top: 2px; }
    .details-toggle { padding: 6px 14px; border-radius: 999px; background: var(--ink-10); border: 1px solid var(--border); font-size: 11px; font-weight: 700; color: var(--ink-60); white-space: nowrap; letter-spacing: .04em; }
    .details-body { padding: 0 22px 22px; }
    .drow { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--border); }
    .drow:last-child { border-bottom: none; }
    .drow-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--green-muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--green); }
    .drow-icon .ic { width: 16px; height: 16px; }
    .drow-label { font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-40); margin-bottom: 3px; }
    .drow-value { font-size: 13.5px; font-weight: 500; color: var(--ink); line-height: 1.45; }
    .drow-mono { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }

    .explainer-card { background: linear-gradient(135deg, var(--green-light), rgba(201,162,39,.06)); border-color: var(--green-line); }
    .explainer-grid { display: grid; grid-template-columns: 1fr 1fr; padding: 20px 22px 22px; }
    @media (max-width: 560px) { .explainer-grid { grid-template-columns: 1fr; } }
    .explainer-item { padding: 0 16px 0 0; }
    .explainer-item:last-child { padding: 0 0 0 16px; border-left: 1px solid var(--green-line); }
    @media (max-width: 560px) { .explainer-item:last-child { padding: 16px 0 0; border-left: none; border-top: 1px solid var(--green-line); margin-top: 16px; } }
    .explainer-label { font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--green); margin-bottom: 8px; }
    .explainer-text { font-size: 13px; color: var(--ink-80); line-height: 1.65; }

    .alert-card { display: flex; gap: 14px; padding: 18px 20px; border-radius: var(--r-md); border: 1.5px solid var(--red-line); background: var(--red-light); margin-bottom: 16px; animation: fadeUp .5s ease .34s both; }
    .alert-icon { color: var(--red); flex-shrink: 0; margin-top: 1px; }
    .alert-icon .ic { width: 18px; height: 18px; }
    .alert-title { font-size: 13px; font-weight: 700; color: var(--red); margin-bottom: 4px; }
    .alert-desc { font-size: 13px; color: var(--ink-80); line-height: 1.55; }
    .alert-errors { margin-top: 12px; padding: 12px 14px; background: rgba(17,24,32,.04); border-radius: var(--r-sm); border: 1px solid var(--border); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; color: var(--ink-60); line-height: 1.7; word-break: break-all; white-space: pre-wrap; }

    .kiosk-bar { background: var(--card); border: 1px solid var(--border); border-radius: var(--r-xl); padding: 20px 22px; box-shadow: var(--shadow-md); margin-bottom: 16px; animation: fadeUp .5s cubic-bezier(.22,1,.36,1) .38s both; }
    .kiosk-inner { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
    .kiosk-text { flex: 1; min-width: 180px; }
    .kiosk-title { font-weight: 800; font-size: 14px; color: var(--green); letter-spacing: -.01em; margin-bottom: 3px; }
    .kiosk-sub { font-size: 12px; color: var(--ink-60); }
    .kiosk-timer-wrap { display: flex; align-items: baseline; gap: 4px; }
    .kiosk-timer { font-family: 'DM Serif Display', Georgia, serif; font-size: 42px; line-height: 1; color: var(--green); letter-spacing: -.03em; }
    .kiosk-timer-unit { font-size: 14px; font-weight: 700; color: var(--ink-40); }
    .kiosk-progress-wrap { width: 100%; margin-top: 16px; }
    .kiosk-progress-track { height: 6px; border-radius: 999px; background: var(--ink-10); overflow: hidden; }
    .kiosk-progress-fill { height: 100%; width: 100%; border-radius: 999px; background: linear-gradient(to right, var(--green), var(--gold)); transition: width .9s linear; }

    @keyframes fadeUp    { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
    @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
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

      <div class="topbar">
        <div class="wordmark">
          <div class="wordmark-shield">${ic.shield("ic")}</div>
          <div class="wordmark-text">Boto<span>Veritas</span></div>
        </div>
        <div class="topbar-label">Secure Verification</div>
      </div>

      <div class="hero">
        <div class="hero-eyebrow"><div class="hero-eyebrow-dot"></div><span>Blockchain Receipt</span></div>
        <h1 class="hero-title">${heroTitle}</h1>
        <p class="hero-desc">${escapeHtml(heroDesc)}</p>
        <div class="hero-badges">
          ${heroBadge(stepReceipt, p.nftOk ? "Token On-Chain" : "Token Missing")}
          ${heroBadge(stepAudit, badgeAuditLabel)}
        </div>
      </div>

      <div class="status-banner status-banner-${heroState}">
        <div class="status-banner-icon">
          ${heroState === "ok" ? ic.check("ic") : heroState === "bad" ? ic.x("ic") : ic.info("ic")}
        </div>
        <div class="status-banner-text">
          <div class="status-banner-title">${escapeHtml(bannerTitle)}</div>
          <div class="status-banner-sub">Token ID #${escapeHtml(p.tokenId)} · Polygon Amoy Testnet</div>
        </div>
      </div>

      <div class="section-label">Your Receipt</div>
      <div class="receipt-card">
        <div class="receipt-card-header">
          <div class="receipt-card-header-left">
            ${ic.shield("ic")}<span class="receipt-card-header-title">Participation Receipt</span>
          </div>
          <div class="receipt-card-privacy">${ic.lock("ic")}<span>Ballot choices never stored</span></div>
        </div>
        <div class="receipt-body">
          <div class="receipt-img"><img src="${escapeHtml(imageUrl)}" alt="Receipt NFT image" loading="eager" /></div>
          <div class="receipt-meta">
            <div class="receipt-name">${escapeHtml(metaName)}</div>
            <div class="receipt-desc">${escapeHtml(metaDesc)}</div>
            <div class="btn-row">
              ${explorerTx ? `<a class="btn btn-outline" href="${escapeHtml(explorerTx)}" target="_blank" rel="noopener">${ic.ext("ic")}<span>PolygonScan</span></a>` : ""}
            </div>
          </div>
        </div>
      </div>

      <div class="section-label">Verification Steps</div>
      <div class="steps-card">
        <div class="steps-list">
          ${stepRow(stepReceipt, "1", "Receipt token on-chain",         "Confirmed on Polygon Amoy — cannot be altered or forged")}
          ${stepRow(stepDetails, "2", "Metadata issued by BotoVeritas",  p.meta ? "Receipt details loaded and authenticated" : "Metadata could not be retrieved")}
          ${stepRow(stepAudit,   "3", "Recorded in final audit dataset", auditSubtitle)}
        </div>
      </div>

      ${accordion(
        'What does "Recorded in final audit" mean?',
        "Plain-language explanation — no blockchain background needed",
        `<div class="explainer-grid">
          <div class="explainer-item">
            <div class="explainer-label">In plain language</div>
            <div class="explainer-text">If your receipt includes an audit code, we confirm it is part of the official dataset used to compute the final results — like a numbered entry on the official roster.</div>
          </div>
          <div class="explainer-item">
            <div class="explainer-label">Your Privacy</div>
            <div class="explainer-text">This confirms inclusion only. It does not reveal who you voted for, your ballot choices, or any personal information.</div>
          </div>
        </div>`,
        "explainer-card",
      )}

      ${accordion(
        "Technical details",
        "Transaction hash, IDs, and on-chain data",
        `<div class="details-body">
          ${detailRow(ic.hash("ic"),   "Token ID",         p.tokenId,                   true)}
          ${detailRow(ic.shield("ic"), "Owner",            p.owner    || "Unavailable",  true)}
          ${detailRow(ic.info("ic"),   "Election ID",      electionId || "Not provided", false)}
          ${detailRow(ic.hash("ic"),   "Transaction Hash", txHash     || "Not provided", true)}
          ${detailRow(ic.info("ic"),   "Spec Version",     spec       || "Not provided", false)}
          ${detailRow(ic.ext("ic"),    "Token URI",        p.tokenUri || "Unavailable",  true)}
        </div>`,
      )}

      ${debugLines.length ? `<div class="alert-card">
        <div class="alert-icon">${ic.info("ic")}</div>
        <div>
          <div class="alert-title">Some checks could not complete</div>
          <div class="alert-desc">Your receipt may still be valid. Retry later or keep your Token ID as proof of participation.</div>
          <details style="margin-top:10px">
            <summary style="font-size:12px;font-weight:700;color:var(--ink-60);cursor:pointer;letter-spacing:.04em">Show technical details</summary>
            <div class="alert-errors">${debugLines.map(escapeHtml).join("\n")}</div>
          </details>
        </div>
      </div>` : ""}

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
          <a class="btn btn-gold-green" href="/">${ic.check("ic")}<span>Go Home Now</span></a>
        </div>
        <div class="kiosk-progress-wrap">
          <div class="kiosk-progress-track">
            <div class="kiosk-progress-fill" id="bvBar"></div>
          </div>
        </div>
      </div>

    </div>
  </div>
  <script>
    (function () {
      var TOTAL = 40, s = TOTAL;
      var timerEl = document.getElementById('bvTimer');
      var barEl   = document.getElementById('bvBar');
      function render() {
        if (timerEl) timerEl.textContent = String(s);
        if (barEl)   barEl.style.width   = Math.max(0, (s / TOTAL) * 100) + '%';
      }
      render();
      var t = setInterval(function () {
        s -= 1; render();
        if (s <= 0) { clearInterval(t); window.location.href = '/'; }
      }, 1000);
    })();
  </script>
</body>
</html>`;
}

/* ─────────────────────────────────────────────
   HANDLER
───────────────────────────────────────────── */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const tokenIdBI = parseTokenId(extractTokenId(req) as string | undefined);
  if (!tokenIdBI) return res.status(400).send("Invalid tokenId");

  const origin = originFromReq(req);
  const errors: string[] = [];

  // ── 1. On-chain check ──
  const rpcUrl     = envAny("AMOY_RPC_URL");
  const nftAddress = envAny("PARTICIPATION_NFT_ADDRESS");

  let nftOk    = false;
  let owner:    string | null = null;
  let tokenUri: string | null = null;

  if (!rpcUrl || !nftAddress) {
    errors.push("Missing env: AMOY_RPC_URL or PARTICIPATION_NFT_ADDRESS");
  } else {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(nftAddress, NFT_ABI, provider);
      owner  = await contract.ownerOf(tokenIdBI);
      nftOk  = Boolean(owner);
      try { tokenUri = await contract.tokenURI(tokenIdBI); } catch { tokenUri = null; }
    } catch (e) {
      errors.push(`On-chain check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 2. Metadata fetch ──
  let meta: Meta | null = null;
  try {
    const metaUrl = `${origin}/api/nft/${tokenIdBI.toString()}`;
    const m = await fetchJsonSafe(metaUrl);
    if (m.ok && m.json && typeof m.json === "object") {
      meta = m.json as Meta;
    } else {
      errors.push(`Metadata fetch failed (HTTP ${m.status})`);
    }
  } catch (e) {
    errors.push(`Metadata fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. Inclusion check ──
  // Collect ALL voteIds — a voter has one votes row per position they cast.
  // We try each one; the first verified=true wins.
  let inclusion: InclusionResult | null = null;

  const allVoteIds: string[] = [];
  if (meta?.voteIds && meta.voteIds.length > 0) {
    allVoteIds.push(...meta.voteIds);
  } else if (meta?.voteId) {
    allVoteIds.push(meta.voteId);
  }

  if (allVoteIds.length > 0) {
    // Must use SERVICE_ROLE_KEY — the edge function calls Supabase tables and
    // the on-chain anchor contract, which require elevated auth.
    // Using the anon key here causes a silent 401 → verified=false → "Unavailable".
    const supabaseUrl    = envAny("SUPABASE_URL");
    const serviceRoleKey = envAny("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE");

    if (!supabaseUrl || !serviceRoleKey) {
      inclusion = { status: "unavailable", msg: "Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
      errors.push("Inclusion check skipped — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    } else {
      inclusion = await checkInclusion(allVoteIds, supabaseUrl, serviceRoleKey);
      if (inclusion.status === "failed" || inclusion.status === "unavailable") {
        errors.push(`Inclusion: ${inclusion.msg ?? inclusion.status}`);
      }
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(
    htmlPage({
      tokenId: tokenIdBI.toString(),
      nftOk,
      owner,
      tokenUri,
      meta,
      inclusion,
      errors,
    }),
  );
}
