// src/components/admin/SuperAdminOtpGate.tsx
// Wraps any sensitive super-admin action behind an email OTP confirmation.
// Usage:
//   <SuperAdminOtpGate action="enrolled_import" onVerified={runImport}>
//     <Button>Import Students</Button>
//   </SuperAdminOtpGate>

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, ShieldCheck, Mail } from "lucide-react";

type Action = "enrolled_import" | "role_management" | "finalize_election";

const ACTION_LABELS: Record<Action, string> = {
  enrolled_import:   "Import Enrolled Students",
  role_management:   "Manage Admin Roles",
  finalize_election: "Finalize Election",
};

interface Props {
  action: Action;
  onVerified: () => void | Promise<void>;
  children: React.ReactNode;
  /** Optional: override the trigger button click entirely */
  triggerLabel?: string;
}

type Step = "idle" | "sending" | "entering" | "verifying" | "verified";

export function SuperAdminOtpGate({ action, onVerified, children }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const getFunctionsBase = () => {
    const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
    return `${url.replace(/\/$/, "")}/functions/v1`;
  };

  const getAuthHeader = async () => {
    const { data } = await supabase.auth.getSession();
    return `Bearer ${data.session?.access_token ?? ""}`;
  };

  const requestOtp = useCallback(async () => {
    setStep("sending");
    setError(null);
    try {
      const base = getFunctionsBase();
      const authHeader = await getAuthHeader();
      const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "") as string;

      const res = await fetch(`${base}/send-super-admin-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");

      setMaskedEmail(data.masked_email || "your admin email");
      setStep("entering");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("idle");
    }
  }, [action]);

  const verifyOtp = useCallback(async () => {
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }
    setStep("verifying");
    setError(null);
    try {
      const base = getFunctionsBase();
      const authHeader = await getAuthHeader();
      const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "") as string;

      const res = await fetch(`${base}/verify-super-admin-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({ action, code }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      setStep("verified");
      setOpen(false);
      setCode("");
      toast.success("Identity verified — proceeding.");
      await onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("entering");
    }
  }, [action, code, onVerified]);

  const handleOpen = () => {
    setStep("idle");
    setCode("");
    setError(null);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setCode("");
    setError(null);
    setStep("idle");
  };

  return (
    <>
      {/* Wrap the trigger child with an onClick interceptor */}
      <span onClick={handleOpen} style={{ display: "contents" }}>
        {children}
      </span>

      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <DialogTitle className="text-emerald-900">Super Admin Verification</DialogTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              The action <span className="font-semibold text-emerald-800">{ACTION_LABELS[action]}</span> requires
              Super Admin confirmation. A one-time code will be sent to your admin email.
            </p>
          </DialogHeader>

          {step === "idle" && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold mb-0.5">Why is this required?</p>
                <p className="text-xs">
                  This action can permanently affect voter eligibility and election integrity.
                  An email OTP ensures that even if your password is compromised, unauthorized
                  actors cannot perform this action.
                </p>
              </div>
              <Button
                className="w-full bg-emerald-700 hover:bg-emerald-800"
                onClick={requestOtp}
              >
                <Mail className="h-4 w-4 mr-2" />
                Send verification code to my email
              </Button>
            </div>
          )}

          {step === "sending" && (
            <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />
              Sending verification code…
            </div>
          )}

          {(step === "entering" || step === "verifying") && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                A 6-digit code was sent to <span className="font-mono font-semibold">{maskedEmail}</span>.
                It expires in 10 minutes.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.5em] font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                autoFocus
                disabled={step === "verifying"}
              />
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={requestOtp} disabled={step === "verifying"}>
                  Resend code
                </Button>
                <Button
                  className="flex-[2] bg-emerald-700 hover:bg-emerald-800"
                  onClick={verifyOtp}
                  disabled={code.length !== 6 || step === "verifying"}
                >
                  {step === "verifying" ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…</>
                  ) : "Confirm"}
                </Button>
              </div>
            </div>
          )}

          {error && step === "idle" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
