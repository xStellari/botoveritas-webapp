import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, User, Clock, ArrowRight, Ban } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

// 🔥 UPDATED PROPS — timeLeft added
interface BallotScreenProps {
  voterData: any;
  electionId: string;
  electionData: any;
  onComplete: (selections: any[]) => void;
  initialSelections?: any[];
  timeLeft: number; // ⬅ NEW — time passed from VotingKiosk
}

type CandidateRow = {
  id: string;
  election_id: string;
  name: string; // display-only (kept for backward compatibility)
  first_name?: string | null;
  last_name?: string | null;
  position: string;
  slate?: string | null;
  photo_url?: string | null;
  bio?: string | null;
  display_order?: number | null;
};

type PositionBlock = {
  id: string; // derived from title
  title: string; // raw DB position label (shown on screen)
  candidates: CandidateRow[];
};

const positionIdFromTitle = (title: string) =>
  title.toLowerCase().trim().replace(/\s+/g, "-");

const getCandidateDisplayName = (c: CandidateRow) => {
  const first = (c.first_name ?? "").trim();
  const last = (c.last_name ?? "").trim();
  const composed = `${first} ${last}`.trim();
  return composed || (c.name ?? "").trim();
};

// Fallback for legacy candidates (or partially filled data)
const splitLegacyName = (name: string) => {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return { first_name: "", last_name: "" };
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first_name: "", last_name: parts[0] };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
};

const getCandidateSortKey = (c: CandidateRow) => {
  const last = (c.last_name ?? "").trim();
  const first = (c.first_name ?? "").trim();

  if (last || first) {
    return { last: last.toLowerCase(), first: first.toLowerCase() };
  }

  const legacy = splitLegacyName(c.name ?? "");
  return { last: legacy.last_name.toLowerCase(), first: legacy.first_name.toLowerCase() };
};

const normalizePosition = (raw: string) => {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();

  // Normalize VP variants (common patterns)
  if (lower.includes("vp") || lower.includes("vice president")) {
    if (lower.includes("internal")) return "Vice President - Internal";
    if (lower.includes("external")) return "Vice President - External";
    // generic VP
    return "Vice President";
  }

  // Normalize PRO variants
  if (lower === "pro" || lower.includes("public relations")) {
    return "Public Relations Officer";
  }

  // Keep canonical casing for key roles if you want, otherwise return original
  if (lower === "president") return "President";
  if (lower === "secretary") return "Secretary";
  if (lower === "treasurer") return "Treasurer";
  if (lower === "auditor") return "Auditor";

  return s;
};


// Canonical position sets per org (single-seat everywhere)
const ORG_CANONICAL_POSITIONS: Record<string, string[]> = {
  ICpEP: [
    "President",
    "Vice President - Internal",
    "Vice President - External",
    "Secretary",
    "Assistant Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "1st Year Batch Representative",
    "2nd Year Batch Representative",
    "3rd Year Batch Representative",
    "4th Year Batch Representative",
    "Director for Publicity and Creatives",
    "Director for Sports",
    "Director for Programs",
  ],
  SCC: [
    "President",
    "Vice President",
    "Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "Director for Creatives",
  ],
  HonSoc: [
    "President",
    "Vice President - Internal",
    "Vice President - External",
    "Secretary",
    "Treasurer",
    "Auditor",
    "Public Relations Officer",
    "Directors Board: Creatives & Technical",
    "Directors Board: Secretariat & Documentation",
    "Directors Board: Academics & Sports",
    "Directors Board: Programs & Logistics",
    "Directors Board: Publicity & External Events",
  ],
};

