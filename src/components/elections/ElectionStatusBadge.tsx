import { Badge } from "@/components/ui/badge";

type ElectionLike = {
  start_date: string;
  end_date: string;
  is_active?: boolean | null;
  is_archived?: boolean | null;
  is_final?: boolean | null;
};

/**
 * ElectionStatusBadge
 *
 * Lifecycle priority (highest → lowest):
 * 1) Archived
 * 2) Finalized
 * 3) Finished (time-ended)
 * 4) Inactive (disabled by admin, but not finished)
 * 5) Time window (Live / Upcoming / Closed)
 *
 * Invalid/missing dates fail CLOSED (we never show Live/Upcoming if dates are malformed).
 */
export const ElectionStatusBadge = ({ election }: { election: ElectionLike }) => {
  const nowMs = Date.now();

  const parseMs = (value: string): number | null => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };

  const startMs = parseMs(election.start_date);
  const endMs = parseMs(election.end_date);

  const isArchived = Boolean(election?.is_archived);
  const isFinal = Boolean(election?.is_final);

  // IMPORTANT: Only treat explicit `false` as inactive.
  // - undefined means older callers that don't pass is_active → fall back to time-based status.
  // - null is treated as "unknown" → also fall back to time-based status.
  const isInactive = election.is_active === false;

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none";

  const Dot = ({ className }: { className: string }) => (
    <span className={`h-1.5 w-1.5 rounded-full ${className}`} aria-hidden="true" />
  );

  if (isArchived) {
    return (
      <Badge variant="outline" className={`${base} border-amber-300 bg-amber-50/70 text-amber-800`}>
        <Dot className="bg-amber-500" />
        Archived
      </Badge>
    );
  }

  if (isFinal) {
    return (
      <Badge variant="outline" className={`${base} border-violet-300 bg-violet-50/70 text-violet-800`}>
        <Dot className="bg-violet-500" />
        Finalized
      </Badge>
    );
  }

  // Malformed dates: fail closed.
  if (startMs === null || endMs === null) {
    return (
      <Badge variant="outline" className={`${base} border-rose-300 bg-rose-50/70 text-rose-800`}>
        <Dot className="bg-rose-500" />
        Closed
      </Badge>
    );
  }

  const isFinished = nowMs > endMs;
  if (isFinished) {
    return (
      <Badge variant="outline" className={`${base} border-rose-300 bg-rose-50/70 text-rose-800`}>
        <Dot className="bg-rose-500" />
        Finished
      </Badge>
    );
  }

  // Admin-disabled elections should not show as Live/Upcoming while they are not finished.
  if (isInactive) {
    return (
      <Badge variant="outline" className={`${base} border-slate-300 bg-slate-50/70 text-slate-800`}>
        <Dot className="bg-slate-500" />
        Inactive
      </Badge>
    );
  }

  const isOngoing = nowMs >= startMs && nowMs <= endMs;
  if (isOngoing) {
    return (
      <Badge variant="outline" className={`${base} border-emerald-300 bg-emerald-50/70 text-emerald-800`}>
        <Dot className="bg-emerald-500" />
        Live
      </Badge>
    );
  }

  const isUpcoming = nowMs < startMs;
  if (isUpcoming) {
    return (
      <Badge variant="outline" className={`${base} border-blue-300 bg-blue-50/70 text-blue-800`}>
        <Dot className="bg-blue-500" />
        Upcoming
      </Badge>
    );
  }

  // Fallback (should be unreachable if dates are valid, but keep UI stable)
  return (
    <Badge variant="outline" className={`${base} border-rose-300 bg-rose-50/70 text-rose-800`}>
      <Dot className="bg-rose-500" />
      Closed
    </Badge>
  );
};
