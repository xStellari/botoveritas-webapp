import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type VerifyStatus =
  | "idle"
  | "verifying"
  | "success"
  | "expired"
  | "used"
  | "invalid"
  | "error";

export default function VerifyEmail() {
  const [params] = useSearchParams();

  const token = useMemo(() => params.get("token")?.trim() || "", [params]);

  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);

  const runVerify = async () => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    setStatus("verifying");
    try {
      const { data, error } = await supabase.rpc(
        "verify_email_token" as any,
        { p_token: token } as any
      );

      if (error) {
        console.error("verify_email_token error:", error);
        setStatus("error");
        return;
      }

      const ok = Boolean((data as any)?.ok);
      const reason = (data as any)?.reason as string | undefined;

      if (ok) {
        setStatus("success");
        toast.success("Email verified successfully.");

        // Send registration confirmation email after successful verification (best effort).
        // Guard against accidental resends on refresh (per-browser session).
        try {
          const key = `bv_reg_email_sent_${token}`;
          const alreadySent = sessionStorage.getItem(key) === "1";

          if (!alreadySent) {
            sessionStorage.setItem(key, "1");
            const { error: regMailErr } = await supabase.functions.invoke(
              "send-registration-email",
              { body: { token } }
            );
            if (regMailErr) {
              console.warn("send-registration-email failed:", regMailErr);
            }
          }
        } catch (e) {
          console.warn("send-registration-email exception:", e);
        }

        return;
      }

      if (reason === "expired") setStatus("expired");
      else if (reason === "used") setStatus("used");
      else if (reason === "invalid") setStatus("invalid");
      else setStatus("error");
    } catch (e) {
      console.error("verify_email_token exception:", e);
      setStatus("error");
    }
  };

  useEffect(() => {
    runVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ✅ Auto-close tab after 3 seconds once we reach a terminal status
  useEffect(() => {
    const terminal =
      status === "success" ||
      status === "expired" ||
      status === "used" ||
      status === "invalid" ||
      status === "error";

    if (!terminal) {
      setAutoCloseSeconds(null);
      return;
    }

    setAutoCloseSeconds(3);

    const tick = setInterval(() => {
      setAutoCloseSeconds((prev) => {
        if (prev === null) return prev;
        return Math.max(0, prev - 1);
      });
    }, 1000);

    const closeTimer = setTimeout(() => {
      try {
        window.close();
      } catch {
        // Browser may block window.close() if tab wasn't opened via script.
      }
    }, 3000);

    return () => {
      clearInterval(tick);
      clearTimeout(closeTimer);
    };
  }, [status]);

  const Title = () => {
    if (status === "verifying") return "Verifying your email…";
    if (status === "success") return "Email verified";
    if (status === "expired") return "Link expired";
    if (status === "used") return "Already verified";
    if (status === "invalid") return "Invalid link";
    return "Verification failed";
  };

  const AutoCloseNote = () => {
    if (autoCloseSeconds === null) return null;

    return (
      <p className="text-xs text-muted-foreground mt-4">
        This tab will close automatically in{" "}
        <span className="font-mono font-semibold">{autoCloseSeconds}</span> seconds.
      </p>
    );
  };

  const Body = () => {
    if (status === "verifying") {
      return (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Please wait…
        </div>
      );
    }

    if (status === "success") {
      return (
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-700 font-semibold">
            <CheckCircle2 className="h-5 w-5" />
            Your registration is now active.
          </div>
          <p className="text-sm text-muted-foreground">
            You may now proceed to the voting kiosk.
          </p>
          <AutoCloseNote />
        </div>
      );
    }

    if (status === "expired") {
      return (
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2 text-amber-700 font-semibold">
            <Clock className="h-5 w-5" />
            This verification link has expired (72 hours).
          </div>
          <p className="text-sm text-muted-foreground">
            Please request a new verification email at the registration desk.
          </p>
          <AutoCloseNote />
        </div>
      );
    }

    if (status === "used") {
      return (
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-700 font-semibold">
            <CheckCircle2 className="h-5 w-5" />
            This link was already used.
          </div>
          <AutoCloseNote />
        </div>
      );
    }

    if (status === "invalid") {
      return (
        <div className="space-y-3 text-center">
          <div className="flex items-center justify-center gap-2 text-destructive font-semibold">
            <AlertCircle className="h-5 w-5" />
            Invalid verification link.
          </div>
          <p className="text-sm text-muted-foreground">
            Please request a new verification email at the registration desk.
          </p>
          <AutoCloseNote />
        </div>
      );
    }

    return (
      <div className="space-y-3 text-center">
        <div className="flex items-center justify-center gap-2 text-destructive font-semibold">
          <AlertCircle className="h-5 w-5" />
          Verification failed.
        </div>
        <p className="text-sm text-muted-foreground">
          Please request a new verification email at the registration desk.
        </p>
        <AutoCloseNote />
      </div>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-50">
      <Card className="p-8 max-w-md w-full text-center space-y-4 border border-primary/15 bg-white/90 backdrop-blur shadow-xl">
        <div className="text-2xl font-extrabold">{Title()}</div>
        <Body />
      </Card>
    </div>
  );
}
