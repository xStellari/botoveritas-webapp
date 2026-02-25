import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setKioskConfig } from "@/utils/kioskIdentity";

/**
 * Kiosk runtime provisioning page.
 *
 * Usage (recommended one-time provisioning):
 *   /kiosk/setup?kiosk_id=<ID>&kiosk_secret=<SECRET>
 *
 * Optional:
 *   &persist=1    -> also store in localStorage (survives browser restarts)
 *   &return_to=/  -> redirect path after setup (defaults to "/")
 *
 * Default behavior stores in sessionStorage so the kiosk stays configured
 * as long as the browser process stays open (commonly "until PC restart" in kiosk mode).
 */
const KioskSetup: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const queryKioskId = (params.get("kiosk_id") || "").trim();
  const queryKioskSecret = (params.get("kiosk_secret") || "").trim();
  const queryPersist = (params.get("persist") || "").trim() === "1";
  const queryReturnToRaw = (params.get("return_to") || "").trim();
  const queryReturnTo = queryReturnToRaw.startsWith("/") ? queryReturnToRaw : "/";

  const [kioskId, setKioskId] = useState(queryKioskId);
  const [kioskSecret, setKioskSecret] = useState(queryKioskSecret);
  const [persist, setPersist] = useState(queryPersist);
  const [status, setStatus] = useState<string | null>(null);

  // Auto-provision when both query params exist
  useEffect(() => {
    if (!queryKioskId || !queryKioskSecret) return;

    setKioskConfig({ kioskId: queryKioskId, kioskSecret: queryKioskSecret, persist: queryPersist });
    setStatus("Kiosk configured. Redirecting...");

    const t = window.setTimeout(() => navigate(queryReturnTo, { replace: true }), 800);
    return () => window.clearTimeout(t);
  }, [queryKioskId, queryKioskSecret, queryPersist, queryReturnTo, navigate]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!kioskId || !kioskSecret) {
      setStatus("Please provide both kiosk_id and kiosk_secret.");
      return;
    }
    setKioskConfig({ kioskId: kioskId.trim(), kioskSecret: kioskSecret.trim(), persist });
    setStatus("Kiosk configured. Redirecting...");
    window.setTimeout(() => navigate(queryReturnTo, { replace: true }), 800);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "min(680px, 92vw)", padding: 20, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Kiosk Setup</h1>
        <p style={{ marginTop: 0, marginBottom: 16, color: "#4b5563" }}>
          This page provisions the kiosk identity used to call secured Edge Functions.
        </p>

        {status && (
          <div style={{ padding: 12, borderRadius: 10, background: "#f3f4f6", marginBottom: 16 }}>
            {status}
          </div>
        )}

        {!queryKioskId || !queryKioskSecret ? (
          <form onSubmit={handleSave}>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>kiosk_id</span>
                <input
                  value={kioskId}
                  onChange={(e) => setKioskId(e.target.value)}
                  placeholder="UUID or kiosk id"
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #d1d5db" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>kiosk_secret</span>
                <input
                  value={kioskSecret}
                  onChange={(e) => setKioskSecret(e.target.value)}
                  placeholder="Secret"
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #d1d5db" }}
                />
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
                <span>
                  Persist across browser restarts (stores in localStorage). If unchecked, configuration lasts until the
                  browser process ends (sessionStorage).
                </span>
              </label>

              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: "#111827",
                  color: "white",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save & Continue
              </button>

              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Tip: you can also provision via URL:
                <br />
                <code>
                  /kiosk/setup?kiosk_id=...&amp;kiosk_secret=...&amp;persist=1
                </code>
              </div>
            </div>
          </form>
        ) : (
          <div style={{ color: "#6b7280" }}>Provisioning from URL parameters…</div>
        )}
      </div>
    </div>
  );
};

export default KioskSetup;
