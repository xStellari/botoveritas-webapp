import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  Eye,
  CheckCircle2,
  Flame,
  Clock,
  CalendarDays,
  Vote,
  UserPlus,
  LayoutDashboard,
  CheckCircle,
} from "lucide-react";

import feuLogo from "@/assets/feu-logo.png";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { sortElections } from "@/utils/sortElections";
import { toast } from "sonner";

const Index = () => {
  const navigate = useNavigate();

  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [elections, setElections] = useState<any[]>([]);
  const [timeLeftMap, setTimeLeftMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Load elections
  useEffect(() => {
    const loadElections = async () => {
      const { data } = await supabase
        .from("elections")
        .select("*")
        .order("start_date", { ascending: true });

      setElections(sortElections(data || []));
      setLoading(false);
    };
    loadElections();
  }, []);

  // Countdown handler
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const updates: Record<string, string> = {};

      elections.forEach((e) => {
        const start = new Date(e.start_date);
        const end = new Date(e.end_date);

        if (now >= start && now <= end) {
          const diff = end.getTime() - now.getTime();
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          updates[e.id] = `${h}h ${m}m ${s}s remaining`;
        }
      });

      setTimeLeftMap(updates);
    }, 1000);

    return () => clearInterval(interval);
  }, [elections]);

  const now = new Date();

  const active = elections.filter(
    (e) => now >= new Date(e.start_date) && now <= new Date(e.end_date)
  );

  const upcoming = elections.filter(
    (e) => now < new Date(e.start_date)
  );

  const finished = elections.filter(
    (e) => now > new Date(e.end_date)
  );

  // Actions
  const handleRegister = () => {
    if (!registrationEnabled) {
      toast.error("Registration is currently closed.");
      return;
    }
    navigate("/register");
  };

  const handleVote = () => {
    if (active.length === 0) {
      toast.error("No active elections available.");
      return;
    }
    navigate("/voting");
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">

      {/* NAVBAR */}
      <header className="w-full border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={feuLogo} className="h-12" />
          </div>

          <Button variant="ghost" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </Button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">

          {/* HERO SECTION */}
          <section className="text-center space-y-4">
            <h1 className="text-5xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent mb-3">
              BotoVeritas
            </h1>
            <p className="text-gray-600 max-w-xl mx-auto text-sm md:text-base">
              A blockchain-powered voting system ensuring fair and trustworthy
              student elections for FEU Alabang.
            </p>

            <div className="flex justify-center gap-2 mt-4">
              <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                Secure Identity
              </Badge>
              <Badge variant="outline" className="border-blue-500 text-blue-700">
                Transparent Records
              </Badge>
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                Verifiable Results
              </Badge>
            </div>
          </section>

          {/* ACTION CARDS */}
          <section className="grid md:grid-cols-2 gap-6">
            {/* Register */}
            <Card
              className={`p-8 border-2 rounded-xl transition ${
                registrationEnabled
                  ? "border-emerald-300 hover:border-emerald-500 hover:shadow-lg cursor-pointer"
                  : "border-border/40 bg-muted/30 opacity-60 cursor-not-allowed"
              }`}
              onClick={handleRegister}
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 rounded-full bg-emerald-50 border border-emerald-200">
                  <UserPlus className="h-10 w-10 text-emerald-700" />
                </div>
                <h3 className="text-xl font-bold">Voter Registration</h3>
                <p className="text-sm text-muted-foreground">
                  Register as a voter for upcoming elections.
                </p>
                <Button className="w-full mt-2" disabled={!registrationEnabled}>
                  Register
                </Button>
              </div>
            </Card>

            {/* Vote */}
            <Card
              className={`p-8 border-2 rounded-xl transition ${
                active.length > 0
                  ? "border-amber-300 hover:border-amber-500 hover:shadow-lg cursor-pointer"
                  : "border-border/40 bg-muted/30 opacity-60 cursor-not-allowed"
              }`}
              onClick={handleVote}
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 rounded-full bg-amber-50 border border-amber-200">
                  <Vote className="h-10 w-10 text-amber-700" />
                </div>
                <h3 className="text-xl font-bold">Cast Your Vote</h3>
                <p className="text-sm text-muted-foreground">
                  Authenticate through the kiosk and submit your ballot.
                </p>
                <Button
                  className="w-full mt-2 bg-gradient-gold text-black hover:opacity-90"
                  disabled={active.length === 0}
                >
                  Start Voting
                </Button>
              </div>
            </Card>
          </section>

          {/* ELECTIONS SECTION */}
          <section className="space-y-12">

            {/* Active Elections */}
            <div>
              <h2 className="text-xl font-bold text-emerald-800 flex items-center gap-2 mb-4">
                <Flame className="h-5 w-5 text-emerald-700" />
                Active Elections
              </h2>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : active.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active elections at the moment.
                </p>
              ) : (
                <div className="space-y-4">
                  {active.map((election) => (
                    <Card
                      key={election.id}
                      className="p-5 border hover:bg-emerald-50/50 transition"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold">{election.title}</h3>
                        <ElectionStatusBadge election={election} />
                      </div>

                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {new Date(election.start_date).toLocaleString()} →{" "}
                        {new Date(election.end_date).toLocaleString()}
                      </p>

                      <p className="text-xs text-destructive mt-1">
                        {timeLeftMap[election.id] ?? ""}
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming Elections */}
            <div>
              <h2 className="text-xl font-bold text-blue-800 flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-blue-700" />
                Upcoming Elections
              </h2>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No upcoming elections scheduled.
                </p>
              ) : (
                <div className="space-y-4">
                  {upcoming.map((election) => (
                    <Card
                      key={election.id}
                      className="p-5 border hover:bg-blue-50/50 transition"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold">{election.title}</h3>
                        <ElectionStatusBadge election={election} />
                      </div>

                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        Starts: {new Date(election.start_date).toLocaleString()}
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Closed ELECTIONS */}
            <div>
              <h2 className="text-xl font-bold text-red-500 flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-red-500" />
                Closed Elections
              </h2>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : finished.length === 0 ? (
                <p className="text-sm text-muted-foreground">No finished elections.</p>
              ) : (
                <div className="space-y-4">
                  {finished.map((election) => (
                    <Card
                      key={election.id}
                      className="p-5 border hover:bg-red-50/50 transition"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold">{election.title}</h3>
                        <ElectionStatusBadge election={election} />
                      </div>

                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {new Date(election.start_date).toLocaleString()} →{" "}
                        {new Date(election.end_date).toLocaleString()}
                      </p>

                      <p className="text-xs text-red-500 mt-1 font-medium">
                        Voting period closed
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </div>

          </section>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="py-6 border-t bg-white/70 backdrop-blur text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} BotoVeritas — FEU Alabang Student Elections
      </footer>
    </div>
  );
};

export default Index;
