import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import feuLogo from "@/assets/feu-logo.png";

import {
  Trophy,
  TrendingUp,
  RefreshCw,
  Download,
  Clock,
  CheckCircle2,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type ElectionRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean | null;
  eligible_orgs: string[] | null;
};

type CandidateRow = {
  id: string;
  name: string;
  position: string | null;
  slate: string | null;
};

type VoteRow = {
  election_id: string;
  position: string | null;
  candidate_id: string | null;
  is_abstain: boolean | null;
};

type CandidateWithCount = CandidateRow & {
  vote_count: number;
  isWinner?: boolean;
};

type PositionSummary = {
  position: string;
  total_ballots: number;
  abstain_count: number;
  leader_vote_count: number;
  leaders: string[]; // candidate names (ties possible)
};

function formatDateTime(dt?: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Results() {
  const navigate = useNavigate();

  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [selectedElection, setSelectedElection] = useState<ElectionRow | null>(null);

  const [candidates, setCandidates] = useState<CandidateWithCount[]>([]);
  const [positionSummaries, setPositionSummaries] = useState<Record<string, PositionSummary>>(
    {}
  );

  const [stats, setStats] = useState({
    
    eligibleVoters: 0,
    votersWhoVoted: 0,
    turnoutRate: 0,
  });

  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const channelsRef = useRef<{ candidates?: any; votes?: any; status?: any }>({});

  // ----------------------------
  // Load elections (show all, newest first)
  // ----------------------------
  const loadElections = async () => {
    const { data, error } = await supabase
      .from("elections")
      .select("id,title,description,start_date,end_date,is_active,eligible_orgs")
      .order("end_date", { ascending: false });

    if (error) {
      toast.error(error.message);
      return;
    }

    const list = (data || []) as ElectionRow[];
    setElections(list);

    if (!selectedElection && list.length > 0) {
      setSelectedElection(list[0]);
    } else if (selectedElection) {
      // keep selection fresh if list updated
      const stillThere = list.find((e) => e.id === selectedElection.id);
      if (!stillThere && list.length > 0) setSelectedElection(list[0]);
    }
  };

  // ----------------------------
  // Eligible voters count (best-effort)
  // - If eligible_orgs is empty/null -> all voters
  // - If eligible_orgs has values -> count voters whose org_affiliations includes ANY of them
  //   (done client-side to avoid guessing your column type/operators)
  // ----------------------------
  const loadEligibleVoterCount = async (election: ElectionRow) => {
    // fast path: open-to-all
    const eligibleOrgs = Array.isArray(election.eligible_orgs) ? election.eligible_orgs : [];
    if (eligibleOrgs.length === 0) {
      const { count, error } = await supabase
        .from("voters")
        .select("*", { count: "exact", head: true });

      if (error) throw error;
      return count || 0;
    }

    // best-effort: fetch org_affiliations and count locally
    const { data, error } = await supabase.from("voters").select("org_affiliations");
    if (error) throw error;

    const rows = data || [];
    let eligible = 0;

    for (const r of rows as any[]) {
      const aff: string[] = Array.isArray(r?.org_affiliations) ? r.org_affiliations : [];
      if (eligibleOrgs.some((org) => aff.includes(org))) eligible++;
    }

    return eligible;
  };

  // ----------------------------
  // Main: load candidates + votes, compute counts per position
  // ----------------------------
  const loadResults = async (election: ElectionRow) => {
    setLoading(true);
    try {
      // candidates for election
      const { data: candidatesData, error: candErr } = await supabase
        .from("candidates")
        .select("id,name,position,slate")
        .eq("election_id", election.id);

      if (candErr) throw candErr;

      // votes for election (we count using candidate_id + is_abstain)
      const { data: votesData, error: votesErr } = await supabase
        .from("votes")
        .select("election_id, position, candidate_id, is_abstain")
        .eq("election_id", election.id);

      if (votesErr) throw votesErr;

      const candList = (candidatesData || []) as CandidateRow[];
      const voteList = (votesData || []) as VoteRow[];

      // vote count per candidate_id per position (candidate_id can be null for abstain)
      const countByPosCandidate = new Map<string, Map<string, number>>();
      const abstainByPos = new Map<string, number>();
      const totalByPos = new Map<string, number>();

      for (const v of voteList) {
        const pos = v.position || "General";
        totalByPos.set(pos, (totalByPos.get(pos) || 0) + 1);

        if (v.is_abstain) {
          abstainByPos.set(pos, (abstainByPos.get(pos) || 0) + 1);
          continue;
        }
        if (!v.candidate_id) continue;

        if (!countByPosCandidate.has(pos)) countByPosCandidate.set(pos, new Map());
        const m = countByPosCandidate.get(pos)!;
        m.set(v.candidate_id, (m.get(v.candidate_id) || 0) + 1);
      }

      // merge counts into candidates
      const merged: CandidateWithCount[] = candList.map((c) => {
        const pos = c.position || "General";
        const m = countByPosCandidate.get(pos);
        const vote_count = m?.get(c.id) || 0;
        return { ...c, vote_count };
      });

      // winner marking per position (ties supported)
      const summaries: Record<string, PositionSummary> = {};
      const grouped = merged.reduce((acc: Record<string, CandidateWithCount[]>, c) => {
        const pos = c.position || "General";
        (acc[pos] ||= []).push(c);
        return acc;
      }, {});

      for (const [pos, list] of Object.entries(grouped)) {
        const sorted = list.slice().sort((a, b) => b.vote_count - a.vote_count);
        const leaderCount = sorted[0]?.vote_count ?? 0;
        const leaders = sorted.filter((x) => x.vote_count === leaderCount && leaderCount > 0);

        // apply winner flag
        const leaderIds = new Set(leaders.map((l) => l.id));
        for (const c of list) c.isWinner = leaderIds.has(c.id);

        summaries[pos] = {
          position: pos,
          total_ballots: totalByPos.get(pos) || 0,
          abstain_count: abstainByPos.get(pos) || 0,
          leader_vote_count: leaderCount,
          leaders: leaders.map((l) => l.name),
        };
      }

      const { count: votedCount, error: votedErr } = await supabase
        .from("voter_election_status")
        .select("*", { count: "exact", head: true })
        .eq("election_id", election.id)
        .eq("has_voted", true);

      if (votedErr) throw votedErr;

      const eligibleVoters = await loadEligibleVoterCount(election);
      const votersWhoVoted = votedCount || 0;
      const turnoutRate = eligibleVoters ? (votersWhoVoted / eligibleVoters) * 100 : 0;

      // final sorting: within each position later
      merged.sort((a, b) => {
        const ap = a.position || "General";
        const bp = b.position || "General";
        if (ap !== bp) return ap.localeCompare(bp);
        return b.vote_count - a.vote_count;
      });

      setCandidates(merged);
      setPositionSummaries(summaries);
      setStats({eligibleVoters, votersWhoVoted, turnoutRate });
      setLastUpdatedAt(new Date());
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    if (!selectedElection) return;
    await loadElections();
    await loadResults(selectedElection);
    toast.success("Results refreshed");
  };

  // ----------------------------
  // Initial load
  // ----------------------------
  useEffect(() => {
    loadElections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When election changes, load + resubscribe
  useEffect(() => {
    if (!selectedElection) return;

    loadResults(selectedElection);

    // cleanup old channels
    const prev = channelsRef.current;
    if (prev.candidates) supabase.removeChannel(prev.candidates);
    if (prev.votes) supabase.removeChannel(prev.votes);
    if (prev.status) supabase.removeChannel(prev.status);

    const candidatesChannel = supabase
      .channel(`results-candidates-${selectedElection.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidates",
          filter: `election_id=eq.${selectedElection.id}`,
        },
        () => loadResults(selectedElection)
      )
      .subscribe();

    const votesChannel = supabase
      .channel(`results-votes-${selectedElection.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          filter: `election_id=eq.${selectedElection.id}`,
        },
        () => loadResults(selectedElection)
      )
      .subscribe();

    const statusChannel = supabase
      .channel(`results-status-${selectedElection.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voter_election_status",
          filter: `election_id=eq.${selectedElection.id}`,
        },
        () => loadResults(selectedElection)
      )
      .subscribe();

    channelsRef.current = { candidates: candidatesChannel, votes: votesChannel, status: statusChannel };

    return () => {
      supabase.removeChannel(candidatesChannel);
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(statusChannel);
    };
  }, [selectedElection]);

  // ----------------------------
  // Derived: candidates grouped by position
  // ----------------------------
  const candidatesByPosition = useMemo(() => {
    return (candidates || []).reduce((acc: Record<string, CandidateWithCount[]>, c) => {
      const pos = c.position || "General";
      (acc[pos] ||= []).push(c);
      return acc;
    }, {});
  }, [candidates]);

  // ----------------------------
  // CSV Export
  // ----------------------------
  const exportCsv = () => {
    if (!selectedElection) return;

    const lines: string[] = [];
    lines.push(
      [
        "row_type",
        "election_title",
        "position",
        "candidate_name",
        "slate",
        "vote_count",
        "abstain_count",
        "total_ballots",
        "rank",
        "is_winner",
      ].join(",")
    );

    const positions = Object.keys(candidatesByPosition).sort((a, b) => a.localeCompare(b));

    for (const pos of positions) {
      const sum = positionSummaries[pos];

      // 1) SUMMARY row (once per position)
      lines.push(
        [
          "SUMMARY",
          JSON.stringify(selectedElection.title),
          JSON.stringify(pos),
          "", // candidate_name
          "", // slate
          "", // vote_count
          String(sum?.abstain_count ?? 0),
          String(sum?.total_ballots ?? 0),
          "", // rank
          "", // is_winner
        ].join(",")
      );

      // 2) Candidate rows
      const sorted = candidatesByPosition[pos].slice().sort((a, b) => b.vote_count - a.vote_count);
      sorted.forEach((c, i) => {
        lines.push(
          [
            "CANDIDATE",
            JSON.stringify(selectedElection.title),
            JSON.stringify(pos),
            JSON.stringify(c.name),
            JSON.stringify(c.slate || ""),
            String(c.vote_count),
            "", // abstain_count (kept in summary row)
            "", // total_ballots (kept in summary row)
            String(i + 1),
            c.isWinner ? "TRUE" : "FALSE",
          ].join(",")
        );
      });
    }

    const filename = `results_${selectedElection.title.replace(/[^\w]+/g, "_")}.csv`;
    downloadTextFile(filename, lines.join("\n"));
    toast.success("CSV exported");
  };


  // ----------------------------
  // UI
  // ----------------------------
  const electionBadge = (e: ElectionRow) => {
    const now = Date.now();
    const start = new Date(e.start_date).getTime();
    const end = new Date(e.end_date).getTime();

    if (now < start) return <Badge variant="outline">Upcoming</Badge>;
    if (now > end) return <Badge variant="outline" className="border-gray-300 text-gray-700">Ended</Badge>;
    return (
      <Badge variant="outline" className="border-emerald-500 text-emerald-700">
        Live
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={feuLogo} alt="FEU" className="h-10 w-auto" />
            <div className="leading-tight">
              <div className="text-lg font-bold text-feu-green">Election Results</div>
              <div className="text-xs text-muted-foreground">
                Live updates • Admin view
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!selectedElection || loading}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>

            <Button variant="outline" onClick={refreshAll} disabled={!selectedElection || loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button variant="outline" onClick={() => navigate("/admin")}>
              Back
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Election selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Selected Election</span>
              {selectedElection ? electionBadge(selectedElection) : null}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {selectedElection
                  ? `${formatDateTime(selectedElection.start_date)} → ${formatDateTime(
                      selectedElection.end_date
                    )}`
                  : "—"}
              </span>
              {lastUpdatedAt ? (
                <span className="text-xs text-muted-foreground">
                  Updated: {lastUpdatedAt.toLocaleTimeString()}
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="min-w-[260px]">
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                value={selectedElection?.id || ""}
                onChange={(e) => {
                  const next = elections.find((el) => el.id === e.target.value) || null;
                  setSelectedElection(next);
                }}
              >
                {elections.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.title}
                  </option>
                ))}
              </select>
              {selectedElection?.description ? (
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedElection.description}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedElection?.eligible_orgs?.length ? (
                <Badge variant="outline" className="border-feu-gold text-feu-gold">
                  Eligible orgs: {selectedElection.eligible_orgs.join(", ")}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-gray-300 text-gray-700">
                  Open to all
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Election Status</CardTitle>
            <CardDescription className="text-xs">Based on schedule</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">
              {(() => {
                const now = Date.now();
                const start = new Date(selectedElection!.start_date).getTime();
                const end = new Date(selectedElection!.end_date).getTime();
                if (now < start) return "Upcoming";
                if (now > end) return "Ended";
                return "Live";
              })()}
            </div>
          </CardContent>
        </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Eligible Voters</CardTitle>
              <CardDescription className="text-xs">Best-effort count</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-gold">{stats.eligibleVoters}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Voters Who Voted</CardTitle>
              <CardDescription className="text-xs">From voter_election_status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">{stats.votersWhoVoted}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Turnout</CardTitle>
              <CardDescription className="text-xs">
                <TrendingUp className="inline h-3 w-3 mr-1" />
                Live tracking
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">
                {stats.turnoutRate.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        {Object.entries(candidatesByPosition)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([position, positionCandidates]) => {
            const sum = positionSummaries[position];
            const chartData = positionCandidates
              .slice()
              .sort((a, b) => b.vote_count - a.vote_count)
              .map((c) => ({
                name: c.name,
                votes: c.vote_count,
                isWinner: !!c.isWinner,
              }));

            const leaderText =
              sum?.leaders?.length
                ? `${sum.leaders.join(" • ")} (${sum.leader_vote_count})`
                : "—";

            return (
              <Card key={position}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-feu-gold" />
                      {position}
                    </span>

                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-gray-300 text-gray-700">
                        Total ballots: {sum?.total_ballots ?? 0}
                      </Badge>
                      <Badge variant="outline" className="border-amber-500 text-amber-700">
                        Abstain: {sum?.abstain_count ?? 0}
                      </Badge>
                    </div>
                  </CardTitle>

                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Leader:</span>
                    <Badge
                      variant="outline"
                      className="border-emerald-500 text-emerald-700"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {leaderText}
                    </Badge>
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Chart */}
                  <div className="w-full h-[280px]">
                    <ResponsiveContainer>
                      <BarChart data={chartData} layout="vertical" margin={{ left: 24, right: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={160} />
                        <Tooltip />
                        <Legend />
                        {/* keep default styling; don’t hard-code colors too aggressively */}
                        <Bar dataKey="votes" name="Votes" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Ranked list */}
                  <div className="space-y-2">
                    {positionCandidates
                      .slice()
                      .sort((a, b) => b.vote_count - a.vote_count)
                      .map((c, idx) => (
                        <div
                          key={c.id}
                          className={`flex items-center justify-between gap-3 p-3 rounded-lg border bg-white ${
                            c.isWinner ? "ring-1 ring-emerald-400" : ""
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Badge variant={c.isWinner ? "default" : "outline"}>
                              #{idx + 1}
                            </Badge>

                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold leading-tight">{c.name}</p>
                                {c.isWinner ? (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-500 text-emerald-700"
                                  >
                                    Winner
                                  </Badge>
                                ) : null}
                              </div>

                              {c.slate ? (
                                <p className="text-xs text-muted-foreground">{c.slate}</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">—</p>
                              )}
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-2xl font-bold text-feu-green">{c.vote_count}</p>
                            <p className="text-xs text-muted-foreground">votes</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </main>
    </div>
  );
}
