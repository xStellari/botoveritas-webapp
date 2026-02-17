import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Compass, Home, TriangleAlert } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <style>
        {`
          @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .animate-gradient {
            background-size: 200% 200%;
            animation: gradientShift 14s ease-in-out infinite;
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
            50% { transform: translate3d(0, -10px, 0); }
          }
          .floaty {
            animation: floaty 6.5s ease-in-out infinite;
          }

          .blob {
            filter: blur(30px);
            opacity: 0.35;
          }
        `}
      </style>

      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-muted/40 via-background to-muted/20 animate-gradient" />
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/20 blob" />
      <div className="absolute -bottom-32 -right-28 h-96 w-96 rounded-full bg-secondary/20 blob" />

      <Card className="w-full max-w-xl bg-white/90 backdrop-blur-md shadow-2xl rounded-2xl border animate-fade-in-up">
        <CardHeader className="text-center space-y-2 pt-10">
          <div className="flex justify-center">
            <div className="floaty rounded-full bg-foreground/90 text-background p-4 shadow-lg">
              <TriangleAlert className="h-8 w-8" />
            </div>
          </div>

          <CardTitle className="text-3xl font-extrabold tracking-tight">404</CardTitle>
          <CardDescription className="text-base">
            This page doesn’t exist (or it was moved).
          </CardDescription>
        </CardHeader>

        <CardContent className="px-8 pb-10">
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <Compass className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Requested route</p>
                <p className="mt-1 break-all">{location.pathname}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Button className="w-full gap-2" onClick={() => navigate("/")}
            >
              <Home className="h-4 w-4" />
              Return to Home
            </Button>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => navigate(-1)}
            >
              Go Back
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground text-center">
            If you believe this is an error, double-check the link or contact an administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
