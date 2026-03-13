import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { setKioskConfig } from "@/utils/kioskIdentity";
import { warmupCamera } from "@/utils/cameraWarmup";

type ExchangeOk = {
  ok: true;
  kiosk_id: string;
  kiosk_secret: string;
  kiosk_secret_valid_days: number;
};

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function getFunctionsBaseUrl(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

async function exchange(args: { token?: string; code?: string; kiosk_name?: string }): Promise<ExchangeOk> {
  const base = getFunctionsBaseUrl();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "") as string;

  if (!base) throw new Error("Missing VITE_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing VITE_SUPABASE_ANON_KEY");

  const res = await fetch(`${base}/kiosk-provision-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const msg = parsed?.error || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return parsed as ExchangeOk;
}

function normalizeCode(input: string): string {
  return (input || "").replace(/\D/g, "").slice(0, 6);
}

export default function KioskProvision() {
  const navigate = useNavigate();
  const query = useQuery();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const [manualCode, setManualCode] = useState("");
  const [kioskName, setKioskName] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Kick off model preloading + camera stream acquisition as early as possible.
  // warmupCamera() is idempotent — safe to call multiple times; subsequent calls
  // are instant no-ops. We intentionally do NOT call it a second time after
  // navigation because claimWarmStream() in FacialRecognition will consume the
  // held stream; calling warmupCamera() again would just open a second stream
  // and immediately discard it.
  useEffect(() => {
    void warmupCamera();
  }, []);

  const returnTo = (() => {
    const rt = (query.get("return_to") || "/").trim();
    return rt.startsWith("/") ? rt : "/";
  })();

  const finishProvision = (data: ExchangeOk) => {
    setKioskConfig({ kioskId: data.kiosk_id, kioskSecret: data.kiosk_secret, persist: true });
    toast.success("Kiosk provisioned", {
      description: `Credentials saved (valid ${data.kiosk_secret_valid_days} days). Redirecting…`,
    });
    navigate(returnTo);
  };

  const doExchange = async (args: { token?: string; code?: string }) => {
    setBusy(true);
    setStatus("Provisioning…");
    try {
      const data = await exchange({ ...args, kiosk_name: kioskName.trim() || undefined });
      finishProvision(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Provisioning failed", { description: msg });
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  // If token is present in URL, auto-provision (admin can still use this as a backup).
  useEffect(() => {
    const token = (query.get("token") || "").trim();
    if (!token) return;
    doExchange({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autofocus code input for kiosk friendliness
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  // Auto-submit once 6 digits are entered
  useEffect(() => {
    const code = normalizeCode(manualCode);
    if (busy) return;
    if (code.length === 6) doExchange({ code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualCode]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Provision this kiosk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Kiosk name (optional)</Label>
              <Input value={kioskName} onChange={(e) => setKioskName(e.target.value)} placeholder="e.g., Library Kiosk" />
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="font-medium">Enter 6-digit code</div>

              <Input
                ref={inputRef}
                value={manualCode}
                onChange={(e) => setManualCode(normalizeCode(e.target.value))}
                placeholder="123456"
                inputMode="numeric"
                className="text-lg tracking-widest text-center"
                disabled={busy}
              />

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => doExchange({ code: normalizeCode(manualCode) })}
                  disabled={busy || normalizeCode(manualCode).length !== 6}
                  className="flex-1"
                >
                  Provision
                </Button>
                <Button type="button" variant="outline" onClick={() => setManualCode("")} disabled={busy}>
                  Clear
                </Button>
              </div>

              {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}

              <div className="text-xs text-muted-foreground">
                Tip: Generate the code in <code>/admin</code> → <strong>Kiosks</strong>. Codes expire after 10 minutes.
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Provisioning persists across refresh/crash because credentials are stored in localStorage.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
