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
  voter_audience?: string | null;
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

  // -----------------------------------------------------
  // Issue #2 hardening: prevent accidental browser back/gesture from breaking kiosk flow.
  // If a back navigation is attempted mid-session, show a confirm dialog.
  // Confirming will end the active session lock in DB and return to Home.
  // -----------------------------------------------------
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const [pendingBack, setPendingBack] = useState(false);
  const [endingFromBack, setEndingFromBack] = useState(false);

  // If RFID auth is repeated while a session is still active (e.g., user swiped back),
  // allow "Resume" or "End session" instead of locking the kiosk.
  const [sessionConflictOpen, setSessionConflictOpen] = useState(false);
  const [conflictVoterRow, setConflictVoterRow] = useState<any | null>(null);

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
    getActiveSessionRow,
    hasActiveSession,
    createInitialLock,
    extendSessionSeconds,
    endSession,
  } = useVotingSessionLock();

  
    // DB-backed session timer (single source of truth: voter_sessions.expires_at)
  const [sessionExpiresAtMs, setSessionExpiresAtMs] = useState<number | null>(null);
  const [extensionCount, setExtensionCount] = useState<number>(0);
  const maxExtensions = 5;

  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  // -----------------------------------------------------
  // History trap (Layer A): block browser back gesture during an active kiosk flow.
  // We only trap when the voter has passed auth OR a DB lock exists for the current voter.
  // -----------------------------------------------------
  useEffect(() => {
    const shouldTrap = currentStep !== "auth";
    if (!shouldTrap) return;

    // Push a dummy state so the first back gesture triggers popstate instead of leaving the route.
    try {
      window.history.pushState({ kiosk: true }, "", window.location.href);
    } catch {
      // noop
    }

    const onPopState = (e: PopStateEvent) => {
      // Immediately re-push state to neutralize the back navigation.
      try {
        window.history.pushState({ kiosk: true }, "", window.location.href);
      } catch {
        // noop
      }

      // Show confirm UI (non-blocking). If they confirm, we'll end session and go home.
      if (!backConfirmOpen) {
        setPendingBack(true);
        setBackConfirmOpen(true);
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [currentStep, backConfirmOpen]);

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
  // SESSION TIMER POLICY
  // Timer starts right after auth (3 minutes) and ONLY extends via the timeout modal.
  // -----------------------------------------------------

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
    const { hasActive, kioskId, error: sessionCheckErr } = await hasActiveSession(voterRow.id);

    if (sessionCheckErr) {
      toast.error("Failed to check active session.");
      return;
    }

    if (hasActive) {
      // ✅ Issue #2 (Layer B): offer Resume / End only when the active session belongs to THIS kiosk.
      // If the active session is bound to a different kiosk, hard-block and show time remaining until expiry.
      const { session, error: activeRowErr } = await getActiveSessionRow(voterRow.id);
      if (activeRowErr) {
        toast.error("Failed to read active session details.");
        return;
      }

      const mismatch = Boolean(session?.kiosk_id) && Boolean(kioskId) && session?.kiosk_id !== kioskId;

      if (mismatch) {
        const expiresAtMs = session?.expires_at ? new Date(session.expires_at).getTime() : 0;
        const timeLeftMs = Math.max(0, expiresAtMs - Date.now());
        const timeLeftSec = Math.max(1, Math.ceil(timeLeftMs / 1000));
        const mm = String(Math.floor(timeLeftSec / 60)).padStart(1, "0");
        const ss = String(timeLeftSec % 60).padStart(2, "0");

        navigate("/error", {
          state: {
            title: "Active Session Detected",
            reason: "ACTIVE_SESSION_OTHER_KIOSK",
            voter_audience: (voterRow as any).voter_audience,
            message:
            `This voter already has an active voting session on another kiosk.\n\nPlease return to that kiosk to continue.\n`,
          },
        });
        return;
      }

      // Same kiosk: show resume/end modal.
      setConflictVoterRow(voterRow);
      setSessionConflictOpen(true);
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

    void logSessionEvent({ voterId: voterRow.id, action: "session_start" });

    // Initialize local timer state from DB (authoritative)
    const { session: initSession } = await getActiveSessionRow(voterRow.id);
    if (initSession?.expires_at) {
      setSessionExpiresAtMs(new Date(initSession.expires_at).getTime());
      setExtensionCount(Number(initSession.extension_count ?? 0));
    } else {
      setSessionExpiresAtMs(Date.now() + initialLockMs);
      setExtensionCount(0);
    }
    setShowTimeoutModal(false);


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


    // ✅ Adviser guard: if this voter has ZERO eligible active elections, do NOT proceed to election selection.
    // End the just-created session lock to avoid kiosk lockstate, then show a clear message.
    if (!active || active.length === 0) {
      await endSession(voterRow.id);
      resetElectionCatalog();
      navigate("/error", {
        state: {
          title: "No Eligible Elections",
          reason: "NO_ELIGIBLE_ELECTIONS",
          voter_audience: (voterRow as any).voter_audience,
          message:
            "There are currently no eligible active elections available at this time. If you believe this is incorrect, please contact election staff.",
          recoverTo: "/voting",
          countdownSeconds: 10,
        },
      });
      return;
    }

    if (hasVotedAllActive) {
      navigate("/error", {
        state: {
          title: "You Already Voted",
          reason: "ALREADY_VOTED",
          voter_audience: (voterRow as any).voter_audience,
          message: "You have already voted in all active elections available to you.",
          recoverTo: "/voting",
          countdownSeconds: 10,
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
      return;
    }

    // Freeze when session timer is up.
    if (showTimeoutModal || (timeLeft !== null && timeLeft <= 0)) {
      setShowTimeoutModal(true);
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
  // COUNTDOWN EFFECT (DB-backed)
  // -----------------------------------------------------
  useEffect(() => {
    if (!sessionExpiresAtMs) {
      setTimeLeft(null);
      return;
    }

    if (currentStep === "submitting" || currentStep === "complete") return;

    const tick = () => {
      const remaining = sessionExpiresAtMs - Date.now();
      const clamped = Math.max(0, remaining);
      setTimeLeft(clamped);

      if (clamped > 0 && clamped <= 15_000) {
        // Show extension modal slightly BEFORE expiry so the voter can extend in advance.
        setShowTimeoutModal(true);
      } else if (clamped <= 0) {
        // Expired: freeze flow + require explicit extension (or re-auth if capped).
        setShowTimeoutModal(true);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sessionExpiresAtMs, currentStep]);

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

    // ✅ Batch UPSERT votes (idempotent)
    // Why: if anything after vote persistence fails (e.g., RLS on voter_election_status),
    // the user may retry — and INSERT would throw 409 due to unique_vote_per_position.
    const voteRows = selections.map((sel) => ({
      voter_id: voterId,
      election_id: electionId,
      position: sel.position,
      candidate_id: sel.candidateId === "ABSTAIN" ? null : sel.candidateId,
      is_abstain: sel.candidateId === "ABSTAIN",
    }));

    const { error: votesErr } = await supabase
      .from("votes")
      .upsert(voteRows, { onConflict: "voter_id,election_id,position" });

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

    // IMPORTANT: Do NOT write to voter_election_status from the client.
    // That table is protected by RLS (403/42501) for kiosk voters.
    // We rely on the AFTER INSERT trigger on votes (SECURITY DEFINER)
    // to upsert voter_election_status safely.

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
void logSessionEvent({ voterId: voterData.id, action: "session_end" });
    }

    dispatchFlow({ type: "RESET_FLOW" });
    setVoterData(null);
    resetElectionCatalog();
    setSessionExpiresAtMs(null);
                  setTimeLeft(null);
                  setExtensionCount(0);
                  setShowTimeoutModal(false);


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

      {/* DEV helper: lets you test the back-swipe handler without a touchscreen */}
      {import.meta.env.DEV && (
        <button
          type="button"
          className="fixed bottom-4 left-4 z-[60] rounded-lg border border-border bg-white/90 px-3 py-2 text-xs font-semibold shadow hover:bg-white"
          onClick={() => {
            try {
              window.history.back();
              // Some browsers won't emit popstate synchronously; nudge it for deterministic testing.
              window.dispatchEvent(new PopStateEvent("popstate"));
            } catch {
              // noop
            }
          }}
        >
          DEV: Simulate Back
        </button>
      )}

      {/* BACK / GESTURE CONFIRM (Issue #2) */}
      {backConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white/95 p-6 shadow-2xl animate-fade-in-up">
            <h2 className="text-xl font-bold text-foreground">Leave voting?</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Going back will <strong>end your voting session</strong> on this kiosk.
              If you did this by accident, choose <strong>Stay</strong> to continue where you left off.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border bg-white hover:bg-muted/20 text-sm font-semibold"
                onClick={() => {
                  setBackConfirmOpen(false);
                  setPendingBack(false);
                }}
              >
                Stay
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-destructive text-white hover:opacity-90 text-sm font-semibold"
                disabled={endingFromBack}
                onClick={async () => {
                  if (endingFromBack) return;
                  setEndingFromBack(true);
                  try {
                    await handleReset();
                  } finally {
                    setEndingFromBack(false);
                    setBackConfirmOpen(false);
                    setPendingBack(false);
                  }
                }}
              >
                End session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE SESSION DETECTED (Issue #2) */}
      {sessionConflictOpen && conflictVoterRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white/95 p-6 shadow-2xl animate-fade-in-up">
            <h2 className="text-xl font-bold text-foreground">Active session detected</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              This voter already has an active voting session on this kiosk. You can <strong>resume</strong> the session
              or <strong>end</strong> it and start over.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border bg-white hover:bg-muted/20 text-sm font-semibold"
                onClick={() => {
                  setSessionConflictOpen(false);
                  setConflictVoterRow(null);
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 text-sm font-semibold"
                onClick={async () => {
                  const voterRow = conflictVoterRow;
                  setSessionConflictOpen(false);
                  setConflictVoterRow(null);

                  const enriched: VoterData = {
                    ...voterRow,
                    rfidVerified: true,
                    faceVerified: true,
                  };

                  const catalog = await refreshElectionsAndStatus(voterRow.id);
                  if (!catalog) return;

                  const { activeElections: active, hasVotedAllActive } = catalog;

                  if (!active || active.length === 0) {
                    await endSession(voterRow.id);
                    resetElectionCatalog();
                    navigate("/error", {
                      state: {
                        title: "No Eligible Elections",
                        reason: "NO_ELIGIBLE_ELECTIONS",
                        voter_audience: (voterRow as any).voter_audience,
                        message:
                          "There are currently no eligible active elections available at this time. If you believe this is incorrect, please contact election staff.",
                        recoverTo: "/voting",
                        countdownSeconds: 10,
                      },
                    });
                    return;
                  }

                  if (hasVotedAllActive) {
                    navigate("/error", {
                      state: {
                        title: "You Already Voted",
                        reason: "ALREADY_VOTED",
                        voter_audience: (voterRow as any).voter_audience,
                        message: "You have already voted in all active elections available to you.",
                        recoverTo: "/voting",
                        countdownSeconds: 10,
                      },
                    });
                    return;
                  }

                  const { session } = await getActiveSessionRow(voterRow.id);
                  if (!session?.expires_at) {
                    // Session no longer active; force re-auth.
                    resetElectionCatalog();
                    navigate("/error", {
                      state: {
                        title: "Session Expired",
                        reason: "SESSION_EXPIRED",
                        voter_audience: (voterRow as any).voter_audience,
                        message: `Your voting session has expired.\n\nPlease authenticate again to continue.`,
                        recoverTo: "/voting",
                        countdownSeconds: 0,
                      },
                    });
                    return;
                  }
                  setSessionExpiresAtMs(new Date(session.expires_at).getTime());
                  setExtensionCount(Number(session.extension_count ?? 0));

                  setVoterData(enriched);
                  setStep("election-select");
                }}
              >
                Resume session
              </button>

              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-destructive text-white hover:opacity-90 text-sm font-semibold"
                onClick={async () => {
                  const voterRow = conflictVoterRow;
                  setSessionConflictOpen(false);
                  setConflictVoterRow(null);

                  await endSession(voterRow.id);
                  dispatchFlow({ type: "RESET_FLOW" });
                  setVoterData(null);
                  resetElectionCatalog();
                  setSessionExpiresAtMs(null);
                  setTimeLeft(null);
                  setExtensionCount(0);
                  setShowTimeoutModal(false);

                  toast.success("Previous session ended. Please tap your RFID again.");
                }}
              >
                End session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TIMEOUT MODAL */}
      {showTimeoutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur p-8 rounded-2xl shadow-2xl max-w-md w-full text-center animate-fade-in-up">
            <h2 className="text-2xl font-bold text-red-600 mb-4">Warning</h2>

            <p className="text-gray-700 mb-6 leading-relaxed">
              Your voting time is almost up. If you need more time, you can extend by{" "}
              <strong>1 minute and 30 seconds</strong> to continue voting.
              <br /> <br />
              <h3 className="text-red-600">
                <strong>Please try to vote a little faster. </strong>
              </h3>
            </p>

            <button
              onClick={async () => {
                if (!voterData) return;

                // If we already reached the cap, force re-auth.
                if (extensionCount >= maxExtensions) {
                  await endSession(voterData.id);
                  resetElectionCatalog();
                  navigate("/error", {
                    state: {
                      title: "Session Expired",
                      reason: "SESSION_EXPIRED_MAX_EXT",
                      voter_audience: (voterData as any)?.voter_audience,
                      message:
                        `Your voting session has expired and the maximum number of extensions has been reached.\n\nPlease authenticate again to continue.`,
                      recoverTo: "/voting",
                      countdownSeconds: 0,
                    },
                  });
                  return;
                }

                const { error } = await extendSessionSeconds(voterData.id, 90);
                if (error) {
                  // DB enforces kiosk binding + cap. Fall back to re-auth.
                  await endSession(voterData.id);
                  resetElectionCatalog();
                  navigate("/error", {
                    state: {
                      title: "Session Expired",
                      reason: "SESSION_EXPIRED",
                      voter_audience: (voterData as any)?.voter_audience,
                      message:
                        `Your voting session has expired.\n\nPlease authenticate again to continue.`,
                      recoverTo: "/voting",
                      countdownSeconds: 0,
                    },
                  });
                  return;
                }

                const { session } = await getActiveSessionRow(voterData.id);
                if (session?.expires_at) {
                  setSessionExpiresAtMs(new Date(session.expires_at).getTime());
                  setExtensionCount(Number(session.extension_count ?? extensionCount + 1));
                } else {
                  // Safety: if RPC didn't return, extend locally by 90s.
                  setSessionExpiresAtMs((prev) => (prev ? prev + 90_000 : Date.now() + 90_000));
                  setExtensionCount((c) => c + 1);
                }

                setShowTimeoutModal(false);
                void logSessionEvent({ voterId: voterData.id, action: "session_extend" });
              }}
              className="px-6 py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/80"
            >
              I Understand
            </button>
          </div>
        </div>
      )}

      {/* GLOBAL COUNTDOWN (Session Timer) */}
      {currentStep !== "auth" && timeLeft !== null && (
        <div className="fixed top-0 left-0 right-0 z-40">
          <div className="mx-auto max-w-3xl px-4 pt-3">
            <div className="rounded-2xl border bg-white/90 backdrop-blur shadow-sm px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-medium">
                Voting session time remaining
              </div>
              <div className="text-sm tabular-nums font-semibold">
                {Math.max(0, Math.floor((timeLeft ?? 0) / 60000))}:
                {String(Math.max(0, Math.floor(((timeLeft ?? 0) % 60000) / 1000))).padStart(2, "0")}
              </div>
            </div>
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