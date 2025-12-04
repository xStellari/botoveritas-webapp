// VotingKiosk.tsx — Final Version (Timer Start on Ballot Click, Timeout Modal, No Floating Timer)

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import AuthenticationScreen from "@/components/voting/AuthenticationScreen";
import ElectionSelection from "@/components/voting/ElectionSelection";
import BallotScreen from "@/components/voting/BallotScreen";
import ReviewScreen from "@/components/voting/ReviewScreen";
import SubmissionScreen from "@/components/voting/SubmissionScreen";
import ElectionFinishedPopup from "@/components/voting/ElectionFinishedPopup";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import type { Tables } from "@/types/supabase";
import { logSessionEvent } from "@/utils/logSessionEvent";
import { SESSION_HEARTBEAT_INTERVAL_MS } from "@/config/kioskConfig";

export type VoterRow = Tables<"voters">;

export interface VoterData extends VoterRow {
  rfidVerified?: boolean;
  faceVerified?: boolean;
}

export type VotingStep =
  | "auth"
  | "election-select"
  | "ballot"
  | "review"
  | "review-final"
  | "submitting"
  | "complete"
  | "election-finished";

export interface CandidateSelection {
  position: string;
  candidateId: string;
  candidateName: string;
  slate: string;
  electionId: string;
  electionName: string; 
}

