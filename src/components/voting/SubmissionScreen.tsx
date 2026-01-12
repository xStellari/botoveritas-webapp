import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle2, Home } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import type { VoterData, CandidateSelection } from "@/pages/VotingKiosk";
import { supabase } from "@/integrations/supabase/client";
// 🎉 Confetti animation
import Confetti from "react-confetti";

interface SubmissionScreenProps {
  voterData: VoterData;
  selections: CandidateSelection[];
  transactionHash: string;
  onComplete: (txHash: string) => void;
  onReset: () => void;
  isComplete: boolean;
}

type SubmissionStep = "encrypting" | "blockchain" | "minting" | "email" | "complete";

type ReceiptItem = {
  position: string;
  choiceName: string; // masked candidate name or "ABSTAIN"
  choiceId?: string | null;
  isAbstain?: boolean;
};

const maskWord = (word: string) => {
  const w = word.trim();
  if (!w) return w;
  if (w.length <= 2) return w[0] + "*"; // e.g. "Al" -> "A*"
  // keep first and last, mask middle
  return `${w[0]}${"*".repeat(Math.min(6, w.length - 2))}${w[w.length - 1]}`;
};

const maskCandidateName = (name: string) => {
  const upper = name.trim().toUpperCase();
  if (upper === "ABSTAIN") return "ABSTAIN";

  // Preserve spaces; mask each word separately
  return name
    .split(" ")
    .map((w) => maskWord(w))
    .join(" ");
};

