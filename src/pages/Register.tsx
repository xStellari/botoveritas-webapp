import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
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
import { Trophy, RefreshCw, Download, Clock, CheckCircle2, Loader2 } from "lucide-react";
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

const DEFAULT_POSITION = "General";

// Prevent CSV/Spreadsheet formula injection.
// If a cell starts with =, +, -, or @, spreadsheet apps may interpret it as a formula.
function sanitizeCsvCell(value: string) {
  if (value.length === 0) return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string) {
  return JSON.stringify(sanitizeCsvCell(value));
}

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
  isTiedLeader?: boolean;
};

type PositionSummary = {
  position: string;
  total_ballots: number;
  abstain_count: number;
  leader_vote_count: number;
  leaders: string[];
  is_tie?: boolean;
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

function getElectionStatus(e?: ElectionRow | null) {
  if (!e) return "—";
  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  const end = new Date(e.end_date).getTime();
  if (now < start) return "Upcoming";
  if (now > end) return "Ended";
  return "Live";
}

export default function Results() {
  const navigate = useNavigate();

  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [selectedElection, setSelectedElection] = useState<ElectionRow | null>(
    null
  );

  const [candidates, setCandidates] = useState<CandidateWithCount[]>([]);
  const [positionSummaries, setPositionSummaries] = useState<
    Record<string, PositionSummary>
  >({});

  const [stats, setStats] = useState({
    eligibleVoters: 0,
    votersWhoVoted: 0,
    turnoutRate: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const loadResultsRequestId = useRef(0);
  const scheduledReloadTimer = useRef<number | null>(null);

  // Cache eligible voter count to avoid re-fetching the voters table on every realtime update.
  const eligibleCountCacheSig = useRef<string | null>(null);
  const eligibleCountCacheVal = useRef<number>(0);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const channelsRef = useRef<{ candidates?: any; votes?: any; status?: any }>(
    {}
  );

  const downloadPdfReport = async () => {
    if (!selectedElection?.id) return;
    if (pdfDownloading) return;

    setPdfDownloading(true);

    // Immediate user feedback
    const toastId = toast.loading(
      <div className="space-y-1">
        <div>Generating PDF report...</div>
        <div className="text-xs text-muted-foreground">
          This may take up to 5–10 seconds.
        </div>
      </div>
    );



    try {
      const { data, error } = await supabase.functions.invoke("generate-results-pdf", {
        body: {
          election_id: selectedElection.id,
          signatories: [
            { label: "Prepared by", name: "Isaac Caubat", role: "Group Member" },
            { label: "Prepared by", name: "Lance Owen Miguel Cervantes", role: "Group Member" },
            { label: "Prepared by", name: "Jego Creencia", role: "Group Member" },
            { label: "Prepared by", name: "Jonas Gomez", role: "Group Member" },
            { label: "Prepared by", name: "Deric Lei Leopando", role: "Group Member" },
            { label: "Noted by", name: "Honeylet G. Grimaldo", role: "Thesis Adviser" },
            { label: "Noted by", name: "Saturnino R. Perlas", role: "Course Adviser" },
            { label: "Certified by", name: "Juan Dela Cruz", role: "COMELEC Chairman" },
            { label: "Approved by", name: "Jose Santos", role: "SADU Director" },
          ],
        },
      });

      if (error) throw error;

      const blob = data instanceof Blob ? data : new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      // Best UX: trigger download in the same tab (no popups/tabs)
      const a = document.createElement("a");
      a.href = url;
      a.download = `BotoVeritas_${selectedElection.title}_Results.pdf`.replace(/\s+/g, "_");
      document.body.appendChild(a);
      a.click();
      a.remove();


      toast.success("PDF ready.", { id: toastId });

      // If you keep the fallback download, revoke after a short delay so the download can start
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e: any) {
      console.error("PDF error object:", e);

      const body = e?.context?.body;
      if (body) {
        try {
          console.error("PDF error body:", JSON.parse(body));
          toast.error(`PDF error: ${JSON.parse(body).error}`, { id: toastId });
        } catch {
          console.error("PDF error body (raw):", body);
          toast.error(`PDF error: ${body}`, { id: toastId });
        }
      } else {
        toast.error(e?.message ?? "Failed to download PDF report", { id: toastId });
      }
    } finally {
      setPdfDownloading(false);
    }
  };

  // ----------------------------
  // Load elections
  // ----------------------------
  const loadElections = async (): Promise<void> => {
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
      const stillThere = list.find((e) => e.id === selectedElection.id);
      if (!stillThere && list.length > 0) setSelectedElection(list[0]);
    }
  };

  // ----------------------------
  // Eligible voters count (best-effort)
  // ----------------------------
  const loadEligibleVoterCount = async (election: ElectionRow) => {
    const eligibleOrgs = Array.isArray(election.eligible_orgs)
      ? election.eligible_orgs
      : [];

    if (eligibleOrgs.length === 0) {
      const { count, error } = await supabase
        .from("voters")
        .select("*", { count: "exact", head: true });

      if (error) throw error;
      return count || 0;
    }

    // Fetch affiliations and count locally
    const { data, error } = await supabase.from("voters").select("org_affiliations");
    if (error) throw error;

    let eligible = 0;
    for (const r of (data || []) as Array<{ org_affiliations?: unknown }>) {
      const aff: string[] = Array.isArray(r?.org_affiliations)
        ? r.org_affiliations
        : [];
      if (eligibleOrgs.some((org) => aff.includes(org))) eligible++;
    }
    return eligible;
  };

  // ----------------------------
  // Load results + compute summaries
  // ----------------------------
  const loadResults = async (election: ElectionRow) => {
    setResultsLoading(true);
    const requestId = ++loadResultsRequestId.current;
    try {
      const { data: candidatesData, error: candErr } = await supabase
        .from("candidates")
        .select("id,name,position,slate")
        .eq("election_id", election.id);

      if (candErr) throw candErr;

      const { data: votesData, error: votesErr } = await supabase
        .from("votes")
        .select("election_id, position, candidate_id, is_abstain")
        .eq("election_id", election.id);

      if (votesErr) throw votesErr;

      const candList = (candidatesData || []) as CandidateRow[];
      const voteList = (votesData || []) as VoteRow[];

      const countByPosCandidate = new Map<string, Map<string, number>>();
      const abstainByPos = new Map<string, number>();
      const totalByPos = new Map<string, number>();

      for (const v of voteList) {
        const pos = v.position || DEFAULT_POSITION;
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

      const merged: CandidateWithCount[] = candList.map((c) => {
        const pos = c.position || DEFAULT_POSITION;
        const m = countByPosCandidate.get(pos);
        const vote_count = m?.get(c.id) || 0;
        return { ...c, vote_count };
      });

      const summaries: Record<string, PositionSummary> = {};
      const leaderInfoByPos: Record<string, { leaderIds: Set<string>; isTie: boolean; leaderCount: number }> = {};

      const grouped = merged.reduce(
        (acc: Record<string, CandidateWithCount[]>, c) => {
          const pos = c.position || DEFAULT_POSITION;
          (acc[pos] ||= []).push(c);
          return acc;
        },
        {}
      );

      for (const [pos, list] of Object.entries(grouped)) {
        const sorted = list.slice().sort((a, b) => b.vote_count - a.vote_count);
        const leaderCount = sorted[0]?.vote_count ?? 0;
        const leaders = sorted.filter(
          (x) => x.vote_count === leaderCount && leaderCount > 0
        );

        const isTie = leaders.length > 1;

        const leaderIds = new Set(leaders.map((l) => l.id));
        for (const c of list) {
          c.isWinner = !isTie && leaderIds.has(c.id);       // only 1 winner allowed
          c.isTiedLeader = isTie && leaderIds.has(c.id);    // mark as tied leaders instead
        }

        summaries[pos] = {
          position: pos,
          total_ballots: totalByPos.get(pos) || 0,
          abstain_count: abstainByPos.get(pos) || 0,
          leader_vote_count: leaderCount,
          leaders: leaders.map((l) => l.name),
          is_tie: isTie,
        };

      }

      
      const flaggedMerged: CandidateWithCount[] = merged.map((c) => {
        const pos = c.position || DEFAULT_POSITION;
        const info = leaderInfoByPos[pos];
        const leaderCount = info?.leaderCount ?? 0;
        const leaderIds = info?.leaderIds;
        const isTie = info?.isTie ?? false;

        const isLeader = leaderCount > 0 && !!leaderIds?.has(c.id);
        return {
          ...c,
          isWinner: !isTie && isLeader,
          isTiedLeader: isTie && isLeader,
        };
      });

      // If a newer request has started, ignore this response to avoid stale overwrites.
      if (requestId !== loadResultsRequestId.current) return;

      const { count: votedCount, error: votedErr } = await supabase
        .from("voter_election_status")
        .select("*", { count: "exact", head: true })
        .eq("election_id", election.id)
        .eq("has_voted", true);

      if (votedErr) throw votedErr;

      const sig = `${election.id}:${JSON.stringify(election.eligible_orgs || [])}`;
      let eligibleVoters = eligibleCountCacheVal.current;
      if (eligibleCountCacheSig.current !== sig) {
        eligibleVoters = await loadEligibleVoterCount(election);
        eligibleCountCacheSig.current = sig;
        eligibleCountCacheVal.current = eligibleVoters;
      }
      const votersWhoVoted = votedCount || 0;
      const turnoutRate = eligibleVoters ? (votersWhoVoted / eligibleVoters) * 100 : 0;

      flaggedMerged.sort((a, b) => {
        const ap = a.position || DEFAULT_POSITION;
        const bp = b.position || DEFAULT_POSITION;
        if (ap !== bp) return ap.localeCompare(bp);
        return b.vote_count - a.vote_count;
      });

      setCandidates(flaggedMerged);
      setPositionSummaries(summaries);
      setStats({ eligibleVoters, votersWhoVoted, turnoutRate });
      setLastUpdatedAt(new Date());
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load results");
    } finally {
      setResultsLoading(false);
    }
  };

  const refreshAll = async () => {
    if (!selectedElection) return;
    setRefreshing(true);
    try {
      await loadElections();
      await loadResults(selectedElection);
      toast.success("Results refreshed");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadElections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedElection) return;

    loadResults(selectedElection);

    const scheduleResultsReload = () => {
      if (!selectedElection) return;
      if (scheduledReloadTimer.current) window.clearTimeout(scheduledReloadTimer.current);
      scheduledReloadTimer.current = window.setTimeout(() => {
        loadResults(selectedElection);
      }, 400);
    };


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
        () => scheduleResultsReload()
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
        () => scheduleResultsReload()
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
        () => scheduleResultsReload()
      )
      .subscribe();

    channelsRef.current = {
      candidates: candidatesChannel,
      votes: votesChannel,
      status: statusChannel,
    };

    return () => {
      supabase.removeChannel(candidatesChannel);
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(statusChannel);
    };
  }, [selectedElection]);

  const candidatesByPosition = useMemo(() => {
    return (candidates || []).reduce(
      (acc: Record<string, CandidateWithCount[]>, c) => {
        const pos = c.position || DEFAULT_POSITION;
        (acc[pos] ||= []).push(c);
        return acc;
      },
      {}
    );
  }, [candidates]);

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

    const positions = Object.keys(candidatesByPosition).sort((a, b) =>
      a.localeCompare(b)
    );

    for (const pos of positions) {
      const sum = positionSummaries[pos];

      lines.push(
        [
          "SUMMARY",
          csvCell(selectedElection.title),
          csvCell(pos),
          "",
          "",
          "",
          String(sum?.abstain_count ?? 0),
          String(sum?.total_ballots ?? 0),
          "",
          "",
        ].join(",")
      );

      const sorted = candidatesByPosition[pos]
        .slice()
        .sort((a, b) => b.vote_count - a.vote_count);

      sorted.forEach((c, i) => {
        lines.push(
          [
            "CANDIDATE",
            csvCell(selectedElection.title),
            csvCell(pos),
            csvCell(c.name),
            csvCell(c.slate || ""),
            String(c.vote_count),
            "",
            "",
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

  const electionBadge = (e: ElectionRow) => {
    const status = getElectionStatus(e);
    if (status === "Upcoming") return <Badge variant="outline">Upcoming</Badge>;
    if (status === "Ended")
      return (
        <Badge variant="outline" className="border-gray-300 text-gray-700">
          Ended
        </Badge>
      );
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
              <div className="text-xs text-muted-foreground">Live updates • Admin view</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={downloadPdfReport} 
              disabled={!selectedElection || pdfDownloading}
              >
              {pdfDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                  <Download className="h-4 w-4 mr-2" />
              )}
              {pdfDownloading ? "Generating PDF..." : "Download PDF Report"}
            </Button>

            <Button
              variant="outline"
              onClick={refreshAll}
              disabled={!selectedElection || refreshing || resultsLoading || pdfDownloading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button variant="outline" onClick={() => navigate("/admin")}>
              Back
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
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
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  const next =
                    elections.find((el) => el.id === e.target.value) || null;
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Eligible Voters</CardTitle>
              <CardDescription className="text-xs">Best-effort count</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-gold">
                {stats.eligibleVoters}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Voters Who Voted</CardTitle>
              <CardDescription className="text-xs">From voter_election_status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">
                {stats.votersWhoVoted}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Turnout</CardTitle>
              <CardDescription className="text-xs">Participation rate</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">
                {stats.turnoutRate.toFixed(1)}%
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Election Status</CardTitle>
              <CardDescription className="text-xs">Based on schedule</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-feu-green">
                {getElectionStatus(selectedElection)}
              </div>
            </CardContent>
          </Card>
        </div>

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
              }));
            if ((sum?.abstain_count ?? 0) > 0) {
              chartData.push({ name: "ABSTAIN", votes: sum!.abstain_count });
            }


            const leaderText =
              sum?.leaders?.length
                ? (sum?.is_tie
                    ? `Tie: ${sum.leaders.join(" • ")} (${sum.leader_vote_count})`
                    : `${sum.leaders.join(" • ")} (${sum.leader_vote_count})`)
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
                        Selections recorded: {sum?.total_ballots ?? 0}
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
                  <div className="w-full h-[280px]">
                    <ResponsiveContainer>
                      <BarChart
                        data={chartData}
                        layout="vertical"
                        margin={{ left: 24, right: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={160} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="votes" name="Votes" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

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
                                ) : c.isTiedLeader ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500 text-amber-700">
                                      Tied
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
                            <p className="text-2xl font-bold text-feu-green">
                              {c.vote_count}
                            </p>
                            <p className="text-xs text-muted-foreground">votes</p>
                          </div>
                        </div>
                      ))}
                  </div>

                    {(sum?.abstain_count ?? 0) > 0 ? (
                      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white">
                        <div className="flex items-start gap-3">
                          <Badge variant="outline">ABSTAIN</Badge>
                          <div>
                            <p className="font-semibold leading-tight">ABSTAIN</p>
                            <p className="text-xs text-muted-foreground">—</p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-2xl font-bold text-feu-green">
                            {sum?.abstain_count ?? 0}
                          </p>
                          <p className="text-xs text-muted-foreground">votes</p>
                        </div>
                      </div>
                    ) : null}

                </CardContent>
              </Card>
            );
          })}
      </main>
    </div>
  );
}

