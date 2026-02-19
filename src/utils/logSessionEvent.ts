import { supabase } from "@/integrations/supabase/client";

function getKioskSecret(): string | null {
  // Prefer build-time env (Vite)
  const envSecret =
    (import.meta as any)?.env?.VITE_KIOSK_SECRET ??
    (import.meta as any)?.env?.VITE_PUBLIC_KIOSK_SECRET ??
    null;

  if (typeof envSecret === "string" && envSecret.trim()) return envSecret.trim();

  // Runtime fallback (useful for kiosk deployments where env isn't embedded)
  try {
    const keys = [
      "botoveritas_kiosk_secret",
      "kiosk_secret",
      "kioskSecret",
      "VITE_KIOSK_SECRET",
    ];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
  } catch {
    // ignore
  }

  return null;
}

export async function logSessionEvent({
  voterId,
  action,
  kioskId,
}: {
  voterId: string;
  action:
    | "session_start"
    | "session_extend"
    | "session_end"
    | "simultaneous_block";
  kioskId?: string;
}) {
  try {
    const ua = navigator.userAgent || null;

    // ❗ DO NOT fetch IP from client (privacy risk & can fail)
    // Let server/edge function populate ip_address in future version
    const ip = null;

    const kioskSecret = getKioskSecret();
    if (!kioskSecret) {
      // Avoid blocking voting if kiosk isn't configured.
      console.warn(
        "[logSessionEvent] Skipped: missing kiosk secret (set VITE_KIOSK_SECRET or localStorage:botoveritas_kiosk_secret)"
      );
      return;
    }

    const { error } = await supabase.functions.invoke("kiosk-session-log", {
      body: {
        voter_id: voterId,
        action,
        kiosk_id: kioskId || null,
        ip_address: ip,
        user_agent: ua,
      },
      headers: {
        "x-kiosk-secret": kioskSecret,
      },
    });

    if (error) {
      console.error("[logSessionEvent] Edge invoke failed:", error.message);
    }
  } catch (err) {
    console.error("[logSessionEvent] Unexpected error:", err);
  }
}
