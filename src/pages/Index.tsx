import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Flame, ShieldCheck, UserPlus, Vote } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { sortElections } from "@/utils/sortElections";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

// Edit this text as needed for your school’s timeline.
const REGISTRATION_PHASE_NOTE =
  "Voter registration is only available during the official registration period. Please wait for announcements on your organization’s Facebook page.";

type Election = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_paused: boolean | null;
  is_active: boolean | null;
  is_final: boolean | null;
  is_archived: boolean | null;
};

type ElectionView = "active" | "upcoming" | "finished";

const FINISHED_LIMIT = 5;

const Index = () => {
  const navigate = useNavigate();

  const formatTime = (value: string) => {
    const dt = new Date(value);
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
    }).format(dt);
  };

  const formatDateTime = (value: string) => {
    const dt = new Date(value);
    const datePart = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(dt);

    const timePart = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
    }).format(dt);

    return `${datePart} ${timePart}`;
  };

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const [elections, setElections] = useState<Election[]>([]);
  const [loading, setLoading] = useState(true);
  const [electionsError, setElectionsError] = useState<string | null>(null);

  const [electionView, setElectionView] = useState<ElectionView>("active");

  // Single 1-second tick for time-based UI (status + countdown derived from this).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  
  const loadRegistrationSetting = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;

    if (!silent) {
      setRegistrationLoading(true);
      setRegistrationError(null);
    }

    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", APP_SETTING_KEYS.registrationEnabled)
        .maybeSingle();

      if (error) throw error;

      const value = data?.value ?? false;
      setRegistrationEnabled(Boolean(value));
    } catch {
      // Fail closed on homepage (safer): disable registration.
      setRegistrationEnabled(false);
      if (!silent) setRegistrationError("Unable to check registration availability. Please try again later.");
    } finally {
      if (!silent) setRegistrationLoading(false);
    }
  };

  const loadElections = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;

    if (!silent) {
      setLoading(true);
      setElectionsError(null);
    }

    try {
      const { data, error } = await supabase
        .from("elections")
        .select("id,title,start_date,end_date,is_paused,is_active,is_final,is_archived")
        .order("start_date", { ascending: true });

      if (error) throw error;

      setElections(sortElections((data ?? []) as Election[]));
    } catch {
      setElections([]);
      if (!silent) setElectionsError("Unable to load elections right now. Please try again later.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial load + realtime for registration setting
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadRegistrationSetting();
    })();

    const channel = supabase
      .channel("app-settings-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "app_settings",
          filter: `key=eq.${APP_SETTING_KEYS.registrationEnabled}`,
        },
        async () => {
          if (cancelled) return;
          // silent reload (don't flash loading)
          await loadRegistrationSetting({ silent: true });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // Initial load + realtime for elections
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadElections();
    })();

    const channel = supabase
      .channel("elections-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "elections" }, async () => {
        if (cancelled) return;
        // silent reload (avoid flicker) but refresh list with latest flags (is_active/is_final/etc.)
        await loadElections({ silent: true });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const isArchived = (e: Election) => Boolean(e.is_archived);
  const isFinal = (e: Election) => Boolean(e.is_final);
  const isPaused = (e: Election) => Boolean(e.is_paused);

  const parseMs = (value: string): number | null => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };

  const { active, upcoming, finished } = useMemo(() => {
    const active: Election[] = [];
    const upcoming: Election[] = [];
    const finished: Election[] = [];

    for (const e of elections) {
      // Voter-visible gate:
      // - Archived: NEVER shown
      // - Final: NEVER shown to voters
      // - Inactive: hidden (admin-only concept)
      // Voter-visible gate:
      // - Archived: hidden from voters
      // - Paused: hidden from voters (maintenance/typo fixes)
      if (isArchived(e) || isPaused(e)) continue;

      const startMs = parseMs(e.start_date);
      const endMs = parseMs(e.end_date);
      const nowMs = now.getTime();

      // If dates are malformed, fail closed by hiding it (prevents confusing/incorrect voter info).
      if (startMs === null || endMs === null) continue;

      // Classify by time window
      // - Live/Upcoming: must NOT be final (final implies no further voting/changes)
      // - Finished: may be final or not (informational on Index)
      if (nowMs >= startMs && nowMs < endMs) {
        if (!isFinal(e)) active.push(e);
      } else if (nowMs < startMs) {
        if (!isFinal(e)) upcoming.push(e);
      } else {
        finished.push(e); // nowMs >= endMs
      }
    }

    // Show most recent finished elections first (so the cap displays the latest results).
    finished.sort((a, b) => {
      const aEnd = parseMs(a.end_date) ?? 0;
      const bEnd = parseMs(b.end_date) ?? 0;
      return bEnd - aEnd;
    });
    return { active, upcoming, finished };
  }, [elections, now]);

  // Keep the selected view valid when the underlying lists change.
  useEffect(() => {
    setElectionView((prev) => {
      if (prev === "active" && active.length) return prev;
      if (prev === "upcoming" && upcoming.length) return prev;
      if (prev === "finished" && finished.length) return prev;

      if (active.length) return "active";
      if (upcoming.length) return "upcoming";
      return "finished";
    });
  }, [active.length, upcoming.length, finished.length]);

  // Countdown strings derived from the single `now` tick (no second interval needed).
  const timeLeftMap = useMemo(() => {
    const updates: Record<string, string> = {};

    for (const e of active) {
      const end = new Date(e.end_date);
      const diff = end.getTime() - now.getTime();

      if (diff > 0) {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        updates[e.id] = `${h}h ${m}m ${s}s remaining`;
      }
    }

    return updates;
  }, [active, now]);

  // NOTE: These client-side guards are for UX only.
  // Security/eligibility must be enforced server-side (e.g., Supabase RLS / RPC validation)
  // because users can bypass UI restrictions by calling APIs directly.

  const handleRegister = () => {
    if (!registrationEnabled) return;
    navigate("/register");
  };

  const handleVote = () => {
    if (active.length === 0) return;
    navigate("/voting");
  };

  const getClosedLabel = (election: Election) => {
    if (Boolean(election?.is_final)) return "Election finished (finalized)";
    return "Voting finished";
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-feu-green/10 via-neutral-50 to-feu-gold/10 kiosk-portrait-shell">

<style>{`
  @keyframes blobFloat1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(16px,-18px) scale(1.05); } }
  @keyframes blobFloat2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-14px,14px) scale(1.06); } }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .animate-blob-1 { animation: blobFloat1 14s ease-in-out infinite; }
  .animate-blob-2 { animation: blobFloat2 16s ease-in-out infinite; }
  .animate-fade-in-up { animation: fadeInUp 420ms ease-out both; }
`}</style>

{/* Depth / motion background blobs */}
<div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-feu-green/20 blur-3xl animate-blob-1" />
<div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-feu-gold/20 blur-3xl animate-blob-2" />
<div className="pointer-events-none absolute top-24 right-20 h-48 w-48 rounded-full bg-emerald-300/10 blur-3xl animate-blob-1" />

      {/* NAVBAR */}
      <header className="w-full border-b bg-white/80 backdrop-blur shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={feuLogo} className="h-12" alt="FEU logo" />
          </div>
        </div>
      </header>

      <main className="flex-1 kiosk-portrait-main">
        <div className="max-w-6xl mx-auto px-6 py-8 h-full flex flex-col animate-fade-in-up">
          <div className="shrink-0 space-y-8">
            <section className="text-center space-y-3">
              <h1 className="text-5xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                BotoVeritas
              </h1>
              <p className="text-gray-600 max-w-xl mx-auto text-sm md:text-base">
                A blockchain-powered voting system ensuring fair and trustworthy student elections for
                FEU Alabang.
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

            {(registrationError || electionsError) && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <div className="text-xs font-semibold text-destructive tracking-wide uppercase">
                  Some features may be unavailable
                </div>
                <div className="text-sm text-foreground/90 mt-1 space-y-1">
                  {registrationError && <p>{registrationError}</p>}
                  {electionsError && <p>{electionsError}</p>}
                </div>
              </div>
            )}

            {!registrationLoading && !registrationEnabled && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <div className="text-xs font-semibold text-destructive tracking-wide uppercase">
                  Registration not available
                </div>
                <div className="text-sm text-foreground/90 mt-1">{REGISTRATION_PHASE_NOTE}</div>
              </div>
            )}

            <section className="grid md:grid-cols-2 gap-6">
              <Card
                className={`p-8 border-2 rounded-xl transition ${
                  registrationEnabled
                    ? "border-emerald-300 hover:border-emerald-500 hover:shadow-lg cursor-pointer"
                    : "border-border/40 bg-muted/30 opacity-60 cursor-not-allowed"
                }`}
                onClick={handleRegister}
                role="button"
                tabIndex={registrationEnabled ? 0 : -1}
                aria-disabled={!registrationEnabled}
                onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                  if (!registrationEnabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRegister();
                  }
                }}
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

                  <Button
                    className={`w-full mt-2 ${
                      registrationLoading || !registrationEnabled
                        ? "bg-muted text-muted-foreground border border-border cursor-not-allowed hover:bg-muted"
                        : ""
                    }`}
                    variant={registrationLoading || !registrationEnabled ? "outline" : "default"}
                    disabled={registrationLoading || !registrationEnabled}
                  >
                    {registrationLoading ? "Checking…" : registrationEnabled ? "Register" : "Unavailable"}
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
                role="button"
                tabIndex={active.length > 0 ? 0 : -1}
                aria-disabled={active.length === 0}
                onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                  if (active.length === 0) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleVote();
                  }
                }}
              >
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="p-4 rounded-full bg-amber-50 border border-amber-200">
                    <Vote className="h-10 w-10 text-amber-700" />
                  </div>
                  <h3 className="text-xl font-bold">Cast Your Vote</h3>
                  <p className="text-sm text-muted-foreground">Authenticate and submit your ballot.</p>
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
                role="button"
                tabIndex={0}
                onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/verify");
                  }
                }}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-full bg-emerald-50 border border-emerald-200">
                      <ShieldCheck className="h-8 w-8 text-emerald-800" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">Public Verification</h3>
                      <p className="text-sm text-muted-foreground">
                        Verify vote inclusion, NFT receipts, and (after finalization) ZK tally proofs —
                        no login required.
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

                  <Button className="bg-emerald-700 hover:bg-emerald-800 md:w-auto w-full">Verify</Button>
                </div>
              </Card>
            </section>
          </div>

          <section className="flex-1 min-h-0 mt-8 space-y-6 kiosk-portrait-scroll no-scrollbar">
            <Card className="border-emerald-100/70 bg-white/70 backdrop-blur">
              <div className="p-4 sm:p-5 border-b border-emerald-100/70 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-emerald-50 border border-emerald-100 grid place-items-center">
                      <Flame className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-lg font-semibold text-emerald-900 leading-tight">Elections</h1>
                      <p className="text-xs text-muted-foreground">
                        Browse live, upcoming, and finished elections.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={electionView === "active" ? "default" : "outline"}
                    className={
                      electionView === "active"
                        ? "bg-emerald-700 hover:bg-emerald-700 text-white"
                        : "border-emerald-200 text-emerald-800 bg-white/70"
                    }
                    onClick={() => setElectionView("active")}
                  >
                    Live <span className="ml-2 text-[11px] opacity-90">({active.length})</span>
                  </Button>

                  <Button
                    type="button"
                    variant={electionView === "upcoming" ? "default" : "outline"}
                    className={
                      electionView === "upcoming"
                        ? "bg-blue-700 hover:bg-blue-700 text-white"
                        : "border-blue-200 text-blue-800 bg-white/70"
                    }
                    onClick={() => setElectionView("upcoming")}
                  >
                    Upcoming <span className="ml-2 text-[11px] opacity-90">({upcoming.length})</span>
                  </Button>

                  <Button
                    type="button"
                    variant={electionView === "finished" ? "default" : "outline"}
                    className={
                      electionView === "finished"
                        ? "bg-rose-600 hover:bg-rose-600 text-white"
                        : "border-rose-200 text-rose-700 bg-white/70"
                    }
                    onClick={() => setElectionView("finished")}
                  >
                    Finished <span className="ml-2 text-[11px] opacity-90">({finished.length})</span>
                  </Button>
                </div>
              </div>

              <div className="p-4 sm:p-5 min-h-0 space-y-4">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading elections…</p>
                ) : electionView === "active" ? (
                  active.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No active elections at the moment.</p>
                  ) : (
                    <div className="space-y-4">
                      {active.map((election) => (
                        <Card key={election.id} className="p-5 border hover:bg-emerald-50/50">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <div className="min-w-0">
                              <h3 className="font-semibold leading-tight truncate">{election.title}</h3>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <CalendarDays className="h-3 w-3" />
                                {formatDateTime(election.start_date)} →{" "}
                                {formatDateTime(election.end_date)}
                              </p>
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              <ElectionStatusBadge election={election} />
                              <p className="text-[11px] text-emerald-800">
                                {timeLeftMap[election.id] ?? ""}
                              </p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )
                ) : electionView === "upcoming" ? (
                  upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No upcoming elections scheduled.</p>
                  ) : (
                    <div className="space-y-4">
                      {upcoming.map((election) => (
                        <Card key={election.id} className="p-5 border hover:bg-blue-50/50">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <div className="min-w-0">
                              <h3 className="font-semibold leading-tight truncate">{election.title}</h3>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                <CalendarDays className="h-3 w-3" />
                                Starts: {formatDateTime(election.start_date)}
                              </p>
                            </div>
                            <div className="shrink-0">
                              <ElectionStatusBadge election={election} />
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )
                ) : finished.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No finished elections.</p>
                ) : (
                  <div className="space-y-4">
                    {finished.slice(0, FINISHED_LIMIT).map((election) => (
                      <Card key={election.id} className="p-5 border hover:bg-rose-50/50">
                        <div className="flex items-start justify-between gap-3 mb-1">
                          <div className="min-w-0">
                            <h3 className="font-semibold leading-tight truncate">{election.title}</h3>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <CalendarDays className="h-3 w-3" />
                              {formatDateTime(election.start_date)} →{" "}{formatDateTime(election.end_date)}
                            </p>
                            <p className="text-xs text-rose-700 mt-1 font-medium">
                              {getClosedLabel(election)}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <ElectionStatusBadge election={election} />
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </Card>
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