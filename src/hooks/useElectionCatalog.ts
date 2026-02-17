import { useCallback, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";


type Election = {
  id: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
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
 * - "Expired/Closed" includes ended-by-time OR ended-by-lifecycle (finalized/archived).
 */
export function useElectionCatalog() {
  const [activeElections, setActiveElections] = useState<Election[]>([]);
  const [expiredElections, setExpiredElections] = useState<Election[]>([]);
  const [completedElections, setCompletedElections] = useState<string[]>([]);

  // Finalized or archived elections must NEVER be treated as "active/ongoing".
  const isOperationalElection = useCallback((e: Election) => !e?.is_final && !e?.is_archived, []);

  const filterElectionsByEligibilityRpc = useCallback(async (elections: Election[], voterId: string) => {
    if (!elections.length) return [];

    const failedElectionIds: string[] = [];

    const results = await Promise.all(
      elections.map(async (e) => {
        const { data, error } = await supabase.rpc(
          "is_voter_eligible_for_election" as any,
          { p_voter_id: voterId, p_election_id: e.id } as any
        );

        if (error) {
          failedElectionIds.push(e.id);
          return null;
        }

        return data ? e : null;
      })
    );

    if (failedElectionIds.length > 0) {
      toast.error("Some eligibility checks failed. Please refresh.");
      console.error("Eligibility checks failed for elections:", failedElectionIds);
    }

    return results.filter(Boolean);
  }, []);

  /**
   * Refresh elections + eligibility + completed status.
   * Returns computed values so callers can act immediately (e.g., auto-select, block if already voted).
   */
  const refreshElectionsAndStatus = useCallback(async (voterId: string) => {
    // 1) Load elections
    const { data: elections = [], error: electionsErr } = await supabase.from("elections").select("*");

    if (electionsErr) {
      toast.error("Failed to load elections.");
      return null;
    }

    const now = new Date();

    // "Active" must exclude finalized/archived even if time window is valid
    const activeTimeWindow = elections.filter((e) => {
      const start = toValidDate(e.start_date);
      const end = toValidDate(e.end_date);
      if (!start || !end) return false;
      return Boolean(e.is_active) && isOperationalElection(e) && start <= now && end > now;
    });

    // "Expired/Closed" includes:
    // - ended by time
    // - OR ended early due to lifecycle (finalized/archived)
    const expiredTimeWindow = elections.filter((e) => {
      const end = toValidDate(e.end_date);
      if (!end) return false;
      const endedByTime = end <= now;
      const endedByLifecycle = !isOperationalElection(e);
      return Boolean(e.is_active) && (endedByTime || endedByLifecycle);
    });

    // Authoritative eligibility (server-side)
    const active = await filterElectionsByEligibilityRpc(activeTimeWindow, voterId);
    const expired = await filterElectionsByEligibilityRpc(expiredTimeWindow, voterId);

    setActiveElections(active);
    setExpiredElections(expired);

    // 2) Refresh completed elections for ACTIVE only
    const activeIds = active.map((e) => e.id);

    if (activeIds.length === 0) {
      setCompletedElections([]);
      return {
        activeElections: active,
        expiredElections: expired,
        completedElections: [],
        hasVotedAllActive: false,
      };
    }

    const { data: statusRows, error: statusErr } = await supabase
      .from("voter_election_status")
      .select("election_id, has_voted")
      .eq("voter_id", voterId)
      .in("election_id", activeIds);

    if (statusErr) {
      toast.error("Failed to check voting status.");
      return null;
    }

    const completed = (statusRows ?? []).filter((r) => r.has_voted).map((r) => r.election_id);

    setCompletedElections(completed);

    const hasVotedAllActive = activeIds.every((id) => completed.includes(id));

    return {
      activeElections: active,
      expiredElections: expired,
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