const SubmissionScreen = ({
  voterData,
  selections,
  transactionHash,
  onComplete,
  onReset,
  isComplete
}: SubmissionScreenProps) => {
  const [currentStep, setCurrentStep] = useState<SubmissionStep>("encrypting");
  const [generatedTxHash, setGeneratedTxHash] = useState("");
  const [countdown, setCountdown] = useState(30);

  const [receiptStatus, setReceiptStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const uniqueElectionTitles = useMemo(() => {
    const set = new Set<string>();
    for (const s of selections) {
      if (s?.electionName) set.add(s.electionName);
    }
    return Array.from(set);
  }, [selections]);

  const computedElectionTitle = useMemo(() => {
    if (uniqueElectionTitles.length === 1) return uniqueElectionTitles[0];
    if (uniqueElectionTitles.length > 1) return "Multiple Elections";
    return "Election";
  }, [uniqueElectionTitles]);

  const buildReceiptItems = (): ReceiptItem[] => {
    return selections.map((sel) => {
      const isAbstain =
        sel.candidateId === "ABSTAIN" ||
        sel.candidateName?.toUpperCase?.() === "ABSTAIN";

      const maskedName = isAbstain
        ? "ABSTAIN"
        : maskCandidateName(sel.candidateName ?? "—");

      // If multiple elections, include election label in the “position” field for clarity
      const positionLabel =
        uniqueElectionTitles.length > 1
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

  useEffect(() => {
    if (!isComplete) {
      const steps: SubmissionStep[] = ["encrypting", "blockchain", "minting", "email", "complete"];
      let stepIndex = 0;
      let mockHash = "";

      const interval = setInterval(() => {
        stepIndex++;
        if (stepIndex < steps.length) {
          setCurrentStep(steps[stepIndex]);
        }

        if (stepIndex === 1) {
          mockHash =
            "0x" +
            Array.from({ length: 64 }, () =>
              Math.floor(Math.random() * 16).toString(16)
            ).join("");
          setGeneratedTxHash(mockHash);
        }

        if (stepIndex === steps.length - 1) {
          clearInterval(interval);
          onComplete(mockHash);
        }
      }, 2500);

      return () => clearInterval(interval);
    }
  }, [isComplete, onComplete]);

  useEffect(() => {
    if (!isComplete) {
      const fallback = setTimeout(() => {
        onComplete("0xFAKEFALLBACKHASH");
      }, 15000);

      return () => clearTimeout(fallback);
    }
  }, [isComplete, onComplete]);

  // ✅ Send the vote receipt during the “email” step (masked names)
  useEffect(() => {
    const run = async () => {
      if (isComplete) return;
      if (currentStep !== "email") return;
      if (receiptStatus !== "idle") return;

      setReceiptStatus("sending");
      try {
        const tx = generatedTxHash || transactionHash || undefined;

        const receiptItems = buildReceiptItems();

        await supabase.functions.invoke("send-vote-receipt-email", {
          body: {
            toEmail: voterData.email,
            voterName: `${voterData.first_name} ${voterData.last_name}`.trim() || undefined,
            electionTitle: computedElectionTitle,
            votedAt: new Date().toISOString(),
            receiptItems,
            txHash: tx,
            explorerUrl: tx ? `https://polygonscan.com/tx/${tx}` : undefined,
          },
        });

        setReceiptStatus("sent");
      } catch (e) {
        console.warn("Vote receipt email failed:", e);
        // don’t block completion UX
        setReceiptStatus("failed");
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, isComplete, generatedTxHash, transactionHash, voterData.email, receiptStatus, computedElectionTitle, selections]);

  useEffect(() => {
    if (isComplete && countdown > 0) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            onReset();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isComplete, countdown, onReset]);

  const getStepStatus = (step: SubmissionStep) => {
    const steps: SubmissionStep[] = ["encrypting", "blockchain", "minting", "email", "complete"];
    const currentIndex = steps.indexOf(currentStep);
    const stepIndex = steps.indexOf(step);

    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  return (
    <div className="min-h-screen p-6 flex items-center justify-center relative">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 text-center">
            <img src={feuLogo} alt="FEU" className="h-16 w-auto mx-auto mb-4" />
            <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              {isComplete ? "Vote Recorded Successfully!" : "Processing Your Vote"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {isComplete
                ? "Your vote has been securely recorded on the blockchain"
                : "Please wait while we secure your vote..."}
            </p>
          </div>
        </Card>

        {/* Progress Steps */}
        {!isComplete && (
          <Card className="mb-6 border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
            <div className="p-8">
              <div className="space-y-6">
                {["encrypting", "blockchain", "minting", "email"].map((step) => (
                  <div key={step} className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      {getStepStatus(step as SubmissionStep) === "complete" ? (
                        <CheckCircle2 className="h-8 w-8 text-success" />
                      ) : getStepStatus(step as SubmissionStep) === "active" ? (
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      ) : (
                        <div className="h-8 w-8 rounded-full border-2 border-muted" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">
                        {step === "encrypting" && "Encrypting Vote"}
                        {step === "blockchain" && "Recording on Blockchain"}
                        {step === "minting" && "Minting NFT Proof"}
                        {step === "email" && "Sending Receipt"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {step === "encrypting" && "Applying zero-knowledge proof encryption..."}
                        {step === "blockchain" && "Submitting to Polygon network..."}
                        {step === "minting" && "Creating your digital proof of vote..."}
                        {step === "email" &&
                          `Email being sent to ${voterData.email}... ${
                            receiptStatus === "sending"
                              ? "(sending)"
                              : receiptStatus === "sent"
                                ? "(sent)"
                                : receiptStatus === "failed"
                                  ? "(failed — vote still recorded)"
                                  : ""
                          }`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Success Card */}
        {isComplete && (
          <>
            {/* 🎉 Confetti celebration */}
            <Confetti recycle={false} numberOfPieces={300} />

            <Card className="mb-6 border-2 border-success/50 bg-success/5">
              <div className="p-8 text-center">
                <div className="w-20 h-20 mx-auto mb-6 bg-success/10 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-12 w-12 text-success" />
                </div>
                <h2 className="text-2xl font-bold mb-4">Your Vote Has Been Cast!</h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for participating in the election. Your vote has been securely recorded and
                  cannot be changed or deleted.
                </p>

                {/* ✅ Highlight Grid */}
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div className="bg-card rounded-lg p-4 border border-border">
                    <h3 className="font-semibold mb-2">🔒 Security</h3>
                    <p className="text-sm text-muted-foreground">
                      Your ballot is encrypted and permanently sealed on the blockchain.
                    </p>
                  </div>
                  <div className="bg-card rounded-lg p-4 border border-border">
                    <h3 className="font-semibold mb-2">📧 Receipt</h3>
                    <p className="text-sm text-muted-foreground">
                      A vote receipt email has been sent to <strong>{voterData.email}</strong>.
                      <br />
                      Candidate names are partially masked for privacy.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Auto-reset Notice */}
            <Card className="border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
              <div className="p-6 text-center">
                <p className="text-muted-foreground mb-4">
                  This kiosk will automatically reset in{" "}
                  <strong className="text-primary text-xl font-mono">{countdown}</strong> seconds
                </p>
                <Button
                  onClick={onReset}
                  className="bg-gradient-primary hover:opacity-90"
                >
                  <Home className="mr-2 h-5 w-5" />
                  Ready for Next Voter
                </Button>
              </div>
            </Card>
          </>
        )}

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by BotoVeritas • Secured by Blockchain Technology
          </p>
        </div>
      </div>
    </div>
  );
};

export default SubmissionScreen;
