// src/hooks/useKioskHeartbeat.ts
import React, { useEffect, useRef, useState } from "react";
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

  // credentialVersion bumps whenever localStorage changes — this lets the effect
  // re-run automatically right after KioskProvision writes the new credentials,
  // without requiring a manual page refresh.
  const [credentialVersion, setCredentialVersion] = useStorageVersion();

  useEffect(() => {
    // cleanup existing timer
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled) return;

    const base = getFunctionsBaseUrl();
    if (!base) return;

    // Read credentials fresh every time this effect runs
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
        // silent — offline shows up via last_seen_at not updating
      }
    };

    // Fire immediately then on interval
    void send();
    timerRef.current = window.setInterval(() => void send(), intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, credentialVersion]); // credentialVersion re-fires after provision
}

/**
 * Returns a counter that increments whenever setKioskConfig writes new credentials.
 * Listens for the custom "kiosk-credentials-updated" event dispatched by
 * kioskIdentity.ts — this works in the same tab, unlike the native "storage" event
 * which only fires across tabs. This makes the heartbeat start automatically
 * right after KioskProvision finishes, with no page refresh.
 */
function useStorageVersion(): [number, React.Dispatch<React.SetStateAction<number>>] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const onCredentials = () => setVersion((v) => v + 1);
    window.addEventListener("kiosk-credentials-updated", onCredentials);
    return () => window.removeEventListener("kiosk-credentials-updated", onCredentials);
  }, []);

  return [version, setVersion];
}