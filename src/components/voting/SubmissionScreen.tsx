import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, Mail } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import type { VoterData, CandidateSelection } from "@/pages/VotingKiosk";
import { supabase } from "@/integrations/supabase/client";
import Confetti from "react-confetti";

interface SubmissionScreenProps {
  voterData: VoterData;
  selections: CandidateSelection[];
  transactionHash: string;
  onComplete: (txHash: string) => void;
  onReset: () => void;
  isComplete: boolean;
}

type SubmissionStep = "encrypting" | "recording" | "minting" | "email" | "complete";

type ReceiptItem = {
  position: string;
  choiceName: string; // masked candidate name or "ABSTAIN"
  choiceId?: string | null;
  isAbstain?: boolean;
};

type MintReceiptResult = {
  electionId: string;
  electionName?: string;
  txHash: string;
  tokenId?: string;
  reused?: boolean;
  mode?: string;
  explorerTxUrl?: string;
};

const AMOY_POLYGONSCAN_TX_BASE = "https://amoy.polygonscan.com/tx/";
// Give voters enough time to read receipt details on-screen before auto-reset.
const RESET_SECONDS = 90;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const maskWord = (word: string) => {
  const w = word.trim();
  if (!w) return w;
  if (w.length <= 2) return w[0] + "*";
  return `${w[0]}${"*".repeat(Math.min(6, w.length - 2))}${w[w.length - 1]}`;
};

const maskCandidateName = (name: string) => {
  const upper = name.trim().toUpperCase();
  if (upper === "ABSTAIN") return "ABSTAIN";
  return name
    .split(" ")
    .map((w) => maskWord(w))
    .join(" ");
};

const extractTxHash = (payload: any): string | null => {
  if (!payload) return null;
  if (typeof payload === "string" && payload.startsWith("0x")) return payload;

  const direct =
    payload?.txHash ??
    payload?.transactionHash ??
    payload?.hash ??
    payload?.data?.txHash ??
    payload?.data?.transactionHash ??
    payload?.data?.hash ??
    payload?.result?.txHash ??
    payload?.result?.transactionHash ??
    payload?.result?.hash;

  if (typeof direct === "string" && direct.startsWith("0x")) return direct;
  return null;
};

