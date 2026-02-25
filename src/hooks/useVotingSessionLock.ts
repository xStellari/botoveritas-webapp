import { getKioskId } from "@/utils/kioskIdentity";
import { kioskSession } from "@/utils/kioskApi";

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
    try {
      await kioskSession("end", { voter_id: voterId });
      return { error: null };
    } catch (e: any) {
      return { error: e };
    }
  };

  /**
   * Check if there is ANY active session using server time (SECURITY DEFINER).
   */
  const hasActiveSession = async (voterId: string) => {
    const kioskId = await getKioskId();
    try {
      const out = await kioskSession("has_active", { voter_id: voterId });
      return { hasActive: Boolean(out?.hasActive), kioskId, error: null };
    } catch (e: any) {
      return { hasActive: false, kioskId, error: e };
    }
  };

  /**
   * Fetch the current session row (kiosk_id + expires_at + extension_count) via SECURITY DEFINER RPC.
   * Note: This may return a row even if expires_at <= now(). Caller decides how to handle expiry.
   */
  const getActiveSessionRow = async (voterId: string) => {
    try {
      const out = await kioskSession("get_active", { voter_id: voterId });
      return { session: out?.session ?? null, error: null };
    } catch (e: any) {
      return { session: null, error: e };
    }
  };

  /**
   * Create or update a lock and enforce kiosk binding in the database.
   * Used for initial session creation right after auth.
   */
  const setSessionExpiresAt = async (voterId: string, expiresAtIso: string) => {
    const kioskId = await getKioskId();
    try {
      await kioskSession("upsert", { voter_id: voterId, expires_at: expiresAtIso });
      return { error: null, kioskId };
    } catch (e: any) {
      return { error: e, kioskId };
    }
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
    try {
      await kioskSession("extend", { voter_id: voterId, seconds });
      return { error: null };
    } catch (e: any) {
      return { error: e };
    }
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
