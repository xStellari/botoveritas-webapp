import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type VerifyStatus = "idle" | "verifying" | "success" | "expired" | "used" | "invalid" | "error";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const token = useMemo(() => params.get("token")?.trim() || "", [params]);

  const [status, setStatus] = useState<VerifyStatus>("idle");

  const runVerify = async () => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    setStatus("verifying");
    try {
      const { data, error } = await supabase.rpc("verify_email_token" as any, {
        p_token: token,
      } as any);

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

  const Title = () => {
    if (status === "verifying") return "Verifying your email…";
    if (status === "success") return "Email verified";
    if (status === "expired") return "Link expired";
    if (status === "used") return "Already verified";
    if (status === "invalid") return "Invalid link";
    return "Verification failed";
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
          <Button className="w-full" onClick={() => navigate("/")}>
            Go to Home
          </Button>
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
          <Button className="w-full" variant="outline" onClick={() => navigate("/")}>
            Go to Home
          </Button>
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
          <Button className="w-full" onClick={() => navigate("/")}>
            Go to Home
          </Button>
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
          <Button className="w-full" variant="outline" onClick={() => navigate("/")}>
            Go to Home
          </Button>
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
          Please try again or request a new verification email.
        </p>
        <div className="flex gap-2">
          <Button className="w-full" variant="outline" onClick={runVerify}>
            Retry
          </Button>
          <Button className="w-full" onClick={() => navigate("/")}>
            Home
          </Button>
        </div>
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
