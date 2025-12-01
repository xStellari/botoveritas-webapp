import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import AuthenticationScreen from "@/components/voting/AuthenticationScreen";
import BallotScreen from "@/components/voting/BallotScreen";
import ReviewScreen from "@/components/voting/ReviewScreen";
import SubmissionScreen from "@/components/voting/SubmissionScreen";
import ElectionSelection from "@/components/voting/ElectionSelection";
import ElectionFinishedPopup from "@/components/voting/ElectionFinishedPopup";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/types/supabase";
import { toast } from "sonner";

// ----------------------------------
// SIMPLE KIOSK CONFIG (NO URL PARAMS)
// ----------------------------------
const KIOSK_ID = "KIOSK"; // only used to fill the NOT NULL column in DB
const KIOSK_SESSION_MINUTES = 10; // how long a session stays active

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
}

const VotingKiosk = () => {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<VotingStep>("auth");
  const [voterData, setVoterData] = useState<VoterData | null>(null);

  const [currentSelections, setCurrentSelections] = useState<CandidateSelection[]>([]);
  const [allSelections, setAllSelections] = useState<CandidateSelection[]>([]);

  const [transactionHash, setTransactionHash] = useState<string>("");
  const [selectedElection, setSelectedElection] = useState<any>(null);
  const [completedElections, setCompletedElections] = useState<string[]>([]);
  const [activeElections, setActiveElections] = useState<any[]>([]);
  const [expiredElections, setExpiredElections] = useState<any[]>([]);

  // -------------------------------------------------
  // HEARTBEAT — keep session alive while voting
  // -------------------------------------------------
  useEffect(() => {
    if (!voterData) return;

    const interval = setInterval(() => {
      supabase
        .from("voter_sessions")
        .update({
          expires_at: new Date(
            Date.now() + KIOSK_SESSION_MINUTES * 60 * 1000
          ).toISOString(),
        })
        .eq("voter_id", voterData.id)
        .then(({ error }) => {
          if (error) console.error("Heartbeat error:", error.message);
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [voterData]);

  // -------------------------------------------------
  // CAST VOTE
  // -------------------------------------------------
  const castVote = async (
    electionId: string,
    candidateId: string,
    voterId: string
  ) => {
    const { data, error } = await supabase.from("votes").insert([
      {
        election_id: electionId,
        candidate_id: candidateId === "ABSTAIN" ? null : candidateId,
        voter_id: voterId,
        is_abstain: candidateId === "ABSTAIN",
      },
    ]);

    if (error) {
      if (error.code === "23505") {
        console.warn("Already voted in this election.");
      } else {
        console.error("Error casting vote:", error.message);
      }
    } else {
      console.log("Vote recorded:", data);
    }
  };

  // -------------------------------------------------
  // AUTH SUCCESS + ANTI-SIMULTANEOUS LOGIN
  // -------------------------------------------------
  const handleAuthSuccess = async (auth: { rfidTag: string; faceHash: string }) => {
    console.log("LOOKING UP VOTER:", auth.rfidTag, auth.faceHash);

    const { data: voterRow, error } = await supabase
      .from("voters")
      .select("*")
      .eq("rfid_tag", auth.rfidTag)
      .eq("face_id_hash", auth.faceHash)
      .single();

    if (error || !voterRow) {
      console.error("Voter lookup error:", error?.message);
      toast.error("Authentication failed. Voter not found.");
      return;
    }

    // 1) Check for ANY active session (no kiosk_id logic)
    const nowIso = new Date().toISOString();

    const { data: existingSessions, error: sessionError } = await supabase
      .from("voter_sessions")
      .select("*")
      .eq("voter_id", voterRow.id)
      .gt("expires_at", nowIso);

    if (sessionError) {
      console.error("Session check error:", sessionError.message);
      toast.error("Cannot verify your session. Please contact election staff.");
      return;
    }

    if (existingSessions && existingSessions.length > 0) {
      // There is already an active session for this voter
      toast.error(
        "There is already an active voting session for this voter.\n" +
          "Please finish the existing session or wait a few minutes before trying again."
      );
      return;
    }

    // 2) Create a new session for this voter
    const newExpiresAt = new Date(
      Date.now() + KIOSK_SESSION_MINUTES * 60 * 1000
    ).toISOString();

    const { error: upsertError } = await supabase.from("voter_sessions").upsert({
      voter_id: voterRow.id,
      kiosk_id: KIOSK_ID, // just to satisfy NOT NULL; not used in logic
      expires_at: newExpiresAt,
    });

    if (upsertError) {
      console.error("Error creating voter session:", upsertError.message);
      toast.error("Unable to create a secure voter session. Please try again.");
      return;
    }

    // 3) Hydrate voter into state
    const enrichedVoter: VoterData = {
      ...voterRow,
      rfidVerified: true,
      faceVerified: true,
    };

    setVoterData(enrichedVoter);

    // 4) Load elections
    const { data: elections = [], error: electionsError } = await supabase
      .from("elections")
      .select("*");

    if (electionsError) {
      console.error("Error loading elections:", electionsError.message);
      toast.error("Unable to load elections.");
      return;
    }

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

  // -------------------------------------------------
  // SELECT ELECTION
  // -------------------------------------------------
  const handleElectionSelect = (electionId: string, electionData: any) => {
    setSelectedElection({ id: electionId, ...electionData });
    setCurrentSelections([]);
    setCurrentStep("ballot");
  };

  // -------------------------------------------------
  // BALLOT COMPLETE
  // -------------------------------------------------
  const handleBallotComplete = (selectedCandidates: CandidateSelection[]) => {
    setCurrentSelections(selectedCandidates);

    const key = selectedElection.id;

    setAllSelections((prev) => {
      const filtered = prev.filter((s) => s.electionId !== key);
      return [...filtered, ...selectedCandidates.map((s) => ({ ...s, electionId: key }))];
    });

    setCurrentStep("review");
  };

  // -------------------------------------------------
  // REVIEW CONFIRM
  // -------------------------------------------------
  const handleReviewConfirm = () => {
    handleSubmissionComplete("pending-hash");
  };

  const handleReviewNavigation = (action: "edit-ballot" | "back-to-elections") => {
    if (action === "back-to-elections") {
      setSelectedElection(null);
      setCurrentSelections([]);
      setCurrentStep("election-select");
      return;
    }

    setCurrentSelections([]);
    setCurrentStep("ballot");
  };

  const handleEditBallot = () => {
    setCurrentSelections([]);
    setCurrentStep("ballot");
  };

  // -------------------------------------------------
  // SUBMISSION FINISHED
  // -------------------------------------------------
  const handleSubmissionComplete = (txHash: string) => {
    setTransactionHash(txHash);

    const updatedCompleted = [...completedElections, selectedElection.id];
    setCompletedElections(updatedCompleted);

    const remainingActive = activeElections.filter(
      (e) => !updatedCompleted.includes(e.id)
    );

    if (remainingActive.length > 0) {
      setCurrentStep("election-finished");
    } else {
      setCurrentStep("review-final");
    }
  };

  // -------------------------------------------------
  // RESET KIOSK
  // -------------------------------------------------
  const handleReset = async () => {
    if (voterData?.id) {
      await supabase.from("voter_sessions").delete().eq("voter_id", voterData.id);
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
    navigate("/");
  };

  // -------------------------------------------------
  // RENDER UI
  // -------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      {currentStep === "auth" && (
        <AuthenticationScreen onAuthSuccess={handleAuthSuccess} />
      )}

      {currentStep === "election-select" && voterData && (
        <ElectionSelection
          voterData={voterData}
          onElectionSelect={handleElectionSelect}
          completedElections={completedElections}
          activeElections={activeElections}
          expiredElections={expiredElections}
        />
      )}

      {currentStep === "ballot" && voterData && selectedElection && (
        <BallotScreen
          voterData={voterData}
          electionId={selectedElection.id}
          electionData={selectedElection}
          onComplete={handleBallotComplete}
          initialSelections={allSelections
            .filter((sel) => sel.electionId === selectedElection.id)
            .map((sel) => ({
              ...sel,
              position: sel.position.toLowerCase().replace(/\s+/g, "-"),
            }))}
        />
      )}

      {currentStep === "review" && voterData && (
        <ReviewScreen
          voterData={voterData}
          selections={currentSelections}
          onConfirm={handleReviewConfirm}
          onEdit={handleEditBallot}
          showAll={false}
        />
      )}

      {currentStep === "review-final" && voterData && (
        <ReviewScreen
          voterData={voterData}
          selections={allSelections}
          onConfirm={async () => {
            for (const sel of allSelections) {
              await castVote(sel.electionId, sel.candidateId, voterData.id);
            }
            setCurrentStep("submitting");
          }}
          onEdit={handleReviewNavigation}
          showAll={true}
        />
      )}

      {currentStep === "submitting" && voterData && (
        <SubmissionScreen
          voterData={voterData}
          selections={allSelections}
          transactionHash={transactionHash}
          onComplete={(txHash) => {
            setTransactionHash(txHash);
            setCurrentStep("complete");
          }}
          onReset={handleReset}
          isComplete={false}
        />
      )}

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

      {currentStep === "complete" && voterData && (
        <SubmissionScreen
          voterData={voterData}
          selections={allSelections}
          transactionHash={transactionHash}
          onComplete={handleSubmissionComplete}
          onReset={handleReset}
          isComplete={true}
        />
      )}
    </div>
  );
};

export default VotingKiosk;
