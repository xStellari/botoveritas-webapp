// src/hooks/useKioskHeartbeat.ts
import { useEffect, useRef } from "react";
import { getConfiguredKioskId, getKioskSecret } from "@/utils/kioskIdentity";

type Options = {
  /** Run heartbeat only when true */
  enabled: boolean;
  /** Interval in ms (default 30s) */
  intervalMs?: number;
};

function getFunctionsBaseUrl(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

export function useKioskHeartbeat(opts: Options) {
  const { enabled, intervalMs = 30_000 } = opts;
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // cleanup existing timer
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled) return;

    const base = getFunctionsBaseUrl();
    if (!base) return;

    const kioskId = (getConfiguredKioskId() || "").trim();
    const kioskSecret = (getKioskSecret() || "").trim();
    if (!kioskId || !kioskSecret) return;

    const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "") as string;

    const send = async () => {
      try {
        await fetch(`${base}/kiosk-heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(anonKey ? { apikey: anonKey } : {}),
            "x-kiosk-id": kioskId,
            "x-kiosk-secret": kioskSecret,
          },
          body: "{}",
        });
      } catch {
        // silent (offline is expected to show up via last_seen_at not updating)
      }
    };

    // fire immediately then interval
    void send();
    timerRef.current = window.setInterval(() => void send(), intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs]);
}
