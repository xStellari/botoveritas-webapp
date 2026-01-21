import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { AlertCircle, Camera, CheckCircle2, Loader2, Scan, ShieldCheck } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

import RFIDScanner from "./RFIDScanner";
import FacialRecognition from "./FacialRecognition";
import { compareDescriptors } from "@/utils/faceMatching";

interface AuthenticationScreenProps {
  onAuthSuccess: (data: { rfidTag: string }) => void;
}

type Step = "rfid" | "face" | "done" | "error";
type StepStatus = "active" | "complete" | "locked";

function maskRfid(uid: string) {
  if (!uid) return "";
  const last4 = uid.slice(-4);
  return `•••• ${last4}`;
}

const StepCard = ({
  icon,
  title,
  subtitle,
  status,
  expanded,
  children,
  meta,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: StepStatus;
  expanded: boolean;
  children?: ReactNode;
  meta?: ReactNode;
}) => {
  const statusLabel =
    status === "complete" ? "Completed" : status === "active" ? "In progress" : "Locked";

  return (
    <div
      className={[
        "h-fit w-full overflow-hidden rounded-2xl border bg-white/90 backdrop-blur-sm shadow-sm",
        status === "active" ? "border-primary/40 ring-2 ring-primary/10" : "border-border/70",
      ].join(" ")}
      aria-label={`${title} - ${statusLabel}`}
    >
      {/* Header row (always compact) */}
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
              status === "active"
                ? "border-primary/20 bg-primary/10 text-primary"
                : status === "complete"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                : "border-border/60 bg-muted/40 text-muted-foreground",
            ].join(" ")}
          >
            {icon}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {meta ? <div className="hidden sm:block">{meta}</div> : null}

          {status === "complete" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : status === "active" ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {statusLabel}
            </div>
          ) : (
            <div className="inline-flex items-center rounded-full bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
              {statusLabel}
            </div>
          )}
        </div>
      </div>

      {/* Expandable body: ONLY render when expanded to avoid blank-space cards */}
      {expanded ? (
        <div className="border-t border-border/60 bg-white/70 px-5 py-4">{children}</div>
      ) : null}

      {/* Meta (mobile) */}
      {meta ? <div className="sm:hidden px-5 pb-4 -mt-2 text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  );
};

