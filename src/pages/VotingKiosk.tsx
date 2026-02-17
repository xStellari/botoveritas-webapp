// VotingKiosk.tsx — Updated Version
// Fixes:
// 1) "Already voted" check now only considers ACTIVE elections and blocks only if voter has voted in ALL active elections.
// 2) Elections with a future start time (same date) are NOT shown until start_date <= now.
// 3) Timer no longer shows 0:00 (starts reliably even when auto-selecting the only active election).
// 4) ✅ NEW: voter_sessions lock is created IMMEDIATELY after auth to prevent simultaneous access on other devices.
// 5) ✅ NEW: Filter elections by eligibility (Option A: abbreviations in voters.org_affiliations + elections.eligible_orgs)
// 6) ✅ NEW: Pass onRefresh callback to ElectionSelection for Refresh button
// 7) ✅ UPDATED: Session check uses SERVER TIME via RPC (prevents kiosk clock skew issues)
// 8) ✅ OPTIONAL: Best-effort delete of expired session row for this voter before checking
// 9) ✅ OPTIONAL: Make election visibility authoritative by using server-side RPC eligibility checks (not just org_affiliations UI filter)
// 10) ✅ NEW: Finalized or archived elections are NEVER treated as "active/ongoing" even if end_date hasn't passed yet.
// 11) ✅ NEW: Safeguard against voting if election is finalized/archived mid-flow (before persisting votes / status)

import { useState, useEffect, useReducer } from "react";
import { useNavigate } from "react-router-dom";

import AuthenticationScreen from "@/components/voting/AuthenticationScreen";
import ElectionSelection from "@/components/voting/ElectionSelection";
import BallotScreen from "@/components/voting/BallotScreen";
import ReviewScreen from "@/components/voting/ReviewScreen";
import SubmissionScreen from "@/components/voting/SubmissionScreen";
import ElectionFinishedPopup from "@/components/voting/ElectionFinishedPopup";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { logSessionEvent } from "@/utils/logSessionEvent";
import { useElectionCatalog } from "@/hooks/useElectionCatalog";
import { useVotingSessionLock } from "@/hooks/useVotingSessionLock";
import { useVotingTimer } from "@/hooks/useVotingTimer";

export type VoterRow = {
  id: string;
  email: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  year_level: string | null;
  org_affiliations: string[] | null;
  rfid_tag: string | null;
  face_descriptor: string[] | null;
  email_verified_at: string | null;
  created_at?: string;
};

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


type FlowState = {
  currentStep: VotingStep;
  selectedElection: any | null;
  currentSelections: CandidateSelection[];
  allSelections: CandidateSelection[];
  transactionHash: string;
};

type FlowAction =
  | { type: "PATCH"; patch: Partial<FlowState> }
  | { type: "APPEND_TO_ALL_SELECTIONS"; selections: CandidateSelection[] }
  | { type: "RESET_FLOW" };

const initialFlowState: FlowState = {
  currentStep: "auth",
  selectedElection: null,
  currentSelections: [],
  allSelections: [],
  transactionHash: "",
};

function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "PATCH":
      return { ...state, ...action.patch };
    case "APPEND_TO_ALL_SELECTIONS":
      return { ...state, allSelections: [...state.allSelections, ...action.selections] };
    case "RESET_FLOW":
      return initialFlowState;
    default:
      return state;
  }
}