function uniqPreserveOrder(items: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const v = String(it ?? "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function getCanonicalPositionsForElection(electionData: any): string[] {
  const eligibleOrgs = Array.isArray(electionData?.eligible_orgs)
    ? electionData.eligible_orgs.filter(Boolean).map((x: any) => String(x).trim())
    : [];
  const known = uniqPreserveOrder(eligibleOrgs).filter((c) => Boolean(ORG_CANONICAL_POSITIONS[c]));
  if (known.length === 0) return [];
  return uniqPreserveOrder(known.flatMap((c) => ORG_CANONICAL_POSITIONS[c]));
}

const positionPriority = (normalized: string, canonicalOrder: string[]) => {
  if (canonicalOrder.length > 0) {
    const idx = canonicalOrder.indexOf(normalized);
    if (idx >= 0) return idx + 1; // 1..N
  }

  // Fallback heuristic order (legacy elections)
  switch (normalized) {
    case "President":
      return 10;
    case "Vice President - Internal":
      return 20;
    case "Vice President - External":
      return 21;
    case "Vice President":
      return 22;
    case "Secretary":
      return 30;
    case "Assistant Secretary":
      return 31;
    case "Treasurer":
      return 40;
    case "Auditor":
      return 50;
    case "Public Relations Officer":
      return 60;
    default:
      return 999;
  }
};

const BallotScreenWithAbstain = ({
  voterData,
  electionId,
  electionData,
  onComplete,
  initialSelections = [],
  timeLeft, // ⬅ NEW
}: BallotScreenProps) => {
  const { toast } = useToast();
  const [selections, setSelections] = useState<{ [positionId: string]: string }>({});
  const [positions, setPositions] = useState<PositionBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const [abstainConfirm, setAbstainConfirm] = useState<{ show: boolean; positionId: string }>({
    show: false,
    positionId: "",
  });

  useEffect(() => {
    loadPositionsAndCandidates();
    initializeSelections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPositionsAndCandidates = async () => {
    setLoading(true);

    const { data: candidatesData, error } = await supabase
      .from("candidates")
      .select("*")
      .eq("election_id", electionId);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to load ballot",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // Remove any candidate literally named "abstain" (legacy hack)
    const filteredCandidates = (candidatesData as CandidateRow[] | null)?.filter(
      (c) => (c.name ?? "").toLowerCase() !== "abstain"
    );

    // Group by raw position label (shown to users)
    const positionsMap = new Map<string, CandidateRow[]>();
    filteredCandidates?.forEach((candidate) => {
      const posTitle = candidate.position;
      if (!positionsMap.has(posTitle)) {
        positionsMap.set(posTitle, []);
      }
      positionsMap.get(posTitle)!.push(candidate);
    });

    // Build positions array
    let positionsArray: PositionBlock[] = Array.from(positionsMap.entries()).map(
      ([position, candidates]) => ({
        id: positionIdFromTitle(position),
        title: position,
        candidates,
      })
    );

    // Sort candidates by last name (then first name)
    positionsArray = positionsArray.map((p) => {
      const sorted = [...p.candidates].sort((a, b) => {
        const ak = getCandidateSortKey(a);
        const bk = getCandidateSortKey(b);

        if (ak.last !== bk.last) return ak.last.localeCompare(bk.last);
        if (ak.first !== bk.first) return ak.first.localeCompare(bk.first);

        // stable deterministic tiebreaker
        return a.id.localeCompare(b.id);
      });

      return { ...p, candidates: sorted };
    });

    // Sort positions using canonical order for the election (based on eligible_orgs)
    const canonicalOrder = getCanonicalPositionsForElection(electionData);

    positionsArray.sort((a, b) => {
      const an = normalizePosition(a.title);
      const bn = normalizePosition(b.title);

      const ap = positionPriority(an, canonicalOrder);
      const bp = positionPriority(bn, canonicalOrder);

      if (ap !== bp) return ap - bp;

      // If both are unknown (or tied), sort alphabetically by title
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });

    setPositions(positionsArray);

    // Clean selections for removed positions
    setSelections((prev) => {
      const cleaned: { [key: string]: string } = {};
      positionsArray.forEach((pos) => {
        if (prev[pos.id]) cleaned[pos.id] = prev[pos.id];
      });
      return cleaned;
    });

    setLoading(false);
  };

  const initializeSelections = () => {
    const initialState: { [key: string]: string } = {};
    initialSelections.forEach((sel) => {
      const posId = positionIdFromTitle(sel.position);
      initialState[posId] = sel.candidateId;
    });
    setSelections(initialState);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSelection = (positionId: string, candidateId: string) => {
    if (candidateId === "ABSTAIN") {
      setAbstainConfirm({ show: true, positionId });
    } else {
      setSelections((prev) => ({
        ...prev,
        [positionId]: candidateId,
      }));
    }
  };

  const confirmAbstain = () => {
    setSelections((prev) => ({
      ...prev,
      [abstainConfirm.positionId]: "ABSTAIN",
    }));
    setAbstainConfirm({ show: false, positionId: "" });

    toast({
      title: "Abstention Recorded",
      description: "Your abstention has been recorded.",
    });
  };

  const handleSubmit = () => {
    const unfilledPositions = positions.filter((pos) => !selections[pos.id]);

    if (unfilledPositions.length > 0) {
      toast({
        title: "Incomplete Ballot",
        description: "You must select a candidate or abstain for ALL positions before reviewing.",
        variant: "destructive",
      });
      return;
    }

    const candidateSelections = Object.entries(selections).map(([positionId, candidateId]) => {
      const position = positions.find((p) => p.id === positionId);

      if (candidateId === "ABSTAIN") {
        return {
          position: position?.title,
          candidateId: "ABSTAIN",
          candidateName: "ABSTAIN",
          slate: "N/A",
          electionId,
          electionName: electionData.title,
        };
      }

      const candidate = position?.candidates.find((c) => c.id === candidateId);

      return {
        position: position?.title,
        candidateId: candidate?.id,
        candidateName: candidate ? getCandidateDisplayName(candidate) : "",
        slate: candidate?.slate || "N/A",
        electionId,
        electionName: electionData.title,
      };
    });

    onComplete(candidateSelections);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Loading ballot...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <img src={feuLogo} alt="FEU" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  {electionData.title}
                </h1>
                <p className="text-sm text-muted-foreground">Cast Your Vote</p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {(() => {
                const ms = Math.max(0, timeLeft ?? 0);
                const min = Math.floor(ms / 60000);
                const sec = Math.floor((ms % 60000) / 1000);
                const isDanger = ms <= 15000;
                const isWarn = ms > 15000 && ms <= 60000;

                const pill =
                  isDanger
                    ? "border-red-200 bg-red-50 text-red-700"
                    : isWarn
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800";

                return (
                  <div
                    className={[
                      "rounded-full border px-4 py-1.5 flex items-baseline gap-2",
                      pill,
                      isDanger ? "animate-pulse" : "",
                    ].join(" ")}
                    aria-label="Voting session timer"
                  >
                    <span className="text-[11px] uppercase tracking-wide opacity-80">Time</span>
                    <span className="tabular-nums text-xl font-bold leading-none">
                      {min}:{String(sec).padStart(2, "0")}
                    </span>
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {voterData.first_name} {voterData.last_name}
                </span>
              </div>

            </div>
          </div>
        </Card>

        {/* Info Card */}
        <Card className="mb-6 p-4 bg-info/5 border-info/20">
          <p className="text-sm text-center">
            <strong>Note:</strong> You may abstain from any position by selecting the "Abstain"
            option.
          </p>
        </Card>

        {/* Ballot Positions */}
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="space-y-6 pr-4">
            {positions.map((position) => (
              <Card
                key={position.id}
                className="border-2 border-primary/10 bg-card/95 backdrop-blur-sm"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">{position.title}</h2>
                      <Badge variant="outline" className="bg-primary/5">
                        {electionData.title}
                      </Badge>
                    </div>
                    {selections[position.id] && <CheckCircle2 className="h-6 w-6 text-success" />}
                  </div>

                  <RadioGroup
                    value={selections[position.id] || ""}
                    onValueChange={(value) => handleSelection(position.id, value)}
                  >
                    <div className="space-y-4">
                      {/* Candidate List */}
                      {position.candidates.map((candidate: CandidateRow) => {
                        const candidateName = getCandidateDisplayName(candidate);

                        return (
                          <div
                            key={candidate.id}
                            className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all cursor-pointer hover:border-primary/50 ${
                              selections[position.id] === candidate.id
                                ? "border-primary bg-primary/5"
                                : "border-border bg-background"
                            }`}
                            onClick={() => handleSelection(position.id, candidate.id)}
                          >
                            <RadioGroupItem value={candidate.id} id={candidate.id} className="mt-1" />
                            <Label htmlFor={candidate.id} className="flex-1 cursor-pointer">
                              <div className="flex items-start gap-4">
                                <div className="w-24 h-24 rounded-lg overflow-hidden border bg-muted flex items-center justify-center">
                                  {candidate.photo_url ? (
                                    <img
                                      src={candidate.photo_url}
                                      alt={candidateName}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).src = "";
                                      }}
                                    />
                                  ) : (
                                    <User className="h-12 w-12 text-muted-foreground" />
                                  )}
                                </div>

                                <div className="flex-1">
                                  <h3 className="font-semibold text-lg">{candidateName}</h3>
                                  {candidate.slate && (
                                    <p className="text-sm text-secondary font-medium mb-2">
                                      {candidate.slate}
                                    </p>
                                  )}
                                  {candidate.bio && (
                                    <p className="text-sm text-muted-foreground">{candidate.bio}</p>
                                  )}
                                </div>
                              </div>
                            </Label>
                          </div>
                        );
                      })}

                      {/* ABSTAIN OPTION */}
                      <div
                        className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all cursor-pointer hover:border-warning/50 ${
                          selections[position.id] === "ABSTAIN"
                            ? "border-warning bg-warning/5"
                            : "border-border bg-muted/20"
                        }`}
                        onClick={() => handleSelection(position.id, "ABSTAIN")}
                      >
                        <RadioGroupItem
                          value="ABSTAIN"
                          id={`${position.id}-abstain`}
                          className="mt-1"
                        />

                        <Label
                          htmlFor={`${position.id}-abstain`}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-warning/20 flex items-center justify-center">
                              <Ban className="h-6 w-6 text-warning" />
                            </div>
                            <div>
                              <h3 className="font-semibold">Abstain from this position</h3>
                              <p className="text-sm text-muted-foreground">
                                I choose not to vote for this position.
                              </p>
                            </div>
                          </div>
                        </Label>
                      </div>
                    </div>
                  </RadioGroup>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {/* Submit Button */}
        <Card className="mt-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {Object.keys(selections).length} of {positions.length} positions selected/abstained
            </p>

            <Button
              onClick={handleSubmit}
              className="bg-gradient-primary hover:opacity-90 shadow-glow h-12 px-8 text-lg"
              disabled={Object.keys(selections).length !== positions.length}
            >
              Review Selections
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Abstain Confirm Dialog */}
      <AlertDialog
        open={abstainConfirm.show}
        onOpenChange={(open) => setAbstainConfirm({ ...abstainConfirm, show: open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Abstention</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to abstain from this position?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAbstain}
              className="bg-warning hover:bg-warning/90"
            >
              Yes, Abstain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BallotScreenWithAbstain;