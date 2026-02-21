import { supabase } from "@/integrations/supabase/client";

// Stable per-kiosk identifier (unique per Edge kiosk profile).
// Priority:
// 1) VITE_KIOSK_ID (optional per-device env)
// 2) localStorage:botoveritas_kiosk_id (generated + persisted)
async function getKioskId(): Promise<string> {
  try {
    const envKioskId = (import.meta as any)?.env?.VITE_KIOSK_ID as string | undefined;
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem("botoveritas_kiosk_id") : null;

    const raw = envKioskId || stored;
    if (raw) return raw;

    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

    if (typeof window !== "undefined") {
      window.localStorage.setItem("botoveritas_kiosk_id", generated);
    }

    return generated;
  } catch {
    return "unknown";
  }
}

/**
 * Centralized voter_sessions locking logic for the kiosk flow.
 *
 * RPC contract:
 * - has_active_voter_session(p_voter_id)
 * - kiosk_get_active_voter_session(p_voter_id) -> returns kiosk_id, expires_at, extension_count
 * - kiosk_upsert_voter_session(p_voter_id, p_expires_at, p_kiosk_id)
 * - kiosk_end_voter_session(p_voter_id, p_kiosk_id)
 * - kiosk_extend_voter_session(p_voter_id, p_kiosk_id, p_seconds)
 */
export function useVotingSessionLock() {
  /**
   * End an active session (same-kiosk only; enforced by DB).
   */
  const endSession = async (voterId: string) => {
    const kioskId = await getKioskId();
    const { error } = await supabase.rpc(
      "kiosk_end_voter_session" as any,
      { p_voter_id: voterId, p_kiosk_id: kioskId } as any
    );
    return { error };
  };

  /**
   * Check if there is ANY active session using server time (SECURITY DEFINER).
   */
  const hasActiveSession = async (voterId: string) => {
    const kioskId = await getKioskId();
    const { data, error } = await supabase.rpc("has_active_voter_session" as any, { p_voter_id: voterId } as any);
    return { hasActive: Boolean(data), kioskId, error };
  };

  /**
   * Fetch the current session row (kiosk_id + expires_at + extension_count) via SECURITY DEFINER RPC.
   * Note: This may return a row even if expires_at <= now(). Caller decides how to handle expiry.
   */
  const getActiveSessionRow = async (voterId: string) => {
    const { data, error } = await supabase.rpc(
      "kiosk_get_active_voter_session" as any,
      { p_voter_id: voterId } as any
    );

    const row = Array.isArray(data) ? data[0] : data;
    return { session: row ?? null, error };
  };

  /**
   * Create or update a lock and enforce kiosk binding in the database.
   * Used for initial session creation right after auth.
   */
  const setSessionExpiresAt = async (voterId: string, expiresAtIso: string) => {
    const kioskId = await getKioskId();
    const { error } = await supabase.rpc(
      "kiosk_upsert_voter_session" as any,
      { p_voter_id: voterId, p_expires_at: expiresAtIso, p_kiosk_id: kioskId } as any
    );
    return { error, kioskId };
  };

  const createInitialLock = async (voterId: string, initialLockMs: number) => {
    const expiresAt = new Date(Date.now() + initialLockMs).toISOString();
    const { error } = await setSessionExpiresAt(voterId, expiresAt);
    return { error };
  };

  /**
   * Extend session expiry by a fixed number of seconds.
   * Enforced in DB (same kiosk + max extensions).
   */
  const extendSessionSeconds = async (voterId: string, seconds: number) => {
    const kioskId = await getKioskId();
    const { error } = await supabase.rpc(
      "kiosk_extend_voter_session" as any,
      { p_voter_id: voterId, p_kiosk_id: kioskId, p_seconds: seconds } as any
    );
    return { error };
  };

  const getCurrentKioskId = async () => getKioskId();

  return {
    getActiveSessionRow,
    hasActiveSession,
    createInitialLock,
    extendSessionSeconds,
    endSession,
    getCurrentKioskId,
  };
}
