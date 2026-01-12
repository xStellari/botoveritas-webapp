import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Users, Vote, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ElectionStats {
  election_id: string;
  title: string;
  registeredVoters: number;
  votedCount: number;
  turnoutRateVsRegistered: number;
}

type ElectionOption = { id: string; title: string };

type CandidateRow = {
  id: string;
  name: string;
  slate: string | null;
  position: string;
  election_id: string;
};

type VoteRow = {
  created_at?: string;
  election_id: string;
  position: string;
  candidate_id: string | null;
  is_abstain: boolean | null;
};

type TallyRow = {
  election_id: string;
  election_title: string;
  position: string;
  candidate_id: string | null;
  candidate_name: string;
  slate: string | null;
  vote_count: number;
  abstain_count: number;
  total_ballots_for_position: number;
};

function toHourBucketISO(dateISO: string) {
  const d = new Date(dateISO);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:00`;
}

function downloadCSV(filename: string, rows: Array<Record<string, any>>) {
  if (!rows.length) {
    toast.message("Nothing to export.");
    return;
  }

  // Build headers safely (avoids TS reduce/Array.from overload issues)
  const headerSet = new Set<string>();
  for (const r of rows) {
    Object.keys(r).forEach((k) => headerSet.add(k));
  }
  const headers = [...headerSet];

  const escape = (val: any) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [elections, setElections] = useState<ElectionOption[]>([]);
  const [selectedElectionId, setSelectedElectionId] = useState<string>("ALL");

  const [globalStats, setGlobalStats] = useState({
    totalVoters: 0,
    votedCount: 0,
    turnoutRate: 0,
  });

  const [perElectionStats, setPerElectionStats] = useState<ElectionStats[]>([]);
  const [hourlyData, setHourlyData] = useState<{ time: string; votes: number }[]>(
    []
  );

  const [tallyByPosition, setTallyByPosition] = useState<
    { position: string; rows: TallyRow[] }[]
  >([]);
  const [flatTallyRows, setFlatTallyRows] = useState<TallyRow[]>([]);

  useEffect(() => {
    loadAnalytics();

    const channel = supabase
      .channel("analytics-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        () => loadAnalytics()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voter_election_status" },
        () => loadAnalytics()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voters" },
        () => loadAnalytics()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elections" },
        () => loadAnalytics()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElectionId]);

  const loadAnalytics = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1) Elections list
      const { data: electionsData, error: electionsError } = await supabase
        .from("elections")
        .select("id, title, start_date")
        .order("start_date", { ascending: false });

      if (electionsError) throw electionsError;

      const electionOptions =
        (electionsData || []).map((e: any) => ({ id: e.id, title: e.title })) ?? [];
      setElections(electionOptions);

      const electionTitleMap = new Map<string, string>();
      (electionsData || []).forEach((e: any) => electionTitleMap.set(e.id, e.title));

      // 2) Total registered voters
      const { count: totalVoters, error: voterError } = await supabase
        .from("voters")
        .select("*", { count: "exact", head: true });

      if (voterError) throw voterError;

      const tv = totalVoters || 0;

      // 3) Global voted count (scoped)
      let votedCountScoped = 0;

      if (selectedElectionId === "ALL") {
        const { data: statusRows, error: statusErr } = await supabase
          .from("voter_election_status")
          .select("voter_id")
          .eq("has_voted", true);

        if (statusErr) throw statusErr;

        const distinct = new Set((statusRows || []).map((r: any) => r.voter_id));
        votedCountScoped = distinct.size;
      } else {
        const { count, error: statusErr } = await supabase
          .from("voter_election_status")
          .select("*", { count: "exact", head: true })
          .eq("election_id", selectedElectionId)
          .eq("has_voted", true);

        if (statusErr) throw statusErr;
        votedCountScoped = count || 0;
      }

      setGlobalStats({
        totalVoters: tv,
        votedCount: votedCountScoped,
        turnoutRate: tv ? (votedCountScoped / tv) * 100 : 0,
      });

      // 4) Per-election stats
      const perStats: ElectionStats[] = [];
      for (const e of electionsData || []) {
        const { count, error } = await supabase
          .from("voter_election_status")
          .select("*", { count: "exact", head: true })
          .eq("election_id", (e as any).id)
          .eq("has_voted", true);

        if (error) throw error;

        const votedCount = count || 0;

        perStats.push({
          election_id: (e as any).id,
          title: (e as any).title,
          registeredVoters: tv,
          votedCount,
          turnoutRateVsRegistered: tv ? (votedCount / tv) * 100 : 0,
        });
      }
      setPerElectionStats(perStats);

      // 5) Timeline chart (votes per hour)
      if (selectedElectionId === "ALL") {
        const { data: voteTimes, error: votesError } = await supabase
          .from("votes")
          .select("created_at")
          .order("created_at", { ascending: true });

        if (votesError) throw votesError;

        const hourlyMap = new Map<string, number>();
        for (const v of voteTimes || []) {
          const created = (v as any).created_at as string | null;
          if (!created) continue;
          const bucket = toHourBucketISO(created);
          hourlyMap.set(bucket, (hourlyMap.get(bucket) || 0) + 1);
        }

        setHourlyData(
          Array.from(hourlyMap.entries())
            .map(([time, count]) => ({ time, votes: count }))
            .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
        );
      } else {
        const { data: voteTimes, error: votesError } = await supabase
          .from("votes")
          .select("created_at")
          .eq("election_id", selectedElectionId)
          .order("created_at", { ascending: true });

        if (votesError) throw votesError;

        const hourlyMap = new Map<string, number>();
        for (const v of voteTimes || []) {
          const created = (v as any).created_at as string | null;
          if (!created) continue;
          const bucket = toHourBucketISO(created);
          hourlyMap.set(bucket, (hourlyMap.get(bucket) || 0) + 1);
        }

        setHourlyData(
          Array.from(hourlyMap.entries())
            .map(([time, count]) => ({ time, votes: count }))
            .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
        );
      }

      // 6) Candidate tallies
      if (selectedElectionId === "ALL") {
        setTallyByPosition([]);
        setFlatTallyRows([]);
      } else {
        const electionTitle =
          electionTitleMap.get(selectedElectionId) ?? "Selected election";

        const { data: candidates, error: candErr } = await supabase
          .from("candidates")
          .select("id, name, slate, position, election_id")
          .eq("election_id", selectedElectionId);

        if (candErr) throw candErr;

        const { data: votes, error: vErr } = await supabase
          .from("votes")
          .select("election_id, position, candidate_id, is_abstain")
          .eq("election_id", selectedElectionId);

        if (vErr) throw vErr;

        const voteRows = (votes || []) as VoteRow[];

        const totalByPos = new Map<string, number>();
        const abstainByPos = new Map<string, number>();

        for (const v of voteRows) {
          const pos = v.position || "Unspecified";
          totalByPos.set(pos, (totalByPos.get(pos) || 0) + 1);
          if (v.is_abstain) {
            abstainByPos.set(pos, (abstainByPos.get(pos) || 0) + 1);
          }
        }

        const countMap = new Map<string, number>();
        for (const v of voteRows) {
          if (v.is_abstain) continue;
          if (!v.candidate_id) continue;
          const pos = v.position || "Unspecified";
          const key = `${pos}::${v.candidate_id}`;
          countMap.set(key, (countMap.get(key) || 0) + 1);
        }

        const positions = new Set<string>();
        (candidates || []).forEach((c: any) => positions.add(c.position || "Unspecified"));
        voteRows.forEach((v) => positions.add(v.position || "Unspecified"));

        const positionsSorted = Array.from(positions).sort((a, b) =>
          a < b ? -1 : a > b ? 1 : 0
        );

        const flat: TallyRow[] = [];

        for (const pos of positionsSorted) {
          const totalBallots = totalByPos.get(pos) || 0;
          const abstainCount = abstainByPos.get(pos) || 0;

          const candsForPos = (candidates || []).filter(
            (c: any) => (c.position || "Unspecified") === pos
          );

          for (const c of candsForPos) {
            const key = `${pos}::${c.id}`;
            const vc = countMap.get(key) || 0;

            flat.push({
              election_id: selectedElectionId,
              election_title: electionTitle,
              position: pos,
              candidate_id: c.id,
              candidate_name: c.name,
              slate: c.slate ?? null,
              vote_count: vc,
              abstain_count: abstainCount,
              total_ballots_for_position: totalBallots,
            });
          }

          flat.push({
            election_id: selectedElectionId,
            election_title: electionTitle,
            position: pos,
            candidate_id: null,
            candidate_name: "ABSTAIN",
            slate: null,
            vote_count: abstainCount,
            abstain_count: abstainCount,
            total_ballots_for_position: totalBallots,
          });
        }

        const byPos = new Map<string, TallyRow[]>();
        for (const r of flat) {
          byPos.set(r.position, [...(byPos.get(r.position) || []), r]);
        }

        const grouped = Array.from(byPos.entries()).map(([position, rows]) => ({
          position,
          rows: [...rows].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)),
        }));

        setFlatTallyRows(flat);
        setTallyByPosition(grouped);
      }
    } catch (err: any) {
      console.error("AdminAnalytics load error:", err);
      setErrorMsg(err?.message || "Failed to load analytics.");
      toast.error("Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  };

  const selectedElectionTitle = useMemo(() => {
    if (selectedElectionId === "ALL") return "All elections";
    return elections.find((e) => e.id === selectedElectionId)?.title ?? "Selected election";
  }, [elections, selectedElectionId]);

  const exportPerElection = () => {
    const rows = perElectionStats.map((e) => ({
      election_id: e.election_id,
      election_title: e.title,
      registered_voters: e.registeredVoters,
      voted_count: e.votedCount,
      turnout_percent: Number(e.turnoutRateVsRegistered.toFixed(2)),
    }));
    downloadCSV(`per-election-participation.csv`, rows);
  };

  const exportTimeline = () => {
    const rows = hourlyData.map((h) => ({
      scope: selectedElectionTitle,
      hour_bucket: h.time,
      votes: h.votes,
    }));
    downloadCSV(
      `voting-timeline-${selectedElectionId === "ALL" ? "ALL" : selectedElectionId}.csv`,
      rows
    );
  };

  const exportTally = () => {
    if (selectedElectionId === "ALL") {
      toast.message("Select an election to export candidate tallies.");
      return;
    }
    const rows = flatTallyRows.map((r) => ({
      election_id: r.election_id,
      election_title: r.election_title,
      position: r.position,
      candidate_id: r.candidate_id ?? "",
      candidate_name: r.candidate_name,
      slate: r.slate ?? "",
      vote_count: r.vote_count,
      total_ballots_for_position: r.total_ballots_for_position,
      abstain_count: r.abstain_count,
    }));
    downloadCSV(`candidate-tallies-${selectedElectionId}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Scope: <span className="font-medium">{selectedElectionTitle}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={selectedElectionId}
            onChange={(e) => setSelectedElectionId(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
            title="Election scope"
          >
            <option value="ALL">All elections</option>
            {elections.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>

          <Button variant="outline" onClick={loadAnalytics} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>

          <Button
            variant="secondary"
            onClick={exportPerElection}
            disabled={loading || perElectionStats.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Participation CSV
          </Button>

          <Button
            variant="secondary"
            onClick={exportTimeline}
            disabled={loading || hourlyData.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Timeline CSV
          </Button>

          <Button
            variant="secondary"
            onClick={exportTally}
            disabled={loading || selectedElectionId === "ALL"}
            title={selectedElectionId === "ALL" ? "Select an election first" : "Export tallies"}
          >
            <Download className="h-4 w-4 mr-2" />
            Export Tallies CSV
          </Button>
        </div>
      </div>

      {errorMsg ? (
        <Card>
          <CardHeader>
            <CardTitle>Analytics Error</CardTitle>
            <CardDescription>{errorMsg}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={loadAnalytics}>Try again</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Total Voters</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : globalStats.totalVoters}</div>
            <p className="text-xs text-muted-foreground mt-1">Registered students (global)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Voted (Scoped)</CardTitle>
              <Vote className="h-4 w-4 text-green-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {loading ? "…" : globalStats.votedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Based on voter_election_status.has_voted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Turnout vs Registered</CardTitle>
              <TrendingUp className="h-4 w-4 text-feu-green" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-feu-green">
              {loading ? "…" : globalStats.turnoutRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Registered voters used as denominator
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-Election Participation</CardTitle>
          <CardDescription>
            Distinct voters per election (rate shown vs total registered voters)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : perElectionStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No elections found.</p>
          ) : (
            <ul>
              {perElectionStats.map((e) => (
                <li key={e.election_id} className="flex justify-between py-1">
                  <span className="truncate pr-3">{e.title}</span>
                  <span className="font-bold">
                    {e.votedCount}/{e.registeredVoters} ({e.turnoutRateVsRegistered.toFixed(1)}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Candidate Results</CardTitle>
          <CardDescription>
            {selectedElectionId === "ALL"
              ? "Select an election to view per-position candidate tallies."
              : "Tallies computed directly from votes + candidates."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedElectionId === "ALL" ? (
            <p className="text-sm text-muted-foreground">
              Pick an election above to view per-position totals and export tallies.
            </p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tallyByPosition.length === 0 ? (
            <p className="text-sm text-muted-foreground">No votes yet.</p>
          ) : (
            <div className="space-y-6">
              {tallyByPosition.map((group) => {
                const total = group.rows?.[0]?.total_ballots_for_position ?? 0;
                const abstain = group.rows?.[0]?.abstain_count ?? 0;

                return (
                  <div key={group.position} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{group.position}</h3>
                      <span className="text-xs text-muted-foreground">
                        Total ballots: {total} • Abstain: {abstain}
                      </span>
                    </div>

                    <ul>
                      {group.rows.map((r) => (
                        <li
                          key={`${group.position}-${r.candidate_id ?? r.candidate_name}`}
                          className="flex justify-between py-1"
                        >
                          <span className="truncate pr-3">
                            {r.candidate_name}
                            {r.slate ? (
                              <span className="text-xs text-muted-foreground">
                                {" "}
                                • {r.slate}
                              </span>
                            ) : null}
                          </span>
                          <span className="font-bold">{r.vote_count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voting Activity Timeline</CardTitle>
          <CardDescription>Votes per hour (scoped)</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="votes" stroke="#1a5f3f" name="Votes Cast" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
