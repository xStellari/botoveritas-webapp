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

export default function RegistrationError() {
  const navigate = useNavigate();
  const location = useLocation();

  const message =
    (location.state as { message?: string })?.message ||
    "An unexpected error occurred during registration.";

  // Auto-redirect countdown
  const [seconds, setSeconds] = useState(8);

  useEffect(() => {
    if (seconds <= 0) {
      navigate("/");
      return;
    }

    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, navigate]);

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

      <Card className="max-w-lg w-full shadow-2xl border border-red-300 bg-white/95 backdrop-blur-md rounded-2xl animate-fade-in-up">

        <CardHeader className="text-center space-y-3 pt-10">
          <div className="flex justify-center">
            <div className="error-icon rounded-full bg-red-500 p-4 text-white shadow-lg">
              <AlertTriangle className="w-10 h-10" />
            </div>
          </div>

          <CardTitle className="text-3xl font-extrabold text-red-600">
            Registration Failed
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
            Returning to Main in {seconds}…
          </Button>

          {/* Optional manual return button */}
          <Button
            variant="outline"
            className="w-full text-base py-5 font-semibold border-red-300 text-red-600 hover:bg-red-50 transition"
            onClick={() => navigate("/")}
          >
            Return to Main Now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
