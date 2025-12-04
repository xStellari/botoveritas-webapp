import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Scan,
  Camera,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

import RFIDScanner from "./RFIDScanner";
import FacialRecognition from "./FacialRecognition";
import { compareDescriptors } from "@/utils/faceMatching";

interface AuthenticationScreenProps {
  onAuthSuccess: (data: { rfidTag: string }) => void;
}

type Step = "rfid" | "face" | "done" | "error";

const AuthenticationScreen = ({ onAuthSuccess }: AuthenticationScreenProps) => {
  const MASTER_RFID_TAG = "1226512821";
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("rfid");
  const [statusMessage, setStatusMessage] = useState("");
  const [rfidTag, setRfidTag] = useState("");
  const [rfidVerified, setRfidVerified] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);

  const [storedDescriptor, setStoredDescriptor] = useState<Float32Array | null>(
    null
  );

  useEffect(() => {
    if (step === "error"){
      const timer = setTimeout(() => {
        window.location.reload();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [step]);
  
  const generateSimulatedRFID = () => {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
  }
  

  const logAttempt = async (type: string, rfid: string, distance?: number) => {
    await supabase.from("auth_logs").insert([
      {
        event_type: type,
        rfid_tag: rfid,
        distance_score: distance ?? null,
      }
    ]);
  };


  // ---------------------------------------------------------------------
  // 1️⃣ HANDLE RFID TAP
  // ---------------------------------------------------------------------
  const handleRFID = async (uid: string) => {
    console.log("RFID scanned:", uid);
    setRfidTag(uid);

    // MASTER OVERRIDE CARD
    if (uid === MASTER_RFID_TAG) {
      setStatusMessage("Admin override activated → Proceeding to face scan.");
      setRfidVerified(true);
      setStep("face");
      return;
    }

    // NORMAL RFID LOOKUP
    setStatusMessage("Checking RFID in database...");
    const { data, error } = await supabase
      .from("voters")
      .select("face_descriptor")
      .eq("rfid_tag", uid)
      .single();

    if (error || !data) {
      console.error("RFID not found:", error?.message);
      setStatusMessage("RFID not registered. Please contact election staff.");
      setStep("error");
      return;
    }

    if (!data.face_descriptor) {
      setStatusMessage(
        "No facial data found for this RFID."
      );
      setStep("error");
      return;
    }

    // Convert array back into Float32 descriptor
    setStoredDescriptor(new Float32Array(data.face_descriptor));

    setRfidVerified(true);
    setStatusMessage("RFID verified! Proceed to face recognition.");
    setStep("face");
  };

  // Manual RFID Typing
  const handleManualRFID = ( e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter"){
      const value = (e.target as HTMLInputElement).value.trim();
      if(value.length >= 4){
        handleRFID(value);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 2️⃣ HANDLE FACE CAPTURE → MATCH AGAINST STORED DESCRIPTOR
  // ---------------------------------------------------------------------
  const handleFaceCaptured = (liveDescriptor: Float32Array) => {
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
      setStatusMessage("Face match successful! Loading ballot...");
      setStep("done");

      setTimeout(() => {
        onAuthSuccess({
          rfidTag,
        });
      }, 500);
    } else {
      setStatusMessage(
        "Face mismatch. Authentication Failed - suspicious login attempt detected"
      );
      setStep("error");

      logAttempt("FACE_MISMATCH", rfidTag, distance);

      navigate("/registration-error", {
        state: {
          message:
            "Face mismatch detected. Suspicious login attempt logged.",
        },
      });
    }
  };

  // ---------------------------------------------------------------------
  // 3️⃣ RETRY BUTTON (currently not used for face mismatch, but kept as-is)
  // ---------------------------------------------------------------------
  const handleRetry = () => {
    setStep("rfid");
    setStatusMessage("");
    setRfidVerified(false);
    setFaceVerified(false);
    setRfidTag("");
    setStoredDescriptor(null);
  };

  // ---------------------------------------------------------------------
  // 4️⃣ MAIN UI
  // ---------------------------------------------------------------------
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-2xl border-2 border-primary/20 bg-white/90 backdrop-blur-sm shadow-2xl">
        <div className="p-12">
          {/* RFID Listener */}
          <RFIDScanner onScan={handleRFID} />

          {/* Header */}
          <div className="flex flex-col items-center mb-12">
            <img src={feuLogo} alt="FEU Alabang" className="h-24 w-auto mb-6" />
            <h1 className="text-4xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent mb-2">
              BotoVeritas
            </h1>
            <p className="text-xl text-muted-foreground text-center">
              Blockchain-Based Voting System
            </p>
            
            {/* 🔵 TEMPORARY BUTTON FOR THESIS TESTING — REMOVE ANYTIME */}
            <div className="w-full flex justify-center mt-4">
 
            </div>


          </div>

          {/* ================================
              RFID AUTH BUTTON
              ================================ */}
          <button
            onClick={() => {
              setStep("rfid");
              setStatusMessage("Please tap your RFID card...");
            }}
            
            className="
              group w-full flex items-center justify-between p-6 border rounded-xl
              transition-colors hover:bg-primary/10 hover:text-primary
            "
          >
            <div className="flex items-center gap-4">
              <Scan className="h-10 w-10 text-primary group-hover:text-primary" />

              {/* Text block as spans to ensure perfect alignment */}
              <div className="flex flex-col items-start">
                <span className="font-semibold text-lg group-hover:text-primary leading-tight">
                  RFID Authentication
                </span>
                <span className="text-sm text-muted-foreground group-hover:text-primary/70 leading-snug">
                  Tap your Student ID
                </span>
              </div>
            </div>

            {rfidVerified && (
              <CheckCircle2 className="h-8 w-8 text-success" />
            )}
          </button>

          {/* Manual RFID Input for Testing */}
          <div className="mt-4">
            <input
              type="text"
              placeholder="Enter RFID Tag (for testing)"
              onKeyDown={handleManualRFID}
              className=" 
                w-full p-3 rounded-lg border border-gray-300 
                focus:outline-none focus:ring-2 focus:ring-primary 
                text-center text-lg"
              />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Press Enter after typing RFID
              </p>
          </div>

          {/* ================================
              FACE AUTH BUTTON
              ================================ */}
          <button
            onClick={() => {
              if (!rfidVerified) {
                setStatusMessage("Please complete RFID first.");
                return;
              }
              setStep("face");
              setStatusMessage("Initializing camera...");
            }}
            className="
              group w-full flex items-center justify-between p-6 border rounded-xl mt-6
              transition-colors hover:bg-primary/10 hover:text-primary
            "
          >
            <div className="flex items-center gap-4">
              <Camera className="h-10 w-10 text-primary group-hover:text-primary" />

              {/* Same structure here so they visually match */}
              <div className="flex flex-col items-start">
                <span className="font-semibold text-lg group-hover:text-primary leading-tight">
                  Facial Recognition
                </span>
                <span className="text-sm text-muted-foreground group-hover:text-primary/70 leading-snug">
                  Align your face with the camera
                </span>
              </div>
            </div>

            {faceVerified && (
              <CheckCircle2 className="h-8 w-8 text-success" />
            )}
          </button>

          {/* STATUS MESSAGE */}
          {statusMessage && (
            <div
              className={`p-4 rounded-lg mt-6 text-center font-medium ${
                step === "done"
                  ? "bg-success/10 text-success"
                  : step === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              }`}
            >
              {statusMessage}
            </div>
          )}

          {/* FACIAL RECOGNITION VIEW */}
          {step === "face" && (
            <div className="mt-6">
              <FacialRecognition onCapture={handleFaceCaptured} />
            </div>
          )}

          {/* ERROR ACTIONS */}
          {step === "error" && (
            <div className="mt-8 text-center">
              <p className="text-red-600 font-bold text-xl mb-4">
                Authentication Failed
              </p>
              <p className="text-muted-foreground mb-6">
                Suspicious login attempt detected.                
              </p>
              {/* Auto-redirect after 5 seconds */}
              <p className="text-sm text-muted-foreground">
                Returning to main... 
              </p>
            </div>
          )}

          {/* FOOTER */}
          <div className="mt-8 pt-6 border-t border-border/50">
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
