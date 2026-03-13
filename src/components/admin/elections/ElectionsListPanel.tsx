import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Archive,
  Calendar,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  activeBadge: (e: ElectionRow) => ReactNode;
  audienceBadge: (e: ElectionRow) => ReactNode;
  finalBadge: (e: ElectionRow) => ReactNode;
  statusBadge: (e: ElectionRow) => ReactNode;
  archiveBadge: (e: ElectionRow) => ReactNode;
  formatDateTimeShort: (iso: string) => string;
  openEditElection: (e: ElectionRow) => void;
  toggleElectionActive: (e: ElectionRow, visible?: boolean) => void;
  openArchiveElection: (e: ElectionRow) => void;
  deleteElection: (id: string) => void;
  openRestoreElection: (e: ElectionRow) => void;
};

type LifecycleState = "ONGOING" | "UPCOMING" | "CLOSED" | "FINALIZED" | "ARCHIVED";

function getState(e: ElectionRow): LifecycleState {
  if (e.is_archived) return "ARCHIVED";
  if (e.is_final) return "FINALIZED";
  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  const end = new Date(e.end_date).getTime();
  if (now < start) return "UPCOMING";
  if (now > end) return "CLOSED";
  return "ONGOING";
}

const GROUP_ORDER: LifecycleState[] = ["ONGOING", "UPCOMING", "CLOSED", "FINALIZED", "ARCHIVED"];

const GROUP_META: Record<LifecycleState, { label: string; dot: string; text: string }> = {
  ONGOING:   { label: "Ongoing",   dot: "bg-green-500",  text: "text-green-700"  },
  UPCOMING:  { label: "Upcoming",  dot: "bg-blue-500",   text: "text-blue-700"   },
  CLOSED:    { label: "Closed",    dot: "bg-zinc-400",   text: "text-zinc-500"   },
  FINALIZED: { label: "Finalized", dot: "bg-violet-500", text: "text-violet-700" },
  ARCHIVED:  { label: "Archived",  dot: "bg-amber-500",  text: "text-amber-700"  },
};

function IconBtn({
  onClick,
  title,
  children,
  destructive = false,
  disabled = false,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(ev) => { ev.stopPropagation(); onClick(ev); }}
            disabled={disabled}
            className={[
              "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
              "disabled:opacity-30 disabled:cursor-not-allowed",
              destructive
                ? "text-muted-foreground hover:bg-red-50 hover:text-red-600"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
  audienceBadge,
  formatDateTimeShort,
  openEditElection,
  toggleElectionActive,
  openArchiveElection,
  deleteElection,
  openRestoreElection,
}: Props) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allElections = showArchived
    ? [...operationalElections, ...archivedElections]
    : operationalElections;

  const filtered = search.trim()
    ? allElections.filter((e) =>
        e.title.toLowerCase().includes(search.trim().toLowerCase())
      )
    : allElections;

  const groups: Partial<Record<LifecycleState, ElectionRow[]>> = {};
  for (const e of filtered) {
    const key = getState(e);
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(e);
  }
  const visibleGroups = GROUP_ORDER.filter((k) => groups[k]?.length);

  const toggleGroup = (k: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const totalActive = operationalElections.length;
  const totalArchived = archivedElections.length;

  return (
    <Card className="rounded-2xl flex flex-col h-full">
      <CardHeader className="flex flex-col gap-3 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Elections
            <span className="text-sm font-normal text-muted-foreground">
              ({totalActive})
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading || saving}
            >
              <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={openCreateElection} disabled={saving}>
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>
          </div>
        </div>

        {/* Search + archived toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search elections…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 shrink-0">
            <span className="text-xs font-medium whitespace-nowrap">
              Archived {totalArchived > 0 && `(${totalArchived})`}
            </span>
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto min-h-0 pt-0 space-y-1">
        {loading ? (
          <div className="text-sm text-muted-foreground py-2">Loading elections…</div>
        ) : visibleGroups.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">
            {search ? "No results match your search." : <>No elections yet. Click <b>New</b>.</>}
          </div>
        ) : (
          visibleGroups.map((groupKey) => {
            const meta = GROUP_META[groupKey];
            const items = groups[groupKey]!;
            const isCollapsed = collapsed.has(groupKey);

            return (
              <div key={groupKey}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center gap-2 py-1.5 px-1 hover:bg-muted/50 rounded-lg transition-colors"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wide flex-1 text-left ${meta.text}`}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                  {isCollapsed
                    ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  }
                </button>

                {/* Election rows */}
                {!isCollapsed && (
                  <div className="space-y-1 mb-2">
                    {items.map((e) => {
                      const isSelected = e.id === selectedElectionId;
                      const isFinal = Boolean(e.is_final);
                      const isArchived = Boolean(e.is_archived);
                      const isVisible = !Boolean(e.is_paused);

                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedElectionId(e.id)}
                          className={[
                            "group rounded-xl border p-3 cursor-pointer transition-colors",
                            isSelected
                              ? "border-primary/40 bg-primary/5"
                              : "hover:bg-muted/40",
                          ].join(" ")}
                        >
                          {/* Title row */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-medium text-sm leading-snug flex-1 line-clamp-2">
                              {e.title}
                            </div>
                            {/* Hover actions */}
                            <div
                              className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {!isFinal && !isArchived && (
                                <>
                                  <IconBtn title="Edit" onClick={() => openEditElection(e)} disabled={saving}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </IconBtn>
                                  <IconBtn title="Delete" onClick={() => deleteElection(e.id)} disabled={saving} destructive>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </IconBtn>
                                </>
                              )}
                              {isFinal && !isArchived && (
                                <IconBtn title="Archive" onClick={() => openArchiveElection(e)} disabled={saving}>
                                  <Archive className="h-3.5 w-3.5" />
                                </IconBtn>
                              )}
                              {isArchived && (
                                <IconBtn title="Restore" onClick={() => openRestoreElection(e)} disabled={saving}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </IconBtn>
                              )}
                            </div>
                          </div>

                          {/* Date + meta row */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {formatDateTimeShort(e.start_date)}
                            </span>
                            {audienceBadge(e)}
                            {!isFinal && !isArchived && (
                              <button
                                onClick={(ev) => { ev.stopPropagation(); toggleElectionActive(e, !isVisible); }}
                                disabled={saving}
                                className={[
                                  "text-xs font-medium rounded-md px-2 py-0.5 transition-colors border",
                                  isVisible
                                    ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                    : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100",
                                ].join(" ")}
                              >
                                {isVisible ? "Visible" : "Hidden"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
