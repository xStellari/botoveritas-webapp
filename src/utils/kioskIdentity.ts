// src/utils/kioskIdentity.ts
// Kiosk identity helpers.
//
// Priority for kiosk_id:
// 1) VITE_KIOSK_ID (baked at build time; useful for per-device builds)
// 2) sessionStorage:kiosk_id (runtime setup; lasts until browser process ends)
// 3) localStorage:kiosk_id (runtime setup w/ persist=1; survives browser restarts)
//
// Priority for kiosk_secret:
// 1) sessionStorage:kiosk_secret
// 2) localStorage:kiosk_secret
// 3) VITE_KIOSK_SECRET (baked at build time; useful for per-device builds)

const KEY_ID = "kiosk_id";
const KEY_SECRET = "kiosk_secret";

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // ignore
  }
}

export function getConfiguredKioskId(): string | null {
  if (typeof window === "undefined") return null;
  return safeGet(window.sessionStorage, KEY_ID) || safeGet(window.localStorage, KEY_ID);
}

export function getConfiguredKioskSecret(): string | null {
  if (typeof window === "undefined") return null;
  return safeGet(window.sessionStorage, KEY_SECRET) || safeGet(window.localStorage, KEY_SECRET);
}

export function setKioskConfig(args: { kioskId: string; kioskSecret: string; persist?: boolean }): void {
  if (typeof window === "undefined") return;
  const { kioskId, kioskSecret, persist } = args;

  // Always write to sessionStorage (so it works immediately without reboot).
  safeSet(window.sessionStorage, KEY_ID, kioskId);
  safeSet(window.sessionStorage, KEY_SECRET, kioskSecret);

  // Optionally persist across browser restarts.
  if (persist) {
    safeSet(window.localStorage, KEY_ID, kioskId);
    safeSet(window.localStorage, KEY_SECRET, kioskSecret);
  }

  // Notify same-tab listeners (e.g. useKioskHeartbeat) that credentials are ready.
  // The native "storage" event only fires in OTHER tabs, so we dispatch our own.
  window.dispatchEvent(new CustomEvent("kiosk-credentials-updated"));
}

export async function getKioskId(): Promise<string> {
  try {
    const envKioskId = (import.meta as any)?.env?.VITE_KIOSK_ID as string | undefined;
    const configured = getConfiguredKioskId();

    const raw = (envKioskId || "").trim() || (configured || "").trim();
    if (raw) return raw;

    // Fallback: generate a stable-ish id (persisted locally) for dev.
    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

    if (typeof window !== "undefined") {
      // Keep old behavior: persist so reloads keep the same id.
      safeSet(window.localStorage, KEY_ID, generated);
    }

    return generated;
  } catch {
    return "unknown";
  }
}

export function getKioskSecret(): string {
  try {
    const configured = getConfiguredKioskSecret();
    if (configured && configured.trim()) return configured.trim();

    const envSecret = (import.meta as any)?.env?.VITE_KIOSK_SECRET as string | undefined;
    return (envSecret || "").trim();
  } catch {
    return "";
  }
}

export function updateKioskSecret(newSecret: string, opts?: { persist?: boolean }) {
  if (typeof window === "undefined") return;
  const secret = (newSecret || "").trim();
  if (!secret) return;

  // keep existing id if present
  const kioskId = getConfiguredKioskId() || safeGet(window.localStorage, KEY_ID) || "";

  // Always update sessionStorage so it takes effect immediately
  safeSet(window.sessionStorage, KEY_SECRET, secret);
  if (kioskId) safeSet(window.sessionStorage, KEY_ID, kioskId);

  // Optionally persist across browser restarts.
  const persist = Boolean(opts?.persist);
  if (persist) {
    safeSet(window.localStorage, KEY_SECRET, secret);
    if (kioskId) safeSet(window.localStorage, KEY_ID, kioskId);
  }
}
