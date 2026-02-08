import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Auditor-facing vote inclusion verifier (serverless HTML page)
 *
 * Route (recommended):
 *   /verify/vote/:voteId  -> /api/verify/vote/[voteId].ts?voteId=:voteId
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
 *
 * Optional (for on-chain anchor link display):
 * - ELECTION_ROOT_ANCHOR_ADDRESS (or VITE_ELECTION_ROOT_ANCHOR_ADDRESS)
 */

const BASE_SITE = "https://botoveritas.info";

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function originFromReq(req: VercelRequest) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0].trim();
  if (!host) return BASE_SITE;
  return `${proto}://${host}`;
}

function envAny(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return null;
}

function shortText(s: string, head = 12, tail = 12) {
  if (!s) return "";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

type VerifyResp = {
  ok: boolean;
  verified?: boolean;

  voteId?: string;
  electionId?: string;
  specVersion?: string;
  chunkSize?: number;

  leafIndex?: number;
  chunkIndex?: number;
  indexInChunk?: number;

  leaf?: string;
  expectedChunkRoot?: string;
  computedChunkRoot?: string;

  computedElectionRoot?: string;
  anchoredElectionRoot?: string;
  anchoredMatches?: boolean;

  receiptTokenId?: string | null;
  receiptTxHash?: string | null;

  details?: Record<string, unknown>;

  error?: string;
  detailsError?: string;
};

type StepState = "ok" | "bad" | "warn";

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
function iconCopy(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 8h10v12H8z" stroke="currentColor" stroke-width="1.8" />
    <path d="M6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}
function iconInfo(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10z" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 16v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 8h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
function iconExternal(cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14 3h7v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M10 14L21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function statusBadge(kind: StepState, label: string) {
  const cls =
    kind === "ok"
      ? "badge badge-good"
      : kind === "bad"
      ? "badge badge-bad"
      : "badge badge-warn";

  const icon = kind === "ok" ? iconCheck() : kind === "bad" ? iconX() : iconInfo();
  return `<span class="${cls}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

function pill(kind: StepState, title: string, subtitle: string) {
  const bar = kind === "ok" ? "bar-ok" : kind === "bad" ? "bar-bad" : "bar-warn";
  const icon =
    kind === "ok"
      ? iconCheck("pill-ic ic-ok")
      : kind === "bad"
      ? iconX("pill-ic ic-bad")
      : iconInfo("pill-ic ic-warn");

  const right =
    kind === "ok"
      ? `<span class="tag tag-ok">${iconCheck("tag-ic ic-ok")}<span>Verified</span></span>`
      : kind === "bad"
      ? `<span class="tag tag-bad">${iconX("tag-ic ic-bad")}<span>Failed</span></span>`
      : `<span class="tag tag-warn">${iconInfo("tag-ic ic-warn")}<span>Unavailable</span></span>`;

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

function statCard(label: string, value: string, copyValue?: string, rightHtml?: string) {
  const val = value ? escapeHtml(value) : "—";
  const copyBtn = copyValue
    ? `<button class="iconbtn" data-copy="${escapeHtml(copyValue)}" title="Copy">${iconCopy("ic")}</button>`
    : "";
  const right = rightHtml ? rightHtml : "";
  return `<div class="stat">
    <div class="stat-in">
      <div class="stat-lab">${escapeHtml(label)}</div>
      <div class="stat-val"><code>${val}</code></div>
      <div class="stat-actions">${copyBtn}${right}</div>
    </div>
  </div>`;
}

function htmlPage(p: { origin: string; voteId: string; data: VerifyResp | null; errMsg: string | null }) {
  const ok = Boolean(p.data?.ok);
  const verified = Boolean(p.data?.verified);

  const headline = !ok ? "Verification Unavailable" : verified ? "Vote Verified" : "Vote Not Verified";
  const subhead = !ok
    ? "We could not reach the verifier or it is not configured."
    : verified
    ? "This vote is proven to be included in the final dataset used to compute results."
    : "This vote could not be proven to be included in the final dataset used to compute results.";

  const anchored = p.data?.anchoredMatches;
  const anchoredKind: StepState = anchored === true ? "ok" : anchored === false ? "bad" : "warn";
  const statusKind: StepState = !ok ? "bad" : verified ? "ok" : "bad";

  const tokenId = p.data?.receiptTokenId || "";
  const backToReceipt = tokenId ? `${p.origin}/verify/nft/${tokenId}` : "";

  const txHash = p.data?.receiptTxHash || "";
  const explorerBase = "https://amoy.polygonscan.com";
  const explorerTx = txHash ? `${explorerBase}/tx/${txHash}` : "";

  const electionId = p.data?.electionId || "";
  const spec = p.data?.specVersion || "";

  const contractAddress = (
    process.env.ELECTION_ROOT_ANCHOR_ADDRESS ||
    process.env.VITE_ELECTION_ROOT_ANCHOR_ADDRESS ||
    ""
  ).toString();
  const contractLink = contractAddress ? `${explorerBase}/address/${contractAddress}` : "";

  const step1: StepState =
    p.data?.expectedChunkRoot && p.data?.computedChunkRoot
      ? p.data.expectedChunkRoot === p.data.computedChunkRoot
        ? "ok"
        : "bad"
      : "warn";
  const step2: StepState = p.data?.computedElectionRoot ? "ok" : "warn";
  const step3: StepState = anchoredKind;

  const topBadges = [
    statusBadge(statusKind, statusKind === "ok" ? "Verified" : "Not Verified"),
    statusBadge(
      anchoredKind,
      anchoredKind === "ok"
        ? "Anchored Root Matches"
        : anchoredKind === "bad"
        ? "Anchored Root Mismatch"
        : "Anchor Unavailable",
    ),
  ].join("");

  const notes = p.errMsg
    ? `<div class="alert alert-bad">
         <div class="alert-ic">${iconX("ic")}</div>
         <div>
           <div class="alert-title">Notes</div>
           <div class="alert-desc">${escapeHtml(p.errMsg)}</div>
         </div>
       </div>`
    : "";

  const errorBlock =
    !ok && p.data?.error
      ? `<div class="alert alert-bad" style="margin-top:0">
           <div class="alert-ic">${iconX("ic")}</div>
           <div>
             <div class="alert-title">Verification Error</div>
             <div class="alert-desc">${escapeHtml(p.data.error)}</div>
           </div>
         </div>`
      : "";

  const explorerBtn = explorerTx
    ? `<a class="btn btn-ghost" href="${escapeHtml(explorerTx)}" target="_blank" rel="noreferrer">
        ${iconExternal("ic")}<span>View Tx on PolygonScan</span>
      </a>`
    : "";

  const openContractBtn = contractLink
    ? `<button class="iconbtn" id="openContract" title="Open anchor contract on Polygonscan">${iconExternal("ic")}</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vote Verification • BotoVeritas</title>
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
      background: linear-gradient(180deg, rgba(11,107,58,.06) 0%, #ffffff 38%, #ffffff 100%);
      min-height: 100vh;
    }
    .bg{
      position: fixed;
      inset: 0;
      pointer-events:none;
      background:
        radial-gradient(1100px 620px at 50% -140px, rgba(11,107,58,.14), transparent 70%),
        radial-gradient(920px 560px at 10% -120px, rgba(201,162,39,.14), transparent 68%),
        radial-gradient(900px 540px at 110% 10%, rgba(11,107,58,.08), transparent 64%),
        radial-gradient(900px 540px at -10% 38%, rgba(201,162,39,.08), transparent 62%);
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
      opacity: .11;
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
      max-width: 760px;
    }
    .hero-right{
      display:flex; gap:10px; align-items:center; flex-wrap:wrap;
      margin-top: 6px;
      justify-content:flex-end;
    }
    .badge{
      display:inline-flex; align-items:center; gap:8px;
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 650;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.82);
      box-shadow: 0 16px 40px rgba(2,6,23,.10);
      backdrop-filter: blur(12px);
      white-space: nowrap;
      color: rgba(11,18,32,.88);
    }
    .badge .ic{width:16px; height:16px}
    .badge-good{border-color: rgba(11,107,58,.28); background: rgba(11,107,58,.08); color: rgba(11,107,58,.96)}
    .badge-warn{border-color: rgba(201,162,39,.30); background: rgba(201,162,39,.10); color: rgba(128,92,0,.96)}
    .badge-bad{border-color: rgba(217,72,72,.28); background: rgba(217,72,72,.10); color: rgba(150,25,25,.96)}

    .main{display:grid; grid-template-columns:1fr; gap:16px; padding-top: 18px;}
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
      font-weight: 650;
      letter-spacing: .2px;
      color: rgba(11,18,32,.92);
    }
    .card-ttl .ic{width:18px; height:18px; color: rgba(11,107,58,.92)}
    .card-desc{margin-top:6px; color: rgba(11,18,32,.70); font-size: 13px; line-height: 1.5;}
    .card-bd{padding: 18px}

    .inputrow{display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top: 10px;}
    .inwrap{position:relative; flex:1; min-width: 280px;}
    .inwrap .ic{position:absolute; left:14px; top:50%; transform: translateY(-50%); width:18px; height:18px; color: rgba(11,18,32,.55); pointer-events:none;}
    input[type="text"]{
      width:100%; height:48px; border-radius:14px;
      border:1px solid var(--line);
      background: rgba(255,255,255,.90);
      color: rgba(11,18,32,.92);
      padding:0 14px 0 44px;
      outline:none;
      font-size: 13px; font-weight: 650;
      transition:.15s ease;
      box-shadow: 0 12px 30px rgba(2,6,23,.06);
    }
    input[type="text"]:focus{
      border-color: rgba(11,107,58,.28);
      box-shadow: 0 0 0 6px rgba(11,107,58,.10);
    }

    a.btn, button.btn{
      appearance:none; border:none;
      display:inline-flex; align-items:center; gap:10px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.88);
      color: rgba(11,18,32,.90);
      text-decoration:none;
      font-weight: 650;
      font-size: 13px;
      transition: .15s ease;
      cursor:pointer;
    }
    a.btn:hover, button.btn:hover{background: rgba(255,255,255,.96)}
    .btn .ic{width:16px; height:16px}
    .btn-primary{
      background: linear-gradient(90deg, rgba(11,107,58,.92), rgba(11,107,58,.80));
      border-color: rgba(11,107,58,.30);
      color: #ffffff;
      box-shadow: 0 16px 40px rgba(11,107,58,.16);
    }
    .btn-primary:hover{filter: brightness(1.02)}
    .btn-ghost{background: rgba(255,255,255,.86)}
    button.btn[disabled]{opacity:.55; cursor:not-allowed}

    .steps{display:grid; grid-template-columns:1fr; gap:12px; margin-top:14px;}
    @media (min-width: 900px){ .steps{grid-template-columns: repeat(3,1fr);} }
    .pill{
      position:relative; overflow:hidden;
      border-radius:22px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.84));
      box-shadow: 0 16px 40px rgba(2,6,23,.10);
    }
    .pill-bar{position:absolute; left:0; top:0; bottom:0; width:4px; opacity:.95;}
    .bar-ok{background: linear-gradient(180deg, rgba(11,107,58,.65), rgba(11,107,58,1))}
    .bar-bad{background: linear-gradient(180deg, rgba(217,72,72,.65), rgba(217,72,72,1))}
    .bar-warn{background: linear-gradient(180deg, rgba(201,162,39,.65), rgba(201,162,39,1))}
    .pill-in{padding: 16px 16px 14px 18px;}
    .pill-top{display:flex; align-items:center; justify-content:space-between; gap:12px}
    .pill-left{display:flex; align-items:center; gap:10px}
    .pill-ic{width: 18px; height:18px}
    .pill-title{font-size:13px; font-weight: 650; color: rgba(11,18,32,.92);}
    .pill-sub{margin-top:8px; color: rgba(11,18,32,.68); font-size:12px; padding-left:28px; line-height: 1.35;}
    .tag{
      display:inline-flex; align-items:center; gap:8px;
      padding: 8px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.86);
      white-space: nowrap;
      color: rgba(11,18,32,.80);
    }
    .tag .tag-ic{width:14px; height:14px}
    .tag-ok{border-color: rgba(11,107,58,.28); background: rgba(11,107,58,.08); color: rgba(11,107,58,.96)}
    .tag-warn{border-color: rgba(201,162,39,.30); background: rgba(201,162,39,.10); color: rgba(128,92,0,.96)}
    .tag-bad{border-color: rgba(217,72,72,.28); background: rgba(217,72,72,.10); color: rgba(150,25,25,.96)}

    .stats{display:grid; grid-template-columns:1fr; gap:12px;}
    @media (min-width: 900px){ .stats{grid-template-columns: repeat(2,1fr);} }
    .stat{
      border-radius:22px;
      border: 1px solid var(--line);
      background: rgba(2,6,23,.03);
      box-shadow: 0 16px 40px rgba(2,6,23,.08);
      overflow:hidden;
    }
    .stat-in{
      padding: 14px;
      display:grid;
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      gap: 10px 12px;
      align-items:start;
    }
    .stat-lab{
      grid-column: 1 / span 2;
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: rgba(11,18,32,.62);
      font-weight: 650;
    }
    .stat-val code{
      display:block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      font-weight: 650;
      color: rgba(11,18,32,.84);
      word-break: break-all;
    }
    .stat-actions{display:flex; gap:8px; align-items:center; justify-content:flex-end;}
    .iconbtn{
      width: 40px; height: 40px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.88);
      color: rgba(11,107,58,.92);
      display:grid; place-items:center;
      cursor:pointer;
      transition:.15s ease;
    }
    .iconbtn:hover{background: rgba(255,255,255,.96)}
    .iconbtn .ic{width:18px; height:18px}

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
      cursor:pointer; padding:16px 16px;
      display:flex; align-items:center; justify-content:space-between; gap:12px;
    }
    .acc-title{font-size: 13px; font-weight: 650; color: rgba(11,18,32,.92);}
    .acc-sub{margin-top:4px; font-size: 12px; color: rgba(11,18,32,.62);}
    .acc-tag{
      display:inline-flex;
      padding: 8px 10px;
      border-radius: 999px;
      background: rgba(11,107,58,.06);
      border: 1px solid rgba(11,107,58,.18);
      color: rgba(11,107,58,.92);
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .acc-bd{padding: 0 16px 16px;}
    .acc-grid{display:grid; grid-template-columns:1fr; gap:12px; margin-top:10px;}
    .acc-box{
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(2,6,23,.03);
      padding: 14px;
    }
    .acc-lab{
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: rgba(11,18,32,.62);
      font-weight: 650;
      margin-bottom: 8px;
    }
    .acc-code{font-size: 13px; color: rgba(11,18,32,.78); line-height: 1.55;}

    .alert{display:flex; gap:12px; padding: 14px; border-radius:20px; border:1px solid var(--line); background: rgba(2,6,23,.03); margin-top:14px;}
    .alert-bad{border-color: rgba(217,72,72,.22); background: rgba(217,72,72,.08)}
    .alert-ic .ic{width:18px; height:18px}
    .alert-title{font-weight: 650; font-size: 13px}
    .alert-desc{margin-top:6px; color: rgba(11,18,32,.78); font-size: 13px; line-height:1.55}

    .toast{
      position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
      background: rgba(255,255,255,.92);
      border: 1px solid var(--line);
      color: rgba(11,18,32,.92);
      padding: 10px 12px; border-radius: 14px;
      box-shadow: var(--shadow); font-size: 13px;
      opacity: 0; pointer-events: none; transition: .18s ease;
      max-width: 92vw; display:flex; gap:10px; align-items:center;
      backdrop-filter: blur(10px);
    }
    .toast.show{opacity:1; transform: translateX(-50%) translateY(-2px);}
    .toast b{font-weight: 650}
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="gridmask"></div>

  <div class="wrap">
    <div class="hero">
      <div class="hero-top">
        <div class="hgroup">
          <div class="chip">${iconShield("ic")}<span>Vote Audit Verification</span></div>
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
          <div class="card-ttl">${iconShield("ic")}<span>Verify Another Vote</span></div>
          <div class="card-desc">Enter a vote ID (UUID) to verify inclusion. No voter identity or choices are shown.</div>
        </div>
        <div class="card-bd">
          <div class="inputrow">
            <div class="inwrap">
              ${iconInfo("ic")}
              <input id="voteInput" type="text" placeholder="e.g. 07e6303a-0608-4d7b-a6be-61ab694e3d1d" value="${escapeHtml(p.voteId)}" />
            </div>
            <button class="btn btn-primary" id="goBtn">${iconShield("ic")}<span>Verify</span></button>
            <button class="btn btn-ghost" id="copyJsonBtn"${ok ? "" : " disabled"}>${iconCopy("ic")}<span>Copy JSON</span></button>
          </div>

          <div class="steps">
            ${pill(step1, "Merkle Inclusion", "Leaf → Chunk Root")}
            ${pill(step2, "Root Computation", "Chunk → Election Root")}
            ${pill(step3, "On-Chain Anchor", "Election Root Anchor")}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-hd">
          <div class="card-ttl">${iconShield("ic")}<span>Verification Details</span></div>
          <div class="card-desc">This page never shows ballot choices. voteId is an audit reference only.</div>
        </div>
        <div class="card-bd">
          ${errorBlock}

          <div class="stats">
            ${statCard("Vote ID", p.data?.voteId || p.voteId, p.data?.voteId || p.voteId)}
            ${statCard("Election ID", electionId || "—", electionId || undefined)}
            ${statCard(
              "Anchored Election Root (On-Chain)",
              p.data?.anchoredElectionRoot ? shortText(p.data.anchoredElectionRoot, 14, 12) : "—",
              p.data?.anchoredElectionRoot || undefined,
              openContractBtn,
            )}
            ${statCard("Leaf Hash", p.data?.leaf ? shortText(p.data.leaf, 14, 12) : "—", p.data?.leaf || undefined)}
            ${statCard("Receipt Token", tokenId ? `#${tokenId}` : "Not found", tokenId || undefined)}
            ${statCard(
              "Receipt Tx",
              txHash ? shortText(txHash, 14, 12) : "Not found",
              txHash || undefined,
              explorerBtn ? `<span style="display:inline-flex">${explorerBtn}</span>` : "",
            )}
          </div>

          <details class="acc" style="margin-top:14px">
            <summary class="acc-sum">
              <div>
                <div class="acc-title">Technical Details</div>
                <div class="acc-sub">Spec version, indices, and roots</div>
              </div>
              <span class="acc-tag">Expand</span>
            </summary>
            <div class="acc-bd">
              <div class="acc-grid">
                <div class="acc-box">
                  <div class="acc-lab">Spec Version</div>
                  <div class="acc-code">${spec ? `<code>${escapeHtml(spec)}</code>` : `<span style="color:rgba(11,18,32,.64)">Unavailable</span>`}</div>
                </div>
                <div class="acc-box">
                  <div class="acc-lab">Chunk / Leaf Indices</div>
                  <div class="acc-code">
                    ${typeof p.data?.chunkIndex === "number" ? `chunkIndex=${p.data.chunkIndex}` : "chunkIndex=—"} •
                    ${typeof p.data?.leafIndex === "number" ? `leafIndex=${p.data.leafIndex}` : "leafIndex=—"} •
                    ${typeof p.data?.indexInChunk === "number" ? `indexInChunk=${p.data.indexInChunk}` : "indexInChunk=—"}
                  </div>
                </div>
                <div class="acc-box">
                  <div class="acc-lab">Election Roots</div>
                  <div class="acc-code">
                    <div>Computed: ${p.data?.computedElectionRoot ? `<code>${escapeHtml(shortText(p.data.computedElectionRoot, 16, 14))}</code>` : "—"}</div>
                    <div style="margin-top:8px">Anchored: ${p.data?.anchoredElectionRoot ? `<code>${escapeHtml(shortText(p.data.anchoredElectionRoot, 16, 14))}</code>` : "—"}</div>
                  </div>
                </div>
                <div class="acc-box">
                  <div class="acc-lab">Chunk Root Verification</div>
                  <div class="acc-code">
                    <div>Expected: ${p.data?.expectedChunkRoot ? `<code>${escapeHtml(shortText(p.data.expectedChunkRoot, 16, 14))}</code>` : "—"}</div>
                    <div style="margin-top:8px">Computed: ${p.data?.computedChunkRoot ? `<code>${escapeHtml(shortText(p.data.computedChunkRoot, 16, 14))}</code>` : "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          </details>

          ${notes}

          <div class="alert" style="margin-top:14px; border-color: rgba(11,107,58,.18); background: rgba(11,107,58,.06)">
            <div class="alert-ic">${iconShield("ic")}</div>
            <div>
              <div class="alert-title">What this proves</div>
              <div class="alert-desc">
                It proves this vote record is part of the exact dataset used to compute the final election root that was anchored on-chain.
                It does not reveal voter identity or ballot choices.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>
    (function(){
      const toast = document.getElementById('toast');
      let t = null;

      function showToast(title, msg){
        if (!toast) return;
        toast.innerHTML = '<b>' + title + '</b><span style="opacity:.85">' + msg + '</span>';
        toast.classList.add('show');
        clearTimeout(t);
        t = setTimeout(()=> toast.classList.remove('show'), 1600);
      }

      async function copyText(txt){
        try{
          if (navigator.clipboard && navigator.clipboard.writeText){
            await navigator.clipboard.writeText(txt);
            return true;
          }
        }catch{}
        try{
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        }catch{ return false; }
      }

      function goVote(){
        const el = document.getElementById('voteInput');
        const v = (el && el.value ? el.value : '').trim();
        if(!v){ showToast('Missing', 'Enter a voteId.'); return; }
        window.location.href = '${escapeHtml(p.origin)}/verify/vote/' + encodeURIComponent(v);
      }

      document.getElementById('goBtn')?.addEventListener('click', goVote);
      document.getElementById('voteInput')?.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter') goVote();
      });

      document.getElementById('copyJsonBtn')?.addEventListener('click', async ()=>{
        const json = ${ok ? JSON.stringify(JSON.stringify(p.data, null, 2)) : "null"};
        if(!json){ showToast('Unavailable', 'No JSON to copy.'); return; }
        const ok2 = await copyText(json);
        showToast(ok2 ? 'Copied' : 'Copy failed', ok2 ? 'Verification JSON copied.' : 'Try selecting and copying manually.');
      });

      document.addEventListener('click', async (e)=>{
        const btn = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
        if (!btn) return;
        const txt = btn.getAttribute('data-copy') || '';
        const ok = await copyText(txt);
        showToast(ok ? 'Copied' : 'Copy failed', ok ? 'Saved to clipboard.' : 'Try selecting and copying manually.');
      });

      const contractLink = ${contractLink ? JSON.stringify(contractLink) : "null"};
      document.getElementById('openContract')?.addEventListener('click', ()=>{
        if(contractLink) window.open(contractLink, '_blank', 'noreferrer');
      });
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Make failures obvious rather than cached.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const voteId = (req.query.voteId ?? "").toString().trim();
  if (!voteId) return res.status(400).send("Missing voteId");

  const origin = originFromReq(req);

  const supabaseUrl = envAny("SUPABASE_URL");
  const anonKey = envAny("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

  let data: VerifyResp | null = null;
  let errMsg: string | null = null;

  if (!supabaseUrl || !anonKey) {
    errMsg = "Missing SUPABASE_URL or SUPABASE_ANON_KEY in server environment.";
    data = { ok: false, error: "Verifier not configured" };
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
        body: JSON.stringify({ voteId }),
      });

      const text = await r.text();
      let j: unknown = null;
      try {
        j = JSON.parse(text);
      } catch {
        j = null;
      }

      if (!r.ok) {
        errMsg = `verify-vote-inclusion failed (${r.status}): ${text.slice(0, 320)}`;
        data = { ok: false, error: "verify-vote-inclusion failed" };
      } else {
        data = j as VerifyResp;
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
      data = { ok: false, error: "Request failed" };
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(htmlPage({ origin, voteId, data, errMsg }));
}
