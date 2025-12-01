import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, LogOut } from "lucide-react";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { sortElections } from "@/utils/sortElections";


const RegistrationConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { firstName, lastName, orgAffiliations } = location.state || {};

  const [elections, setElections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
          orgAffiliations?.includes(election.title)
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

  // Helper: Render status badge based on real-time date
  const renderStatusBadge = (election: any) => {
    const now = new Date();
    const start = new Date(election.start_date);
    const end = new Date(election.end_date);

    const isCurrentlyActive =
      election.is_active && now >= start && now <= end;
    const hasEnded = now > end;

    if (isCurrentlyActive) {
      return (
        <Badge variant="outline" className="text-primary border-primary/40">
          Active
        </Badge>
      );
    }

    if (hasEnded) {
      return (
        <Badge
          variant="outline"
          className="text-destructive border-destructive"
        >
          Inactive
        </Badge>
      );
    }

    return null; // No badge for future/upcoming elections
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-6">
      <Card className="max-w-2xl w-full p-10 text-center shadow-xl border border-primary/20 bg-card/90 backdrop-blur-md">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Registration Successful
        </h1>

        <p className="text-muted-foreground mb-6">
          Welcome,{" "}
          <span className="font-semibold">
            {firstName} {lastName}
          </span>
          ! You’ve successfully registered as a voter.
        </p>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2 text-primary">
            Your Election Schedule
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading election schedule...
            </p>
          ) : elections.length > 0 ? (
            <div className="grid gap-4">
              {elections.map((election) => (
                <div
                  key={election.title}
                  className="border border-border rounded-lg p-4 text-left bg-muted/10"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-bold text-foreground">
                      {election.title}
                    </h3>
                    <ElectionStatusBadge election={election} />
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <div className="flex flex-col">
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
            <p className="text-sm text-muted-foreground">
              No election schedule found for your affiliations yet.
            </p>
          )}
        </div>

        <Button
          className="w-full bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90"
          onClick={() => navigate("/")}
        >
          Go to Home
        </Button>

        <Button
          variant="ghost"
          className="mt-4 text-muted-foreground hover:text-destructive"
          onClick={() => navigate("/auth?mode=login")}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </Card>
    </div>
  );
};

export default RegistrationConfirmation;
