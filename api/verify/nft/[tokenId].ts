import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore - This file runs in Vercel's Node serverless runtime where `ethers` is available as a dependency.
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

// Accepts big tokenIds (no JS number parsing).
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
  voteId?: string; // hidden on this page
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
  try {
    json = JSON.parse(r.text);
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, json, text: r.text };
}

function shortText(s: string, head = 12, tail = 10) {
  if (!s) return "";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function shortHex(s: string, head = 10, tail = 10) {
  return shortText(s, head, tail);
}

type StepState = "loading" | "ok" | "bad" | "warn";

/* ---------------------------
   Inline icons (tiny SVGs)
----------------------------*/
function iconShield(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="1.6"/>
    <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function iconCheck(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function iconX(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
function iconLoader(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
function iconExternal(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14 3h7v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M10 14L21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}
function iconInfo(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10z" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 16v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 8h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function statusBadge(kind: StepState, label: string) {
  const cls =
    kind === "ok"
      ? "badge badge-good"
      : kind === "bad"
      ? "badge badge-bad"
      : kind === "loading"
      ? "badge badge-warn"
      : "badge badge-warn";
  const icon =
    kind === "loading"
      ? iconLoader()
      : kind === "ok"
      ? iconCheck()
      : kind === "bad"
      ? iconX()
      : iconInfo();
  return `<span class="${cls}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

function pill(kind: StepState, title: string, subtitle: string) {
  const bar =
    kind === "ok"
      ? "bar-ok"
      : kind === "bad"
      ? "bar-bad"
      : kind === "loading"
      ? "bar-loading"
      : "bar-warn";
  const icon =
    kind === "loading"
      ? iconLoader('pill-ic ic-spin')
      : kind === "ok"
      ? iconCheck('pill-ic ic-ok')
      : kind === "bad"
      ? iconX('pill-ic ic-bad')
      : iconInfo('pill-ic ic-warn');

  const right =
    kind === "loading"
      ? `<span class="tag tag-warn">${iconLoader('tag-ic ic-spin')}<span>Checking</span></span>`
      : kind === "ok"
      ? `<span class="tag tag-ok">${iconCheck('tag-ic ic-ok')}<span>Verified</span></span>`
      : kind === "bad"
      ? `<span class="tag tag-bad">${iconX('tag-ic ic-bad')}<span>Failed</span></span>`
      : `<span class="tag tag-warn">${iconInfo('tag-ic ic-warn')}<span>Unavailable</span></span>`;

  return `<div class="pill">
    <div class="pill-bar ${bar}"></div>
    <div class="pill-in">
      <div class="pill-top">
        <div class="pill-left">
          ${icon}
          <div class="pill-title">${escapeHtml(title)}</div>
        </div>
        ${right}
      </div>
      <div class="pill-sub">${escapeHtml(subtitle)}</div>
    </div>
  </div>`;
}

/* ---------------------------
   HTML
----------------------------*/
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
  const receiptUrl = p.meta?.verification?.receiptUrl || `${p.origin}/verify/nft/${p.tokenId}`;
  const auditorUrl =
    p.meta?.verification?.auditorVoteUrl ||
    (p.meta?.voteId ? `${p.origin}/verify/vote/${p.meta.voteId}` : "");

  const metaName = p.meta?.name || `BotoVeritas Participation Receipt #${p.tokenId}`;
  const metaDesc =
    p.meta?.description ||
    "This receipt confirms your vote submission was recorded. Ballot choices are never stored in this receipt.";
  const imageUrl = p.meta?.image || `${BASE_SITE}/nft/receipt.png`;

  const electionId = p.meta?.electionId || "";
  const txHash = p.meta?.txHash || "";
  const spec = p.meta?.specVersion || "";

  const headline = p.nftOk ? "Receipt Verified" : "Receipt Not Verified";
  const subhead = p.nftOk
    ? "Your on-chain receipt is verified in the finalized election audit"
    : "Receipt token not found on-chain. Please try again.";

  const stepReceipt: StepState = p.nftOk ? "ok" : "bad";
  const stepDetails: StepState = p.meta ? "ok" : "warn";
  const stepAudit: StepState = !hasVoteId ? "warn" : p.inclusion?.ok && p.inclusion.verified ? "ok" : p.inclusion?.ok ? "bad" : "warn";

  const topBadges = [
    statusBadge(stepReceipt, p.nftOk ? "Receipt Token Found" : "Receipt Token Missing"),
    statusBadge(stepAudit, !hasVoteId ? "Audit Check Unavailable" : stepAudit === "ok" ? "Recorded in Final Audit" : stepAudit === "bad" ? "Audit Check Failed" : "Audit Check Unavailable"),
  ].join("");

  const explorerBase = "https://amoy.polygonscan.com";
  const explorerTx = txHash ? `${explorerBase}/tx/${txHash}` : "";
  const explorerBtn = explorerTx
    ? `<a class="btn btn-ghost" href="${escapeHtml(explorerTx)}">
        ${iconExternal("ic")}<span>View Transaction on PolygonScan</span>
      </a>`
    : "";

  const notes =
    errs.length
      ? `<div class="alert alert-bad">
          <div class="alert-ic">${iconX("ic")}</div>
          <div>
            <div class="alert-title">Notes</div>
            <div class="alert-desc">${errs.map((e) => escapeHtml(e)).join("<br/>")}</div>
          </div>
        </div>`
      : "";

  const techDetails =
    `<details class="acc" style="margin-top:14px">
      <summary class="acc-sum">
        <div>
          <div class="acc-title">Technical details</div>
          <div class="acc-sub">Transaction and IDs</div>
        </div>
        <span class="acc-tag">Expand</span>
      </summary>
      <div class="acc-bd">
        <div class="acc-grid">
          <div class="acc-box">
            <div class="acc-lab">Token ID</div>
            <div class="acc-code"><code>${escapeHtml(p.tokenId)}</code></div>
          </div>
          <div class="acc-box">
            <div class="acc-lab">Owner</div>
            <div class="acc-code"><code>${escapeHtml(p.owner || "Unavailable")}</code></div>
          </div>
          <div class="acc-box">
            <div class="acc-lab">Election ID</div>
            <div class="acc-code"><code>${escapeHtml(electionId || "Not provided")}</code></div>
          </div>
          <div class="acc-box">
            <div class="acc-lab">Transaction Hash</div>
            <div class="acc-code"><code>${escapeHtml(txHash || "Not provided")}</code></div>
          </div>
          <div class="acc-box">
            <div class="acc-lab">Spec Version</div>
            <div class="acc-code"><code>${escapeHtml(spec || "Not provided")}</code></div>
          </div>
          <div class="acc-box">
            <div class="acc-lab">TokenURI</div>
            <div class="acc-code"><code>${escapeHtml(p.tokenUri || "Unavailable")}</code></div>
          </div>
        </div>
      </div>
    </details>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(metaName)} • BotoVeritas</title>
  <meta name="color-scheme" content="light dark">
  <style>
    :root{
      --bg: #ffffff;
      --ink: #0b1220;
      --muted: rgba(11,18,32,.68);
      --line: rgba(11,18,32,.10);
      --card: rgba(255,255,255,.92);
      --card2: rgba(255,255,255,.86);
      --shadow: 0 18px 50px rgba(2,6,23,.10);

      --feuGreen: #0B6B3A;
      --feuGold: #C9A227;

      --good: #0B6B3A;
      --warn: #C9A227;
      --bad: #D94848;

      --r: 22px;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: var(--ink);
      background: #ffffff;
      min-height: 100vh;
    }
    .bg{
      position: fixed;
      inset: 0;
      pointer-events:none;
      background:
        radial-gradient(1100px 620px at 50% -140px, rgba(11,107,58,0), transparent 70%),
        radial-gradient(920px 560px at 10% -120px, rgba(201,162,39,0), transparent 68%),
        radial-gradient(900px 540px at 110% 10%, rgba(11,107,58,0), transparent 64%),
        radial-gradient(900px 540px at -10% 38%, rgba(201,162,39,0), transparent 62%);
      filter: saturate(1.03);
    }
    .gridmask{
      position: fixed;
      inset: 0;
      pointer-events:none;
      background:
        linear-gradient(rgba(2,6,23,.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(2,6,23,.05) 1px, transparent 1px);
      background-size: 32px 32px;
      -webkit-mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 0%, transparent 70%);
      mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 0%, transparent 70%);
      opacity: 0;
    }
    .wrap{
      position: relative;
      max-width: 1100px;
      margin: 0 auto;
      padding: 26px 16px 64px;
    }
    .hero{
      position: relative;
      overflow: hidden;
      border-bottom: 1px solid var(--line);
      padding: 28px 0 18px;
    }
    .hero-top{
      display:flex; flex-wrap:wrap; gap:14px;
      align-items:flex-start; justify-content:space-between;
    }
    .chip{
      display:inline-flex; align-items:center; gap:10px;
      border: 1px solid rgba(11,107,58,.22);
      background: rgba(11,107,58,.07);
      color: rgba(11,107,58,.98);
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 30px rgba(2,6,23,.10);
    }
    .chip .ic{width:18px; height:18px}
    .hgroup{max-width: 760px}
    h1{
      margin: 10px 0 0;
      font-size: clamp(30px, 4vw, 44px);
      line-height: 1.1;
      letter-spacing: -.02em;
      background: linear-gradient(180deg, rgba(11,18,32,.96), rgba(11,18,32,.72));
      -webkit-background-clip:text;
      background-clip:text;
      color: transparent;
      font-weight: 700;
    }
    .sub{
      margin-top: 12px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.55;
    }
    .hero-right{
      display:flex; gap:10px; align-items:center; flex-wrap:wrap;
      margin-top: 6px;
    }
    .badge{
      display:inline-flex; align-items:center; gap:8px;
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.82);
      box-shadow: 0 16px 40px rgba(2,6,23,.10);
      backdrop-filter: blur(12px);
      white-space: nowrap;
      color: rgba(11,18,32,.88);
    }
    .badge .ic{width:16px; height:16px}
    .badge-good{border-color: rgba(11,107,58,.28); background: rgba(11,107,58,0); color: rgba(11,107,58,.96)}
    .badge-warn{border-color: rgba(201,162,39,.30); background: rgba(201,162,39,.10); color: rgba(128,92,0,.96)}
    .badge-bad{border-color: rgba(217,72,72,.28); background: rgba(217,72,72,.10); color: rgba(150,25,25,.96)}
    .card{
      background: linear-gradient(180deg, var(--card), var(--card2));
      border: 1px solid var(--line);
      border-radius: 26px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(14px);
      overflow: hidden;
    }
    .card-hd{
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(11,107,58,.06), transparent);
    }
    .card-ttl{
      display:flex; align-items:center; gap:10px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: .2px;
      color: rgba(11,18,32,.92);
    }
    .card-ttl .ic{width:18px; height:18px; color: rgba(11,107,58,.92)}
    .card-desc{margin-top:6px; color: rgba(11,18,32,.70); font-size: 13px; line-height: 1.5;}
    .card-bd{padding: 18px}
    .main{
      display:grid;
      grid-template-columns: 1fr;
      gap: 16px;
      padding-top: 18px;
    }
    .receipt{
      display:flex; gap:16px; align-items:stretch; flex-wrap:wrap;
    }
    .img{
      width: 120px; height: 120px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(2,6,23,.03);
      overflow: hidden;
      flex: 0 0 auto;
    }
    .img img{width:100%; height:100%; object-fit:cover}
    .rmeta{flex:1; min-width: 260px}
    .rmeta h2{margin:0; font-size: 16px; font-weight: 700; color: rgba(11,18,32,.92);}
    .rmeta p{margin: 10px 0 0; color: rgba(11,18,32,.70); font-size: 13px; line-height: 1.55;}
    .btnrow{display:flex; gap:10px; flex-wrap:wrap; margin-top:14px}
    a.btn{
      appearance:none; border:none;
      display:inline-flex; align-items:center; gap:10px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.88);
      color: rgba(11,18,32,.90);
      text-decoration:none;
      font-weight: 700;
      font-size: 13px;
      transition: .15s ease;
      cursor:pointer;
    }
    a.btn:hover{background: rgba(255,255,255,.96)}
    .btn .ic{width:16px; height:16px}
    .btn-primary{
      background: linear-gradient(90deg, rgba(11,107,58,.92), rgba(11,107,58,.80));
      border-color: rgba(11,107,58,.30);
      color: #ffffff;
      box-shadow: 0 16px 40px rgba(11,107,58,.16);
    }
    .btn-primary:hover{filter: brightness(1.02)}
    .btn-ghost{background: rgba(255,255,255,.86)}

    /* Kiosk-safe return bar */
    .returnbar{
      margin-top: 18px;
      border: 1px solid rgba(11,107,58,.22);
      background: rgba(11,107,58,.06);
      border-radius: 18px;
      padding: 16px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .returnleft{display:flex; flex-direction:column; gap:6px}
    .returnttl{font-weight: 800; color: rgba(11,107,58,.95); letter-spacing: -.01em}
    .returndesc{font-size: 13px; color: rgba(11,18,32,.70)}
    .timerbig{font-size: 28px; font-weight: 900; color: rgba(11,107,58,.98); line-height: 1}
    .timerwrap{display:flex; align-items:baseline; gap:8px}
    .timerunit{font-size: 12px; color: rgba(11,18,32,.62); font-weight: 700}
    .progress{width: 220px; height: 10px; border-radius: 999px; background: rgba(11,18,32,.10); overflow:hidden}
    .progress > div{height:100%; width:100%; background: linear-gradient(90deg, rgba(11,107,58,.95), rgba(201,162,39,.95));}
    a.btn-home{
      background: linear-gradient(90deg, rgba(11,107,58,.98), rgba(201,162,39,.98));
      border-color: rgba(11,107,58,.22);
      color: white;
      box-shadow: 0 14px 30px rgba(2,6,23,.12);
    }
    a.btn-home:hover{opacity:.92}
    .steps{
      display:grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin-top: 14px;
    }
    @media (min-width: 900px){
      .steps{grid-template-columns: repeat(3, 1fr);}
    }
    .pill{
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.84));
      box-shadow: 0 16px 40px rgba(2,6,23,.10);
    }
    .pill-bar{position:absolute; left:0; top:0; bottom:0; width: 4px; opacity: .95;}
    .bar-ok{background: linear-gradient(180deg, rgba(11,107,58,.65), rgba(11,107,58,1))}
    .bar-bad{background: linear-gradient(180deg, rgba(217,72,72,.65), rgba(217,72,72,1))}
    .bar-warn{background: linear-gradient(180deg, rgba(201,162,39,.65), rgba(201,162,39,1))}
    .bar-loading{background: linear-gradient(180deg, rgba(11,107,58,.55), rgba(201,162,39,.90))}
    .pill-in{padding: 16px 16px 14px 18px;}
    .pill-top{display:flex; align-items:center; justify-content:space-between; gap:12px}
    .pill-left{display:flex; align-items:center; gap:10px}
    .pill-ic{width: 18px; height: 18px}
    .pill-title{font-size: 13px; font-weight: 700; color: rgba(11,18,32,.92);}
    .pill-sub{margin-top: 8px; color: rgba(11,18,32,.68); font-size: 12px; padding-left: 28px; line-height: 1.35;}
    .tag{
      display:inline-flex; align-items:center; gap:8px;
      padding: 8px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.86);
      white-space: nowrap;
      color: rgba(11,18,32,.80);
    }
    .tag .tag-ic{width: 14px; height: 14px}
    .tag-ok{border-color: rgba(11,107,58,.28); background: rgba(11,107,58,0); color: rgba(11,107,58,.96)}
    .tag-warn{border-color: rgba(201,162,39,.30); background: rgba(201,162,39,.10); color: rgba(128,92,0,.96)}
    .tag-bad{border-color: rgba(217,72,72,.28); background: rgba(217,72,72,.10); color: rgba(150,25,25,.96)}
    .ic-spin{animation: spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    details.acc{
      margin-top: 12px;
      border-radius: 26px;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(255,255,255,.92), rgba(255,255,255,.84));
      box-shadow: 0 16px 40px rgba(2,6,23,.09);
      overflow:hidden;
    }
    summary{list-style:none}
    summary::-webkit-details-marker{display:none}
    .acc-sum{
      cursor:pointer;
      padding: 16px 16px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 12px;
    }
    .acc-title{font-size: 13px; font-weight: 700; color: rgba(11,18,32,.92);}
    .acc-sub{margin-top:4px; font-size: 12px; color: rgba(11,18,32,.62);}
    .acc-tag{
      display:inline-flex;
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(11,107,58,.06);
      border: 1px solid rgba(11,107,58,.18);
      color: rgba(11,107,58,.92);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .acc-bd{padding: 0 16px 16px;}
    .acc-grid{display:grid; grid-template-columns: 1fr; gap: 12px; margin-top: 10px;}
    .acc-box{border-radius: 20px; border: 1px solid var(--line); background: rgba(2,6,23,.03); padding: 14px;}
    .acc-lab{font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: rgba(11,18,32,.62); font-weight: 850; margin-bottom: 8px;}
    .acc-code code{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      color: rgba(11,18,32,.84);
      word-break: break-all;
    }
    .alert{
      display:flex; gap:12px;
      padding: 14px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(2,6,23,.03);
      margin-top: 14px;
      color: rgba(11,18,32,.88);
    }
    .alert-bad{border-color: rgba(217,72,72,.22); background: rgba(217,72,72,.08)}
    .alert-ic .ic{width:18px; height:18px}
    .alert-title{font-weight: 700; font-size: 13px}
    .alert-desc{margin-top:6px; color: rgba(11,18,32,.78); font-size: 13px; line-height: 1.55}
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="gridmask"></div>

  <div class="wrap">
    <div class="hero">
      <div class="hero-top">
        <div class="hgroup">
          <div class="chip">${iconShield("ic")}<span>Receipt Verification</span></div>
          <h1>${escapeHtml(headline)}</h1>
          <div class="sub">${escapeHtml(subhead)}</div>
        </div>
        <div class="hero-right">
          ${topBadges}
        </div>
      </div>
    </div>

    <div class="main">
      <div class="card">
        <div class="card-hd">
          <div class="card-ttl">${iconShield("ic")}<span>Receipt</span></div>
          <div class="card-desc">This page shows proof of participation. It never shows ballot choices.</div>
        </div>
        <div class="card-bd">
          <div class="receipt">
            <div class="img"><img src="${escapeHtml(imageUrl)}" alt="Receipt image" /></div>
            <div class="rmeta">
              <h2>${escapeHtml(metaName)}</h2>
              <p>${escapeHtml(metaDesc)}</p>
              <div class="btnrow">
                ${explorerBtn}
              </div>
            </div>
          </div>

          <div class="steps">
            ${pill(stepReceipt, "Receipt token verified", "Confirmed on Polygon Amoy (cannot be altered)")}
            ${pill(stepDetails, "Receipt details confirmed", "Issued by BotoVeritas (metadata loaded)")}
            ${pill(stepAudit, "Recorded in final audit", hasVoteId ? "We can confirm that your vote is on the official list used to count the results" : "Not available for this receipt")}
          </div>

          <details class="acc" style="margin-top:14px">
            <summary class="acc-sum">
              <div>
                <div class="acc-title">What does “Recorded in final audit” mean?</div>
                <div class="acc-sub">A simple explanation (no blockchain background needed)</div>
              </div>
              <span class="acc-tag">Expand</span>
            </summary>
            <div class="acc-bd">
              <div class="acc-grid">
                <div class="acc-box">
                  <div class="acc-lab">In plain language</div>
                  <div class="acc-code"><code>If your receipt has an audit code, we can confirm your vote is included in the official data used to compute the final results.</code></div>
                </div>
                <div class="acc-box">
                  <div class="acc-lab">Privacy</div>
                  <div class="acc-code"><code>This confirms inclusion only. It does not reveal who you voted for.</code></div>
                </div>
              </div>
            </div>
          </details>

          ${techDetails}
          ${notes}

          <div class="returnbar" role="note" aria-label="Return to Home">
            <div class="returnleft">
              <div class="returnttl">Return to Home</div>
              <div class="returndesc">For kiosk safety, this page will automatically return.</div>
            </div>

            <div class="timerwrap" aria-label="Auto return timer">
              <div class="timerbig"><span id="bvTimer">40</span>s</div>
              <div class="timerunit">until auto-return</div>
            </div>

            <div class="progress" aria-hidden="true"><div id="bvBar"></div></div>

            <a class="btn btn-home" href="/">${iconCheck("ic")}<span>Go to Home</span></a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function(){
      var total = 40;
      var s = total;
      var timerEl = document.getElementById('bvTimer');
      var barEl = document.getElementById('bvBar');
      function render(){
        if (timerEl) timerEl.textContent = String(s);
        if (barEl) barEl.style.width = Math.max(0, Math.min(100, (s/total)*100)) + '%';
      }
      render();
      var t = setInterval(function(){
        s -= 1;
        render();
        if (s <= 0){
          clearInterval(t);
          window.location.href = '/';
        }
      }, 1000);
    })();
  </script>
</body>
</html>`;
}

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

      try {
        tokenUri = await c.tokenURI(tokenIdBI);
      } catch {
        tokenUri = null;
      }
    } catch (e) {
      nftOk = false;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Pull metadata from our own endpoint so local/prod are consistent.
  let meta: Meta | null = null;
  try {
    const metaUrl = `${origin}/api/nft/${tokenIdBI.toString()}`;
    const m = await fetchJsonSafe(metaUrl);
    if (m.ok && m.json && typeof m.json === "object") meta = m.json as Meta;
    else errors.push(`Metadata fetch failed (${m.status}).`);
  } catch (e) {
    errors.push(`Metadata fetch error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Inclusion verification (optional, only if voteId present)
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
        try {
          j = JSON.parse(text);
        } catch {
          j = null;
        }

        if (!r.ok) {
          inclusion = { ok: false, msg: `verify-vote-inclusion failed (${r.status})` };
          errors.push(
            `verify-vote-inclusion failed (${r.status}): ${
              typeof text === "string" ? text.slice(0, 240) : ""
            }`,
          );
        } else {
          const verified = Boolean((j as { verified?: unknown } | null)?.verified);
          inclusion = { ok: true, verified };
        }
      } catch (e) {
        inclusion = { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(
    htmlPage({
      tokenId: tokenIdBI.toString(),
      origin,
      nftOk,
      owner,
      tokenUri,
      meta,
      inclusion,
      errors,
    }),
  );
}
