import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanFace, ArrowRight, ShieldCheck } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";

const Kiosk = () => {
  const navigate = useNavigate();

  const handleStart = () => {
    navigate("/voting"); // goes to VotingKiosk.tsx (starts at step = "auth")
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-6">

      <Card className="w-full max-w-3xl border-2 border-primary/30 bg-card/95 backdrop-blur-xl p-12 shadow-2xl animate-fade-in">

        {/* HEADER */}
        <div className="flex flex-col items-center text-center mb-10">
          <img
            src={feuLogo}
            alt="FEU Alabang"
            className="h-28 w-auto mb-6 drop-shadow-lg"
          />

          <h1 className="text-4xl font-extrabold bg-gradient-hero bg-clip-text text-transparent drop-shadow-sm">
            BotoVeritas Voting Kiosk
          </h1>

          <p className="text-muted-foreground mt-2 text-base max-w-md">
            Authenticate using your <strong>RFID Student ID</strong> and{" "}
            <strong>Facial Recognition</strong> to begin voting.
          </p>

          <div className="flex gap-2 mt-4">
            <Badge
              variant="outline"
              className="border-primary/40 text-primary bg-primary/10"
            >
              Secure
            </Badge>
            <Badge
              variant="outline"
              className="border-secondary/40 text-secondary bg-secondary/10"
            >
              Private
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-600 bg-amber-50"
            >
              Instant
            </Badge>
          </div>
        </div>

        {/* ICON */}
        <div className="flex justify-center mb-10">
          <div className="p-8 rounded-full bg-primary/10 border border-primary/20 shadow-inner animate-pulse-slow">
            <ScanFace className="h-20 w-20 text-primary" />
          </div>
        </div>

        {/* START BUTTON */}
        <Button
          onClick={handleStart}
          className="w-full h-16 text-xl font-semibold bg-gradient-primary hover:opacity-90 shadow-glow flex items-center justify-center gap-3"
        >
          Begin Authentication
          <ArrowRight className="h-6 w-6" />
        </Button>

        {/* SECURITY FOOTER */}
        <div className="mt-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span>
            Your identity is encrypted and never stored outside the election
            system.
          </span>
        </div>
      </Card>

    </div>
  );
};

export default Kiosk;
