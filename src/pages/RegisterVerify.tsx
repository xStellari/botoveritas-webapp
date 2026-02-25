/** FULL UPDATED RegisterVerify.tsx WITH ONE-SHOT SUBMIT (prevents double insert) **/

import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

import RFIDScanner from "@/components/voting/RFIDScanner";
import FacialRecognition from "@/components/voting/FacialRecognition";
import { supabase } from "@/integrations/supabase/client";

import { Radio, ScanFace, CheckCircle2 } from "lucide-react";
import * as faceapi from "face-api.js";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

export default function RegisterVerify() {
  const navigate = useNavigate();
  const location = useLocation();

  const data = location.state as
    | {
        firstName: string;
        middleName: string;
        lastName: string;
        suffix: string;
        yearLevel: string;
        orgAffiliations: string[];
        fullEmail: string;
      }
    | undefined;

  const [rfid, setRfid] = useState<string>("");
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const [registrationEnabled, setRegistrationEnabled] = useState<boolean>(false);
  const [registrationLoading, setRegistrationLoading] = useState<boolean>(true);

  // Determine voter audience from authoritative registry (associates override).
  // This keeps election eligibility deterministic post-RFID.
  // Determine voter audience from authoritative registry (associates override).
// Uses a SECURITY DEFINER RPC first so it works even before auth session exists.
const resolveVoterAudience = async (email: string): Promise<"students" | "associates"> => {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return "students";

  // 1) Preferred: RPC that returns a boolean without exposing associate list.
  try {
    const { data, error } = await (supabase as any).rpc("is_associate_email", { p_email: normalized });
    if (!error && typeof data === "boolean") {
      return data ? "associates" : "students";
    }
    if (error) {
      console.warn("resolveVoterAudience: is_associate_email RPC failed:", error);
    }
  } catch (e) {
    console.warn("resolveVoterAudience: is_associate_email RPC exception:", e);
  }

  // 2) Fallback: direct table lookup (may be blocked depending on RLS/policies).
  try {
    const { data, error } = await supabase
      .from("associate_registry" as any)
      .select("id")
      .ilike("email_norm", normalized)
      .limit(1);

    if (error) {
      console.warn("resolveVoterAudience: associate_registry lookup failed:", error);
      return "students";
    }
    if (data && data.length > 0) return "associates";

    const { data: data2, error: error2 } = await supabase
      .from("associate_registry" as any)
      .select("id")
      .ilike("email", normalized)
      .limit(1);

    if (error2) {
      console.warn("resolveVoterAudience: associate_registry fallback lookup failed:", error2);
      return "students";
    }

    return data2 && data2.length > 0 ? "associates" : "students";
  } catch (e) {
    console.warn("resolveVoterAudience: exception:", e);
    return "students";
  }
};



  // ✅ One-shot submit guard (prevents double click / double insert)
  const hasSubmittedRef = useRef(false);


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
        // Fail closed if settings fetch fails
        if (!cancelled) setRegistrationEnabled(false);
      } finally {
        if (!cancelled) setRegistrationLoading(false);
      }
    }

    loadRegistrationSetting();

    return () => {
      cancelled = true;
    };
  }, []);

  // 🔒 Prevent accessing this page directly
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md w-full text-center space-y-4">
          <CardTitle>Registration Data Missing</CardTitle>
          <CardDescription>Please restart the registration process.</CardDescription>
          <Button onClick={() => navigate("/")}>Return Home</Button>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------
  // FACE DUPLICATE CHECK
  // -----------------------------------------------
  const checkDuplicateFace = async (descriptor: Float32Array) => {
    const { data: voters, error } = await supabase
      .from("voters")
      .select("face_descriptor");

    if (error) return false;

    for (const v of voters || []) {
      if (!v.face_descriptor) continue;

      const stored = new Float32Array(v.face_descriptor);
      const distance = faceapi.euclideanDistance(descriptor, stored);

      if (distance < 0.45) return true;
    }
    return false;
  };

  // -----------------------------------------------
  // FINAL REGISTRATION SUBMIT
  // -----------------------------------------------
  const handleFinish = async () => {
    // ✅ Hard guard: never run twice
    if (hasSubmittedRef.current) return;
    if (!rfid || !faceDescriptor) return;

    // 🔒 Enforce registration phase at the point of DB write
    if (registrationLoading) return;
    if (!registrationEnabled) {
      navigate("/error", {
        state: {
          title: "Registration Closed",
          message: "Registration is currently closed. Please return during the official registration window.",
          reason: "REGISTRATION_CLOSED",
          recoverTo: "/",
          countdownSeconds: 10,
        },
      });
      return;
    }

    hasSubmittedRef.current = true;
    setLoading(true);

    try {
      // 1) RFID uniqueness check
      const { data: existingRFID } = await supabase
        .from("voters")
        .select("email")
        .eq("rfid_tag", rfid)
        .maybeSingle();

      if (existingRFID) {
        navigate("/error", {
          state: {
            title: "RFID Already Registered",
            message: "This RFID is already registered to another voter.",
            reason: "RFID_ALREADY_REGISTERED",
            recoverTo: "/register",
            countdownSeconds: 10,
          },
        });
        return;
      }

      // 1b) Resolve voter audience BEFORE creating auth/voter row
      const voterAudience = await resolveVoterAudience(data.fullEmail);

      // 2) Create auth user
      const { data: signupData, error } = await supabase.auth.signUp({
        email: data.fullEmail,
        password: crypto.randomUUID(),
      });

      if (error) {
        navigate("/error", {
          state: {
            title: "Registration Failed",
            message: "Registration failed. Please try again. " + error.message,
            reason: "REGISTRATION_FAILED",
            recoverTo: "/register",
            countdownSeconds: 10,
          },
        });
        return;
      }

      const user = signupData.user;
      if (!user?.id) {
        navigate("/error", {
          state: {
            title: "Registration Failed",
            message: "Registration failed: missing user id.",
            reason: "REGISTRATION_FAILED",
            recoverTo: "/register",
            countdownSeconds: 10,
          },
        });
        return;
      }

      // Only set session if it exists (depends on email confirmation settings)
      if (signupData.session) {
        await supabase.auth.setSession(signupData.session);
      }

      // 3) Insert voter record
      const { error: voterErr } = await supabase.from("voters").insert([
        {
          id: user.id,
          email: data.fullEmail,
          first_name: data.firstName,
          middle_name: data.middleName,
          last_name: data.lastName,
          suffix: data.suffix || null,
          year_level: data.yearLevel,
          // org_affiliations is system-assigned (authoritative roster)
          org_affiliations: null,
          voter_audience: voterAudience,
          rfid_tag: rfid,
          face_descriptor: Array.from(faceDescriptor),
        },
      ]);

      if (voterErr) {
        navigate("/error", {
          state: {
            title: "Registration Failed",
            message: "Failed to save voter record. " + voterErr.message,
            reason: "VOTER_SAVE_FAILED",
            recoverTo: "/register",
            countdownSeconds: 10,
          },
        });
        return;
      }

      // 3b) Refresh and persist system-assigned org affiliations (RLS-safe)
      // This RPC updates voters.org_affiliations server-side and returns the computed array.
      // If email confirmation is enabled and no session exists, we fall back to SCC-only display.
      // Students: compute orgs. Associates: org affiliations are not applicable.
      let finalOrgs: string[] = voterAudience === "associates" ? [] : ["SCC"]; // SCC is open to all students (safe fallback)
      try {
        if (voterAudience !== "associates") {
          const { data: refreshed, error: refreshErr } = await supabase.rpc(
            "refresh_voter_org_affiliations" as any,
            { p_voter_id: user.id } as any
          );

          if (refreshErr) {
            console.warn("refresh_voter_org_affiliations failed:", refreshErr);
          } else if (Array.isArray(refreshed)) {
            finalOrgs = refreshed as string[];
          }
        }
      } catch (e) {
        console.warn("refresh_voter_org_affiliations exception:", e);
      }

      // 4) Send email (best effort; don't block success)
      // ✅ pass BOTH voter_id + email (fallback works even if id lookup fails)
      const { error: emailErr } = await supabase.functions.invoke(
        "send-email-verification-link",
        {
          body: {
            voter_id: user.id,
            email: data.fullEmail,
            fullName: [
              data.firstName,
              data.middleName ? `${data.middleName}.` : "",
              data.lastName,
              data.suffix || "",
            ]
              .filter(Boolean)
              .join(" "),
          },
        }
      );
      
      if (emailErr) {
        console.warn("send-email-verification-link failed:", emailErr);
      }


      

console.log("signupData.session exists?", Boolean(signupData.session));
      console.log("auth.getSession()", await supabase.auth.getSession());
      // 5) Navigate to confirmation
      navigate("/registration-confirmation", {
        state: {
          firstName: data.firstName,
          middleName: data.middleName,
          lastName: data.lastName,
          orgAffiliations: finalOrgs,
          email: data.fullEmail,
        },
      });

      // ✅ IMPORTANT: do NOT setLoading(false) after navigate; component unmounts anyway
    } catch (err) {
      console.error(err);
      navigate("/error", {
        state: {
          title: "Registration Error",
          message: "Unexpected error during registration.",
          reason: "UNEXPECTED_ERROR",
          recoverTo: "/register",
          countdownSeconds: 10,
        },
      });
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
      {/* Custom animations */}
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

          @keyframes progressFillStep3 {
            0% { width: 66.6667%; }
            100% { width: 100%; }
          }

          @keyframes stepGlow {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            100% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          }
          .step-active {
            animation: stepGlow 1.8s ease-out infinite;
          }
        `}
      </style>

      {/* Animated background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      {/* Main Card */}
      <div className="max-w-3xl w-full animate-fade-in-up">
        <Card className="shadow-xl rounded-2xl border border-primary/20 bg-white/90 backdrop-blur">
          <CardHeader className="pb-6">
            <CardTitle className="text-3xl font-extrabold text-center bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Step 3 of 3 — Verify Your Identity
            </CardTitle>
            <CardDescription className="text-center">
              Scan your RFID and capture your Face ID to finish registration.
            </CardDescription>

            {/* Progress Bar */}
            <div className="mt-6 h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                style={{ animation: "progressFillStep3 1.4s ease-out forwards" }}
              />
            </div>

            {/* Stepper */}
            <div className="flex justify-center gap-14 mt-2">
              <div className="flex flex-col items-center">
                <div
                  className={`
                    h-10 w-10 rounded-full flex items-center justify-center font-semibold
                    ${rfid ? "bg-emerald-500 text-white" : "bg-gray-300 text-gray-600 step-active"}
                  `}
                >
                  1
                </div>
                <span className="mt-2 text-xs font-medium text-gray-700">RFID Scan</span>
              </div>

              <div className="flex flex-col items-center">
                <div
                  className={`
                    h-10 w-10 rounded-full flex items-center justify-center font-semibold transition
                    ${
                      faceDescriptor
                        ? "bg-emerald-500 text-white"
                        : rfid
                        ? "bg-yellow-400 text-yellow-900 step-active"
                        : "bg-gray-300 text-gray-600"
                    }
                  `}
                >
                  2
                </div>
                <span className="mt-2 text-xs font-medium text-gray-700">Face ID</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-8 px-8 pb-10">
            <div className="text-center mb-6">
              <p className="text-sm font-medium text-emerald-700">
                Complete both steps to finish your registration
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-2 items-stretch">
              {/* RFID */}
              <div
                className={`
                  border rounded-xl p-5 shadow-sm bg-white/70 transition flex flex-col h-full
                  ${rfid ? "border-emerald-400" : "border-emerald-100 step-active"}
                `}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700">
                      <Radio className="w-5 h-5" />
                    </div>
                    <p className="font-semibold text-base">Step 1: RFID Scan</p>
                  </div>
                  {rfid && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                </div>

                <div className="mb-4">
                  {!rfid ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Tap your RFID card on the reader to begin.
                      </p>
                    </>
                  ) : (
                    <p className="text-green-600 font-semibold text-lg">
                      RFID Detected: {rfid}
                    </p>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center border border-dashed rounded-lg text-sm text-slate-600">
                  {!rfid ? "Waiting for RFID scan..." : "RFID Scanned Successfully"}
                </div>
              </div>

              {/* Face */}
              <div
                id="face-step"
                className={`
                  border rounded-xl p-5 shadow-sm bg-white/70 transition flex flex-col h-full
                  ${faceDescriptor ? "border-emerald-400" : "border-slate-200"}
                  ${rfid && !faceDescriptor ? "step-active" : ""}
                  ${rfid ? "" : "opacity-60 pointer-events-none"}
                `}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-yellow-100 rounded-lg text-yellow-700">
                      <ScanFace className="w-5 h-5" />
                    </div>
                    <p className="font-semibold text-base">Step 2: Face ID</p>
                  </div>
                  {faceDescriptor && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                </div>

                <div className="mb-4">
                  {!rfid ? (
                    <p className="text-sm text-muted-foreground">
                      Complete RFID scanning to unlock Face ID.
                    </p>
                  ) : !faceDescriptor ? (
                    <p className="text-sm text-muted-foreground">
                      The camera will activate automatically. Align your face within the frame.
                    </p>
                  ) : (
                    <p className="text-green-600 font-semibold text-lg">Face ID Captured</p>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center border border-dashed rounded-lg text-sm text-slate-600">
                  {!rfid ? (
                    "Waiting for RFID..."
                  ) : !faceDescriptor ? (
                    <FacialRecognition
                      autoCapture={true}
                      onCapture={async (descriptor) => {
                        if (hasSubmittedRef.current) return; // ✅ lock capture once submitted

                        const isDuplicate = await checkDuplicateFace(descriptor);
                        if (isDuplicate) {
                          navigate("/error", {
                            state: {
                              title: "Duplicate Face ID",
                              reason: "FACE_DUPLICATE",
                              message:
                                "This Face ID already exists. You are already registered.",
                              recoverTo: "/register",
                              countdownSeconds: 10,
                            },
                          });
                          return;
                        }

                        setFaceDescriptor(descriptor);
                      }}
                      onError={() =>
                        navigate("/error", {
                          state: {
                            title: "Face Detection Failed",
                            reason: "FACE_DETECTION_FAILED",
                            message: "Face detection failed. Please try again.",
                            recoverTo: "/register/verify",
                            countdownSeconds: 10,
                          },
                        })
                      }
                    />
                  ) : (
                    "Face ID Captured"
                  )}
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex flex-col md:flex-row gap-4 mt-4">
              <Button
                type="button"
                variant="outline"
                className="md:w-1/3"
                onClick={() => navigate("/")}
                disabled={loading || hasSubmittedRef.current}
              >
                Cancel
              </Button>

              <Button
                className="flex-1 text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary"
                onClick={handleFinish}
                disabled={loading || hasSubmittedRef.current || !rfid || !faceDescriptor}
              >
                {loading ? "Finalizing..." : "Complete Registration"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* RFID Listener */}
      <RFIDScanner
        onScan={async (tag) => {
          if (hasSubmittedRef.current) return; // ✅ lock scanning once submitted

          const { data: existingRFID } = await supabase
            .from("voters")
            .select("email")
            .eq("rfid_tag", tag)
            .maybeSingle();

          if (existingRFID) {
            navigate("/error", {
              state: {
                title: "RFID Already Registered",
                reason: "RFID_ALREADY_REGISTERED",
                message: "This RFID is already registered to another voter.",
                recoverTo: "/register",
                countdownSeconds: 10,
              },
            });
            return;
          }

          setRfid(tag);

          setTimeout(() => {
            document.getElementById("face-step")?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 300);
        }}
      />
    </div>
  );
}