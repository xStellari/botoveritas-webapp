import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

export default function RegisterVerify() {
  const navigate = useNavigate();
  const location = useLocation();

  const data = location.state as
    | {
        firstName: string;
        middleName: string;
        lastName: string;
        yearLevel: string;
        orgAffiliations: string[];
        fullEmail: string;
      }
    | undefined;

  const [rfid, setRfid] = useState<string>("");
  const [faceDescriptor, setFaceDescriptor] =
    useState<Float32Array | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // -----------------------------------------------
  // Redirect if user skipped step 1
  // -----------------------------------------------
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="p-8 max-w-md w-full text-center space-y-4">
          <CardTitle>Registration Data Missing</CardTitle>
          <CardDescription>
            Please restart the registration process.
          </CardDescription>
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

      if (distance < 0.45) {
        return true;
      }
    }
    return false;
  };

  // -----------------------------------------------
  // SUBMIT FINAL REGISTRATION
  // -----------------------------------------------
  const handleFinish = async () => {
    if (!rfid || !faceDescriptor) return;

    setLoading(true);

    const { data: existingRFID } = await supabase
      .from("voters")
      .select("email")
      .eq("rfid_tag", rfid)
      .maybeSingle();

    if (existingRFID) {
      navigate("/registration-error", {
        state: { message: "This RFID is already registered to another student." },
      });
      return;
    }

    const { data: signupData, error } = await supabase.auth.signUp({
      email: data.fullEmail,
      password: crypto.randomUUID(),
    });

    if (error) {
      navigate("/registration-error", {
        state: { message: "Registration failed. Please try again." },
      });
      return;
    }

    const user = signupData.user;
    await supabase.auth.setSession(signupData.session);

    const { error: voterErr } = await supabase.from("voters").insert([
      {
        id: user.id,
        email: data.fullEmail,
        first_name: data.firstName,
        middle_name: data.middleName,
        last_name: data.lastName,
        year_level: data.yearLevel,
        org_affiliations: data.orgAffiliations,
        rfid_tag: rfid,
        face_descriptor: Array.from(faceDescriptor),
      },
    ]);

    if (voterErr) {
      navigate("/registration-error", {
        state: { message: "Failed to save voter record." },
      });
      return;
    }

    navigate("/registration-confirmation", {
      state: {
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        orgAffiliations: data.orgAffiliations,
      },
    });
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
      
      {/* ----------------------------- */}
      {/* STEP ANIMATIONS */}
      {/* ----------------------------- */}
      <style>
        {`
          @keyframes stepGlow {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            100% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          }
          .step-active {
            animation: stepGlow 1.8s ease-out infinite;
          }
        `}
      </style>

      {/* Background gradient */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      {/* RFID Listener */}
      <RFIDScanner
        onScan={async (tag) => {
          const { data: existingRFID } = await supabase
            .from("voters")
            .select("email")
            .eq("rfid_tag", tag)
            .maybeSingle();

          if (existingRFID) {
            navigate("/registration-error", {
              state: {
                message: "This RFID is already registered to another student.",
              },
            });
            return;
          }

          setRfid(tag);

          // scroll to Face ID automatically
          setTimeout(() => {
            document.getElementById("face-step")?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 300);
        }}
      />

      {/* Main card */}
      <div className="max-w-3xl w-full animate-fade-in-up">
        <Card className="shadow-xl rounded-2xl border border-primary/20 bg-white/90 backdrop-blur">

          {/* ----------------------------- */}
          {/* HEADER WITH FLOATING BAR */}
          {/* ----------------------------- */}
          <CardHeader className="text-center pb-6 pt-10">

            <h1
              className="
                text-4xl font-extrabold mb-3 leading-[1.2]
                bg-gradient-to-r from-primary to-secondary
                bg-clip-text text-transparent
              "
            >
              Identity Verification
            </h1>

            <CardDescription className="text-muted-foreground text-lg mb-6">
              Step 2 of 2 — Scan your RFID and capture your Face ID
            </CardDescription>

            {/* FLOATING PROGRESS BAR */}
            <div className="flex items-center justify-center gap-6 mb-2">

              {/* STEP 1 */}
              <div className="flex items-center gap-2">
                <div
                  className={`
                    w-3 h-3 rounded-full transition
                    ${rfid ? "bg-emerald-500" : "bg-gray-300"}
                    ${!rfid ? "step-active" : ""}
                  `}
                ></div>
                <p
                  className={`
                    text-sm font-medium
                    ${rfid ? "text-emerald-700" : "text-gray-500"}
                  `}
                >
                  RFID Scan
                </p>
              </div>

              {/* LINE */}
              <div
                className={`
                  h-[2px] w-10 rounded-full transition
                  ${rfid ? "bg-emerald-400" : "bg-gray-300"}
                `}
              ></div>

              {/* STEP 2 */}
              <div className="flex items-center gap-2">
                <div
                  className={`
                    w-3 h-3 rounded-full transition
                    ${
                      faceDescriptor
                        ? "bg-emerald-500"
                        : rfid
                        ? "bg-yellow-400"
                        : "bg-gray-300"
                    }
                    ${rfid && !faceDescriptor ? "step-active" : ""}
                  `}
                ></div>
                <p
                  className={`
                    text-sm font-medium
                    ${
                      faceDescriptor
                        ? "text-emerald-700"
                        : rfid
                        ? "text-yellow-600"
                        : "text-gray-500"
                    }
                  `}
                >
                  Face ID
                </p>
              </div>
            </div>
          </CardHeader>

          {/* ----------------------------- */}
          {/* MAIN CONTENT */}
          {/* ----------------------------- */}
          <CardContent className="space-y-8 px-8 pb-10">

            {/* Section Title */}
            <div className="text-center mb-6">
              <p className="text-sm font-medium text-emerald-700">
                Verification Steps
              </p>
              <p className="text-xs text-muted-foreground">
                Complete each step to finish your registration
              </p>
            </div>

            {/* ----------------------------- */}
            {/* RFID + FACE ID STEPS */}
            {/* ----------------------------- */}
            <div className="grid gap-8 lg:grid-cols-2 items-stretch">

              {/* STEP 1 — RFID */}
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
                    <p className="text-sm text-muted-foreground">
                      Tap your RFID card on the reader to begin.
                    </p>
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

              {/* STEP 2 — FACE ID */}
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

                  {faceDescriptor && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  )}
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
                    <p className="text-green-600 font-semibold text-lg">
                      Face ID Captured
                    </p>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center border border-dashed rounded-lg text-sm text-slate-600">
                  {!rfid ? (
                    "Waiting for RFID..."
                  ) : !faceDescriptor ? (
                    <FacialRecognition
                      autoCapture={true}
                      onCapture={async (descriptor) => {
                        const isDuplicate = await checkDuplicateFace(descriptor);

                        if (isDuplicate) {
                          navigate("/registration-error", {
                            state: {
                              message:
                                "This Face ID already exists.\nYou are already registered.",
                            },
                          });
                          return;
                        }

                        setFaceDescriptor(descriptor);
                      }}
                      onError={() =>
                        navigate("/registration-error", {
                          state: { message: "Face detection failed." },
                        })
                      }
                    />
                  ) : (
                    "Face ID Captured"
                  )}
                </div>
              </div>
            </div>

            {/* ----------------------------- */}
            {/* ACTION BUTTONS */}
            {/* ----------------------------- */}
            <div className="flex flex-col md:flex-row gap-4 mt-4">
              <Button
                type="button"
                variant="outline"
                className="md:w-1/3"
                onClick={() => navigate("/")}
                disabled={loading}
              >
                Cancel
              </Button>

              <Button
                className="flex-1 text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary"
                onClick={handleFinish}
                disabled={loading || !rfid || !faceDescriptor}
              >
                {loading ? "Finalizing..." : "Complete Registration"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
