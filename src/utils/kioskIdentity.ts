// src/utils/kioskIdentity.ts
// Stable per-kiosk identifier (unique per Edge kiosk profile).
// Priority:
// 1) VITE_KIOSK_ID (optional per-device env)
// 2) localStorage:botoveritas_kiosk_id (generated + persisted)

export async function getKioskId(): Promise<string> {
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
