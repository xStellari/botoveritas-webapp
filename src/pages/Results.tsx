import { useEffect, useState, useMemo } from "react";
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
import { Trophy, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useNavigate } from "react-router-dom";

export default function Results() {
  const navigate = useNavigate();
  const [elections, setElections] = useState<any[]>([]);
  const [selectedElection, setSelectedElection] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalVotes: 0,
    totalVoters: 0,
    turnoutRate: 0,
  });

  useEffect(() => {
    loadElections();
  }, []);

  useEffect(() => {
    if (!selectedElection) return;

    loadCandidates();
    loadStats();

    const candidatesChannel = supabase
      .channel("candidates-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "candidates",
          filter: `election_id=eq.${selectedElection.id}`,
        },
        () => loadCandidates()
      )
      .subscribe();

    const votesChannel = supabase
      .channel("votes-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          filter: `election_id=eq.${selectedElection.id}`,
        },
        () => {
          loadCandidates();
          loadStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(candidatesChannel);
      supabase.removeChannel(votesChannel);
    };
  }, [selectedElection]);

  const loadElections = async () => {
    const { data } = await supabase
      .from("elections")
      .select("*")
      .eq("is_active", true)
      .order("start_date", { ascending: false });

    if (data && data.length > 0) {
      setElections(data);
      setSelectedElection(data[0]);
    }
  };

  // Live aggregation from votes; adds pseudo-candidate "Abstain" (Option A)
  const loadCandidates = async () => {
    if (!selectedElection) return;

    const { data: candidatesData } = await supabase
      .from("candidates")
      .select("id, name, position, slate")
      .eq("election_id", selectedElection.id);

    const { data: votesData } = await supabase
      .from("votes")
      .select("candidate_id")
      .eq("election_id", selectedElection.id);

    const counts: Record<string, number> = {};
    (votesData || []).forEach((v) => {
      counts[v.candidate_id] = (counts[v.candidate_id] || 0) + 1;
    });

    let merged =
      (candidatesData || []).map((c) => ({
        ...c,
        vote_count: counts[c.id] || 0,
      })) || [];

    // Pseudo-candidate for Abstain (id = "abstain")
    const abstainCount = counts["abstain"] || 0;
    if (abstainCount > 0) {
      merged.push({
        id: "abstain",
        name: "Abstain",
        position: "General",
        slate: "",
        vote_count: abstainCount,
      });
    }

    merged.sort((a, b) => b.vote_count - a.vote_count);
    setCandidates(merged);
  };

  const loadStats = async () => {
    if (!selectedElection) return;

    const { count: voteCount } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .eq("election_id", selectedElection.id);

    // If eligible voters are scoped per election, update this query accordingly
    const { count: voterCount } = await supabase
      .from("voters")
      .select("*", { count: "exact", head: true });

    setStats({
      totalVotes: voteCount || 0,
      totalVoters: voterCount || 0,
      turnoutRate: voterCount ? ((voteCount || 0) / voterCount) * 100 : 0,
    });
  };

  const candidatesByPosition = useMemo(() => {
    return (candidates || []).reduce((acc: Record<string, any[]>, candidate: any) => {
      const pos = candidate.position || "General";
      if (!acc[pos]) acc[pos] = [];
      acc[pos].push(candidate);
      return acc;
    }, {});
  }, [candidates]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-feu-green/10 to-feu-gold/10">
      <header className="bg-background border-b border-border p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/src/assets/feu-logo.png" alt="FEU" className="h-12" />
            <div>
              <h1 className="text-2xl font-bold text-feu-green">Live Election Results</h1>
              <p className="text-sm text-muted-foreground">Real-time Blockchain Verified Voting</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate("/admin")}>
            Back
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Election selector if multiple active elections */}
        {elections.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Election:</span>
            <select
              className="border rounded-md px-2 py-1 text-sm"
              value={selectedElection?.id || ""}
              onChange={(e) => {
                const next = elections.find((el) => el.id === e.target.value);
                setSelectedElection(next || elections[0]);
              }}
            >
              {elections.map((el) => (
                <option key={el.id} value={el.id}>
                  {el.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Total Votes Cast</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">{stats.totalVotes}</div>
              <p className="text-xs text-muted-foreground mt-1">Blockchain verified</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Eligible Voters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-gold">{stats.totalVoters}</div>
              <p className="text-xs text-muted-foreground mt-1">Registered students</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Voter Turnout</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-feu-green">
                {stats.turnoutRate.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                <TrendingUp className="inline h-3 w-3 mr-1" />
                Live tracking
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Results by Position (Bar charts only) */}
        {Object.entries(candidatesByPosition).map(
          ([position, positionCandidates]: [string, any[]]) => (
            <Card key={position}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-feu-gold" />
                  {position}
                </CardTitle>
                <CardDescription>Live vote count</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Bar chart per position */}
                <div className="w-full h-[300px]">
                  <ResponsiveContainer>
                    <BarChart data={positionCandidates}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="vote_count" fill="#1a5f3f" name="Votes" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Ranked list */}
                <div className="mt-4 space-y-2">
                  {positionCandidates
                    .slice()
                    .sort((a, b) => b.vote_count - a.vote_count)
                    .map((candidate, index) => (
                      <div
                        key={candidate.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant={index === 0 ? "default" : "outline"}>
                            #{index + 1}
                          </Badge>
                          <div>
                            <p className="font-semibold">
                              {candidate.name}
                              {candidate.id === "abstain" && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (no preference)
                                </span>
                              )}
                            </p>
                            {candidate.slate && (
                              <p className="text-sm text-muted-foreground">
                                {candidate.slate}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-feu-green">
                            {candidate.vote_count}
                          </p>
                          <p className="text-xs text-muted-foreground">votes</p>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )
        )}
      </main>
    </div>
  );
}
