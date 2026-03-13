import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

const AUDIT = {
  entityType: "app_setting",
  entityId: "00000000-0000-0000-0000-000000000000",
  actionRegistrationMessage: "registration_message_set",
} as const;

// OPTIONAL: Your capitalization helper (keep your preferred version)
const formatName = (str: string) => {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (/^(ii|iii|iv|v)$/i.test(word)) return word.toUpperCase();
      if (word.endsWith(".")) return word.charAt(0).toUpperCase() + word.slice(1);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

export default function Register() {
  const navigate = useNavigate();

  // 3-step registration:
  // 1) Data Privacy Consent
  // 2) Personal Information
  // 3) Identity (handled on /register/verify)
  const [step, setStep] = useState<1 | 2>(1);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [privacyConsentedAt, setPrivacyConsentedAt] = useState<string | null>(null);

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);

  const [closedMessage, setClosedMessage] = useState<string>("");

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [signupEmail, setSignupEmail] = useState("");

  const [showConfirm, setShowConfirm] = useState(false);

  const fullEmail = `${signupEmail.trim()}@feualabang.edu.ph`;

  useEffect(() => {
    let cancelled = false;

    async function loadRegistrationSetting() {
      setRegistrationLoading(true);
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", APP_SETTING_KEYS.registrationEnabled)
          .maybeSingle();

        if (error) throw error;

        const value = data?.value ?? false;

        if (!cancelled) setRegistrationEnabled(Boolean(value));
      } catch (e) {
        if (!cancelled) {
          // Fail closed.
          setRegistrationEnabled(false);
          toast.error("Registration status unavailable", {
            description: "Please try again later or contact the election admin.",
          });
        }
      } finally {
        if (!cancelled) setRegistrationLoading(false);
      }
    }

    loadRegistrationSetting();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadClosedMessage() {
      try {
        const { data, error } = await supabase
          .from("admin_audit_logs")
          .select("details, created_at")
          .eq("entity_type", AUDIT.entityType)
          .eq("entity_id", AUDIT.entityId)
          .eq("action", AUDIT.actionRegistrationMessage)
          .order("created_at", { ascending: false })
          .limit(1);

        if (error) throw error;

        const latest: any = data?.[0]?.details;
        const msg = typeof latest?.message === "string" ? latest.message : "";
        if (!cancelled) setClosedMessage(msg);
      } catch {
        if (!cancelled) setClosedMessage("");
      }
    }

    loadClosedMessage();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();

    if (registrationLoading) return;

    if (!registrationEnabled) {
      toast.error("Registration is currently closed.");
      return;
    }

    if (!privacyConsent) {
      toast.error("Consent required", {
        description: "Please review the Data Privacy Policy Statement and confirm your consent before proceeding.",
      });
      setStep(1);
      return;
    }

    if (!firstName || !lastName || !signupEmail || !yearLevel) {
      toast.error("Please fill out all required fields.");
      return;
    }

    // Show review-and-confirm modal before proceeding to identity verification
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    // ✅ org affiliations are now auto-assigned server-side (SCC always + roster match)
    navigate("/register/verify", {
      state: {
        firstName,
        middleName,
        lastName,
        suffix,
        yearLevel,
        fullEmail,
        privacyConsent: true,
        privacyConsentedAt,
      },
    });
  };

  const handleBack = () => {
    // Within the registration flow: step back to consent screen.
    if (step === 2) {
      setStep(1);
      return;
    }

    // Prefer navigating back to the landing page, but fail-safe to "/" if history is missing
    // (e.g., direct link to /register or kiosk/browser history restrictions).
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  };

  // Registration CLOSED state (still styled, not a blank page)
  if (!registrationLoading && !registrationEnabled) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden animate-fade-in-up">
        <style>{`
@keyframes blobDance1 {
  0%   { transform: translate(-20px, 10px) scale(1) rotate(0deg); }
  25%  { transform: translate(55px, -35px) scale(1.18) rotate(8deg); }
  50%  { transform: translate(15px, -70px) scale(0.96) rotate(-10deg); }
  75%  { transform: translate(-50px, -15px) scale(1.12) rotate(14deg); }
  100% { transform: translate(-20px, 10px) scale(1) rotate(0deg); }
}

@keyframes blobDance2 {
  0%   { transform: translate(25px, -10px) scale(1) rotate(0deg); }
  25%  { transform: translate(-60px, 25px) scale(1.16) rotate(-10deg); }
  50%  { transform: translate(-20px, 70px) scale(0.98) rotate(12deg); }
  75%  { transform: translate(65px, 30px) scale(1.12) rotate(-16deg); }
  100% { transform: translate(25px, -10px) scale(1) rotate(0deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(18px); filter: blur(2px); }
  to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
}

@keyframes floatPunch {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-10px) rotate(3deg); }
}

@keyframes shimmer {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.animate-blob-1 { animation: blobDance1 7.5s cubic-bezier(.2,.9,.2,1) infinite; }
.animate-blob-2 { animation: blobDance2 9s cubic-bezier(.2,.9,.2,1) infinite; }
.animate-fade-in-up { animation: fadeInUp 560ms cubic-bezier(.2,.8,.2,1) both; }
.animate-float { animation: floatPunch 2.4s ease-in-out infinite; transform-origin: center; }

.lift-hover { transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease; }
.lift-hover:hover { transform: translateY(-4px) scale(1.01); box-shadow: 0 18px 55px rgba(0,0,0,0.16); border-color: rgba(0,0,0,0.08); }

.shimmer-border {
  background: linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.35), rgba(255,255,255,0.12));
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
`}</style>

        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />


<div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl animate-blob-1 -z-10 animate-float" />
<div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-secondary/15 blur-3xl animate-blob-2 -z-10" />
<div className="pointer-events-none absolute top-24 right-20 h-52 w-52 rounded-full bg-emerald-500/10 blur-3xl animate-blob-1 -z-10" />


        <div className="max-w-xl w-full animate-fade-in-up">
          <Card className="lift-hover shadow-2xl rounded-2xl border border-emerald/20 bg-white/90 backdrop-blur shimmer-border">
            <CardHeader className="text-center pb-6 pt-10 space-y-3">
              <h1
                className="
                  text-4xl font-extrabold leading-tight
                  bg-gradient-to-r from-primary to-secondary
                  bg-clip-text text-transparent
                "
              >
                Registration Closed
              </h1>
              <CardDescription className="text-muted-foreground text-base">
                {closedMessage
                  ? closedMessage
                  : "Registration is not available right now. Please return during the official registration window."}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-8 pb-10 space-y-4">
              <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
                <p className="text-sm text-muted-foreground">
                  If you believe this is a mistake, contact your election administrator.
                </p>
              </div>

              <Button className="w-full" variant="outline" onClick={() => navigate("/")}>
                Return to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
      {/* Background animation */}
      <style>
        {`
          @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .animate-gradient {
            background-size: 200% 200%;
            animation: gradientShift 12s ease-in-out infinite;
          }


@keyframes blobFloat1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(14px,-16px) scale(1.04); } }
@keyframes blobFloat2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-12px,12px) scale(1.05); } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.animate-blob-1 { animation: blobFloat1 16s ease-in-out infinite; }
.animate-blob-2 { animation: blobFloat2 18s ease-in-out infinite; }
.animate-fade-in-up { animation: fadeInUp 420ms ease-out both; }

          /* Progress bar fill animation */
          @keyframes progressFill {
            0% { width: 0%; }
            100% { width: 50%; }
          }
        `}
      </style>

      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <div className="max-w-2xl w-full animate-fade-in-up">
        <Card className="lift-hover shadow-2xl rounded-2xl border border-emerald/20 bg-white/90 backdrop-blur">
          {/* ========================== */}
          {/*   REDESIGNED HEADER + STEPPER   */}
          {/* ========================== */}
          <CardHeader className="text-center pb-8 pt-10 space-y-4">
            <h1
              className="
                text-4xl font-extrabold leading-tight
                bg-gradient-to-r from-primary to-secondary
                bg-clip-text text-transparent
              "
            >
              Student Registration
            </h1>

            <CardDescription className="text-muted-foreground text-lg">
              {step === 1 ? "Step 1 of 3 — Data Privacy Consent" : "Step 2 of 3 — Personal Information"}
            </CardDescription>

            {/* Progress Bar (3-step) */}
            <div className="relative w-72 h-2 bg-gray-200 rounded-full mx-auto mt-4 overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                style={{
                  width: step === 1 ? "33%" : "66%",
                  transition: "width 420ms ease",
                }}
              />
            </div>

            {/* Stepper Circles */}
            <div className="flex justify-center mt-6 gap-10">
              {/* STEP 1 */}
              <div className={`flex flex-col items-center ${step === 1 ? "" : "opacity-70"}`}>
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold shadow-md ${
                    step === 1
                      ? "bg-gradient-to-r from-primary to-secondary text-white"
                      : "border-2 border-primary/30 text-primary"
                  }`}
                >
                  1
                </div>
                <span className="mt-2 text-xs font-medium tracking-wide text-primary">Data Privacy</span>
              </div>

              {/* STEP 2 */}
              <div className={`flex flex-col items-center ${step === 2 ? "" : "opacity-60"}`}>
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold shadow-md ${
                    step === 2
                      ? "bg-gradient-to-r from-primary to-secondary text-white"
                      : "border-2 border-gray-300 text-gray-400"
                  }`}
                >
                  2
                </div>
                <span className="mt-2 text-xs tracking-wide text-muted-foreground">Personal Info</span>
              </div>

              {/* STEP 3 */}
              <div className="flex flex-col items-center opacity-60">
                <div className="h-10 w-10 rounded-full flex items-center justify-center border-2 border-gray-300 text-gray-400 font-semibold">
                  3
                </div>
                <span className="mt-2 text-xs text-muted-foreground tracking-wide">Identity</span>
              </div>
            </div>
          </CardHeader>

          {/* ========================== */}
          {/* FORM CONTENT               */}
          {/* ========================== */}
          <CardContent className="space-y-6 px-8 pb-10">
            {step === 1 ? (
              <div className="space-y-6">
                <div className="rounded-xl border border-primary/15 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b bg-primary/5">
                    <p className="text-sm font-semibold text-foreground">Data Privacy Policy Statement</p>
                    <p className="text-xs text-muted-foreground">
                      Please review the statement below. You must provide consent before registration can continue.
                    </p>
                  </div>

                  <div className="p-4">
                    <div className="rounded-lg border bg-white overflow-hidden">
                      <img
                        src="/privacy-policy.png"
                        alt="FEU Data Privacy Policy Statement"
                        className="w-full h-auto"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={privacyConsent}
                      onChange={(e) => setPrivacyConsent(e.target.checked)}
                    />
                    <span className="text-sm text-muted-foreground leading-relaxed">
                      I have read the Data Privacy Policy Statement and I consent to the collection and processing of my
                      information for voter registration and election-related purposes.
                    </span>
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate("/")}
                    className="w-full sm:w-auto sm:flex-1 text-lg py-6 font-semibold"
                  >
                    I Do Not Consent
                  </Button>

                  <Button
                    type="button"
                    disabled={registrationLoading || !registrationEnabled || !privacyConsent}
                    onClick={() => {
                      if (!privacyConsent) {
                        toast.error("Consent required", {
                          description: "Please tick the consent checkbox to continue.",
                        });
                        return;
                      }

                      setPrivacyConsentedAt(new Date().toISOString());
                      setStep(2);
                    }}
                    className="w-full sm:flex-[2] text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                  >
                    {registrationLoading
                      ? "Checking registration window…"
                      : registrationEnabled
                        ? "I Consent — Continue"
                        : "Registration Closed"}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleProceed} className="space-y-6">
              {/* NAME ROW */}
              <div className="grid gap-6 md:grid-cols-[2fr_0.5fr_2fr_1.2fr]">
                {/* First Name */}
                <div>
                  <Label className="font-semibold">Given Name</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(formatName(e.target.value))}
                    required
                    className="mt-1"
                  />
                </div>

                {/* M.I. */}
                <div>
                  <Label className="font-semibold">M.I.</Label>
                  <Input
                    value={middleName}
                    maxLength={1}
                    onChange={(e) => setMiddleName(e.target.value.toUpperCase())}
                    className="mt-1"
                  />
                </div>

                {/* Last Name */}
                <div>
                  <Label className="font-semibold">Last Name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(formatName(e.target.value))}
                    required
                    className="mt-1"
                  />
                </div>

                {/* Suffix */}
                <div>
                  <Label className="font-semibold">Suffix</Label>
                  <select
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm"
                  >
                    <option value="">None</option>
                    <option value="Jr.">Jr.</option>
                    <option value="Sr.">Sr.</option>
                    <option value="II">II</option>
                    <option value="III">III</option>
                    <option value="IV">IV</option>
                  </select>
                </div>
              </div>

              {/* YEAR LEVEL */}
              <div>
                <Label className="font-semibold">Year Level</Label>
                <select
                  value={yearLevel}
                  onChange={(e) => setYearLevel(e.target.value)}
                  className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm"
                  required
                >
                  <option value="" disabled>
                    Select Year Level
                  </option>
                  <option>1st Year</option>
                  <option>2nd Year</option>
                  <option>3rd Year</option>
                  <option>4th Year</option>
                  <option>Associate</option>
                </select>
              </div>

              {/* ✅ NOTE ABOUT AUTO-ASSIGN (thesis-friendly) */}
              <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Note:</span> Organizational eligibility is automatically
                  assigned from official membership rosters.
                </p>
              </div>

              {/* EMAIL */}
              <div>
                <Label className="font-semibold">FEU Email</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder="your.email"
                    value={signupEmail}
                    onChange={(e) => {
                      let value = e.target.value;

                      if (value.includes("@")) {
                        toast.error(
                          <div>
                            Please enter only the email prefix (before @).<br />
                            <br />
                            The domain is automatically added.
                          </div>
                        );
                        e.target.blur();
                        return;
                      }

                      setSignupEmail(value.trim());
                    }}
                    required
                  />
                  <span className="text-muted-foreground">@feualabang.edu.ph</span>
                </div>
              </div>

              {/* PROCEED BUTTON */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  className="w-full sm:w-auto sm:flex-1 text-lg py-6 font-semibold"
                >
                  Back
                </Button>

                <Button
                  type="submit"
                  disabled={registrationLoading || !registrationEnabled}
                  className="w-full sm:flex-[2] text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90"
                >
                  {registrationLoading ? "Checking registration window…" : "Proceed to Identity Verification"}
                </Button>
              </div>
            </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Review & Confirm Modal ───────────────────────────────────────── */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-emerald-900">
              Review Your Information
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Please check everything carefully — especially your email.
              A verification link will be sent there. If it's wrong, you
              won't be able to complete registration.
            </p>
          </DialogHeader>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 divide-y divide-emerald-100 text-sm my-2">
            <div className="flex justify-between px-4 py-3">
              <span className="text-muted-foreground font-medium">Given Name</span>
              <span className="font-semibold text-emerald-900">{firstName}</span>
            </div>
            {middleName && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-muted-foreground font-medium">M.I.</span>
                <span className="font-semibold text-emerald-900">{middleName}.</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-muted-foreground font-medium">Last Name</span>
              <span className="font-semibold text-emerald-900">{lastName}</span>
            </div>
            {suffix && (
              <div className="flex justify-between px-4 py-3">
                <span className="text-muted-foreground font-medium">Suffix</span>
                <span className="font-semibold text-emerald-900">{suffix}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-3">
              <span className="text-muted-foreground font-medium">Year Level</span>
              <span className="font-semibold text-emerald-900">{yearLevel}</span>
            </div>
            <div className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground font-medium">FEU Email</span>
                <span className="font-semibold text-emerald-900 text-right break-all">{fullEmail}</span>
              </div>
              <p className="text-xs text-amber-600 font-medium mt-1">
                ⚠ A verification link will be sent here. Double-check this is correct.
              </p>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:flex-1 border-emerald-200 text-emerald-800 font-semibold"
              onClick={() => setShowConfirm(false)}
            >
              Edit — Go Back
            </Button>
            <Button
              type="button"
              className="w-full sm:flex-[2] font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              onClick={handleConfirm}
            >
              Confirm — Proceed to Identity Verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}