const VotingKiosk = () => {
  const navigate = useNavigate();

  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const { currentStep, selectedElection, currentSelections, allSelections, transactionHash } = flow;

  const setStep = (step: VotingStep) => dispatchFlow({ type: "PATCH", patch: { currentStep: step } });
  const setSelectedElection = (election: any | null) =>
    dispatchFlow({ type: "PATCH", patch: { selectedElection: election } });
  const setCurrentSelections = (selections: CandidateSelection[]) =>
    dispatchFlow({ type: "PATCH", patch: { currentSelections: selections } });
  const setAllSelections = (selections: CandidateSelection[]) =>
    dispatchFlow({ type: "PATCH", patch: { allSelections: selections } });
  const appendToAllSelections = (selections: CandidateSelection[]) =>
    dispatchFlow({ type: "APPEND_TO_ALL_SELECTIONS", selections });
  const setTransactionHash = (txHash: string) =>
    dispatchFlow({ type: "PATCH", patch: { transactionHash: txHash } });

  const [voterData, setVoterData] = useState<VoterData | null>(null);

  const {
    activeElections,
    expiredElections,
    completedElections,
    refreshElectionsAndStatus,
    resetElectionCatalog,
  } = useElectionCatalog();

  

  const {
    cleanupExpiredSession,
    hasActiveSession,
    createInitialLock,
    setSessionExpiresInMs,
    endSession,
  } = useVotingSessionLock();

  
  const {
    timeLeft,
    showTimeoutModal,
    setShowTimeoutModal,
    startTimerIfNeeded,
    setTimeLeft,
    resetTimer,
  } = useVotingTimer({ currentStep });

// -----------------------------------------------------
  // ✅ NEW: Centralized lifecycle guard
  // Finalized or archived elections must NEVER be treated as "active/ongoing".
  // -----------------------------------------------------
  const isOperationalElection = (e: any) => !e?.is_final && !e?.is_archived;

  // -----------------------------------------------------
  // ✅ NEW: Re-check election lifecycle state from DB (for mid-flow safety)
  // -----------------------------------------------------
  const assertElectionStillOperational = async (electionId: string) => {
    const { data, error } = await supabase
      .from("elections")
      .select("id, is_final, is_archived, is_active, start_date, end_date")
      .eq("id", electionId)
      .single();

    if (error || !data) {
      toast.error("Failed to verify election status. Please refresh.");
      return false;
    }

    // If finalized/archived, it's not voteable even if within end_date.
    if (Boolean((data as any).is_final) || Boolean((data as any).is_archived)) {
      toast.error("This election was finalized/archived and is no longer available for voting.");
      return false;
    }

    // Also ensure it's actually active + within time window (extra safety)
    const now = new Date();
    const start = new Date((data as any).start_date);
    const end = new Date((data as any).end_date);

    if (!Boolean((data as any).is_active) || start > now || end <= now) {
      toast.error("This election is no longer active.");
      return false;
    }

    return true;
  };

  // -----------------------------------------------------
  // ✅ OPTIONAL: Authoritative eligibility is now handled via RPC (name-based membership lists)
  // -----------------------------------------------------

  // -----------------------------------------------------
  // ✅ OPTIONAL: Authoritative eligibility (server-side)
  // Uses the RPC that checks the imported membership lists by NAME.
  // We confirm eligibility via RPC so election visibility is correct.
  // -----------------------------------------------------
  // -----------------------------------------------------
  // TIMER START HELPER (does NOT depend on React state timing)
  // -----------------------------------------------------
  const ensureTimerStarted = async (voterId: string, activeCount: number) => {
    const totalMinutes = Math.max(activeCount, 1) * 3; // 3 mins per active election, at least 3 mins
    const totalMs = totalMinutes * 60 * 1000;

    // starts only if not started yet
    startTimerIfNeeded(totalMs);

    // keep DB session expiry aligned with timer
    await setSessionExpiresInMs(voterId, totalMs);
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

    // 2) Prevent simultaneous sessions (SERVER TIME via RPC)
    // OPTIONAL: best-effort delete any expired row for this voter (helps immediately even before cron cleanup)
        await cleanupExpiredSession(voterRow.id);
    const { hasActive, error: sessionCheckErr } = await hasActiveSession(voterRow.id);
if (sessionCheckErr) {
      toast.error("Failed to check active session.");
      return;
    }

    if (hasActive) {
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

    const { error: lockErr } = await createInitialLock(voterRow.id, initialLockMs);
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

    // 3) Load elections + eligibility + completed status
    const catalog = await refreshElectionsAndStatus(voterRow.id);

    if (!catalog) {
      // refreshElectionsAndStatus already handled user-facing error
      return;
    }

    const { activeElections: active, completedElections: completed, hasVotedAllActive } = catalog;

    if (hasVotedAllActive) {
      navigate("/registration-error", {
        state: {
          title: "You Already Voted",
          message: "You have already voted in all active elections available to you.",
        },
      });
      return;
    }
// 5) Proceed
    setVoterData(enriched);

    // ✅ UX CHANGE: always show election selection, even if only 1 eligible election.
    // This lets voters see other elections (and why they may be ineligible) instead of being auto-routed to the ballot.
    setStep("election-select");
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

    // ✅ NEW: Defensive guard (prevents edge-cases / stale UI selection)
    if (electionData?.is_final || electionData?.is_archived) {
      toast.error("This election is already finalized/archived and is no longer available for voting.");
      await refreshElectionsAndStatus(voterId);
      return;
    }

    // ✅ Enforce eligibility server-side (prevents UI bypass)
    const { data: isEligible, error: eligErr } = await supabase.rpc(
      "is_voter_eligible_for_election" as any,
      { p_voter_id: voterId, p_election_id: electionId } as any
    );

    if (eligErr) {
      console.error("Eligibility check failed:", eligErr);
      toast.error("Eligibility check failed.");
      return;
    }

    if (!isEligible) {
      toast.error("You are not eligible to vote in this election.");
      return;
    }

    // If user is selecting manually, activeElections state is already set.
    // If auto-selecting, we pass active.length override to avoid stale state.
    const activeCount = activeCountOverride ?? activeElections.length ?? 1;

    await ensureTimerStarted(voterId, activeCount);

    setSelectedElection({ id: electionId, ...electionData });
    setCurrentSelections([]);
    setStep("ballot");
  };

  // -----------------------------------------------------
  // HANDLE BALLOT COMPLETION
  // -----------------------------------------------------
  const handleBallotComplete = (selections: CandidateSelection[]) => {
    setCurrentSelections(selections);

    // merge into allSelections
    const filtered = allSelections.filter((s) => s.electionId !== selectedElection.id);
    setAllSelections([...filtered, ...selections]);

    setStep("review");
  };

  // -----------------------------------------------------
  // COUNTDOWN EFFECT
  // -----------------------------------------------------
  


  // -----------------------------------------------------
  // FINAL SUBMISSION COMPLETE
  // -----------------------------------------------------
  const persistVotesForElection = async (
    voterId: string,
    electionId: string,
    selections: CandidateSelection[]
  ) => {
    // ✅ Mid-flow safety check (lifecycle + time window)
    const ok = await assertElectionStillOperational(electionId);
    if (!ok) {
      await refreshElectionsAndStatus(voterId);
      setSelectedElection(null);
      setCurrentSelections([]);
      setStep("election-select");
      return { ok: false as const };
    }

    // ✅ Batch insert votes (reduces network calls + lowers partial failure risk)
    const voteRows = selections.map((sel) => ({
      voter_id: voterId,
      election_id: electionId,
      position: sel.position,
      candidate_id: sel.candidateId === "ABSTAIN" ? null : sel.candidateId,
      is_abstain: sel.candidateId === "ABSTAIN",
    }));

    const { error: votesErr } = await supabase.from("votes").insert(voteRows);

    if (votesErr) {
      console.error("Failed to persist votes:", votesErr);
      toast.error("Failed to save your votes. Please try again.");
      return { ok: false as const };
    }

    return { ok: true as const };
  };

  const handleSubmissionComplete = async (txHash: string) => {
    setTransactionHash(txHash);

    const electionId = selectedElection?.id;
    const voterId = voterData?.id;

    if (!electionId || !voterId) {
      toast.error("Missing voting session.");
      return;
    }

    // ✅ Mid-flow safety check before marking has_voted
    const ok = await assertElectionStillOperational(electionId);
    if (!ok) {
      await refreshElectionsAndStatus(voterId);
      setSelectedElection(null);
      setCurrentSelections([]);
      setStep("election-select");
      return;
    }

    const { error: statusErr } = await supabase.from("voter_election_status").upsert({
      voter_id: voterId,
      election_id: electionId,
      has_voted: true,
      voted_at: new Date().toISOString(),

      // Keep denormalized voter info consistent with final-review flow
      voter_first_name: voterData.first_name,
      voter_middle_name: voterData.middle_name,
      voter_last_name: voterData.last_name,
      voter_suffix: voterData.suffix,
      voter_email: voterData.email,
      year_level: voterData.year_level,
    });

    if (statusErr) {
      console.error("Failed to mark election as voted:", statusErr);
      toast.error("Failed to finalize your vote. Please try again.");
      return;
    }

    // ✅ Refresh catalog from DB to update completed elections accurately
    const catalog = await refreshElectionsAndStatus(voterId);

    const completed = catalog?.completedElections ?? completedElections;
    const remaining = activeElections.filter((e) => !completed.includes(e.id));

    if (remaining.length > 0) {
      setStep("election-finished");
    } else {
      setStep("review-final");
    }
  };

  // -----------------------------------------------------
  // RESET AFTER FULL VOTING PROCESS
  // -----------------------------------------------------
  const handleReset = async () => {
    if (voterData?.id) {
            await endSession(voterData.id);
await logSessionEvent({ voterId: voterData.id, action: "session_end" });
    }

    dispatchFlow({ type: "RESET_FLOW" });
    setVoterData(null);
    resetElectionCatalog();
    resetTimer();

    navigate("/");
  };

  // -----------------------------------------------------
  // RENDER UI
  // -----------------------------------------------------
  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-emerald-400/35 via-white to-yellow-300/35">

<style>{`
  @keyframes blobFloat1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(12px,-14px) scale(1.04); } }
  @keyframes blobFloat2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-10px,10px) scale(1.05); } }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .animate-blob-1 { animation: blobFloat1 14s ease-in-out infinite; }
  .animate-blob-2 { animation: blobFloat2 16s ease-in-out infinite; }
  .animate-fade-in-up { animation: fadeInUp 420ms ease-out both; }
`}</style>

<div className="pointer-events-none absolute -top-28 -left-28 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl animate-blob-1" />
<div className="pointer-events-none absolute -bottom-28 -right-28 h-96 w-96 rounded-full bg-amber-400/15 blur-3xl animate-blob-2" />
<div className="pointer-events-none absolute top-24 right-20 h-56 w-56 rounded-full bg-white/30 blur-3xl animate-blob-1" />

      {/* TIMEOUT MODAL */}
      {showTimeoutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur p-8 rounded-2xl shadow-2xl max-w-md w-full text-center animate-fade-in-up">
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
                                    await setSessionExpiresInMs(voterData.id, newTime);
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
          onRefresh={async () => { await refreshElectionsAndStatus(voterData.id); }} // ✅ NEW
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
          onConfirm={async () => {
            if (!selectedElection?.id) {
              toast.error("Missing election.");
              return;
            }

            const res = await persistVotesForElection(voterData.id, selectedElection.id, currentSelections);
            if (!res.ok) return;
            await handleSubmissionComplete("pending-hash");
          }}
          onEdit={() => setStep("ballot")}
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
            // Votes & status are persisted after each election submission.
            // Final review only proceeds to the submission/receipt step.
            setStep("submitting");
          }}
          onEdit={() => setStep("election-select")}
          showAll={true}
          timeLeft={timeLeft ?? 0}
          activeElections={activeElections}
          completedElections={completedElections}
        />
      )}

      {/* SUBMISSION / COMPLETE (single instance to prevent UI reset) */}
      {(currentStep === "submitting" || currentStep === "complete") && voterData && (
        <SubmissionScreen
          voterData={voterData}
          selections={allSelections}
          transactionHash={transactionHash}
          onComplete={(tx) => {
            // ✅ IMPORTANT: Keep the same SubmissionScreen instance mounted.
            // This prevents state (mintedReceipts, receiptStatus, currentStep) from resetting.
            setTransactionHash(tx);
            if (currentStep !== "complete") setStep("complete");
          }}
          onReset={handleReset}
          isComplete={currentStep === "complete"}
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
              setStep("election-select");
            } else {
              setStep("review-final");
            }
          }}
        />
      )}
    </div>
  );
};

export default VotingKiosk;