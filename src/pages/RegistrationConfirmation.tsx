import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, LogOut, CheckCircle2 } from "lucide-react";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { sortElections } from "@/utils/sortElections";

const RegistrationConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    firstName = "",
    middleName = "",
    lastName = "",
    suffix = "",
    orgAffiliations = [],
  } = (location.state || {}) as {
    firstName?: string;
    middleName?: string;
    lastName?: string;
    suffix?: string;
    orgAffiliations?: string[];
  };

  const [elections, setElections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(10);

  const fullName = [firstName, middleName && `${middleName}.`, lastName, suffix]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const loadElections = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("elections")
        .select("title, start_date, end_date, is_active");

      if (error) {
        console.error("Error loading elections:", error.message);
      } else {
        const eligible = (data || []).filter((election) =>
          orgAffiliations?.some((org) =>
            election.title.toLowerCase().includes(org.toLowerCase())
          )
        );
        setElections(sortElections(eligible));
      }
      setLoading(false);
    };

    if (orgAffiliations && orgAffiliations.length > 0) {
      loadElections();
    } else {
      setLoading(false);
    }
  }, [orgAffiliations]);

  // Auto-redirect countdown back to landing
  useEffect(() => {
    if (secondsLeft <= 0) {
      navigate("/");
      return;
    }
    const timer = setTimeout(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [secondsLeft, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Local keyframes for background + icon animation */}
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

          @keyframes successPop {
            0% { transform: scale(0.6); opacity: 0; }
            60% { transform: scale(1.05); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }

          @keyframes ringPulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
            100% { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0); }
          }

          .success-icon {
            animation: successPop 0.6s ease-out forwards, ringPulse 1.6s ease-out infinite;
          }
        `}
      </style>

      {/* Animated background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <Card className="max-w-2xl w-full p-10 text-center shadow-xl border border-primary/20 bg-card/90 backdrop-blur-md">
        {/* Success badge */}
        <div className="flex justify-center mb-6">
          <div className="success-icon rounded-full bg-gradient-to-br from-emerald-500 to-primary p-4 text-white flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10" />
          </div>
        </div>

        <h1 className="text-4xl font-extrabold mb-3 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Registration Complete
        </h1>

        <p className="text-muted-foreground mb-6 text-base">
          Welcome,&nbsp;
          <span className="font-semibold text-foreground">{fullName}</span>!
          <br />
          You’ve successfully registered as a voter in BotoVeritas.
        </p>

        {/* Org affiliations summary (if any) */}
        {orgAffiliations && orgAffiliations.length > 0 && (
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Registered Organizational Affiliations
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {orgAffiliations.map((org) => (
                <span
                  key={org}
                  className="px-3 py-1 text-xs rounded-full bg-primary/5 text-primary border border-primary/20"
                >
                  {org}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Election schedule */}
        <div className="mb-8 text-left">
          <h2 className="text-lg font-semibold mb-2 text-primary text-center">
            Your Election Schedule
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground text-center">
              Loading election schedule...
            </p>
          ) : elections.length > 0 ? (
            <div className="grid gap-4 mt-3">
              {elections.map((election) => (
                <div
                  key={election.title}
                  className="border border-border rounded-lg p-4 bg-muted/10"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-bold text-foreground">
                      {election.title}
                    </h3>
                    <ElectionStatusBadge election={election} />
                  </div>

                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary mt-[2px]" />
                    <div className="flex flex-col gap-0.5">
                      <span>
                        <strong>Opens:</strong>{" "}
                        {new Date(election.start_date).toLocaleDateString()}{" "}
                        {new Date(election.start_date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        <strong>Closes:</strong>{" "}
                        {new Date(election.end_date).toLocaleDateString()}{" "}
                        {new Date(election.end_date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center mt-2">
              No election schedule found for your affiliations yet.
            </p>
          )}
        </div>

        {/* Primary action + countdown */}
        <div className="space-y-3">
          <Button
            className="w-full bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 text-base py-5 font-semibold"
            onClick={() => navigate("/")}
          >
            Go to Home Now
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Returning to Home automatically in{" "}
            <span className="font-semibold text-primary">
              {secondsLeft}s
            </span>
            ...
          </p>
        </div>
      </Card>
    </div>
  );
};

export default RegistrationConfirmation;
