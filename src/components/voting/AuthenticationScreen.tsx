import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  Scan,
  ShieldCheck,
} from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import RFIDScanner from "./RFIDScanner";
import FacialRecognition from "./FacialRecognition";
import { compareDescriptors } from "@/utils/faceMatching";
import { kioskAuthLog, kioskGetVoterByRfid } from "@/utils/kioskApi";

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
    status === "complete"
      ? "Completed"
      : status === "active"
      ? "In progress"
      : "Locked";

  return (
    <div
      className={[
        "h-fit w-full overflow-hidden rounded-2xl border bg-white/90 backdrop-blur-sm shadow-sm",
        status === "active"
          ? "border-primary/40 ring-2 ring-primary/10"
          : "border-border/70",
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
            <div className="mt-1 text-xs text-muted-foreground leading-snug">
              {subtitle}
            </div>
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
        <div className="border-t border-border/60 bg-white/70 px-5 py-4">
          {children}
        </div>
      ) : null}

      {/* Meta (mobile) */}
      {meta ? (
        <div className="sm:hidden px-5 pb-4 -mt-2 text-xs text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </div>
  );
};

const AuthenticationScreen = ({ onAuthSuccess }: AuthenticationScreenProps) => {
  const navigate = useNavigate();

  const [voterId, setVoterId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("rfid");

  const [statusMessage, setStatusMessage] = useState<string>(
    "Ready. Please tap your Student ID."
  );
  const [rfidTag, setRfidTag] = useState<string>("");
  const [rfidVerified, setRfidVerified] = useState<boolean>(false);

  const [faceVerified, setFaceVerified] = useState<boolean>(false);
  const [storedDescriptor, setStoredDescriptor] =
    useState<Float32Array | null>(null);

  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const ERROR_RESET_MS = 10000;

  useEffect(() => {
    if (step !== "error") return;

    const timer = setTimeout(() => {
      window.location.reload();
    }, ERROR_RESET_MS);

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
      setWarningMessage(
        "Warning: Security logging is currently unavailable. Please inform election staff."
      );
    }

    return { error };
  };

  // ---------------------------------------------------------------------
  // 1️⃣ HANDLE RFID TAP
  // ---------------------------------------------------------------------
  const handleRFID = async (uid: string) => {
    const normalized = uid?.trim();
    if (!normalized) return;
    // Belt-and-suspenders: ignore RFID input if we are past the rfid step
    if (step !== "rfid") return;

    setWarningMessage(null);

    setStep("rfid");
    setStatusMessage("Checking RFID in database...");

    await logAttempt("RFID_SCANNED", normalized);
    setRfidTag(normalized);

    let data: any = null;
    try {
      data = await kioskGetVoterByRfid(normalized);
    } catch (err: any) {
      const status = (err as any)?.status;
      const msg = String((err as any)?.message || "");

      if (msg.toLowerCase().includes("kiosk not configured")) {
        setStatusMessage(
          "This kiosk is not configured yet. Please contact election staff to set up this device."
        );
      } else if (status === 403 && msg.toLowerCase().includes("kiosk not approved")) {
        setStatusMessage(
          "This kiosk is not authenticated. Please contact election staff to approve this device."
        );
      } else {
        setStatusMessage(
          "Unable to verify RFID right now. Please try again or contact election staff."
        );
      }

      await logAttempt("RFID_LOOKUP_FAILED", normalized);
      setStep("error");
      return;
    }


    if (!data) {
      console.error("RFID not found");
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

    // ---------------------------------------------------------------
    // ✅ Thesis adviser requirement:
    // Block ineligible voters IMMEDIATELY after RFID auth (before facial ID).
    // We do this by checking whether the voter has at least one eligible ACTIVE election.
    // If none, we stop the flow here and show a clear error screen.
    // ---------------------------------------------------------------
    try {
      const { data: elections, error: electionsErr } = await supabase
        .from("elections")
        .select("id,start_date,end_date,is_active,is_final,is_archived");

      if (electionsErr) {
        console.error("Failed to load elections for eligibility precheck:", electionsErr);
        setStatusMessage("Unable to verify election eligibility. Please ask election staff.");
        await logAttempt("ELIGIBILITY_PRECHECK_FAILED", normalized, undefined, data.id);
        setStep("error");
        return;
      }

      const now = new Date();
      const operationalActive = (elections ?? []).filter((e: any) => {
        if (!e?.is_active) return false;
        if (e?.is_final || e?.is_archived) return false;
        const start = new Date(e.start_date);
        const end = new Date(e.end_date);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return start <= now && end > now;
      });

      if (operationalActive.length === 0) {
        await logAttempt("NO_ACTIVE_ELECTIONS", normalized, undefined, data.id);
        navigate("/error", {
          state: {
            title: "No Active Elections",
            reason: "NO_ACTIVE_ELECTIONS",
            voter_audience: (data as any).voter_audience,
            message:
              "There are currently no active elections available. Please contact election staff.",
            recoverTo: "/voting",
            countdownSeconds: 10,
          },
        });
        setStep("error");
        return;
      }

      const eligResults = await Promise.all(
        operationalActive.map(async (e: any) => {
          const { data: isEligible, error: eligErr } = await supabase.rpc(
            "is_voter_eligible_for_election" as any,
            { p_voter_id: data.id, p_election_id: e.id } as any
          );
          if (eligErr) return false;
          return Boolean(isEligible);
        })
      );

      const hasAnyEligible = eligResults.some(Boolean);

      if (!hasAnyEligible) {
        await logAttempt("NO_ELIGIBLE_ELECTIONS", normalized, undefined, data.id);
        navigate("/error", {
          state: {
            title: "No Eligible Elections",
            reason: "NO_ELIGIBLE_ELECTIONS",
            voter_audience: (data as any).voter_audience,
            message:
              "There are currently no eligible active elections available at this time. If you believe this is a mistake, please contact your system administrator.",
            recoverTo: "/voting",
            countdownSeconds: 10,
          },
        });
        setStep("error");
        return;
      }
    } catch (err) {
      console.error("Eligibility precheck error:", err);
      setStatusMessage("Unable to verify election eligibility. Please ask election staff.");
      await logAttempt("ELIGIBILITY_PRECHECK_EXCEPTION", normalized, undefined, data.id);
      setStep("error");
      return;
    }

    if (!data.face_descriptor) {
      setStatusMessage("No facial data found for this RFID.");
      await logAttempt("RFID_NO_FACE_DATA", normalized, undefined, data.id);
      setStep("error");
      return;
    }

    const parsed = Array.isArray(data.face_descriptor)
      ? data.face_descriptor
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((v) => Number.isFinite(v))
      : [];

    if (parsed.length === 0) {
      setStatusMessage("No facial data found for this RFID.");
      await logAttempt("RFID_NO_FACE_DATA", normalized, undefined, data.id);
      setStep("error");
      return;
    }

    setStoredDescriptor(new Float32Array(parsed));
    setRfidVerified(true);

    await logAttempt("RFID_VERIFIED", normalized, undefined, data.id);

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

    const { match, distance } = compareDescriptors(
      storedDescriptor,
      liveDescriptor
    );
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

    navigate("/error", {
      state: {
        title: "Authentication Failed",
        reason: "FACE_MISMATCH",
        message: "Face mismatch detected. Authentication failed.",
        recoverTo: "/voting",
        countdownSeconds: 10,
      },
    });
  };

  const step1Status: StepStatus = useMemo(() => {
    if (rfidVerified) return "complete";
    // ✅ Keep Step 1 “active” while error so the status box remains the main focus.
    if (step === "rfid" || step === "error") return "active";
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

  // ✅ KEY FIX:
  // Keep Step 1 expanded on error so the real message (email verification required, etc.)
  // stays visible in the same place.
  const step1Expanded = step === "rfid" || step === "error";
  const step2Expanded = step === "face";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-feu-green/10 via-background to-feu-gold/10">
      <Card className="w-full max-w-5xl border border-primary/15 bg-white/90 backdrop-blur-sm shadow-2xl">
        <div className="p-8 sm:p-10">
          <RFIDScanner onScan={handleRFID} disabled={step !== "rfid"} />

          {/* Header */}
          <div className="relative flex flex-col items-center">
            <div className="absolute right-0 top-0">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => navigate("/", { replace: true })}
              >
                Go to Home
              </Button>
            </div>
            <img
              src={feuLogo}
              alt="FEU Alabang"
              className="h-16 sm:h-20 w-auto mb-4"
            />
            <h1 className="text-3xl sm:text-4xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent">
              BotoVeritas
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground text-center">
              Two-factor voter authentication
            </p>
          </div>

          {/* Warnings (non-blocking) */}
          <div className="mt-6 space-y-3">
            {warningMessage ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-amber-900">
                      System notice
                    </div>
                    <div className="mt-1 text-xs text-amber-900/80">
                      {warningMessage}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {rfidVerified && step !== "error" ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-emerald-900">
                        RFID verified
                      </div>
                      <div className="mt-0.5 text-xs text-emerald-900/70">
                        Student ID accepted — proceed to facial recognition.
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-mono text-emerald-900">
                    {maskRfid(rfidTag)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Steps */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <StepCard
              icon={<Scan className="h-5 w-5" />}
              title="Step 1: RFID Authentication"
              subtitle="Tap your Student ID on the reader"
              status={step1Status}
              expanded={step1Expanded}
              meta={
                rfidTag ? (
                  <span className="font-mono">{maskRfid(rfidTag)}</span>
                ) : null
              }
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {step === "error" ? "Action required" : "Waiting for RFID scan"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {step === "error"
                      ? "Please follow the instruction below before trying again."
                      : "Hold your Student ID close to the reader until it registers."}
                  </div>

                  {/* ✅ This is the message you care about — it now stays visible even on error */}
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
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Tip: face the camera, avoid strong backlight, and keep your head
                  level.
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

          {/* Done */}
          {step === "done" ? (
            <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-emerald-800">
                    Authenticated
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Loading ballot…
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* ✅ Error becomes a compact banner instead of a huge block */}
          {step === "error" ? (
            <div className="mt-4 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Authentication halted</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    This kiosk will reset in ~{Math.ceil(ERROR_RESET_MS / 1000)} seconds…
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Footer */}
          <div className="mt-10 pt-6 border-t border-border/50">
            <p className="text-sm text-center text-muted-foreground">
              Secure • Transparent • Verifiable
            </p>
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