const AuthenticationScreen = ({ onAuthSuccess }: AuthenticationScreenProps) => {
  const navigate = useNavigate();

  const [voterId, setVoterId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("rfid");

  const [statusMessage, setStatusMessage] = useState<string>("Ready. Please tap your Student ID.");
  const [rfidTag, setRfidTag] = useState<string>("");
  const [rfidVerified, setRfidVerified] = useState<boolean>(false);

  const [faceVerified, setFaceVerified] = useState<boolean>(false);
  const [storedDescriptor, setStoredDescriptor] = useState<Float32Array | null>(null);

  useEffect(() => {
    if (step !== "error") return;

    const timer = setTimeout(() => {
      window.location.reload();
    }, 5000);

    return () => clearTimeout(timer);
  }, [step]);

  const logAttempt = async (
    type: string,
    rfid: string,
    distance?: number,
    voterIdOverride?: string | null
  ) => {
    const payload = {
      event_type: type,
      rfid_tag: rfid || null,
      distance_score: typeof distance === "number" ? distance : null,
      voter_id: voterIdOverride ?? voterId,
    };

    const { error } = await supabase.from("auth_logs").insert([payload]);

    if (error) {
      console.error("auth_logs insert failed:", error);
      toast.error(`auth_logs insert failed: ${error.message}`);
    }

    return { error };
  };

  // ---------------------------------------------------------------------
  // 1️⃣ HANDLE RFID TAP
  // ---------------------------------------------------------------------
  const handleRFID = async (uid: string) => {
    const normalized = uid?.trim();
    if (!normalized) return;

    setStep("rfid");
    setStatusMessage("Checking RFID in database...");

    await logAttempt("RFID_SCANNED", normalized);
    setRfidTag(normalized);

    const { data, error } = await supabase
      .from("voters")
      .select("id, face_descriptor, email_verified_at")
      .eq("rfid_tag", normalized)
      .single();

    if (error || !data) {
      console.error("RFID not found:", error?.message);
      setStatusMessage("RFID not registered. Please contact election staff.");
      await logAttempt("RFID_NOT_REGISTERED", normalized);
      setStep("error");
      return;
    }

    setVoterId(data.id);

    if (!data.email_verified_at) {
      setStatusMessage(
        "Email verification required. Please open the verification link sent to your school email, then try again."
      );
      await logAttempt("EMAIL_NOT_VERIFIED", normalized, undefined, data.id);
      setStep("error");
      return;
    }

    if (!data.face_descriptor) {
      setStatusMessage("No facial data found for this RFID.");
      await logAttempt("RFID_NO_FACE_DATA", normalized, undefined, data.id);
      setStep("error");
      return;
    }

    setStoredDescriptor(new Float32Array(data.face_descriptor));
    setRfidVerified(true);

    await logAttempt("RFID_VERIFIED", normalized, undefined, data.id);

    // Move to Step 2; Step 1 collapses automatically (no blank space)
    setStep("face");
    setStatusMessage("RFID verified. Please align your face with the camera.");
  };

  // ---------------------------------------------------------------------
  // 2️⃣ HANDLE FACE CAPTURE → MATCH AGAINST STORED DESCRIPTOR
  // ---------------------------------------------------------------------
  const handleFaceCaptured = async (liveDescriptor: Float32Array) => {
    if (!storedDescriptor) {
      setStatusMessage("No stored face data found.");
      setStep("error");
      return;
    }

    const { match, distance } = compareDescriptors(storedDescriptor, liveDescriptor);
    console.log("Face match distance:", distance);

    if (match) {
      setFaceVerified(true);
      setStep("done");
      setStatusMessage("Face matched. Loading ballot...");

      await logAttempt("FACE_MATCH", rfidTag, distance, voterId);

      setTimeout(() => {
        onAuthSuccess({ rfidTag });
      }, 500);

      return;
    }

    setStep("error");
    setStatusMessage("Face mismatch detected. Authentication failed.");

    await logAttempt("FACE_MISMATCH", rfidTag, distance, voterId);

    navigate("/registration-error", {
      state: {
        message: "Face mismatch detected. Suspicious login attempt logged.",
      },
    });
  };

  const step1Status: StepStatus = useMemo(() => {
    if (rfidVerified) return "complete";
    if (step === "rfid") return "active";
    return "locked";
  }, [rfidVerified, step]);

  const step2Status: StepStatus = useMemo(() => {
    if (faceVerified) return "complete";
    if (!rfidVerified) return "locked";
    if (step === "face") return "active";
    return "locked";
  }, [faceVerified, rfidVerified, step]);

  const statusTone = useMemo(() => {
    if (step === "done") return "bg-emerald-500/10 text-emerald-700";
    if (step === "error") return "bg-destructive/10 text-destructive";
    if (step === "face") return "bg-primary/10 text-primary";
    return "bg-muted/40 text-foreground";
  }, [step]);

  const step1Expanded = step === "rfid";
  const step2Expanded = step === "face";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-feu-green/10 via-background to-feu-gold/10">
      <Card className="w-full max-w-5xl border border-primary/15 bg-white/90 backdrop-blur-sm shadow-2xl">
        <div className="p-8 sm:p-10">
          {/* RFID Listener (auto) */}
          <RFIDScanner onScan={handleRFID} />

          {/* Header */}
          <div className="flex flex-col items-center">
            <img src={feuLogo} alt="FEU Alabang" className="h-16 sm:h-20 w-auto mb-4" />
            <h1 className="text-3xl sm:text-4xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent">
              BotoVeritas
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground text-center">
              Two-factor voter authentication
            </p>
          </div>

          {/* Steps */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <StepCard
              icon={<Scan className="h-5 w-5" />}
              title="Step 1: RFID Authentication"
              subtitle="Tap your Student ID on the reader"
              status={step1Status}
              expanded={step1Expanded}
              meta={rfidVerified ? <span className="font-mono">{maskRfid(rfidTag)}</span> : null}
            >
              {/* Expanded content (ONLY while active) */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Waiting for RFID scan</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Hold your Student ID close to the reader until it registers.
                  </div>
                  <div className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${statusTone}`}>
                    {statusMessage}
                  </div>
                </div>
              </div>
            </StepCard>

            <StepCard
              icon={<Camera className="h-5 w-5" />}
              title="Step 2: Facial Recognition"
              subtitle="Align your face with the camera"
              status={step2Status}
              expanded={step2Expanded}
              
            >
              {/* Expanded content (ONLY while active) */}
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Tip: face the camera, avoid strong backlight, and keep your head level.
                </div>

                <div className="inline-flex items-center gap-2 rounded-full bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground w-fit">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Live check
                </div>

                <div className="overflow-hidden rounded-2xl border border-border/60 bg-black/5">
                  <FacialRecognition onCapture={handleFaceCaptured} />
                </div>

                <div className={`rounded-xl px-4 py-3 text-sm font-medium ${statusTone}`}>
                  {statusMessage}
                </div>
              </div>
            </StepCard>
          </div>

          {/* Done / Error cards below (compact) */}
          {step === "done" ? (
            <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-emerald-800">Authenticated</div>
                  <div className="mt-1 text-xs text-muted-foreground">Loading ballot…</div>
                </div>
              </div>
            </div>
          ) : null}

          {step === "error" ? (
            <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Authentication failed</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Please contact election staff. This kiosk will reset automatically.
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">Returning to main in ~5 seconds…</div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Footer */}
          <div className="mt-10 pt-6 border-t border-border/50">
            <p className="text-sm text-center text-muted-foreground">Secure • Transparent • Verifiable</p>
            <p className="text-xs text-center text-muted-foreground mt-2">
              Powered by Blockchain Technology &amp; NFT Proof of Vote
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AuthenticationScreen;
