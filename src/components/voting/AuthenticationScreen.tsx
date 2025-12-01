import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Scan,
  Camera,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

interface AuthenticationScreenProps {
  onAuthSuccess: (data: { rfidTag: string; faceHash: string }) => void;
}

type AuthStep =
  | "idle"
  | "rfid-scan"
  | "face-scan"
  | "verifying"
  | "success"
  | "error";

const AuthenticationScreen = ({ onAuthSuccess }: AuthenticationScreenProps) => {
  const { toast } = useToast();

  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [rfidVerified, setRfidVerified] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);

  const [voters, setVoters] = useState<any[]>([]);
  const [selectedVoter, setSelectedVoter] = useState<any | null>(null);

  // ⭐ Always fetch ALL voters when screen mounts OR regains focus
  useEffect(() => {
    async function loadVoters() {
      const { data, error } = await supabase
        .from("voters")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error loading voters:", error.message);
      } else {
        setVoters(data || []);
      }
    }

    loadVoters(); // Initial load

    // 👇 Reload voters every time the user returns to this tab/page
    const handleFocus = () => loadVoters();
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // -----------------------------
  // SIMULATION — RFID Scan
  // -----------------------------
  const simulateRfidScan = () => {
    if (!selectedVoter) {
      toast({
        title: "No Voter Selected",
        description: "Please choose a voter before starting authentication.",
        variant: "destructive",
      });
      return;
    }

    setAuthStep("rfid-scan");
    setStatusMessage("Please tap the student ID on the RFID reader...");

    setTimeout(() => {
      setRfidVerified(true);
      setStatusMessage("RFID verified successfully! ✓");
      setAuthStep("face-scan");

      setTimeout(() => {
        setStatusMessage("Position your face in the camera frame...");
        simulateFaceScan();
      }, 1500);
    }, 2000);
  };

  // -----------------------------
  // SIMULATION — Face Scan
  // -----------------------------
  const simulateFaceScan = () => {
    setTimeout(() => {
      setAuthStep("verifying");
      setStatusMessage("Analyzing facial features...");

      setTimeout(() => {
        setFaceVerified(true);
        setAuthStep("success");
        setStatusMessage("Authentication successful! ✓");

        toast({
          title: "Authentication Complete",
          description: "Identity verified successfully",
          duration: 2000,
        });

        setTimeout(() => {
          onAuthSuccess({
            rfidTag: selectedVoter.rfid_tag,
            faceHash: selectedVoter.face_id_hash,
          });

          console.log("AUTHENTICATED AS:", selectedVoter);
        }, 1800);
      }, 2500);
    }, 2000);
  };

  const handleRetry = () => {
    setAuthStep("idle");
    setStatusMessage("");
    setRfidVerified(false);
    setFaceVerified(false);
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-2xl border-2 border-primary/20 bg-card/95 backdrop-blur-sm shadow-2xl">
        <div className="p-12">

          {/* Header */}
          <div className="flex flex-col items-center mb-12">
            <img src={feuLogo} alt="FEU Alabang" className="h-24 w-auto mb-6" />
            <h1 className="text-4xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent mb-2">
              BotoVeritas
            </h1>
            <p className="text-xl text-muted-foreground text-center">
              Blockchain-Based Voting System
            </p>
          </div>

          {/* Voter Selector */}
          <div className="mb-6">
            <label className="text-sm font-semibold text-muted-foreground">
              Select Voter (Simulation Only)
            </label>
            <select
              className="mt-2 w-full p-3 border rounded-md bg-background"
              value={selectedVoter?.id || ""}
              onChange={(e) => {
                const voter = voters.find((v) => v.id === e.target.value);
                setSelectedVoter(voter);
              }}
            >
              <option value="">-- Choose Voter --</option>

              {voters.map((voter) => (
                <option key={voter.id} value={voter.id}>
                  {voter.first_name} {voter.last_name} — {voter.email}
                </option>
              ))}
            </select>
          </div>

          {/* Status Boxes */}
          <div className="space-y-6 mb-8">
            {/* RFID */}
            <div
              className={`flex items-center gap-4 p-6 rounded-xl border-2 transition-all ${
                rfidVerified
                  ? "border-success bg-success/5"
                  : authStep === "rfid-scan"
                  ? "border-primary bg-primary/5 animate-pulse"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex-shrink-0">
                {rfidVerified ? (
                  <CheckCircle2 className="h-10 w-10 text-success" />
                ) : authStep === "rfid-scan" ? (
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                ) : (
                  <Scan className="h-10 w-10 text-muted-foreground" />
                )}
              </div>

              <div>
                <h3 className="font-semibold text-lg">RFID Authentication</h3>
                <p className="text-sm text-muted-foreground">
                  Student ID verification
                </p>
              </div>
            </div>

            {/* Face */}
            <div
              className={`flex items-center gap-4 p-6 rounded-xl border-2 transition-all ${
                faceVerified
                  ? "border-success bg-success/5"
                  : authStep === "face-scan" || authStep === "verifying"
                  ? "border-primary bg-primary/5 animate-pulse"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex-shrink-0">
                {faceVerified ? (
                  <CheckCircle2 className="h-10 w-10 text-success" />
                ) : authStep === "face-scan" || authStep === "verifying" ? (
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                ) : (
                  <Camera className="h-10 w-10 text-muted-foreground" />
                )}
              </div>

              <div>
                <h3 className="font-semibold text-lg">Facial Recognition</h3>
                <p className="text-sm text-muted-foreground">
                  Biometric verification
                </p>
              </div>
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-4 rounded-lg mb-6 text-center font-medium ${
                authStep === "success"
                  ? "bg-success/10 text-success"
                  : authStep === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              }`}
            >
              {statusMessage}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-4">
            {authStep === "idle" && (
              <Button
                onClick={simulateRfidScan}
                className="w-full h-16 text-lg font-semibold bg-gradient-primary hover:opacity-90 shadow-glow"
              >
                <Scan className="mr-2 h-6 w-6" />
                Start Authentication
              </Button>
            )}

            {authStep === "error" && (
              <>
                <Button onClick={handleRetry} variant="outline" className="flex-1 h-14">
                  <AlertCircle className="mr-2 h-5 w-5" />
                  Retry
                </Button>
                <Button
                  onClick={() => window.location.reload()}
                  variant="destructive"
                  className="flex-1 h-14"
                >
                  Cancel
                </Button>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-border/50">
            <p className="text-sm text-center text-muted-foreground">
              Secure • Transparent • Verifiable
            </p>
            <p className="text-xs text-center text-muted-foreground mt-2">
              Powered by Blockchain Technology & NFT Proof of Vote
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AuthenticationScreen;
