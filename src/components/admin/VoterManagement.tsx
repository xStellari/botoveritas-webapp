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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, CheckCircle, XCircle, User, ArrowUpDown } from "lucide-react";

export default function VoterManagement() {
  const [voters, setVoters] = useState<any[]>([]);
  const [votes, setVotes] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // Eligibility filters
  const [filterSCC, setFilterSCC] = useState(false);
  const [filterICpEP, setFilterICpEP] = useState(false);
  const [filterHonor, setFilterHonor] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    loadVoters();

    const channel = supabase
      .channel("voter-management")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voters" },
        () => loadVoters()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        () => loadVoters()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadVoters = async () => {
    setLoading(true);

    const { data: voterData, error: voterError } = await supabase
      .from("voters")
      .select("*")
      .order(sortColumn, { ascending: sortDirection === "asc" });

    const { data: voteData, error: voteError } = await supabase
      .from("votes")
      .select("voter_id, created_at");

    if (voterError) console.error("Error fetching voters:", voterError);
    if (voteError) console.error("Error fetching votes:", voteError);

    setVoters(voterData || []);
    setVotes(voteData || []);
    setLoading(false);
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    loadVoters();
  };

  const filteredVoters = voters.filter((voter) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      voter.first_name?.toLowerCase().includes(searchLower) ||
      voter.middle_name?.toLowerCase().includes(searchLower) ||
      voter.last_name?.toLowerCase().includes(searchLower) ||
      voter.email?.toLowerCase().includes(searchLower) ||
      voter.year_level?.toLowerCase().includes(searchLower);

    const affiliations = voter.org_affiliations || [];
    const matchesSCC = !filterSCC || affiliations.includes("SCC");
    const matchesICpEP = !filterICpEP || affiliations.includes("ICpEP");
    const matchesHonor = !filterHonor || affiliations.includes("Honor");

    return matchesSearch && matchesSCC && matchesICpEP && matchesHonor;
  });

  const getVoteStatus = (voterId: string) => {
    const vote = votes.find((v: any) => v.voter_id === voterId);
    return {
      hasVoted: !!vote,
      votedAt: vote?.created_at || null,
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Voter Management
        </CardTitle>
        <CardDescription>
          Manage voter eligibility and track voting status
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search + Refresh */}
        <div className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or year level..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={loadVoters}>Refresh</Button>
          </div>
        </div>

        {/* Eligibility filters */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={filterSCC ? "default" : "outline"}
            onClick={() => setFilterSCC(!filterSCC)}
          >
            SCC
          </Button>
          <Button
            variant={filterICpEP ? "default" : "outline"}
            onClick={() => setFilterICpEP(!filterICpEP)}
          >
            ICpEP
          </Button>
          <Button
            variant={filterHonor ? "default" : "outline"}
            onClick={() => setFilterHonor(!filterHonor)}
          >
            Honor Society
          </Button>
        </div>

        {/* Voter table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("year_level")}
                >
                  Year Level <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("last_name")}
                >
                  Name <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("email")}
                >
                  Email <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>
                <TableHead>Affiliations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("created_at")}
                >
                  Voted At <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    Loading voters...
                  </TableCell>
                </TableRow>
              ) : filteredVoters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    No voters found
                  </TableCell>
                </TableRow>
              ) : (
                filteredVoters.map((voter) => {
                  const { hasVoted, votedAt } = getVoteStatus(voter.id);
                  return (
                    <TableRow key={voter.id}>
                      <TableCell className="font-medium">
                        {voter.year_level}
                      </TableCell>
                      <TableCell>
                        {voter.first_name}{" "}
                        {voter.middle_name ? voter.middle_name + " " : ""}
                        {voter.last_name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {voter.email}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {voter.org_affiliations?.map((org: string) => (
                            <Badge
                              key={org}
                              variant="outline"
                              className="text-xs"
                            >
                              {org}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasVoted ? (
                          <Badge className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Voted
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {votedAt ? new Date(votedAt).toLocaleString() : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
``