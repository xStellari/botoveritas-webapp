import type { ReactNode } from "react";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  UserCircle2,
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
  const [collapsedPositions, setCollapsedPositions] = useState<Set<string>>(new Set());

  const isSelectedLive = (() => {
    if (!selectedElection) return false;
    const now = Date.now();
    const start = new Date(selectedElection.start_date).getTime();
    const end = new Date(selectedElection.end_date).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return now >= start && now <= end;
  })();

  const isReadOnly = isSelectedFinal || isSelectedArchived || isSelectedLive;

  const togglePosition = (pos: string) =>
    setCollapsedPositions((prev) => {
      const next = new Set(prev);
      next.has(pos) ? next.delete(pos) : next.add(pos);
      return next;
    });

  const orderedPositions = positionOrder?.length
    ? positionOrder
    : Object.keys(candidatesByPosition).sort((a, b) => a.localeCompare(b));

  return (
    <Card className="rounded-2xl flex flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Candidates
          {candidates.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({candidates.length})
            </span>
          )}
        </CardTitle>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedElectionId || candidatesLoading || saving}
            onClick={() => selectedElectionId && loadCandidates(selectedElectionId)}
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${candidatesLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => openCreateCandidate()}
            disabled={!selectedElectionId || isReadOnly}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Candidate
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto min-h-0 space-y-4">
        {!selectedElection ? (
          <div className="text-sm text-muted-foreground">
            Select an election to manage its candidates.
          </div>
        ) : (
          <>
            {/* Election summary */}
            <div className="rounded-xl border p-3 bg-muted/20">
              <div className="font-semibold">{selectedElection.title}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatDateTimeShort(selectedElection.start_date)} —{" "}
                {formatDateTimeShort(selectedElection.end_date)}
              </div>
            </div>

            {/* Status banners */}
            {isSelectedFinal && (
              <div className="rounded-lg border border-violet-600/30 bg-violet-600/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-violet-800">
                  <Lock className="h-4 w-4" />
                  Finalized election (read-only)
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Editing election details, candidates, and votes is locked. Reporting remains available.
                </div>
              </div>
            )}
            {isSelectedArchived && (
              <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
                <div className="font-medium text-amber-900">Archived election (history)</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This election is archived and remains viewable for history only.
                </div>
              </div>
            )}
            {isSelectedLive && (
              <div className="rounded-lg border border-red-600/30 bg-red-600/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-red-900">
                  <Lock className="h-4 w-4" />
                  Live election (candidate list locked)
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Candidate add/edit/remove/reorder is disabled while the election is live.
                </div>
              </div>
            )}

            {/* Candidates by position */}
            {candidatesLoading ? (
              <div className="text-sm text-muted-foreground">Loading candidates…</div>
            ) : candidates.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No candidates yet. Click <b>Add Candidate</b>.
              </div>
            ) : (
              <div className="space-y-3">
                {orderedPositions.map((pos) => {
                  const positionCandidates = candidatesByPosition[pos] ?? [];
                  const isCollapsed = collapsedPositions.has(pos);

                  return (
                    <div key={pos} className="rounded-2xl border overflow-hidden">
                      {/* Position header */}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                        <button
                          onClick={() => togglePosition(pos)}
                          className="flex items-center gap-2 flex-1 text-left hover:opacity-70 transition-opacity"
                        >
                          {isCollapsed
                            ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          }
                          <span className="font-semibold text-sm">{pos}</span>
                          <span className="text-xs text-muted-foreground">
                            {positionCandidates.length} candidate{positionCandidates.length !== 1 ? "s" : ""}
                          </span>
                        </button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openCreateCandidate(pos)}
                          disabled={isReadOnly}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add to {pos}
                        </Button>
                      </div>

                      {/* Candidate rows */}
                      {!isCollapsed && (
                        <div className={isReadOnly ? "opacity-60 pointer-events-none" : ""}>
                          {positionCandidates.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-muted-foreground italic">
                              No candidates for this position yet.
                            </div>
                          ) : (
                            <div className="divide-y">
                              {positionCandidates.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-start gap-3 p-3 hover:bg-muted/20 transition-colors group"
                                  draggable={!isReadOnly}
                                  onDragStart={() => !isReadOnly && onDragStartCandidate(pos, c.id)}
                                  onDragOver={(e) => { if (!isReadOnly) e.preventDefault(); }}
                                  onDrop={() => { if (!isReadOnly) onDropCandidate(pos, c.id); }}
                                >
                                  <div className={`mt-1 text-muted-foreground ${isReadOnly ? "cursor-not-allowed" : "cursor-grab"}`}>
                                    <GripVertical className="h-5 w-5" />
                                  </div>

                                  {/* Avatar */}
                                  <div className="h-10 w-10 rounded-full overflow-hidden border bg-muted flex items-center justify-center shrink-0">
                                    {c.photo_url ? (
                                      <img
                                        src={c.photo_url}
                                        alt={getCandidateDisplayName(c)}
                                        className="w-full h-full object-cover"
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = ""; }}
                                      />
                                    ) : (
                                      <UserCircle2 className="h-6 w-6 text-muted-foreground/50" />
                                    )}
                                  </div>

                                  {/* Info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold truncate">{getCandidateDisplayName(c)}</span>
                                      {c.slate && <Badge variant="secondary">{c.slate}</Badge>}
                                    </div>
                                    {c.bio ? (
                                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.bio}</div>
                                    ) : (
                                      <div className="text-xs text-muted-foreground mt-1 italic">No bio.</div>
                                    )}
                                  </div>

                                  {/* Actions */}
                                  <div className="flex flex-col gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openEditCandidate(c)}
                                      disabled={saving || isReadOnly}
                                    >
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Edit
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      onClick={() => deleteCandidate(c.id)}
                                      disabled={saving || isReadOnly}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isReadOnly && positionCandidates.length > 0 && (
                            <div className="px-4 py-2 border-t">
                              <p className="text-xs text-muted-foreground">Drag candidates to reorder (auto-saves).</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
