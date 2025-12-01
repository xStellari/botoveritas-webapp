import { useEffect, useState } from "react";
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
import { TrendingUp, Users, Vote } from "lucide-react";

interface ElectionStats {
  election_id: string;
  title: string;
  totalVoters: number;
  votedCount: number; // distinct voters in that election
  turnoutRate: number;
}

export default function AdminAnalytics() {
  const [globalStats, setGlobalStats] = useState({
    totalVoters: 0,
    votedCount: 0, // distinct voters across all elections
    turnoutRate: 0,
  });
  const [perElectionStats, setPerElectionStats] = useState<ElectionStats[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [results, setResults] = useState<
    { candidate_id: string; candidate_name: string; count: number }[]
  >([]);

  useEffect(() => {
    loadAnalytics();

    const channel = supabase
      .channel("analytics-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        () => loadAnalytics()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadAnalytics = async () => {
    // Total registered voters (global)
    const { count: totalVoters, error: voterError } = await supabase
      .from("voters")
      .select("*", { count: "exact" });
    if (voterError) console.error("Error fetching voters:", voterError);

    // All votes (for global + per-election + hourly + candidate results)
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("voter_id, election_id, candidate_id, created_at")
      .order("created_at", { ascending: true });
    if (votesError) console.error("Error fetching votes:", votesError);

    // Global distinct voters
    const distinctVotersGlobal = new Set(votes?.map((v) => v.voter_id));
    const globalVotedCount = distinctVotersGlobal.size;

    setGlobalStats({
      totalVoters: totalVoters || 0,
      votedCount: globalVotedCount,
      turnoutRate: totalVoters ? (globalVotedCount / totalVoters) * 100 : 0,
    });

    // Per-election stats (assume all registered voters are eligible for each election)
    const { data: elections, error: electionsError } = await supabase
      .from("elections")
      .select("id, title");
    if (electionsError) console.error("Error fetching elections:", electionsError);

    const perStats: ElectionStats[] = (elections || []).map((election) => {
      const electionVotes = (votes || []).filter(
        (v) => v.election_id === election.id
      );
      const distinctVotersElection = new Set(
        electionVotes.map((v) => v.voter_id)
      );
      const votedCount = distinctVotersElection.size;
      const totalElectionVoters = totalVoters || 0;

      return {
        election_id: election.id,
        title: election.title,
        totalVoters: totalElectionVoters,
        votedCount,
        turnoutRate: totalElectionVoters
          ? (votedCount / totalElectionVoters) * 100
          : 0,
      };
    });

    setPerElectionStats(perStats);

    // Hourly activity (global timeline)
    const hourlyMap: Record<string, number> = {};
    votes?.forEach((vote: any) => {
      const hour = new Date(vote.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        hour12: true,
      });
      hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
    });
    const hourlyArray = Object.entries(hourlyMap).map(([time, count]) => ({
      time,
      votes: count,
    }));
    setHourlyData(hourlyArray);

    // Candidate results (global)
    const counts: Record<string, number> = {};
    votes?.forEach((vote: any) => {
      counts[vote.candidate_id] = (counts[vote.candidate_id] || 0) + 1;
    });

    let candidateResults: {
      candidate_id: string;
      candidate_name: string;
      count: number;
    }[] = [];
    if (Object.keys(counts).length > 0) {
      const { data: candidates, error: candidatesError } = await supabase
        .from("candidates")
        .select("id, name")
        .in("id", Object.keys(counts));
      if (candidatesError)
        console.error("Error fetching candidates:", candidatesError);

      candidateResults = Object.keys(counts).map((id) => {
        const candidate = candidates?.find((c: any) => c.id === id);
        return {
          candidate_id: id,
          candidate_name: candidate?.name ?? "Unknown",
          count: counts[id],
        };
      });
    }
    setResults(candidateResults);
  };

  return (
    <div className="space-y-6">
      {/* Global summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Total Voters</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{globalStats.totalVoters}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Registered students
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Voted (Global)</CardTitle>
              <Vote className="h-4 w-4 text-green-600" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {globalStats.votedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Distinct voters across all elections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Global Turnout</CardTitle>
              <TrendingUp className="h-4 w-4 text-feu-green" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-feu-green">
              {globalStats.turnoutRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Distinct voter turnout across all elections
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-election stats */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Election Turnout</CardTitle>
          <CardDescription>Distinct voters vs total registered</CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {perElectionStats.map((e) => (
              <li key={e.election_id} className="flex justify-between py-1">
                <span>{e.title}</span>
                <span className="font-bold">
                  {e.votedCount}/{e.totalVoters} ({e.turnoutRate.toFixed(1)}%)
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Candidate results (global) */}
      <Card>
        <CardHeader>
          <CardTitle>Live Candidate Results</CardTitle>
          <CardDescription>Votes counted per candidate</CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {results.map((r) => (
              <li key={r.candidate_id} className="flex justify-between py-1">
                <span>{r.candidate_name}</span>
                <span className="font-bold">{r.count}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Timeline chart (global) */}
      <Card>
        <CardHeader>
          <CardTitle>Voting Activity Timeline</CardTitle>
          <CardDescription>Real-time voting activity per hour</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="votes"
                stroke="#1a5f3f"
                name="Votes Cast"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
