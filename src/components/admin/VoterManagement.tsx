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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  User,
  ArrowUpDown,
  Download,
  Copy,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

type SortDirection = "asc" | "desc";

type CanonicalOrg =
  | "Student Coordinating Council"
  | "ICpEP"
  | "Honor Society";

function normalizeOrg(raw: unknown): CanonicalOrg | null {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return null;

  // Accept common variants but normalize to fixed set.
  if (
    s === "scc" ||
    s.includes("student coordinating") ||
    s.includes("student council")
  ) {
    return "Student Coordinating Council";
  }
  if (
    s === "icpep" ||
    s.includes("icpep") ||
    s.includes("institute of computer engineers")
  ) {
    return "ICpEP";
  }
  if (s === "honsoc" || s.includes("honor society") || s === "honor") {
    return "Honor Society";
  }

  // If DB already stores the canonical value but with weird casing.
  if (s === "student coordinating council") return "Student Coordinating Council";
  if (s === "honor society") return "Honor Society";

  return null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function maskEmail(email: string | null | undefined) {
  if (!email) return "-";
  const at = email.indexOf("@");
  if (at <= 1) return "***" + email.slice(at);
  const name = email.slice(0, at);
  const domain = email.slice(at);
  if (name.length <= 2) return name[0] + "***" + domain;
  return name.slice(0, 2) + "***" + domain;
}

function toCsvValue(v: unknown) {
  const s = (v ?? "").toString();
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

type ElectionRow = {
  id: string;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
};

type VoterElectionStatusRow = {
  election_id: string;
  has_voted: boolean;
  voted_at: string | null;
  elections?: ElectionRow | null;
};

export default function VoterManagement() {
  const [voters, setVoters] = useState<any[]>([]);
  const [votedVoterIds, setVotedVoterIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // Eligibility filters
  const [filterSCC, setFilterSCC] = useState(false);
  const [filterICpEP, setFilterICpEP] = useState(false);
  const [filterHonor, setFilterHonor] = useState(false);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Email reveal
  const [revealedEmails, setRevealedEmails] = useState<Record<string, boolean>>(
    {}
  );

  // Voter profile drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedVoter, setSelectedVoter] = useState<any | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<any[]>([]);
  const [selectedSessionLogs, setSelectedSessionLogs] = useState<any[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<
    VoterElectionStatusRow[]
  >([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

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
        { event: "*", schema: "public", table: "voter_election_status" },
        () => {
          // refresh counts + drawer statuses
          void loadVoters();
          if (drawerOpen && selectedVoter?.id) {
            void loadVoterProfile(selectedVoter.id);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voter_sessions" },
        () => {
          if (drawerOpen && selectedVoter?.id) {
            void loadVoterProfile(selectedVoter.id);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voter_session_logs" },
        () => {
          if (drawerOpen && selectedVoter?.id) {
            void loadVoterProfile(selectedVoter.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Reload when sorting changes.
    loadVoters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortColumn, sortDirection]);

  useEffect(() => {
    // Reset to first page when filters/search/pageSize changes.
    setPage(1);
  }, [searchTerm, filterSCC, filterICpEP, filterHonor, pageSize]);

  const loadVoters = async () => {
    setLoading(true);

    const { data: voterData, error: voterError } = await supabase
      .from("voters")
      .select("*")
      .order(sortColumn, { ascending: sortDirection === "asc" });

    // Count voters who have voted in ANY election (for insights only).
    const { data: statusData, error: statusError } = await supabase
      .from("voter_election_status")
      .select("voter_id")
      .eq("has_voted", true);

    if (voterError) console.error("Error fetching voters:", voterError);
    if (statusError) {
      console.error("Error fetching voter_election_status:", statusError);
    } else {
      console.info(
        "[VoterManagement] voter_election_status (has_voted=true) rows:",
        (statusData ?? []).length
      );
    }

    const s = new Set<string>();
    for (const row of statusData ?? []) {
      if (row?.voter_id) s.add(row.voter_id);
    }

    setVoters(voterData || []);
    setVotedVoterIds(s);
    setLoading(false);
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIndicator = (column: string) => {
    if (sortColumn !== column) return null;
    return sortDirection === "asc" ? "↑" : "↓";
  };

  const copyToClipboard = async (text: string, meta?: any) => {
    try {
      await navigator.clipboard.writeText(text);
      await logAdminAction("COPY_TO_CLIPBOARD", meta ?? { value: text });
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  };

  const clearFilters = () => {
    setFilterSCC(false);
    setFilterICpEP(false);
    setFilterHonor(false);
    setSearchTerm("");
  };

  const getCanonicalAffiliations = (voter: any): CanonicalOrg[] => {
    const raw = (voter?.org_affiliations ?? []) as unknown[];
    const canon = raw.map(normalizeOrg).filter(Boolean) as CanonicalOrg[];
    return Array.from(new Set(canon));
  };

  const filteredVoters = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase();

    return voters.filter((voter) => {
      const matchesSearch =
        !searchLower ||
        voter.first_name?.toLowerCase().includes(searchLower) ||
        voter.middle_name?.toLowerCase().includes(searchLower) ||
        voter.last_name?.toLowerCase().includes(searchLower) ||
        voter.email?.toLowerCase().includes(searchLower) ||
        voter.year_level?.toLowerCase().includes(searchLower);

      const canonAffiliations = getCanonicalAffiliations(voter);
      const hasSCC = canonAffiliations.includes("Student Coordinating Council");
      const hasICpEP = canonAffiliations.includes("ICpEP");
      const hasHonor = canonAffiliations.includes("Honor Society");

      const matchesSCC = !filterSCC || hasSCC;
      const matchesICpEP = !filterICpEP || hasICpEP;
      const matchesHonor = !filterHonor || hasHonor;

      return matchesSearch && matchesSCC && matchesICpEP && matchesHonor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voters, searchTerm, filterSCC, filterICpEP, filterHonor]);

  const insights = useMemo(() => {
    const total = voters.length;
    const voted = votedVoterIds.size;
    const pending = Math.max(total - voted, 0);

    const counts: Record<CanonicalOrg, number> = {
      "Student Coordinating Council": 0,
      ICpEP: 0,
      "Honor Society": 0,
    };

    for (const voter of voters) {
      for (const org of getCanonicalAffiliations(voter)) {
        counts[org] += 1;
      }
    }

    return {
      total,
      voted,
      pending,
      orgCounts: counts,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voters, votedVoterIds]);

  const totalPages = Math.max(1, Math.ceil(filteredVoters.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedVoters = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredVoters.slice(start, end);
  }, [filteredVoters, currentPage, pageSize]);

  const logAdminAction = async (action: string, details?: any) => {
    try {
      await supabase.from("auth_logs").insert([
        {
          action,
          details: details ? JSON.stringify(details) : null,
          created_at: new Date().toISOString(),
        } as any,
      ]);
    } catch (e) {
      console.warn("Audit log insert failed:", e);
    }
  };

  const handleExportCsv = async () => {
    const header = [
      "Year Level",
      "Last Name",
      "First Name",
      "Middle Name",
      "Email",
      "Affiliations",
    ];

    const rows = filteredVoters.map((voter) => {
      const affiliations = getCanonicalAffiliations(voter).join("; ");
      return [
        voter.year_level ?? "",
        voter.last_name ?? "",
        voter.first_name ?? "",
        voter.middle_name ?? "",
        voter.email ?? "",
        affiliations,
      ];
    });

    const csv = [
      header.map(toCsvValue).join(","),
      ...rows.map((r) => r.map(toCsvValue).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voters_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    await logAdminAction("EXPORT_VOTERS_CSV", {
      filteredCount: filteredVoters.length,
      filters: { filterSCC, filterICpEP, filterHonor, searchTerm, pageSize },
    });
  };

  const loadVoterProfile = async (voterId: string) => {
    setDrawerLoading(true);

    const [
      { data: sessionData, error: sessionError },
      { data: logData, error: logError },
      { data: electionsData, error: electionsError },
      { data: statusData, error: statusError },
      { data: voterRow, error: voterError },
    ] = await Promise.all([
      supabase
        .from("voter_sessions")
        .select("*")
        .eq("voter_id", voterId)
        .order("created_at", { ascending: false })
        .limit(10),

      supabase
        .from("voter_session_logs")
        .select("*")
        .eq("voter_id", voterId)
        .order("created_at", { ascending: false })
        .limit(25),

      // ✅ include eligible_orgs so we can filter elections by voter orgs
      supabase
        .from("elections")
        .select("id, title, start_date, end_date, is_active, eligible_orgs")
        .order("start_date", { ascending: false }),

      supabase
        .from("voter_election_status")
        .select("election_id, has_voted, voted_at")
        .eq("voter_id", voterId),

      // ✅ fetch the voter's org_affiliations so filtering is correct even if selectedVoter state isn't updated yet
      supabase
        .from("voters")
        .select("org_affiliations")
        .eq("id", voterId)
        .single(),
    ]);

    if (sessionError) console.error("Error fetching voter_sessions:", sessionError);
    if (logError) console.error("Error fetching voter_session_logs:", logError);
    if (electionsError) console.error("Error fetching elections:", electionsError);
    if (statusError)
      console.error("Error fetching voter_election_status:", statusError);
    if (voterError) console.error("Error fetching voter org_affiliations:", voterError);

    // Build voter's canonical org set
    const rawOrgs = ((voterRow as any)?.org_affiliations ?? []) as unknown[];
    const voterOrgs = Array.from(
      new Set(rawOrgs.map(normalizeOrg).filter(Boolean) as CanonicalOrg[])
    );

    // Filter elections: show only elections the voter is eligible for
    const eligibleElections = ((electionsData ?? []) as any[]).filter((e) => {
      const elig = (e?.eligible_orgs ?? null) as unknown[] | null;

      // No eligible_orgs means open to all
      if (!elig || elig.length === 0) return true;

      // Otherwise, voter must overlap with eligible_orgs
      return elig.some((x) => {
        const canon = normalizeOrg(x);
        return canon ? voterOrgs.includes(canon) : false;
      });
    });

    // Map status by election_id
    const statusByElection = new Map<
      string,
      { has_voted: boolean; voted_at: string | null }
    >();

    for (const s of (statusData ?? []) as any[]) {
      if (s?.election_id) {
        statusByElection.set(s.election_id, {
          has_voted: !!s.has_voted,
          voted_at: s.voted_at ?? null,
        });
      }
    }

    // Merge: all eligible elections + existing status (or default not voted)
    const merged: VoterElectionStatusRow[] = eligibleElections.map((e) => {
      const st = statusByElection.get(e.id);
      return {
        election_id: e.id,
        has_voted: st?.has_voted ?? false,
        voted_at: st?.voted_at ?? null,
        elections: e as ElectionRow,
      };
    });

    setSelectedSessions(sessionData || []);
    setSelectedSessionLogs(logData || []);
    setSelectedStatuses(merged);

    setDrawerLoading(false);
  };


  const openVoterDrawer = async (voter: any) => {
    setSelectedVoter(voter);
    setDrawerOpen(true);
    await loadVoterProfile(voter.id);
    await logAdminAction("OPEN_VOTER_PROFILE", { voter_id: voter.id });
  };

  const toggleEmailReveal = async (voterId: string) => {
    setRevealedEmails((prev) => ({ ...prev, [voterId]: !prev[voterId] }));

    await logAdminAction("TOGGLE_EMAIL_REVEAL", {
      voter_id: voterId,
      revealed: !revealedEmails[voterId],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Voter Management
        </CardTitle>
        <CardDescription>
          Manage voter eligibility and view profiles, sessions, and activity logs
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Insights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Total Voters</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-semibold">{insights.total}</div>
              <div className="text-xs text-muted-foreground">
                All registered voters
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Voted (Any election)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-semibold">{insights.voted}</div>
              <div className="text-xs text-muted-foreground">
                At least one election marked as voted
              </div>
            </CardContent>
          </Card>

          <Card className="border">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Pending (Any election)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-semibold">{insights.pending}</div>
              <div className="text-xs text-muted-foreground">
                No elections marked as voted yet
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <Badge variant="outline" className="text-xs">
            SCC: {insights.orgCounts["Student Coordinating Council"]}
          </Badge>
          <Badge variant="outline" className="text-xs">
            ICpEP: {insights.orgCounts["ICpEP"]}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Honor Society: {insights.orgCounts["Honor Society"]}
          </Badge>
        </div>

        {/* Search + actions */}
        <div className="mb-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or year level..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={loadVoters}>
                Refresh
              </Button>
              <Button onClick={handleExportCsv}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Active filter chips */}
          {(filterSCC || filterICpEP || filterHonor || searchTerm.trim()) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Active:</span>

              {searchTerm.trim() && (
                <Badge variant="secondary" className="gap-1">
                  Search: “{searchTerm.trim()}”
                  <button
                    type="button"
                    className="ml-1 rounded hover:bg-muted p-0.5"
                    onClick={() => setSearchTerm("")}
                    aria-label="Remove search filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {filterSCC && (
                <Badge variant="secondary" className="gap-1">
                  Student Coordinating Council
                  <button
                    type="button"
                    className="ml-1 rounded hover:bg-muted p-0.5"
                    onClick={() => setFilterSCC(false)}
                    aria-label="Remove SCC filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {filterICpEP && (
                <Badge variant="secondary" className="gap-1">
                  ICpEP
                  <button
                    type="button"
                    className="ml-1 rounded hover:bg-muted p-0.5"
                    onClick={() => setFilterICpEP(false)}
                    aria-label="Remove ICpEP filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              {filterHonor && (
                <Badge variant="secondary" className="gap-1">
                  Honor Society
                  <button
                    type="button"
                    className="ml-1 rounded hover:bg-muted p-0.5"
                    onClick={() => setFilterHonor(false)}
                    aria-label="Remove Honor Society filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}

              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear all
              </Button>
            </div>
          )}
        </div>

        {/* Eligibility filters */}
        <div className="flex flex-wrap gap-2 mb-4">
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

          {(filterSCC || filterICpEP || filterHonor || searchTerm.trim()) && (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {/* Pagination controls (top) */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
          <div className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-medium">
              {filteredVoters.length === 0
                ? 0
                : (currentPage - 1) * pageSize + 1}
              –
              {Math.min(currentPage * pageSize, filteredVoters.length)}
            </span>{" "}
            of <span className="font-medium">{filteredVoters.length}</span>{" "}
            filtered voters
            <span className="ml-2 text-xs text-muted-foreground">
              (Sorted by <span className="font-medium">{sortColumn}</span>{" "}
              {getSortIndicator(sortColumn)})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows:</span>
            <Button
              variant={pageSize === 25 ? "default" : "outline"}
              size="sm"
              onClick={() => setPageSize(25)}
            >
              25
            </Button>
            <Button
              variant={pageSize === 50 ? "default" : "outline"}
              size="sm"
              onClick={() => setPageSize(50)}
            >
              50
            </Button>
            <Button
              variant={pageSize === 100 ? "default" : "outline"}
              size="sm"
              onClick={() => setPageSize(100)}
            >
              100
            </Button>
          </div>
        </div>

        {/* Voter table */}
        <div className="rounded-md border max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("year_level")}
                >
                  Year Level{" "}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {getSortIndicator("year_level") ?? ""}
                  </span>
                  <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>

                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("last_name")}
                >
                  Name{" "}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {getSortIndicator("last_name") ?? ""}
                  </span>
                  <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>

                <TableHead
                  className="cursor-pointer"
                  onClick={() => handleSort("email")}
                >
                  Email{" "}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {getSortIndicator("email") ?? ""}
                  </span>
                  <ArrowUpDown className="inline h-4 w-4 ml-1" />
                </TableHead>

                <TableHead>Affiliations</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">
                    Loading voters...
                  </TableCell>
                </TableRow>
              ) : filteredVoters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">
                    <div className="py-10">
                      <div className="text-sm font-medium">No voters found</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Try adjusting your search or filters.
                      </div>
                      {(filterSCC ||
                        filterICpEP ||
                        filterHonor ||
                        searchTerm.trim()) && (
                        <div className="mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearFilters}
                          >
                            Clear filters
                          </Button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                pagedVoters.map((voter) => {
                  const canonAffiliations = getCanonicalAffiliations(voter);
                  const isEmailRevealed = !!revealedEmails[voter.id];

                  return (
                    <TableRow
                      key={voter.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => void openVoterDrawer(voter)}
                    >
                      <TableCell className="font-medium">
                        {voter.year_level}
                      </TableCell>

                      <TableCell>
                        {voter.first_name}{" "}
                        {voter.middle_name ? voter.middle_name + " " : ""}
                        {voter.last_name}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {isEmailRevealed
                              ? voter.email ?? "-"
                              : maskEmail(voter.email)}
                          </span>

                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                void toggleEmailReveal(voter.id);
                              }}
                              aria-label={
                                isEmailRevealed ? "Hide email" : "Reveal email"
                              }
                            >
                              {isEmailRevealed ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                const email = (voter.email ?? "").toString();
                                if (email)
                                  void copyToClipboard(email, {
                                    voter_id: voter.id,
                                    field: "email",
                                  });
                              }}
                              aria-label="Copy email"
                              disabled={!voter.email}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {(canonAffiliations.length
                            ? canonAffiliations
                            : []
                          ).map((org) => (
                            <Badge
                              key={org}
                              variant="outline"
                              className="text-xs"
                            >
                              {org}
                            </Badge>
                          ))}
                          {canonAffiliations.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              -
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination controls (bottom) */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mt-3">
          <div className="text-sm text-muted-foreground">
            Page <span className="font-medium">{currentPage}</span> of{" "}
            <span className="font-medium">{totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setPage(1)}
              disabled={currentPage === 1}
            >
              First
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              Last
            </Button>
          </div>
        </div>

        {/* Voter profile drawer */}
        <Sheet
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) {
              setSelectedVoter(null);
              setSelectedStatuses([]);
              setSelectedSessions([]);
              setSelectedSessionLogs([]);
            }
          }}
        >
          <SheetContent className="w-full sm:max-w-xl flex flex-col h-[100dvh]">
            <SheetHeader className="shrink-0">
              <SheetTitle>Voter Profile</SheetTitle>
              <SheetDescription>
                Details, per-election vote status, sessions, and activity logs
              </SheetDescription>
            </SheetHeader>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto pr-2">
              {!selectedVoter ? (
                <div className="mt-6 text-sm text-muted-foreground">
                  No voter selected.
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <div className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">
                          {selectedVoter.first_name}{" "}
                          {selectedVoter.middle_name
                            ? selectedVoter.middle_name + " "
                            : ""}
                          {selectedVoter.last_name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Year Level: {selectedVoter.year_level ?? "-"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Email: {selectedVoter.email ?? "-"}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {getCanonicalAffiliations(selectedVoter).map((org) => (
                            <Badge
                              key={org}
                              variant="outline"
                              className="text-xs"
                            >
                              {org}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Per-election status table */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      Per-election voting status
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Election</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Voted At</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drawerLoading ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">
                                Loading...
                              </TableCell>
                            </TableRow>
                          ) : selectedStatuses.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">
                                No election status found
                              </TableCell>
                            </TableRow>
                          ) : (
                            selectedStatuses.map((s) => (
                              <TableRow key={s.election_id}>
                                <TableCell className="text-sm">
                                  {s.elections?.title ?? s.election_id}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {s.has_voted ? (
                                    <Badge className="bg-green-600">
                                      Voted
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">Not voted</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatDateTime(s.voted_at)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Sessions */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Recent Sessions</div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Created</TableHead>
                            <TableHead>Expires</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drawerLoading ? (
                            <TableRow>
                              <TableCell colSpan={2} className="text-center">
                                Loading...
                              </TableCell>
                            </TableRow>
                          ) : selectedSessions.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={2} className="text-center">
                                No sessions found
                              </TableCell>
                            </TableRow>
                          ) : (
                            selectedSessions.map((s: any, idx: number) => (
                              <TableRow key={s.id ?? idx}>
                                <TableCell className="text-sm">
                                  {formatDateTime(s.created_at)}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {formatDateTime(s.expires_at)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Logs */}
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      Recent Activity Logs
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Time</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Source</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {drawerLoading ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">
                                Loading...
                              </TableCell>
                            </TableRow>
                          ) : selectedSessionLogs.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center">
                                No logs found
                              </TableCell>
                            </TableRow>
                          ) : (
                            selectedSessionLogs.map((l: any, idx: number) => (
                              <TableRow key={l.id ?? idx}>
                                <TableCell className="text-sm">
                                  {formatDateTime(l.created_at)}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {l.action ?? "-"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {(l.kiosk_id ?? "-") +
                                    " • " +
                                    (l.ip_address ?? "-")}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}
