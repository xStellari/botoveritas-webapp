import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function ErrorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  type ErrorState = {
    title?: string;
    message?: string;
    voterAudience?: "students" | "associates";
    voter_audience?: "students" | "associates";
    reason?: "NO_ELIGIBLE_ELECTIONS" | "NO_ACTIVE_ELECTIONS" | string;
    recoverTo?: string;
    countdownSeconds?: number;
  };

  const state = (location.state as ErrorState) || {};
  const audience = state.voterAudience || state.voter_audience;

  const rawMessage =
    state.message || "An unexpected error occurred.";

  // Defensive UI sanitization: avoid showing raw Postgres constraint errors.
  const isDuplicateRFIDConstraint =
    /duplicate\s+key\s+value\s+violates\s+unique\s+constraint/i.test(rawMessage) &&
    /voters_rfid_tag_key|rfid_tag/i.test(rawMessage);

  const isNoEligibleElectionsMessage =
    state.reason === "NO_ELIGIBLE_ELECTIONS" ||
    /no\s+active\s+elections/i.test(rawMessage) ||
    /no\s+eligible\s+elections/i.test(rawMessage);

  const isNoActiveElectionsMessage =
    state.reason === "NO_ACTIVE_ELECTIONS" || /no\s+active\s+elections/i.test(rawMessage);

  const message = (() => {
    if (isDuplicateRFIDConstraint) {
      return "RFID is already registered in the database. Please use a different RFID or contact an administrator.";
    }

    // Make the “no elections” case explicit and non-personal.
    if (isNoActiveElectionsMessage && !isNoEligibleElectionsMessage) {
      return (
        "There are currently no active elections at this time.\n\n" +
        "If you believe this is incorrect, please contact your system administrator."
      );
    }

    if (isNoEligibleElectionsMessage) {
      if (audience === "associates") {
        return (
          "This kiosk is primarily used for student elections.\n\n" +
          "There are currently no active elections for associates.\n\n" +
          "If you believe this is incorrect, please contact your system administrator."
        );
      }

      if (audience === "students") {
        return (
          "There are currently no active student elections.\n\n" +
          "If you believe this is incorrect, please contact your system administrator."
        );
      }

      return (
        "There are currently no active elections available at this time.\n\n" +
        "If you believe this is incorrect, please contact your system administrator."
      );
    }

    return rawMessage;
  })();

  // Auto-redirect countdown
  const recoverTo = state.recoverTo || "/";
  const initialSeconds =
    typeof state.countdownSeconds === "number" && state.countdownSeconds > 0
      ? Math.floor(state.countdownSeconds)
      : 10;
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) {
      navigate(recoverTo);
      return;
    }

    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, navigate, recoverTo]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">

      {/* CSS animations */}
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

          @keyframes fadeInUp {
            0% { transform: translateY(10px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }

          .animate-fade-in-up {
            animation: fadeInUp 420ms ease-out both;
          }

          @keyframes floaty {
            0%, 100% { transform: translate3d(0, 0, 0); }
            50% { transform: translate3d(0, -12px, 0); }
          }

          .blob {
            filter: blur(28px);
            opacity: 0.35;
            animation: floaty 7s ease-in-out infinite;
          }

          .blob-delay {
            animation-delay: -2.5s;
          }

          @keyframes errorPop {
            0% { transform: scale(0.6); opacity: 0; }
            60% { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }

          @keyframes ringPulseRed {
            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
            100% { box-shadow: 0 0 0 18px rgba(239, 68, 68, 0); }
          }

          .error-icon {
            animation: errorPop 0.6s ease-out forwards,
                       ringPulseRed 1.6s ease-out infinite;
          }
        `}
      </style>

      {/* Background animation */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-red-200/20 via-background to-red-400/20 animate-gradient" />
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-red-400/30 blob" />
      <div className="absolute -bottom-32 -right-28 h-96 w-96 rounded-full bg-red-300/30 blob blob-delay" />

      <Card className="max-w-lg w-full shadow-2xl border border-red-300 bg-white/95 backdrop-blur-md rounded-2xl animate-fade-in-up">

        <CardHeader className="text-center space-y-3 pt-10">
          <div className="flex justify-center">
            <div className="error-icon rounded-full bg-red-500 p-4 text-white shadow-lg">
              <AlertTriangle className="w-10 h-10" />
            </div>
          </div>

          <CardTitle className="text-3xl font-extrabold text-red-600">
            {state.title ?? "Error"}
          </CardTitle>

          <CardDescription className="text-base text-muted-foreground">
            Please review the message below.
          </CardDescription>
        </CardHeader>

        <CardContent className="text-center px-8 pb-10 space-y-6">

          {/* Error Message */}
          <p className="text-lg font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 whitespace-pre-line shadow-sm">
            {message}
          </p>

          {/* Auto redirect countdown */}
          <Button
            disabled
            className="w-full text-lg py-6 font-semibold opacity-100 cursor-default bg-gradient-to-r from-primary to-secondary"
          >
            Returning in {seconds}…
          </Button>

          {/* Optional manual return button */}
          <Button
            variant="outline"
            className="w-full text-base py-5 font-semibold border-red-300 text-red-600 hover:bg-red-50 transition"
            onClick={() => navigate(recoverTo)}
          >
            Return Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
