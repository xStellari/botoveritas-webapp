import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
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

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);

  const [closedMessage, setClosedMessage] = useState<string>("");

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [signupEmail, setSignupEmail] = useState("");

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

    if (!firstName || !lastName || !signupEmail || !yearLevel) {
      toast.error("Please fill out all required fields.");
      return;
    }

    // ✅ org affiliations are now auto-assigned server-side (SCC always + roster match)
    navigate("/register/verify", {
      state: {
        firstName,
        middleName,
        lastName,
        suffix,
        yearLevel,
        fullEmail,
      },
    });
  };

  // Registration CLOSED state (still styled, not a blank page)
  if (!registrationLoading && !registrationEnabled) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
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
          `}
        </style>

        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

        <div className="max-w-xl w-full animate-fade-in-up">
          <Card className="shadow-xl rounded-2xl border border-emerald/20 bg-white/90 backdrop-blur">
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

          /* Progress bar fill animation */
          @keyframes progressFill {
            0% { width: 0%; }
            100% { width: 50%; }
          }
        `}
      </style>

      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <div className="max-w-2xl w-full animate-fade-in-up">
        <Card className="shadow-xl rounded-2xl border border-emerald/20 bg-white/90 backdrop-blur">
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
              Step 1 of 2 — Personal Information
            </CardDescription>

            {/* Animated Progress Bar */}
            <div className="relative w-64 h-2 bg-gray-200 rounded-full mx-auto mt-4 overflow-hidden">
              <div
                className="
                  absolute left-0 top-0 h-full
                  bg-gradient-to-r from-primary to-secondary
                  rounded-full
                "
                style={{
                  animation: "progressFill 1.4s ease-out forwards",
                }}
              ></div>
            </div>

            {/* Stepper Circles */}
            <div className="flex justify-center mt-6 gap-12">
              {/* STEP 1 */}
              <div className="flex flex-col items-center">
                <div
                  className="
                    h-10 w-10 rounded-full flex items-center justify-center
                    bg-gradient-to-r from-primary to-secondary text-white
                    font-semibold shadow-md
                  "
                >
                  1
                </div>
                <span className="mt-2 text-xs font-medium text-primary tracking-wide">Personal Info</span>
              </div>

              {/* STEP 2 */}
              <div className="flex flex-col items-center opacity-60">
                <div
                  className="
                    h-10 w-10 rounded-full flex items-center justify-center
                    border-2 border-gray-300 text-gray-400 font-semibold
                  "
                >
                  2
                </div>
                <span className="mt-2 text-xs text-muted-foreground tracking-wide">Identity</span>
              </div>
            </div>
          </CardHeader>

          {/* ========================== */}
          {/* FORM CONTENT               */}
          {/* ========================== */}
          <CardContent className="space-y-6 px-8 pb-10">
            <form onSubmit={handleProceed} className="space-y-6">
              {/* NAME ROW */}
              <div className="grid gap-6 md:grid-cols-[2fr_0.5fr_2fr_1.2fr]">
                {/* First Name */}
                <div>
                  <Label className="font-semibold">First Name</Label>
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
                  <option>5th Year</option>
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
              <Button
                type="submit"
                disabled={registrationLoading || !registrationEnabled}
                className="w-full text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              >
                {registrationLoading ? "Checking registration window…" : "Proceed to Identity Verification"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}