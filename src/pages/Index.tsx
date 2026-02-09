import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Clock, CalendarDays, Vote, UserPlus, CheckCircle, ShieldCheck } from "lucide-react";

import feuLogo from "@/assets/feu-logo.png";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { sortElections } from "@/utils/sortElections";
import { toast } from "sonner";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

// Edit this text as needed for your school’s timeline.
const REGISTRATION_PHASE_NOTE = "Voter registration is only available during the official registration period. Please wait for announcements on your organization’s Facebook page.";

const Index = () => {
  const navigate = useNavigate();

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [elections, setElections] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistrationSetting() {
      setRegistrationLoading(true);
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", APP_SETTING_KEYS.registrationEnabled)
          .maybeSingle();

        if (error) throw error;
        const value = data?.value ?? false;
        if (!cancelled) setRegistrationEnabled(Boolean(value));
      } catch {
        // Fail closed on homepage (safer): disable registration.
        if (!cancelled) setRegistrationEnabled(false);
      } finally {
        if (!cancelled) setRegistrationLoading(false);
      }
    }

    loadRegistrationSetting();
    return () => {
      cancelled = true;
    };
  }, []);
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

  const now = new Date();

  const isArchived = (e: any) => Boolean(e?.is_archived);

  const isOperational = (e: any) =>
    Boolean(e?.is_active) && !Boolean(e?.is_final) && !Boolean(e?.is_archived);

  const active = elections.filter((e) => {
    if (isArchived(e)) return false;
    if (!isOperational(e)) return false;
    return now >= new Date(e.start_date) && now <= new Date(e.end_date);
  });

  const upcoming = elections.filter((e) => {
    if (isArchived(e)) return false;
    if (!isOperational(e)) return false;
    return now < new Date(e.start_date);
  });

  /**
   * Closed elections (Index policy):
   * - Archived: NEVER shown
   * - Finalized: shown as closed (even if finalized early)
   * - Time-ended: shown as closed
   */
  const finished = elections.filter((e) => {
    if (isArchived(e)) return false;

    const end = new Date(e.end_date);
    const timeEnded = now > end;
    const finalized = Boolean(e?.is_final);

    return timeEnded || finalized;
  });

  // Countdown handler (ONLY for active operational elections)
  useEffect(() => {
    const interval = setInterval(() => {
      const updates: Record<string, string> = {};

      active.forEach((e) => {
        const end = new Date(e.end_date);
        const diff = end.getTime() - Date.now();
        if (diff > 0) {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          updates[e.id] = `${h}h ${m}m ${s}s remaining`;
        }
      });

      setTimeLeftMap(updates);
    }, 1000);

    return () => clearInterval(interval);
  }, [active]);

  const handleRegister = () => {
    if (!registrationEnabled) {
      toast.error("Registration is currently closed.", {
        description: REGISTRATION_PHASE_NOTE,
      });
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

  const getClosedLabel = (election: any) => {
    if (Boolean(election?.is_final)) return "Election finished (finalized)";
    return "Voting finished";
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 kiosk-portrait-shell">
      {/* NAVBAR */}
      <header className="w-full border-b bg-white/80 backdrop-blur shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={feuLogo} className="h-12" />
          </div>
        </div>
      </header>

      <main className="flex-1 kiosk-portrait-main">
        <div className="max-w-6xl mx-auto px-6 py-8 h-full flex flex-col">
          <div className="shrink-0 space-y-8">
            <section className="text-center space-y-3">
              <h1 className="text-5xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                BotoVeritas
              </h1>
              <p className="text-gray-600 max-w-xl mx-auto text-sm md:text-base">
                A blockchain-powered voting system ensuring fair and trustworthy
                student elections for FEU Alabang.
              </p>

              <div className="flex justify-center gap-2 mt-3">
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

                      <section className="grid md:grid-cols-2 gap-6">
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Registration availability depends on the current election phase.
                  </p>

                  {!registrationEnabled && !registrationLoading && (
                    <div className="mt-4 rounded-lg border border-border/60 bg-muted/50 p-3">
                      <div className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
                        Registration disabled
                      </div>
                      <div className="text-sm text-foreground/90 mt-1">
                        {REGISTRATION_PHASE_NOTE}
                      </div>
                    </div>
                  )}
                  <Button
                    className={`w-full mt-2 ${
                      registrationLoading || !registrationEnabled
                        ? "bg-muted text-muted-foreground border border-border cursor-not-allowed hover:bg-muted"
                        : ""
                    }`}
                    variant={registrationLoading || !registrationEnabled ? "outline" : "default"}
                    disabled={registrationLoading || !registrationEnabled}
                  >
                    {registrationLoading ? "Checking…" : registrationEnabled ? "Register" : "Registration Not Available"}
                  </Button>
                </div>
              </Card>

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
                    Authenticate and submit your ballot.
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Voting eligibility will be verified in the next step.
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


            <section className="mt-6">
              <Card
                className="p-6 border-2 rounded-xl border-emerald-200 hover:border-emerald-500 hover:shadow-lg transition cursor-pointer"
                onClick={() => navigate("/verify")}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-full bg-emerald-50 border border-emerald-200">
                      <ShieldCheck className="h-8 w-8 text-emerald-800" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Public Verification</h3>
                      <p className="text-sm text-muted-foreground">
                        Verify vote inclusion, NFT receipts, and (after finalization) ZK tally proofs — no login required.
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                          Vote Inclusion
                        </Badge>
                        <Badge variant="outline" className="border-amber-500 text-amber-700">
                          NFT Receipts
                        </Badge>
                        <Badge variant="outline" className="border-blue-500 text-blue-700">
                          ZK Audit
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <Button className="bg-emerald-700 hover:bg-emerald-800 md:w-auto w-full">
                    Verify
                  </Button>
                </div>
              </Card>
            </section>

          </div>

          <section className="flex-1 min-h-0 mt-8 space-y-10 kiosk-portrait-scroll no-scrollbar">
            {/* ACTIVE */}
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
                    <Card key={election.id} className="p-5 border hover:bg-emerald-50/50">
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

            {/* UPCOMING */}
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
                    <Card key={election.id} className="p-5 border hover:bg-blue-50/50">
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

            {/* FINISHED */}
            <div>
              <h2 className="text-xl font-bold text-red-500 flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-red-500" />
                Finished Elections
              </h2>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : finished.length === 0 ? (
                <p className="text-sm text-muted-foreground">No finished elections.</p>
              ) : (
                <div className="space-y-4">
                  {finished.map((election) => (
                    <Card key={election.id} className="p-5 border hover:bg-red-50/50">
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
                        {getClosedLabel(election)}
                      </p>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="py-6 border-t bg-white/70 backdrop-blur text-center text-xs text-muted-foreground shrink-0">
        © {new Date().getFullYear()} BotoVeritas — FEU Alabang Student Elections
      </footer>
    </div>
  );
};

export default Index;