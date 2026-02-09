import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Users,
} from "lucide-react";

type CandidateRow = {
  id: string;
  election_id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  position: string;
  slate: string | null;
  photo_url: string | null;
  bio: string | null;
  display_order: number | null;
  vote_count: number | null;
  created_at?: string;
  updated_at?: string;
};

type ElectionRowMinimal = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
};

type Props = {
  selectedElection: ElectionRowMinimal | null;
  selectedElectionId: string | null;

  candidates: CandidateRow[];
  candidatesByPosition: Record<string, CandidateRow[]>;
  // Canonical position order (derived from election eligible_orgs); fallback handled internally
  positionOrder?: string[];
  candidatesLoading: boolean;
  saving: boolean;

  isSelectedFinal: boolean;
  isSelectedArchived: boolean;

  loadCandidates: (electionId: string) => void | Promise<void>;
  openCreateCandidate: (position?: string) => void;
  openEditCandidate: (c: CandidateRow) => void;
  deleteCandidate: (candidateId: string) => void | Promise<void>;

  onDragStartCandidate: (position: string, candidateId: string) => void;
  onDropCandidate: (position: string, targetCandidateId: string) => void;

  formatDateTimeShort: (iso: string) => string;
  getCandidateDisplayName: (c: CandidateRow) => string;
};

export function CandidatesManager({
  selectedElection,
  selectedElectionId,
  candidates,
  candidatesByPosition,
  positionOrder,
  candidatesLoading,
  saving,
  isSelectedFinal,
  isSelectedArchived,
  loadCandidates,
  openCreateCandidate,
  openEditCandidate,
  deleteCandidate,
  onDragStartCandidate,
  onDropCandidate,
  formatDateTimeShort,
  getCandidateDisplayName,
}: Props) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Candidates
        </CardTitle>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedElectionId || candidatesLoading || saving}
            onClick={() => selectedElectionId && loadCandidates(selectedElectionId)}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => openCreateCandidate()}
            disabled={!selectedElectionId || isSelectedFinal}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Candidate
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!selectedElection ? (
          <div className="text-sm text-muted-foreground">
            Select an election to manage its candidates.
          </div>
        ) : (
          <>
            <div className="rounded-xl border p-3 bg-muted/20">
              <div className="font-semibold">{selectedElection.title}</div>

              <div className="text-xs text-muted-foreground mt-1">
                {formatDateTimeShort(selectedElection.start_date)} —{" "}
                {formatDateTimeShort(selectedElection.end_date)}
              </div>

              {isSelectedFinal ? (
                <div className="mt-3 rounded-lg border border-violet-600/30 bg-violet-600/5 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-violet-800">
                    <Lock className="h-4 w-4" />
                    Finalized election (read-only)
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Editing election details, candidates, and votes is locked.
                    Reporting remains available.
                  </div>
                </div>
              ) : null}

              {isSelectedArchived ? (
                <div className="mt-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
                  <div className="font-medium text-amber-900">
                    Archived election (history)
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    This election is archived. It remains viewable for history,
                    but should not be treated as ongoing/active.
                  </div>
                </div>
              ) : null}
            </div>

            {candidatesLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading candidates…
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No candidates yet. Click <b>Add Candidate</b>.
              </div>
            ) : (
              <div className="space-y-6">
                {(positionOrder?.length ? positionOrder : Object.keys(candidatesByPosition).sort((a, b) => a.localeCompare(b)))
                  .map((pos) => (
                    <div key={pos} className="rounded-2xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">{pos}</div>
                          <div className="text-xs text-muted-foreground">
                            {(candidatesByPosition[pos] ?? []).length} candidate(s)
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Drag candidates to reorder (auto-saves).
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openCreateCandidate(pos)}
                          disabled={isSelectedFinal}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add to {pos}
                        </Button>
                      </div>

                      <Separator className="my-4" />

                      <div className="space-y-3">
                        {(candidatesByPosition[pos] ?? []).map((c) => (
                          <div
                            key={c.id}
                            className="rounded-xl border p-3 flex items-start justify-between gap-3"
                            draggable={!isSelectedFinal}
                            onDragStart={() =>
                              !isSelectedFinal && onDragStartCandidate(pos, c.id)
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                            }}
                            onDrop={() => onDropCandidate(pos, c.id)}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="mt-1 text-muted-foreground cursor-grab">
                                <GripVertical className="h-5 w-5" />
                              </div>

                              <div className="w-16 h-16 rounded-full overflow-hidden border bg-muted flex items-center justify-center flex-shrink-0">
                                {c.photo_url ? (
                                  <img
                                    src={c.photo_url}
                                    alt={c.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).src =
                                        "";
                                    }}
                                  />
                                ) : (
                                  <Users className="h-9 w-9 text-muted-foreground" />
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="font-semibold truncate">
                                    {getCandidateDisplayName(c)}
                                  </div>
                                  {c.slate ? (
                                    <Badge variant="secondary">{c.slate}</Badge>
                                  ) : null}
                                  <Badge variant="outline">
                                    Order: {c.display_order ?? 0}
                                  </Badge>
                                </div>

                                {c.bio ? (
                                  <div className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                    {c.bio}
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground mt-2 italic">
                                    No bio.
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditCandidate(c)}
                                disabled={saving || isSelectedFinal}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteCandidate(c.id)}
                                disabled={saving || isSelectedFinal}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
