import { supabase } from "@/integrations/supabase/client";

/**
 * Centralized voter_sessions locking logic for the kiosk flow.
 *
 * RPC contract:
 * - has_active_voter_session(p_voter_id uuid) -> boolean
 *
 * Table contract:
 * - voter_sessions(voter_id PK, expires_at timestamptz)
 */
export function useVotingSessionLock() {
  const cleanupExpiredSession = async (voterId: string) => {
    const { error } = await supabase
      .from("voter_sessions")
      .delete()
      .eq("voter_id", voterId)
      .lte("expires_at", new Date().toISOString());

    return { error };
  };

  const hasActiveSession = async (voterId: string) => {
    const { data, error } = await supabase.rpc(
      "has_active_voter_session" as any,
      { p_voter_id: voterId } as any
    );

    return { hasActive: Boolean(data), error };
  };

  const createInitialLock = async (voterId: string, initialLockMs: number) => {
    const initialExpiresAt = new Date(Date.now() + initialLockMs).toISOString();

    const { error } = await supabase.from("voter_sessions").upsert({
      voter_id: voterId,
      expires_at: initialExpiresAt,
    });

    return { error };
  };

  const setSessionExpiresInMs = async (voterId: string, msFromNow: number) => {
    const expiresAt = new Date(Date.now() + msFromNow).toISOString();

    const { error } = await supabase.from("voter_sessions").upsert({
      voter_id: voterId,
      expires_at: expiresAt,
    });

    return { error };
  };

  const endSession = async (voterId: string) => {
    const { error } = await supabase
      .from("voter_sessions")
      .delete()
      .eq("voter_id", voterId);

    return { error };
  };

  return {
    cleanupExpiredSession,
    hasActiveSession,
    createInitialLock,
    setSessionExpiresInMs,
    endSession,
  };
}
