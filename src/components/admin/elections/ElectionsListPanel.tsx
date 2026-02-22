import type { Dispatch, ReactNode, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Calendar, Lock, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";

type ElectionRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean | null;
  is_paused?: boolean | null;
  eligible_orgs: string[] | null;
  voter_audience?: string | null;
  is_final?: boolean | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  finalized_by_email?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archived_by_email?: string | null;
};

type Props = {
  loading: boolean;
  saving: boolean;

  showArchived: boolean;
  setShowArchived: Dispatch<SetStateAction<boolean>>;

  onRefresh: () => void;
  openCreateElection: () => void;

  operationalElections: ElectionRow[];
  archivedElections: ElectionRow[];

  selectedElectionId: string | null;
  setSelectedElectionId: Dispatch<SetStateAction<string | null>>;

  // Render helpers (kept in parent to minimize behavior risk)
  activeBadge: (e: ElectionRow) => ReactNode;
  audienceBadge: (e: ElectionRow) => ReactNode;
  finalBadge: (e: ElectionRow) => ReactNode;
  statusBadge: (e: ElectionRow) => ReactNode;
  archiveBadge: (e: ElectionRow) => ReactNode;

  formatDateTimeShort: (iso: string) => string;

  openEditElection: (e: ElectionRow) => void;
  toggleElectionActive: (e: ElectionRow, visible?: boolean) => void;

  openFinalizeElection: (e: ElectionRow) => void;
  openArchiveElection: (e: ElectionRow) => void;
  deleteElection: (id: string) => void;

  openRestoreElection: (e: ElectionRow) => void;
};

export function ElectionsListPanel({
  loading,
  saving,
  showArchived,
  setShowArchived,
  onRefresh,
  openCreateElection,
  operationalElections,
  archivedElections,
  selectedElectionId,
  setSelectedElectionId,
  activeBadge,
  audienceBadge,
  finalBadge,
  statusBadge,
  archiveBadge,
  formatDateTimeShort,
  openEditElection,
  toggleElectionActive,
  openFinalizeElection,
  openArchiveElection,
  deleteElection,
  openRestoreElection,
}: Props) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Elections
        </CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading || saving}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Refresh
          </Button>

          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <span className="text-xs font-medium">Show Archived</span>
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          </div>

          <Button size="sm" onClick={openCreateElection}>
            <Plus className="h-4 w-4 mr-2" />
            New
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading elections…</div>
        ) : operationalElections.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No elections yet. Click <b>New</b>.
          </div>
        ) : (
          operationalElections.map((e) => {
            const selected = e.id === selectedElectionId;
            return (
              <div
                key={e.id}
                className={`rounded-xl border p-3 transition ${
                  selected
                    ? "border-primary/40 bg-primary/5"
                    : "hover:bg-muted/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setSelectedElectionId(e.id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{e.title}</div>
                      {activeBadge(e)}
                      {audienceBadge(e)}
                      {finalBadge(e)}
                      {statusBadge(e)}
                    </div>

                    {e.description ? (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {e.description}
                      </div>
                    ) : null}

                    <div className="text-xs text-muted-foreground mt-2">
                      {formatDateTimeShort(e.start_date)} —{" "}
                      {formatDateTimeShort(e.end_date)}
                    </div>

                    {e.eligible_orgs?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {e.eligible_orgs.slice(0, 6).map((org) => (
                          <Badge key={org} variant="secondary">
                            {org}
                          </Badge>
                        ))}
                        {e.eligible_orgs.length > 6 ? (
                          <Badge variant="outline">
                            +{e.eligible_orgs.length - 6}
                          </Badge>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Eligible orgs: <span className="italic">all</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditElection(e)}
                      disabled={saving || Boolean(e.is_final)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>

                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <span className="text-xs font-medium">Visible to voters</span>
                      <Switch
                        checked={!Boolean(e.is_paused)}
                        disabled={
                          saving || Boolean(e.is_final) || Boolean(e.is_archived)
                        }
                        onCheckedChange={(checked) => toggleElectionActive(e, checked)}
                      />
                    </div>

                    {Boolean(e.is_final) ? (
                      <>
                        <div className="rounded-md border px-3 py-2">
                          <div className="text-xs font-medium flex items-center gap-2">
                            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                            Finalized
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {e.finalized_at
                              ? formatDateTimeShort(e.finalized_at)
                              : "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Finalized by:{" "}
                            {e.finalized_by_email ||
                              (e.finalized_by
                                ? `${e.finalized_by.slice(0, 8)}…`
                                : "—")}
                          </div>
                        </div>

                        {!Boolean(e.is_archived) ? (
                          <Button
                            className="mt-3 w-full"
                            variant="outline"
                            size="sm"
                            onClick={() => openArchiveElection(e)}
                            disabled={saving}
                          >
                            Archive
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openFinalizeElection(e)}
                        disabled={saving}
                      >
                        <Lock className="h-4 w-4 mr-2" />
                        Finalize
                      </Button>
                    )}

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteElection(e.id)}
                      disabled={saving || Boolean(e.is_final)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {showArchived ? (
          <>
            <Separator className="my-6" />
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Archived Elections</div>
                <div className="text-xs text-muted-foreground">
                  Archived elections are hidden from the operational list, but
                  remain viewable as read-only history.
                </div>
              </div>
              <Badge variant="outline">{archivedElections.length}</Badge>
            </div>

            {archivedElections.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-3">
                No archived elections.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {archivedElections.map((e) => (
                  <div
                    key={e.id}
                    className={`rounded-2xl border p-4 transition ${
                      selectedElectionId === e.id
                        ? "border-amber-500/60 bg-amber-500/5"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => setSelectedElectionId(e.id)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold">{e.title}</div>
                          {archiveBadge(e)}
                          {audienceBadge(e)}
                          {finalBadge(e)}
                          {statusBadge(e)}
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          {formatDateTimeShort(e.start_date)} —{" "}
                          {formatDateTimeShort(e.end_date)}
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          Archived at:{" "}
                          {e.archived_at
                            ? formatDateTimeShort(e.archived_at)
                            : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Archived by:{" "}
                          {e.archived_by_email ||
                            (e.archived_by
                              ? `${e.archived_by.slice(0, 8)}…`
                              : "—")}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRestoreElection(e)}
                          disabled={saving}
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
