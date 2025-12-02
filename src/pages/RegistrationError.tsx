import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function RegistrationError() {
  const navigate = useNavigate();
  const location = useLocation();

  const message =
    (location.state as { message?: string })?.message ||
    "An unexpected error occurred during registration.";

  // Auto-redirect countdown
  const [seconds, setSeconds] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          navigate("/");
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* FEU Hybrid Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/20 via-background to-secondary/20 animate-gradient" />

      <style>
        {`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position:100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradientShift 12s ease-in-out infinite;
        }
        `}
      </style>

      <Card className="max-w-lg w-full shadow-2xl border border-red-300 bg-white/95 backdrop-blur rounded-2xl">
        <CardHeader className="text-center space-y-3 pt-10">
          <div className="flex justify-center">
            <AlertTriangle className="w-16 h-16 text-red-500" />
          </div>

          <CardTitle className="text-3xl font-extrabold text-red-600">
            Registration Failed
          </CardTitle>

          <CardDescription className="text-base text-muted-foreground">
            Please review the message below.
          </CardDescription>
        </CardHeader>

        <CardContent className="text-center px-8 pb-10 space-y-6">
          <p className="text-lg font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 whitespace-pre-line">
            {message}
          </p>

          {/* Button-styled countdown (not clickable) */}
          <Button
            disabled
            className="w-full text-lg py-6 font-semibold opacity-100 cursor-default bg-gradient-to-r from-primary to-secondary"
          >
            Returning to start in {seconds}…
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
