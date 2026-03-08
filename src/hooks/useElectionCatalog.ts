import { useCallback, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { kioskGetVoterElectionStatus } from "@/utils/kioskApi";

type Election = {
  id: string;
  start_date: string;
  end_date: string;
  is_paused?: boolean | null;
  // Legacy: kept for backward compatibility; do NOT use for voter visibility.
  is_active?: boolean | null;
  is_final: boolean;
  is_archived: boolean;
  // Allow additional columns without losing type safety for core fields
  [key: string]: any;
};

const toValidDate = (value: any): Date | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * useElectionCatalog
 * Centralizes election loading + eligibility filtering + "already voted" status refresh
 * so VotingKiosk.tsx can focus on flow orchestration.
 *
 * NOTE:
 * - Eligibility is authoritative (server-side) via `is_voter_eligible_for_election`.
 * - "Active" elections exclude finalized/archived elections even if within the time window.
 * - The second list is "Upcoming" elections (optional), computed from schedule + lifecycle (not `is_active`).
 */
export function useElectionCatalog() {
  const [activeElections, setActiveElections] = useState<Election[]>([]);
  const [expiredElections, setExpiredElections] = useState<Election[]>([]);
  const [completedElections, setCompletedElections] = useState<string[]>([]);

  // Finalized or archived elections must NEVER be treated as "active/ongoing".
  // Visible to voters only when NOT paused and NOT archived. (Final elections are excluded from voter flows.)
  const isOperationalElection = useCallback((e: Election) => !e?.is_final && !e?.is_archived && e?.is_paused !== true, []);

  const filterElectionsByEligibilityRpc = useCallback(async (elections: Election[], voterId: string) => {
    if (!elections.length) return [];

    const failedElectionIds: string[] = [];

    const results = await Promise.all(
      elections.map(async (e) => {
        const { data, error } = await supabase.rpc(
          "is_voter_eligible_for_election" as any,
          { p_voter_id: voterId, p_election_id: e.id } as any,
        );

        if (error) {
          failedElectionIds.push(e.id);
          return null;
        }

        return data ? e : null;
      }),
    );

    if (failedElectionIds.length > 0) {
      toast.error("Some eligibility checks failed. Please refresh.");
      console.error("Eligibility checks failed for elections:", failedElectionIds);
    }

    return results.filter((x): x is Election => Boolean(x));
  }, []);

  /**
   * Refresh elections + eligibility + completed status.
   * Returns computed values so callers can act immediately (e.g., auto-select, block if already voted).
   */
  const refreshElectionsAndStatus = useCallback(async (voterId: string) => {
    // 1) Load elections
    const { data, error: electionsErr } = await supabase.from("elections").select("*");

    const elections = data ?? [];

    if (electionsErr) {
      toast.error("Failed to load elections.");
      return null;
    }

    const now = new Date();

    // "Active" elections for the voter UI are computed from schedule (start/end) + lifecycle.
    // We intentionally do not rely on `is_active` here. Voter visibility uses schedule + lifecycle, plus the admin pause flag (`is_paused`).
    const activeTimeWindow = elections.filter((e) => {
      const start = toValidDate(e.start_date);
      const end = toValidDate(e.end_date);
      if (!start || !end) return false;
      return isOperationalElection(e) && start <= now && end > now;
    });

    // "Upcoming" elections (optional list shown to voters). Also computed purely from schedule + lifecycle.
    const upcomingTimeWindow = elections.filter((e) => {
      const start = toValidDate(e.start_date);
      const end = toValidDate(e.end_date);
      if (!start || !end) return false;
      return isOperationalElection(e) && start > now;
    });

    // Authoritative eligibility (server-side)
    const active = await filterElectionsByEligibilityRpc(activeTimeWindow, voterId);
    const upcoming = await filterElectionsByEligibilityRpc(upcomingTimeWindow, voterId);

    setActiveElections(active);
    setExpiredElections(upcoming);

    // 2) Refresh completed elections for ACTIVE only
    const activeIds = active.map((e) => e.id);

    if (activeIds.length === 0) {
      setCompletedElections([]);
      return {
        activeElections: active,
        expiredElections: upcoming,
        completedElections: [],
        hasVotedAllActive: false,
      };
    }

    let statusRows: Array<{ election_id: string; has_voted: boolean }> = [];
    try {
      statusRows = await kioskGetVoterElectionStatus({
        voter_id: voterId,
        election_ids: activeIds,
      });
    } catch (statusErr) {
      console.error("Failed to check voting status via kiosk function:", statusErr);
      toast.error("Failed to check voting status.");
      return null;
    }

    const completed = (statusRows ?? []).filter((r) => r.has_voted).map((r) => r.election_id);

    setCompletedElections(completed);

    const hasVotedAllActive = activeIds.every((id) => completed.includes(id));

    return {
      activeElections: active,
      expiredElections: upcoming,
      completedElections: completed,
      hasVotedAllActive,
    };
  }, [filterElectionsByEligibilityRpc, isOperationalElection]);

  const resetElectionCatalog = useCallback(() => {
    setActiveElections([]);
    setExpiredElections([]);
    setCompletedElections([]);
  }, []);

  return {
    activeElections,
    expiredElections,
    completedElections,
    refreshElectionsAndStatus,
    resetElectionCatalog,
  };
}
