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
  eligibleVoters: number;
  votedCount: number;
  turnoutRateVsEligible: number;
}

type ElectionOption = { id: string; title: string };

type ElectionRow = {
  id: string;
  title: string;
  start_date: string;
  eligible_orgs: string[] | null;
};

type OpsMetrics = {
  votesLast60m: number;
  votesLast15m: number;
  activeSessions: number;
  sessionsExpiringSoon: number;
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

  const headerSet = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));
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
    totalEligible: 0,
    votedCount: 0,
    turnoutRate: 0,
    totalRegistered: 0, // keep registered count for ALL scope clarity
  });

  const [perElectionStats, setPerElectionStats] = useState<ElectionStats[]>([]);
  const [hourlyData, setHourlyData] = useState<{ time: string; votes: number }[]>(
    []
  );

  const [ops, setOps] = useState<OpsMetrics>({
    votesLast60m: 0,
    votesLast15m: 0,
    activeSessions: 0,
    sessionsExpiringSoon: 0,
  });

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElectionId]);

  const loadAnalytics = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1) Elections list (include eligible_orgs for correct denominators)
      const { data: electionsDataRaw, error: electionsError } = await supabase
        .from("elections")
        .select("id, title, start_date, eligible_orgs")
        .order("start_date", { ascending: false });

      if (electionsError) throw electionsError;

      const electionsData = (electionsDataRaw || []) as unknown as ElectionRow[];

      const electionOptions =
        (electionsData || []).map((e) => ({ id: e.id, title: e.title })) ?? [];
      setElections(electionOptions);

      // 2) Registered voters (global count)
      const { count: registeredCount, error: regErr } = await supabase
        .from("voters")
        .select("id", { count: "exact", head: true });

      if (regErr) throw regErr;

      const totalRegistered = registeredCount || 0;

      // 3) Eligibility stats (authoritative name-based eligibility, per election)
      const { data: eligRowsRaw, error: eligErr } = await supabase.rpc(
        "get_election_eligibility_stats" as any,
        { p_election_id: null } as any
      );

      if (eligErr) throw eligErr;

      const eligRows = (eligRowsRaw || []) as any[];
      const eligMap = new Map<
        string,
        { eligible_voters: number; voted_eligible: number }
      >();

      for (const r of eligRows) {
        eligMap.set(r.election_id, {
          eligible_voters: Number(r.eligible_voters || 0),
          voted_eligible: Number(r.voted_eligible || 0),
        });
      }

      // 4) Global voted count (scoped)
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
        votedCountScoped = eligMap.get(selectedElectionId)?.voted_eligible ?? 0;
      }

      // 5) Compute eligible denominator for the current scope
      // - ALL: uses total registered voters (SCC open-to-all baseline)
      // - Specific election: uses authoritative roster eligibility counts
      let scopeEligible = totalRegistered;

      if (selectedElectionId !== "ALL") {
        scopeEligible = eligMap.get(selectedElectionId)?.eligible_voters ?? 0;
      }

      setGlobalStats({
        totalEligible: scopeEligible,
        votedCount: votedCountScoped,
        turnoutRate: scopeEligible ? (votedCountScoped / scopeEligible) * 100 : 0,
        totalRegistered,
      });

      // 6) Per-election stats (eligible turnout is authoritative name-based eligibility)
      const perStats: ElectionStats[] = [];
      for (const e of electionsData || []) {
        const eligibleVoters = eligMap.get(e.id)?.eligible_voters ?? 0;
        const votedCount = eligMap.get(e.id)?.voted_eligible ?? 0;

        perStats.push({
          election_id: e.id,
          title: e.title,
          eligibleVoters,
          votedCount,
          turnoutRateVsEligible: eligibleVoters
            ? (votedCount / eligibleVoters) * 100
            : 0,
        });
      }
      setPerElectionStats(perStats);

      // 7) Timeline chart (votes per hour) — good for monitoring stalls/spikes
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

      // 8) Operational metrics — intentionally NO candidate tallies (Results page owns that)
      const now = new Date();
      const isoNow = now.toISOString();

      const isoMinusMins = (mins: number) =>
        new Date(now.getTime() - mins * 60 * 1000).toISOString();

      const isoPlusMins = (mins: number) =>
        new Date(now.getTime() + mins * 60 * 1000).toISOString();

      const votesBase = supabase
        .from("votes")
        .select("id", { count: "exact", head: true });

      const votes60Query =
        selectedElectionId === "ALL"
          ? votesBase.gte("created_at", isoMinusMins(60))
          : votesBase
              .eq("election_id", selectedElectionId)
              .gte("created_at", isoMinusMins(60));

      const votes15Query =
        selectedElectionId === "ALL"
          ? supabase
              .from("votes")
              .select("id", { count: "exact", head: true })
              .gte("created_at", isoMinusMins(15))
          : supabase
              .from("votes")
              .select("id", { count: "exact", head: true })
              .eq("election_id", selectedElectionId)
              .gte("created_at", isoMinusMins(15));

      const [{ count: v60 }, { count: v15 }] = await Promise.all([
        votes60Query,
        votes15Query,
      ]);

      // Active sessions / expiring sessions (global by design)
      const { count: activeSess } = await supabase
        .from("voter_sessions")
        .select("voter_id", { count: "exact", head: true })
        .gt("expires_at", isoNow);

      const { count: expSoon } = await supabase
        .from("voter_sessions")
        .select("voter_id", { count: "exact", head: true })
        .gt("expires_at", isoNow)
        .lte("expires_at", isoPlusMins(10));

      setOps({
        votesLast60m: v60 || 0,
        votesLast15m: v15 || 0,
        activeSessions: activeSess || 0,
        sessionsExpiringSoon: expSoon || 0,
      });
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
    return (
      elections.find((e) => e.id === selectedElectionId)?.title ??
      "Selected election"
    );
  }, [elections, selectedElectionId]);

  const scopeDenominatorLabel =
    selectedElectionId === "ALL"
      ? "Registered voters used as denominator (overall participation)"
      : "Eligible voters used as denominator (based on org membership)";

  const totalEligibleLabel =
    selectedElectionId === "ALL"
      ? "Registered students (global)"
      : "Eligible voters (based on org membership)";

  const votedScopedLabel =
    selectedElectionId === "ALL"
      ? "Distinct voters who voted in any election"
      : "Voters who voted in the selected election";

  const exportPerElection = () => {
    const rows = perElectionStats.map((e) => ({
      election_id: e.election_id,
      election_title: e.title,
      eligible_voters: e.eligibleVoters,
      voted_count: e.votedCount,
      turnout_percent: Number(e.turnoutRateVsEligible.toFixed(2)),
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
      `voting-timeline-${
        selectedElectionId === "ALL" ? "ALL" : selectedElectionId
      }.csv`,
      rows
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Operations</h2>
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
              <CardTitle className="text-sm font-medium">
                {selectedElectionId === "ALL"
                  ? "Total Registered"
                  : "Total Eligible"}
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "…" : globalStats.totalEligible}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalEligibleLabel}
            </p>

            {selectedElectionId !== "ALL" ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                Registered (global): {loading ? "…" : globalStats.totalRegistered}
              </p>
            ) : null}
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
            <p className="text-xs text-muted-foreground mt-1">{votedScopedLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {selectedElectionId === "ALL"
                  ? "Overall Participation"
                  : "Turnout vs Eligible"}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-feu-green" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-feu-green">
              {loading ? "…" : globalStats.turnoutRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {scopeDenominatorLabel}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Votes (last 15 min)</CardTitle>
              <Vote className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : ops.votesLast15m}</div>
            <p className="text-xs text-muted-foreground mt-1">Quick stall/spike indicator</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Votes (last 60 min)</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : ops.votesLast60m}</div>
            <p className="text-xs text-muted-foreground mt-1">Rolling activity window</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : ops.activeSessions}</div>
            <p className="text-xs text-muted-foreground mt-1">
              voter_sessions.expires_at &gt; now
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "…" : ops.sessionsExpiringSoon}</div>
            <p className="text-xs text-muted-foreground mt-1">Within next 10 minutes</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Per-Election Participation</CardTitle>
              <CardDescription>
                Turnout computed using <span className="font-medium">eligible voters</span> per election (based on org
                membership). Elections with no eligible_orgs are treated as open to all registered voters.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportPerElection}
              disabled={loading || perElectionStats.length === 0}
              title="Export per-election participation CSV"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
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
                    {e.votedCount}/{e.eligibleVoters} ({e.turnoutRateVsEligible.toFixed(1)}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Voting Activity Timeline</CardTitle>
              <CardDescription>Votes per hour (scoped)</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportTimeline}
              disabled={loading || hourlyData.length === 0}
              title="Export voting timeline CSV"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
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
