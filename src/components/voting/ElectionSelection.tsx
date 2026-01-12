import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  Users,
  Vote,
  CheckCircle2,
  Flame,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import feuLogo from "@/assets/feu-logo.png";

interface ElectionSelectionProps {
  voterData: any;
  onElectionSelect: (electionId: string, electionData: any) => void;
  completedElections: string[];
  activeElections: any[];
  expiredElections: any[];
  onRefresh?: () => Promise<void> | void;
}

const ElectionSelection = ({
  voterData,
  onElectionSelect,
  completedElections,
  activeElections,
  expiredElections,
  onRefresh,
}: ElectionSelectionProps) => {
  const handleSelectElection = (election: any) => {
    if (completedElections.includes(election.id)) {
      toast.error("You have already voted in this election");
      return;
    }
    onElectionSelect(election.id, election);
  };

  /**
   * Local mirrors (helps if parent reuses array references)
   */
  const [localActive, setLocalActive] = useState<any[]>(
    Array.isArray(activeElections) ? activeElections : []
  );
  const [localExpired, setLocalExpired] = useState<any[]>(
    Array.isArray(expiredElections) ? expiredElections : []
  );

  // Track changes by IDs (stable even if array reference is reused)
  const activeKey = useMemo(() => {
    const list = Array.isArray(activeElections) ? activeElections : [];
    return list.map((e) => e?.id).filter(Boolean).join("|");
  }, [activeElections]);

  const expiredKey = useMemo(() => {
    const list = Array.isArray(expiredElections) ? expiredElections : [];
    return list.map((e) => e?.id).filter(Boolean).join("|");
  }, [expiredElections]);

  useEffect(() => {
    setLocalActive(Array.isArray(activeElections) ? activeElections : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => {
    setLocalExpired(Array.isArray(expiredElections) ? expiredElections : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiredKey]);

  // ✅ Eligibility filter (defensive, UI-only)
  const voterOrgs: string[] = Array.isArray(voterData?.org_affiliations)
    ? voterData.org_affiliations
    : [];

  const eligibleActiveElections = useMemo(() => {
    return (localActive ?? []).filter((e) => {
      const eligibleOrgs: string[] = Array.isArray(e?.eligible_orgs) ? e.eligible_orgs : [];
      if (eligibleOrgs.length === 0) return true; // open election fallback
      return eligibleOrgs.some((org) => voterOrgs.includes(org));
    });
  }, [localActive, voterOrgs]);

  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = async () => {
    if (!onRefresh) {
      toast.message("Refresh is not wired yet", {
        description: "VotingKiosk must pass an onRefresh callback.",
      });
      return;
    }
    try {
      setRefreshing(true);
      await onRefresh();
      toast.success("Elections refreshed");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to refresh elections");
    } finally {
      setRefreshing(false);
    }
  };

  const voterFullName = `${voterData.first_name} ${voterData.middle_name}. ${voterData.last_name}`;

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* NAVBAR (match Index.tsx) */}
      <header className="w-full border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={feuLogo} className="h-12" alt="FEU Logo" />
          </div>

          <div className="text-xs text-muted-foreground hidden md:block">Voting Kiosk</div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
          {/* HERO */}
          <section className="text-center space-y-3">
            <h1 className="text-5xl font-bold text-center bg-gradient-hero bg-clip-text text-transparent mb-2">
              BotoVeritas
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto text-sm md:text-base">
              Select an election available for voting.
            </p>

            <p className="text-xs md:text-sm text-muted-foreground">
              Logged in as <span className="font-semibold text-foreground">{voterFullName}</span>
            </p>

            <div className="flex justify-center items-center gap-2 mt-4 flex-wrap">
              <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                Active: {eligibleActiveElections.length}
              </Badge>
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                Voted: {completedElections.length}
              </Badge>
              <Badge variant="outline" className="border-gray-300 text-gray-700">
                Closed: {localExpired.length}
              </Badge>

              {/* Refresh button */}
              <Button
                variant="outline"
                className="h-7 px-3 rounded-full border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={doRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </section>

          {/* ACTIVE ELECTIONS */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-emerald-800 flex items-center gap-2">
              <Flame className="h-5 w-5 text-emerald-700" />
              Active Elections
            </h2>

            {eligibleActiveElections.length === 0 ? (
              <Card className="p-6 border">
                <p className="text-sm text-muted-foreground">
                  No active elections at the moment.
                </p>
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={doRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                    {refreshing ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="space-y-4">
                {eligibleActiveElections.map((election) => {
                  const hasVoted = completedElections.includes(election.id);

                  return (
                    <Card
                      key={election.id}
                      className={`p-6 border transition ${
                        hasVoted
                          ? "bg-muted/30 opacity-70"
                          : "hover:bg-emerald-50/50 cursor-pointer"
                      }`}
                      onClick={() => !hasVoted && handleSelectElection(election)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div
                              className={`p-2 rounded-full border ${
                                hasVoted
                                  ? "bg-amber-50 border-amber-200"
                                  : "bg-emerald-50 border-emerald-200"
                              }`}
                            >
                              <Vote
                                className={`h-5 w-5 ${
                                  hasVoted ? "text-amber-700" : "text-emerald-700"
                                }`}
                              />
                            </div>

                            <h3 className="font-semibold text-lg leading-tight">
                              {election.title}
                            </h3>
                          </div>

                          {election.description ? (
                            <p className="text-sm text-muted-foreground">{election.description}</p>
                          ) : null}

                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <p className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {election.start_date
                                ? new Date(election.start_date).toLocaleString()
                                : "—"}{" "}
                              →{" "}
                              {election.end_date
                                ? new Date(election.end_date).toLocaleString()
                                : "—"}
                            </p>

                            {election.total_voters ? (
                              <p className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {election.total_voters} voters
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {hasVoted ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500 text-amber-700 whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Voted
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-500 text-emerald-700 whitespace-nowrap"
                          >
                            Active
                          </Badge>
                        )}
                      </div>

                      <div className="mt-5">
                        <Button
                          className={`w-full mt-2 ${
                            hasVoted ? "" : "bg-gradient-gold text-black hover:opacity-90"
                          }`}
                          disabled={hasVoted}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!hasVoted) handleSelectElection(election);
                          }}
                        >
                          {hasVoted ? "Already Voted" : "Start Voting"}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* CLOSED ELECTIONS */}
          {localExpired.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-bold text-red-500 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-red-500" />
                Closed Elections
              </h2>

              <div className="space-y-4">
                {localExpired.map((election) => (
                  <Card key={election.id} className="p-6 border hover:bg-red-50/50 transition">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold">{election.title}</h3>
                      <Badge variant="outline" className="border-gray-300 text-gray-700">
                        Closed
                      </Badge>
                    </div>

                    {election.description ? (
                      <p className="text-sm text-muted-foreground">{election.description}</p>
                    ) : null}

                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                      <CalendarDays className="h-3 w-3" />
                      {election.start_date ? new Date(election.start_date).toLocaleString() : "—"}{" "}
                      → {election.end_date ? new Date(election.end_date).toLocaleString() : "—"}
                    </p>

                    <p className="text-xs text-red-500 mt-1 font-medium">Voting period closed</p>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="py-6 border-t bg-white/70 backdrop-blur text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} BotoVeritas — FEU Alabang Student Elections
      </footer>
    </div>
  );
};

export default ElectionSelection;
