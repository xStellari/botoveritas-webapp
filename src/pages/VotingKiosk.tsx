// VotingKiosk.tsx — Updated Version
// Fixes:
// 1) "Already voted" check now only considers ACTIVE elections and blocks only if voter has voted in ALL active elections.
// 2) Elections with a future start time (same date) are NOT shown until start_date <= now.
// 3) Timer no longer shows 0:00 (starts reliably even when auto-selecting the only active election).
// 4) ✅ NEW: voter_sessions lock is created IMMEDIATELY after auth to prevent simultaneous access on other devices.
// 5) ✅ NEW: Filter elections by eligibility (Option A: abbreviations in voters.org_affiliations + elections.eligible_orgs)
// 6) ✅ NEW: Pass onRefresh callback to ElectionSelection for Refresh button

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
  // ✅ NEW: Eligibility helpers (Option A: abbreviations only)
  // voters.org_affiliations should be like ["SCC","ICpEP"]
  // elections.eligible_orgs should be like ["SCC"] or ["HonSoc"]
  // -----------------------------------------------------
  const getVoterOrgs = (v: any): string[] =>
    Array.isArray(v?.org_affiliations) ? v.org_affiliations : [];

  const isElectionEligibleForVoter = (election: any, voterOrgs: string[]): boolean => {
    const eligibleOrgs: string[] = Array.isArray(election?.eligible_orgs)
      ? election.eligible_orgs
      : [];

    // If eligible_orgs is empty/null, treat as open-to-all (keep as-is)
    if (eligibleOrgs.length === 0) return true;

    return eligibleOrgs.some((org) => voterOrgs.includes(org));
  };

  // -----------------------------------------------------
  // ✅ UPDATED: Refresh elections + status (used by Refresh button)
  // -----------------------------------------------------
  const refreshElectionsAndStatus = async () => {
    if (!voterData) return;

    const voterOrgs = getVoterOrgs(voterData);

    // 1) Load elections
    const { data: elections = [], error: electionsErr } = await supabase
      .from("elections")
      .select("*");

    if (electionsErr) {
      toast.error("Failed to load elections.");
      return;
    }

    const now = new Date();

    const active = elections.filter((e) => {
      const start = new Date(e.start_date);
      const end = new Date(e.end_date);
      return (
        e.is_active &&
        start <= now &&
        end > now &&
        isElectionEligibleForVoter(e, voterOrgs)
      );
    });

    const expired = elections.filter((e) => {
      const end = new Date(e.end_date);
      return e.is_active && end <= now && isElectionEligibleForVoter(e, voterOrgs);
    });

    setActiveElections(active);
    setExpiredElections(expired);

    // 2) Refresh completed elections for ACTIVE only
    const activeIds = active.map((e) => e.id);

    if (activeIds.length === 0) {
      setCompletedElections([]);
      return;
    }

    const { data: statusRows, error: statusErr } = await supabase
      .from("voter_election_status")
      .select("election_id, has_voted")
      .eq("voter_id", voterData.id)
      .in("election_id", activeIds);

    if (statusErr) {
      toast.error("Failed to check voting status.");
      return;
    }

    const completed = (statusRows ?? [])
      .filter((r) => r.has_voted)
      .map((r) => r.election_id);

    setCompletedElections(completed);
  };

  // -----------------------------------------------------
  // TIMER START HELPER (does NOT depend on React state timing)
  // -----------------------------------------------------
  const ensureTimerStarted = async (voterId: string, activeCount: number) => {
    if (timeLeft !== null) return;

    const totalMinutes = Math.max(activeCount, 1) * 3; // 3 mins per active election, at least 3 mins
    const totalMs = totalMinutes * 60 * 1000;

    setTimeLeft(totalMs);

    const expiresAt = Date.now() + totalMs;

    await supabase.from("voter_sessions").upsert({
      voter_id: voterId,
      expires_at: new Date(expiresAt).toISOString(),
    });
  };

  // -----------------------------------------------------
  // AUTH SUCCESS (NO TIMER HERE)
  // -----------------------------------------------------
  const handleAuthSuccess = async (auth: { rfidTag: string }) => {
    // 1) Find voter by RFID (via RPC to avoid direct voters SELECT under RLS)
    const { data: voterRows, error: voterErr } = await supabase.rpc(
      "get_voter_by_rfid" as any,
      { p_rfid: auth.rfidTag } as any
    );

    const voterRow = voterRows?.[0];

    if (voterErr || !voterRow) {
      toast.error("Voter not found.");
      return;
    }

    const voterOrgs = getVoterOrgs(voterRow);

    // 2) Prevent simultaneous sessions
    const nowIso = new Date().toISOString();
    const { data: existingSessions, error: sessionCheckErr } = await supabase
      .from("voter_sessions")
      .select("*")
      .eq("voter_id", voterRow.id)
      .gt("expires_at", nowIso);

    if (sessionCheckErr) {
      toast.error("Failed to check active session.");
      return;
    }

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

    // ✅ NEW: Create session lock immediately after auth
    // This prevents another device from authenticating before election selection starts.
    const initialLockMs = 3 * 60 * 1000; // 3 minutes initial lock
    const initialExpiresAt = new Date(Date.now() + initialLockMs).toISOString();

    const { error: lockErr } = await supabase.from("voter_sessions").upsert({
      voter_id: voterRow.id,
      expires_at: initialExpiresAt,
    });

    if (lockErr) {
      toast.error("Failed to create voting session lock.");
      return;
    }

    await logSessionEvent({ voterId: voterRow.id, action: "session_start" });

    const enriched: VoterData = {
      ...voterRow,
      rfidVerified: true,
      faceVerified: true,
    };

    // 3) Load elections FIRST (so we can determine what "active" means)
    const { data: elections = [], error: electionsErr } = await supabase
      .from("elections")
      .select("*");

    if (electionsErr) {
      toast.error("Failed to load elections.");
      return;
    }

    const now = new Date();

    // ✅ FIX: Election is "active" only if:
    // - is_active = true
    // - start_date <= now
    // - end_date > now
    // ✅ NEW: and voter is eligible based on orgs
    const active = elections.filter((e) => {
      const start = new Date(e.start_date);
      const end = new Date(e.end_date);
      return (
        e.is_active &&
        start <= now &&
        end > now &&
        isElectionEligibleForVoter(e, voterOrgs)
      );
    });

    // Expired = was active but end_date <= now
    // ✅ NEW: and voter is eligible based on orgs
    const expired = elections.filter((e) => {
      const end = new Date(e.end_date);
      return e.is_active && end <= now && isElectionEligibleForVoter(e, voterOrgs);
    });

    setActiveElections(active);
    setExpiredElections(expired);

    // 4) ✅ FIX: already-voted logic should only consider ACTIVE elections
    const activeIds = active.map((e) => e.id);

    if (activeIds.length > 0) {
      const { data: statusRows, error: statusErr } = await supabase
        .from("voter_election_status")
        .select("election_id, has_voted")
        .eq("voter_id", voterRow.id)
        .in("election_id", activeIds);

      if (statusErr) {
        toast.error("Failed to check voting status.");
        return;
      }

      const completed = (statusRows ?? [])
        .filter((r) => r.has_voted)
        .map((r) => r.election_id);

      setCompletedElections(completed);

      const hasVotedAllActive = activeIds.every((id) => completed.includes(id));

      if (hasVotedAllActive) {
        navigate("/registration-error", {
          state: {
            title: "You Already Voted",
            message: "You have already voted in all active elections available to you.",
          },
        });
        return;
      }
    } else {
      setCompletedElections([]);
    }

    // 5) Proceed
    setVoterData(enriched);

    // ✅ IMPORTANT: if only one active election, we auto-select it.
    // But voterData state may not be ready yet, so pass voterRow.id and active.length.
    if (active.length === 1) {
      handleElectionSelect(active[0].id, active[0], voterRow.id, active.length);
    } else {
      setCurrentStep("election-select");
    }
  };

  // -----------------------------------------------------
  // START TIMER ON FIRST BALLOT CLICK
  // -----------------------------------------------------
  const handleElectionSelect = async (
    electionId: string,
    electionData: any,
    voterIdOverride?: string,
    activeCountOverride?: number
  ) => {
    const voterId = voterData?.id ?? voterIdOverride;
    if (!voterId) {
      toast.error("Missing voter session.");
      return;
    }

    // If user is selecting manually, activeElections state is already set.
    // If auto-selecting, we pass active.length override to avoid stale state.
    const activeCount = activeCountOverride ?? activeElections.length ?? 1;

    await ensureTimerStarted(voterId, activeCount);

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
    const filtered = allSelections.filter((s) => s.electionId !== selectedElection.id);
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
  }, [timeLeft, currentStep, voterData, showTimeoutModal]);

  // -----------------------------------------------------
  // FINAL SUBMISSION COMPLETE
  // -----------------------------------------------------
  const handleSubmissionComplete = async (txHash: string) => {
    setTransactionHash(txHash);

    await supabase.from("voter_election_status").upsert({
      voter_id: voterData?.id,
      election_id: selectedElection?.id,
      has_voted: true,
      voted_at: new Date().toISOString(),
    });

    const updated = [...completedElections, selectedElection.id];
    setCompletedElections(updated);

    const remaining = activeElections.filter((e) => !updated.includes(e.id));

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
            <h2 className="text-2xl font-bold text-red-600 mb-4">Warning</h2>

            <p className="text-gray-700 mb-6 leading-relaxed">
              Your voting time is up, but don’t worry — we’ve added{" "}
              <strong>1 minute and 30 seconds</strong> so you can finish.
              <br /> <br />
              <h3 className="text-red-600">
                <strong>Please try to vote a little faster. </strong>
              </h3>
            </p>

            <button
              onClick={async () => {
                const ext = 89 * 1000;
                const newTime = (timeLeft ?? 0) + ext;

                setTimeLeft(newTime);
                setShowTimeoutModal(false);

                if (voterData) {
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
      {currentStep === "auth" && <AuthenticationScreen onAuthSuccess={handleAuthSuccess} />}

      {/* ELECTION SELECT */}
      {currentStep === "election-select" && voterData && (
        <ElectionSelection
          voterData={voterData}
          onElectionSelect={handleElectionSelect}
          completedElections={completedElections}
          activeElections={activeElections}
          expiredElections={expiredElections}
          onRefresh={refreshElectionsAndStatus} // ✅ NEW
        />
      )}

      {/* BALLOT */}
      {currentStep === "ballot" && voterData && selectedElection && (
        <BallotScreen
          voterData={voterData}
          electionId={selectedElection.id}
          electionData={selectedElection}
          onComplete={handleBallotComplete}
          initialSelections={allSelections.filter((sel) => sel.electionId === selectedElection.id)}
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
                voter_id: voterData.id,
                election_id: sel.electionId,
                position: sel.position,
                candidate_id: sel.candidateId === "ABSTAIN" ? null : sel.candidateId,
                is_abstain: sel.candidateId === "ABSTAIN",
              });
            }

            for (const sel of allSelections) {
              await supabase.from("voter_election_status").upsert({
                voter_id: voterData.id,
                election_id: sel.electionId,
                has_voted: true,
                voted_at: new Date().toISOString(),

                voter_first_name: voterData.first_name,
                voter_middle_name: voterData.middle_name,
                voter_last_name: voterData.last_name,
                voter_suffix: voterData.suffix,
                voter_email: voterData.email,
                year_level: voterData.year_level,
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
          onComplete={() => {}}
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