const VotingKiosk = () => {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<VotingStep>("auth");
  const [voterData, setVoterData] = useState<VoterData | null>(null);

  const [currentSelections, setCurrentSelections] = useState<CandidateSelection[]>([]);
  const [allSelections, setAllSelections] = useState<CandidateSelection[]>([]);

  const [selectedElection, setSelectedElection] = useState<any>(null);
  const [transactionHash, setTransactionHash] = useState("");

  const [completedElections, setCompletedElections] = useState<string[]>([]);
  const [activeElections, setActiveElections] = useState<any[]>([]);
  const [expiredElections, setExpiredElections] = useState<any[]>([]);

  // 🔥 TIMER LOGIC
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  // -----------------------------------------------------
  // AUTH SUCCESS (NO TIMER HERE)
  // -----------------------------------------------------
  const handleAuthSuccess = async (auth: { rfidTag: string }) => {
    const { data: voterRow, error } = await supabase
      .from("voters")
      .select("*")
      .eq("rfid_tag", auth.rfidTag)
      .single();

    if (error || !voterRow) {
      toast.error("Voter not found.");
      return;
    }

    const nowIso = new Date().toISOString();
    const { data: existingSessions } = await supabase
      .from("voter_sessions")
      .select("*")
      .eq("voter_id", voterRow.id)
      .gt("expires_at", nowIso);

    if (existingSessions?.length) {
      navigate("/registration-error", {
        state: {
          title: "Active Voting Session Detected",
          message:
            "There is already an active voting session for this voter. Please wait before trying again.",
        },
      });
      return;
    }

    await logSessionEvent({ voterId: voterRow.id, action: "session_start" });

    const enriched: VoterData = {
      ...voterRow,
      rfidVerified: true,
      faceVerified: true,
    };

    setVoterData(enriched);

    // Load elections
    const { data: elections = [] } = await supabase
      .from("elections")
      .select("*");

    const now = new Date();
    const active = elections.filter((e) => e.is_active && new Date(e.end_date) > now);
    const expired = elections.filter((e) => e.is_active && new Date(e.end_date) <= now);

    setActiveElections(active);
    setExpiredElections(expired);

    if (active.length === 1) {
      handleElectionSelect(active[0].id, active[0]);
    } else {
      setCurrentStep("election-select");
    }
  };

  // -----------------------------------------------------
  // START TIMER ON FIRST BALLOT CLICK
  // -----------------------------------------------------
  const handleElectionSelect = async (electionId: string, electionData: any) => {
    if (voterData && timeLeft === null) {
      const totalMinutes = activeElections.length * 3;
      const totalMs = totalMinutes * 60 * 1000;

      setTimeLeft(totalMs);
      const expiresAt = Date.now() + totalMs;

      await supabase.from("voter_sessions").upsert({
        voter_id: voterData.id,
        expires_at: new Date(expiresAt).toISOString(),
      });
    }

    setSelectedElection({ id: electionId, ...electionData });
    setCurrentSelections([]);
    setCurrentStep("ballot");
  };

  // -----------------------------------------------------
  // HANDLE BALLOT COMPLETION
  // -----------------------------------------------------
  const handleBallotComplete = (selections: CandidateSelection[]) => {
    setCurrentSelections(selections);

    // merge into allSelections
    const filtered = allSelections.filter(
      (s) => s.electionId !== selectedElection.id
    );

    setAllSelections([...filtered, ...selections]);

    setCurrentStep("review");
  };

  // -----------------------------------------------------
  // COUNTDOWN EFFECT
  // -----------------------------------------------------
  useEffect(() => {
    if (timeLeft === null) return;
    if (currentStep === "submitting" || currentStep === "complete") return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;

        if (prev <= 1000) {
          clearInterval(interval);
          
          if (!showTimeoutModal) setShowTimeoutModal(true);
          return prev;
        }

        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, currentStep, voterData]);

  // -----------------------------------------------------
  // FINAL SUBMISSION COMPLETE
  // -----------------------------------------------------
  const handleSubmissionComplete = (txHash: string) => {
    setTransactionHash(txHash);

    const updated = [...completedElections, selectedElection.id];
    setCompletedElections(updated);

    const remaining = activeElections.filter(
      (e) => !updated.includes(e.id)
    );

    if (remaining.length > 0) {
      setCurrentStep("election-finished");
    } else {
      setCurrentStep("review-final");
    }
  };

  // -----------------------------------------------------
  // RESET AFTER FULL VOTING PROCESS
  // -----------------------------------------------------
  const handleReset = async () => {
    if (voterData?.id) {
      await supabase.from("voter_sessions").delete().eq("voter_id", voterData.id);
      await logSessionEvent({ voterId: voterData.id, action: "session_end" });
    }

    setCurrentStep("auth");
    setVoterData(null);
    setCurrentSelections([]);
    setAllSelections([]);
    setTransactionHash("");
    setSelectedElection(null);
    setCompletedElections([]);
    setActiveElections([]);
    setExpiredElections([]);
    setTimeLeft(null);
    setShowTimeoutModal(false);

    navigate("/");
  };

  // -----------------------------------------------------
  // RENDER UI
  // -----------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-400/40 via-white to-yellow-300/40 relative">

      {/* TIMEOUT MODAL */}
      {showTimeoutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-4">
              Warning
            </h2>

            <p className="text-gray-700 mb-6 leading-relaxed">
              Your voting time is up, but don’t worry — we’ve added{" "}
              <strong>1 minute and 30 seconds</strong> so you can finish.<br /> <br />
              <h3 className="text-red-600"><strong>Please try to vote a little faster. </strong></h3>
            </p>

            <button
              onClick={async () => {
                const ext = 89* 1000;
                const newTime = (timeLeft ?? 0) + ext;

                setTimeLeft(newTime);
                setShowTimeoutModal(false);

                if(voterData) {
                  await supabase
                    .from("voter_sessions")
                    .update({
                      expires_at: new Date(Date.now() + newTime).toISOString(),
                    })
                    .eq("voter_id", voterData.id);

                  await logSessionEvent({
                    voterId: voterData.id,
                    action: "session_extend",
                  });
                }
              }}
              className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/80"
              >
                I Understand
            </button>
          </div>
        </div>
      )}

      {/* AUTH */}
      {currentStep === "auth" && (
        <AuthenticationScreen
          onAuthSuccess={handleAuthSuccess}
        />
      )}

      {/* ELECTION SELECT */}
      {currentStep === "election-select" && voterData && (
        <ElectionSelection
          voterData={voterData}
          onElectionSelect={handleElectionSelect}
          completedElections={completedElections}
          activeElections={activeElections}
          expiredElections={expiredElections}
        />
      )}

      {/* BALLOT */}
      {currentStep === "ballot" && voterData && selectedElection && (
        <BallotScreen
          voterData={voterData}
          electionId={selectedElection.id}
          electionData={selectedElection}
          onComplete={handleBallotComplete}
          initialSelections={allSelections.filter(
            (sel) => sel.electionId === selectedElection.id
          )}
          timeLeft={timeLeft ?? 0}
        />
      )}

      {/* SINGLE REVIEW */}
      {currentStep === "review" && voterData && (
        <ReviewScreen
          voterData={voterData}
          selections={currentSelections}
          onConfirm={() => handleSubmissionComplete("pending-hash")}
          onEdit={() => setCurrentStep("ballot")}
          showAll={false}
          timeLeft={timeLeft ?? 0}
          activeElections={activeElections}
          completedElections={completedElections}
        />
      )}

      {/* FINAL REVIEW */}
      {currentStep === "review-final" && voterData && (
        <ReviewScreen
          voterData={voterData}
          selections={allSelections}
          onConfirm={async () => {
            for (const sel of allSelections) {
              await supabase.from("votes").insert({
                election_id: sel.electionId,
                candidate_id: sel.candidateId === "ABSTAIN" ? null : sel.candidateId,
                voter_id: voterData.id,
                is_abstain: sel.candidateId === "ABSTAIN",
              });
            }
            setCurrentStep("submitting");
          }}
          onEdit={() => setCurrentStep("election-select")}
          showAll={true}
          timeLeft={timeLeft ?? 0}
          activeElections={activeElections}
          completedElections={completedElections}
        />
      )}

      {/* SUBMISSION */}
      {currentStep === "submitting" && (
        <SubmissionScreen
          voterData={voterData}
          selections={allSelections}
          transactionHash={transactionHash}
          onComplete={(tx) => {
            setTransactionHash(tx);
            setCurrentStep("complete");
          }}
          onReset={handleReset}
          isComplete={false}
        />
      )}

      {/* COMPLETE */}
      {currentStep === "complete" && (
        <SubmissionScreen
          voterData={voterData}
          selections={allSelections}
          transactionHash={transactionHash}
          onComplete={(tx) => {}}
          onReset={handleReset}
          isComplete={true}
        />
      )}

      {/* AFTER SINGLE BALLOT */}
      {currentStep === "election-finished" && (
        <ElectionFinishedPopup
          hasRemaining={activeElections.length > completedElections.length}
          onContinue={() => {
            if (activeElections.length > completedElections.length) {
              setSelectedElection(null);
              setCurrentSelections([]);
              setCurrentStep("election-select");
            } else {
              setCurrentStep("review-final");
            }
          }}
        />
      )}
    </div>
  );
};

export default VotingKiosk;