// ✅ Normalize tokenId so email verification links always work (string numeric expected)
const normalizeTokenId = (v: unknown): string | undefined => {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

const SubmissionScreen = ({
  voterData,
  selections,
  transactionHash,
  onComplete,
  onReset,
  isComplete,
}: SubmissionScreenProps) => {
  const [currentStep, setCurrentStep] = useState<SubmissionStep>("encrypting");
  const [mintedReceipts, setMintedReceipts] = useState<MintReceiptResult[]>([]);
  const [countdown, setCountdown] = useState(RESET_SECONDS);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [receiptStatus, setReceiptStatus] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle"
  );

  const startedRef = useRef(false);

  // ✅ Gate the final success screen so it doesn't appear unless voter taps Continue
  const [showSuccess, setShowSuccess] = useState(false);
  // ✅ Prevent accidental taps by briefly disabling Continue once it appears
  const [canContinue, setCanContinue] = useState(false);

  const uniqueElections = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const s of selections) {
      if (s?.electionId) map.set(s.electionId, s.electionName);
    }
    return Array.from(map.entries()).map(([electionId, electionName]) => ({
      electionId,
      electionName,
    }));
  }, [selections]);

  const computedElectionTitle = useMemo(() => {
    const titles = new Set<string>();
    for (const s of selections) {
      if (s?.electionName) titles.add(s.electionName);
    }
    const list = Array.from(titles);
    if (list.length === 1) return list[0];
    if (list.length > 1) return "Multiple Elections";
    return "Election";
  }, [selections]);

  const buildReceiptItems = (): ReceiptItem[] => {
    const hasMultiple = uniqueElections.length > 1;

    return selections.map((sel) => {
      const isAbstain =
        sel.candidateId === "ABSTAIN" || sel.candidateName?.toUpperCase?.() === "ABSTAIN";

      const maskedName = isAbstain ? "ABSTAIN" : maskCandidateName(sel.candidateName ?? "—");

      const positionLabel = hasMultiple
        ? `${sel.electionName ?? "Election"} • ${sel.position}`
        : sel.position;

      return {
        position: positionLabel,
        choiceName: maskedName,
        choiceId: isAbstain ? null : (sel.candidateId ?? null),
        isAbstain,
      };
    });
  };

  // -------------------------------
  // Main pipeline (real on-chain mint)
  // -------------------------------
  useEffect(() => {
    const getKioskHeaders = (): Record<string, string> | undefined => {
      // Prefer provisioned kiosk identity in localStorage; fall back to env for local dev.
      // NOTE: Some parts of the codebase previously used botoveritas_* keys.
      const readLS = (key: string) => {
        try {
          return (localStorage.getItem(key) || "").trim();
        } catch {
          return "";
        }
      };

      const kioskId =
        readLS("kiosk_id") ||
        readLS("botoveritas_kiosk_id") ||
        (import.meta.env.VITE_KIOSK_ID as string | undefined)?.trim() ||
        "";

      const kioskSecret =
        readLS("kiosk_secret") ||
        readLS("botoveritas_kiosk_secret") ||
        (import.meta.env.VITE_KIOSK_SECRET as string | undefined)?.trim() ||
        "";

      if (!kioskSecret) return undefined;

      // Always send secret; send kiosk id when available.
      return kioskId
        ? { "x-kiosk-secret": kioskSecret, "x-kiosk-id": kioskId }
        : { "x-kiosk-secret": kioskSecret };
    };

    const run = async () => {
      if (isComplete) return;
      if (startedRef.current) return;
      startedRef.current = true;

      setErrorMessage("");
      setMintedReceipts([]);
      setReceiptStatus("idle");
      setShowSuccess(false);
      setCanContinue(false);

      try {
        setCurrentStep("encrypting");
        await sleep(700);

        setCurrentStep("recording");
        await sleep(700);

        setCurrentStep("minting");
        const kioskHeaders = getKioskHeaders();


        if (!uniqueElections.length) {
          throw new Error("No electionId found in selections. Cannot mint receipt.");
        }

        const minted: MintReceiptResult[] = [];

        for (const e of uniqueElections) {
          const requestBody = { voterId: voterData.id, electionId: e.electionId };

          const { data, error } = await supabase.functions.invoke("create-vote-receipt", {
            body: requestBody,
            headers: kioskHeaders,
          });

          if (error) {
            console.error("create-vote-receipt invoke error:", {
              message: error.message,
              name: (error as any).name,
              context: (error as any).context,
              details: (error as any).details,
              requestBody,
            });

            throw new Error(
              (error.message || "Mint failed.") +
                "\n\ncreate-vote-receipt returned an error. Most common causes: (1) missing/invalid x-kiosk-secret header, (2) votes not yet inserted for this voter/election (function returns 409), or (3) invalid voterId/electionId."
            );
          }

          const txHash = extractTxHash(data);
          if (!txHash) {
            console.error("create-vote-receipt success but missing txHash. Raw data:", data);
            throw new Error(
              "Mint succeeded but the function response did not include a txHash (expected txHash/transactionHash/hash)."
            );
          }

          const explorerTxUrl = (data as any)?.explorerTxUrl || `${AMOY_POLYGONSCAN_TX_BASE}${txHash}`;

          // ✅ Ensure tokenId is always string (email verification expects numeric string)
          const tokenId = normalizeTokenId((data as any)?.tokenId);

          minted.push({
            electionId: e.electionId,
            electionName: e.electionName,
            txHash,
            tokenId,
            reused: (data as any)?.reused,
            mode: (data as any)?.mode,
            explorerTxUrl,
          });
        }

        setMintedReceipts(minted);

        setCurrentStep("email");
        setReceiptStatus("sending");

        // Email is best-effort; do not block completion if it fails
        try {
          const receiptItems = buildReceiptItems();
          const primary = minted[0];

          await supabase.functions.invoke("send-vote-receipt-email", {
            body: {
              toEmail: voterData.email,
              voterName: `${voterData.first_name} ${voterData.last_name}`.trim() || undefined,
              electionTitle: computedElectionTitle,
              votedAt: new Date().toISOString(),
              receiptItems,

              // Backward compatible (single)
              txHash: primary?.txHash,
              explorerUrl: primary?.explorerTxUrl,

              // ✅ NEW: single tokenId fallback (so "Verify Vote Receipt" never depends on receipts[])
              tokenId: primary?.tokenId,

              // Forward compatible (multi) - preferred path
              receipts: minted,
            },
          });

          setReceiptStatus("sent");
        } catch (e) {
          console.warn("Vote receipt email failed:", e);
          setReceiptStatus("failed");
        }

        setCurrentStep("complete");
        onComplete(minted[0].txHash);
      } catch (e: any) {
        console.error("Submission pipeline failed:", e);
        setErrorMessage(
          e?.message || "Something went wrong while recording your vote. Please ask a facilitator."
        );
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // -------------------------------
  // Continue safety gate
  // -------------------------------
  useEffect(() => {
    if (!isComplete) return;
    if (showSuccess) return;

    // Briefly disable the Continue button to avoid accidental taps.
    setCanContinue(false);
    const t = setTimeout(() => setCanContinue(true), 2000);
    return () => clearTimeout(t);
  }, [isComplete, showSuccess]);

  // -------------------------------
  // Auto-reset (kiosk safe)
  // -------------------------------
  // ✅ Start the countdown ONLY after the success screen is visible.
  // This prevents the kiosk from feeling like it "rushes" past the receipt details.
  useEffect(() => {
    if (!isComplete) return;
    if (!showSuccess) return;

    setCountdown(RESET_SECONDS);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(timer);
          try {
            window.close();
          } catch {
            // ignore
          }
          onReset();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isComplete, showSuccess, onReset]);

  const getStepStatus = (step: SubmissionStep) => {
    const steps: SubmissionStep[] = ["encrypting", "recording", "minting", "email", "complete"];
    const currentIndex = steps.indexOf(currentStep);
    const stepIndex = steps.indexOf(step);

    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  const StepRow = ({
    step,
    title,
    description,
  }: {
    step: SubmissionStep;
    title: string;
    description: React.ReactNode;
  }) => {
    const status = getStepStatus(step);

    return (
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          {status === "complete" ? (
            <CheckCircle2 className="h-7 w-7 text-success" />
          ) : status === "active" ? (
            <Loader2 className="h-7 w-7 text-primary animate-spin" />
          ) : (
            <div className="h-7 w-7 rounded-full border-2 border-muted" />
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-base">{title}</h3>
            {status === "active" ? (
              <Badge variant="secondary">In progress</Badge>
            ) : status === "complete" ? (
              <Badge className="bg-success/15 text-success border-success/30" variant="outline">
                Done
              </Badge>
            ) : (
              <Badge variant="outline">Queued</Badge>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-1">{description}</div>
        </div>
      </div>
    );
  };

  const ReceiptList = ({ receipts, compact }: { receipts: MintReceiptResult[]; compact?: boolean }) => {
    if (!receipts.length) return null;

    return (
      <div className={compact ? "mt-3" : "mt-4"}>
        <div className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          Vote Receipt Proof ID{receipts.length > 1 ? "s" : ""} (read-only)
        </div>

        <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-4"}>
          {receipts.map((r) => (
            <div
              key={r.electionId}
              className={
                compact
                  ? "rounded-lg border border-border bg-background/60 p-3"
                  : "rounded-lg border border-border bg-background/60 p-4"
              }
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="font-medium text-sm">{r.electionName || "Election"}</div>
                <div className="flex items-center gap-2">
                  {r.reused ? (
                    <Badge variant="outline">Reused</Badge>
                  ) : (
                    <Badge className="bg-success/15 text-success border-success/30" variant="outline">
                      Minted
                    </Badge>
                  )}
                  {r.tokenId ? <Badge variant="secondary">Token #{r.tokenId}</Badge> : null}
                </div>
              </div>

              <div className={compact ? "mt-2" : "mt-3"}>
                <div className="text-[11px] text-muted-foreground">Proof ID</div>
                <div
                  className={
                    compact
                      ? "mt-1 font-mono text-xs break-all select-text"
                      : "mt-1 font-mono text-sm break-all select-text"
                  }
                >
                  {r.txHash}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          External links are disabled on this kiosk. Keep your receipt email to verify later on a personal device.
        </div>
      </div>
    );
  };

  const headerTitle = isComplete
    ? showSuccess
      ? "Vote Recorded Successfully"
      : "Review Your Receipt"
    : "Finalizing Your Vote";

  const headerSubtitle = isComplete
    ? showSuccess
      ? "Your session is complete. A vote receipt was sent to your email."
      : "Review the receipt proof IDs below, then tap Continue."
    : `Please wait. We are generating ${uniqueElections.length || 1} blockchain receipt${
        uniqueElections.length === 1 ? "" : "s"
      }.`;

  return (
    <div className="min-h-screen p-6 flex items-center justify-center relative">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 text-center">
            <img src={feuLogo} alt="FEU" className="h-16 w-auto mx-auto mb-4" />
            <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              {headerTitle}
            </h1>
            <p className="text-muted-foreground mt-2">{headerSubtitle}</p>
          </div>
        </Card>

        {/* Error */}
        {!isComplete && errorMessage ? (
          <Card className="mb-6 border-2 border-red-500/30 bg-red-500/5">
            <div className="p-6 flex gap-4 items-start">
              <AlertTriangle className="h-6 w-6 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-700">Processing Failed</h3>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{errorMessage}</p>
                <div className="mt-4">
                  <Button onClick={onReset} className="bg-gradient-primary hover:opacity-90">
                    Reset Kiosk
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {/* Processing OR "Wrapping up..." (when isComplete just flipped but we delay the final success UI) */}
        {(!isComplete && !errorMessage) || (isComplete && !showSuccess) ? (
          <Card className="mb-6 border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
            <div className="p-8">
              <div className="space-y-6">
                <StepRow
                  step="encrypting"
                  title="Encrypting ballot"
                  description="Applying vote protection before final submission."
                />

                <StepRow
                  step="recording"
                  title="Recording vote"
                  description="Saving your selections securely in the election database."
                />

                <StepRow
                  step="minting"
                  title="Minting blockchain proof"
                  description={
                    <div className="space-y-2">
                      <div>
                        Creating one ERC-721 participation receipt per election on Polygon Amoy.
                      </div>
                      {isComplete && !showSuccess ? (
                        <div className="rounded-lg border border-border bg-background/60 p-4">
                          <div className="font-semibold text-sm">What this receipt means</div>
                          <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                            <li>This is your receipt proof on the blockchain.</li>
                            <li>Keep the email we sent for later verification.</li>
                            <li>Once recorded, it cannot be altered.</li>
                          </ul>
                        </div>
                      ) : null}
                      <ReceiptList receipts={mintedReceipts} compact={!isComplete} />
                    </div>
                  }
                />

                <StepRow
                  step="email"
                  title="Sending verification receipt"
                  description={
                    <div className="flex items-center gap-2 flex-wrap">
                      <Mail className="h-4 w-4" />
                      <span>
                        Sending to <strong>{voterData.email}</strong>
                      </span>
                      {receiptStatus === "sending" ? (
                        <Badge variant="secondary">Sending</Badge>
                      ) : receiptStatus === "sent" ? (
                        <Badge className="bg-success/15 text-success border-success/30" variant="outline">
                          Sent
                        </Badge>
                      ) : receiptStatus === "failed" ? (
                        <Badge variant="destructive">Failed (vote still recorded)</Badge>
                      ) : (
                        <Badge variant="outline">Queued</Badge>
                      )}
                    </div>
                  }
                />

                {/* ✅ subtle "wrapping up" text once complete but before the success screen */}
                {isComplete && !showSuccess ? (
                  <div className="pt-2">
                    <div className="text-sm text-muted-foreground">
                      Please review your receipt details above.
                    </div>

                    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground text-center sm:text-left">
                        Please read this screen before continuing.
                        {!canContinue ? (
                          <span className="block mt-1">Continue will be available in a moment.</span>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        className="bg-gradient-primary hover:opacity-90"
                        disabled={!canContinue}
                        onClick={() => {
                          if (!canContinue) return;
                          setShowSuccess(true);
                        }}
                      >
                        Continue
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}

        {/* Success */}
        {isComplete && showSuccess ? (
          <>
            <Confetti recycle={false} numberOfPieces={300} />

            <Card className="mb-6 border-2 border-success/50 bg-success/5">
              <div className="p-8 text-center">
                <div className="w-20 h-20 mx-auto mb-6 bg-success/10 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-12 w-12 text-success" />
                </div>

                <h2 className="text-2xl font-bold mb-3">Vote Submitted</h2>
                <p className="text-muted-foreground mb-6">
                  Your vote has been recorded. Receipt details were emailed for later verification on your personal device.
                </p>

                {/* Transactions (read-only) */}
                {mintedReceipts.length ? (
                  <div className="text-left">
                    <ReceiptList receipts={mintedReceipts} />
                  </div>
                ) : transactionHash ? (
                  <div className="text-left rounded-lg border border-border bg-background/60 p-4">
                    <div className="text-sm text-muted-foreground">
                      Vote Receipt Proof ID (read-only)
                    </div>
                    <div className="mt-2 font-mono text-xs break-all select-text">{transactionHash}</div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      External links are disabled on this kiosk. Receipt details were sent to your email.
                    </div>
                  </div>
                ) : null}

                

                {/* Highlights */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <div className="bg-card rounded-lg p-4 border border-border text-left">
                    <h3 className="font-semibold mb-2">Security</h3>
                    <p className="text-sm text-muted-foreground">
                      Your ballot is sealed with verifiable proof.
                    </p>
                  </div>
                  <div className="bg-card rounded-lg p-4 border border-border text-left">
                    <h3 className="font-semibold mb-2">Receipt</h3>
                    <p className="text-sm text-muted-foreground">
                      A receipt email was sent to <strong>{voterData.email}</strong>. Candidate names are masked for privacy.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Auto-reset Notice */}
            <Card className="border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
              <div className="p-6 text-center">
                <p className="text-muted-foreground">
                  This kiosk will reset in{" "}
                  <strong className="text-primary text-xl font-mono">{countdown}</strong> seconds.
                  <span className="block text-xs text-muted-foreground mt-1">
                    Please step away after reading this message. The verification details are in your email.
                  </span>
                </p>

                <div className="mt-4">
                  <Button onClick={onReset} className="bg-gradient-primary hover:opacity-90">
                    Ready for Next Voter
                  </Button>
                </div>
              </div>
            </Card>
          </>
        ) : null}

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">Powered by BotoVeritas • Secured by Blockchain Technology</p>
        </div>
      </div>
    </div>
  );
};

export default SubmissionScreen;
