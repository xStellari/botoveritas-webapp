import { serve } from "std/http/server";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

type Body = {
  voterId: string;
  electionId: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return null;
}

function requireEnvAny(...names: string[]) {
  const v = envAny(...names);
  if (!v) throw new Error(`Missing required secret: ${names.join(" OR ")}`);
  return v;
}

function getKioskHeaders(req: Request) {
  const kioskId = (req.headers.get("x-kiosk-id") || "").trim();
  const kioskSecret = (req.headers.get("x-kiosk-secret") || "").trim();
  return { kioskId, kioskSecret };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}



function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PARTICIPATION_NFT_ABI = [
  // function mintReceipt(address to, bytes32 electionId, bytes32 voterIdHash) external returns (uint256 tokenId)
  "function mintReceipt(address to, bytes32 electionId, bytes32 voterIdHash) external returns (uint256)",
  // event ReceiptMinted(address indexed to, uint256 indexed tokenId, bytes32 indexed electionId, bytes32 voterIdHash)
  "event ReceiptMinted(address indexed to, uint256 indexed tokenId, bytes32 indexed electionId, bytes32 voterIdHash)",
  // Standard ERC721 Transfer (fallback tokenId extraction)
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

function extractTokenIdFromReceiptLogs(opts: {
  receipt: ethers.TransactionReceipt;
  iface: ethers.Interface;
  nftAddress: string;
  recipient: string;
}): string | null {
  const { receipt, iface, nftAddress, recipient } = opts;

  // 1) Preferred: ReceiptMinted event
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "ReceiptMinted") {
        const tid = parsed.args?.tokenId;
        const tokenId = tid?.toString?.() ?? String(tid);
        if (tokenId && tokenId !== "0") return tokenId;
      }
    } catch {
      // ignore non-matching logs
    }
  }

  // 2) Fallback: ERC721 Transfer event on the NFT contract address, minted to recipient
  // Transfer(from=0x0, to=recipient, tokenId=topic3)
  const transferTopic0 = ethers.id("Transfer(address,address,uint256)");
  const toTopic = ethers.zeroPadValue(recipient, 32).toLowerCase();

  for (const log of receipt.logs) {
    try {
      if ((log.address || "").toLowerCase() !== nftAddress.toLowerCase()) continue;
      if (!log.topics || log.topics.length < 4) continue;
      if ((log.topics[0] || "").toLowerCase() !== transferTopic0.toLowerCase()) continue;

      const fromTopic = (log.topics[1] || "").toLowerCase();
      const toTopicLogged = (log.topics[2] || "").toLowerCase();
      if (!fromTopic.endsWith("0000000000000000000000000000000000000000")) continue;
      if (toTopicLogged !== toTopic) continue;

      const tokenIdHex = log.topics[3];
      if (!tokenIdHex) continue;
      const tokenId = BigInt(tokenIdHex).toString();
      if (tokenId && tokenId !== "0") return tokenId;
    } catch {
      // ignore
    }
  }

  return null;
}

serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const supabaseUrl = requireEnvAny("SUPABASE_URL");
    const serviceRole = requireEnvAny("SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });

    // Validate kiosk identity using kiosk_devices.
    // kiosk_devices stores only secret hashes (secret_sha256), not the plaintext secret.
    const { kioskId, kioskSecret } = getKioskHeaders(req);
    if (!kioskId || !kioskSecret) {
      return json(401, { error: "Unauthorized" });
    }

    const secretSha = await sha256Hex(kioskSecret);

    const { data: kioskRow, error: kioskErr } = await supabase
      .from("kiosk_devices")
      .select("kiosk_id")
      .eq("kiosk_id", kioskId)
      .eq("secret_sha256", secretSha)
      .eq("is_approved", true)
      .is("revoked_at", null)
      .maybeSingle();

    if (kioskErr || !kioskRow) {
      return json(401, { error: "Unauthorized" });
    }

    const body = (await req.json().catch(() => null)) as Partial<Body> | null;
    const voterId = typeof body?.voterId === "string" ? body.voterId : "";
    const electionId = typeof body?.electionId === "string" ? body.electionId : "";

    if (!voterId || !electionId || !isUuid(voterId) || !isUuid(electionId)) {
      return json(400, { error: "Invalid voterId or electionId" });
    }

    // 1) Verify votes exist (truth-first)
    const { count: voteCount, error: votesErr } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("voter_id", voterId)
      .eq("election_id", electionId);

    if (votesErr) {
      return json(500, { error: "Failed to verify votes", details: votesErr.message });
    }

    if (!voteCount || voteCount <= 0) {
      return json(409, {
        error: "No votes found for this voter/election",
        hint: "Ensure vote rows were inserted into public.votes before creating a receipt.",
      });
    }

    // 2) Idempotency: reuse existing receipt if present
    const { data: statusRow, error: statusErr } = await supabase
      .from("voter_election_status")
      .select("id, has_voted, tx_hash, nft_token_id")
      .eq("voter_id", voterId)
      .eq("election_id", electionId)
      .maybeSingle();

    if (statusErr) {
      return json(500, {
        error: "Failed to load voter election status",
        details: statusErr.message,
      });
    }

    const explorerBase = envAny("AMOY_EXPLORER_BASE") || "https://amoy.polygonscan.com";

    if (statusRow?.tx_hash && statusRow?.nft_token_id) {
      return json(200, {
        txHash: statusRow.tx_hash,
        tokenId: statusRow.nft_token_id,
        network: "polygon-amoy",
        explorerTxUrl: `${explorerBase}/tx/${statusRow.tx_hash}`,
        reused: true,
        mode: envAny("RECEIPT_MODE") || "mock",
      });
    }

    // 3) Create receipt: MOCK or LIVE
    const mode = (envAny("RECEIPT_MODE") || "mock").toLowerCase();

    if (mode === "live") {
      // Required secrets (you already added these in Supabase)
      const rpcUrl = requireEnvAny("AMOY_RPC_URL");
      const minterPk = requireEnvAny("MINTER_PRIVATE_KEY");
      const nftAddress = requireEnvAny("PARTICIPATION_NFT_ADDRESS");

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(minterPk, provider);
      const recipient = envAny("RECEIPT_NFT_RECIPIENT") || wallet.address;

      // Convert UUID strings to bytes32 for on-chain audit linkage
      const electionIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(electionId));
      const voterIdHash = ethers.keccak256(ethers.toUtf8Bytes(voterId));

      const contract = new ethers.Contract(nftAddress, PARTICIPATION_NFT_ABI, wallet);
      const iface = new ethers.Interface(PARTICIPATION_NFT_ABI);

      let txHash = "";
      let tokenId = "";

      try {
        const tx = await contract.mintReceipt(recipient, electionIdBytes32, voterIdHash);
        txHash = tx.hash;

        const receipt = await tx.wait();
        if (!receipt) {
          return json(502, {
            error: "Mint submitted but no receipt returned",
            txHash,
          });
        }

        const extracted = extractTokenIdFromReceiptLogs({
          receipt,
          iface,
          nftAddress,
          recipient,
        });

        if (!extracted) {
          // Important: do NOT persist unknown tokenId; it breaks metadata verification.
          return json(502, {
            error: "Mint succeeded but tokenId could not be extracted from logs",
            txHash,
            hint:
              "Ensure the NFT contract emits ReceiptMinted or standard ERC721 Transfer. If it does, verify the contract address and ABI.",
          });
        }

        tokenId = extracted;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json(500, {
          error: "LIVE mint failed",
          details: msg,
          hint:
            "Check AMOY_RPC_URL, MINTER_PRIVATE_KEY, and that the minter wallet has Amoy test MATIC for gas. Also ensure the contract owner matches the minter wallet.",
        });
      }

      // Persist receipt to voter_election_status
      const { error: upsertErr } = await supabase
        .from("voter_election_status")
        .upsert(
          {
            voter_id: voterId,
            election_id: electionId,
            has_voted: true,
            voted_at: new Date().toISOString(),
            tx_hash: txHash,
            nft_token_id: tokenId,
          },
          { onConflict: "voter_id,election_id" },
        );

      if (upsertErr) {
        return json(500, { error: "Failed to save receipt", details: upsertErr.message });
      }

      return json(200, {
        txHash,
        tokenId,
        network: "polygon-amoy",
        explorerTxUrl: `${explorerBase}/tx/${txHash}`,
        reused: false,
        mode,
      });
    }

    // MOCK mode (current fallback)
    const txHash = `0x${randomHex(32)}`;
    // Avoid collisions: use epoch seconds + random suffix
    // NOTE: mock tokenId is NOT an on-chain tokenId; intended only for offline dev/testing.
    const tokenId = `${Math.floor(Date.now() / 1000)}-${randomHex(4)}`;

    // Persist receipt to voter_election_status
    const { error: upsertErr } = await supabase
      .from("voter_election_status")
      .upsert(
        {
          voter_id: voterId,
          election_id: electionId,
          has_voted: true,
          voted_at: new Date().toISOString(),
          tx_hash: txHash,
          nft_token_id: tokenId,
        },
        { onConflict: "voter_id,election_id" },
      );

    if (upsertErr) {
      return json(500, { error: "Failed to save receipt", details: upsertErr.message });
    }

    return json(200, {
      txHash,
      tokenId,
      network: "polygon-amoy",
      explorerTxUrl: `${explorerBase}/tx/${txHash}`,
      reused: false,
      mode,
    });
  } catch (e) {
    console.error("create-vote-receipt error:", e);
    return json(500, {
      error: "Unexpected error",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
