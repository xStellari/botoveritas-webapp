import { Badge } from "@/components/ui/badge";

type ElectionLike = {
  start_date: string;
  end_date: string;
  is_archived?: boolean | null;
  is_final?: boolean | null;
};

/**
 * ElectionStatusBadge
 *
 * Visual goals (kiosk/landing):
 * - Consistent height + padding
 * - Small status dot for faster scanning at distance
 * - Subtle tinted background (still "outline" badge)
 *
 * Lifecycle rules:
 * - Archived or Finalized always overrides time window
 */
export const ElectionStatusBadge = ({ election }: { election: ElectionLike }) => {
  const now = Date.now();
  const start = new Date(election.start_date).getTime();
  const end = new Date(election.end_date).getTime();

  const isArchived = Boolean(election?.is_archived);
  const isFinal = Boolean(election?.is_final);

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none";

  const Dot = ({ className }: { className: string }) => (
    <span className={`h-1.5 w-1.5 rounded-full ${className}`} aria-hidden="true" />
  );

  // ✅ Strict lifecycle override:
  // If election is archived OR finalized, it must NEVER show as Live/Upcoming
  // even if the current time is still inside the date window.
  if (isArchived) {
    return (
      <Badge
        variant="outline"
        className={`${base} border-amber-300 bg-amber-50/70 text-amber-800`}
      >
        <Dot className="bg-amber-500" />
        Archived
      </Badge>
    );
  }

  if (isFinal) {
    return (
      <Badge
        variant="outline"
        className={`${base} border-violet-300 bg-violet-50/70 text-violet-800`}
      >
        <Dot className="bg-violet-500" />
        Finalized
      </Badge>
    );
  }

  const isUpcoming = now < start;
  const isOngoing = now >= start && now <= end;
  const isClosed = now > end;

  if (isOngoing) {
    return (
      <Badge
        variant="outline"
        className={`${base} border-emerald-300 bg-emerald-50/70 text-emerald-800`}
      >
        <Dot className="bg-emerald-500" />
        Live
      </Badge>
    );
  }

  if (isUpcoming) {
    return (
      <Badge
        variant="outline"
        className={`${base} border-blue-300 bg-blue-50/70 text-blue-800`}
      >
        <Dot className="bg-blue-500" />
        Upcoming
      </Badge>
    );
  }

  if (isClosed) {
    return (
      <Badge
        variant="outline"
        className={`${base} border-rose-300 bg-rose-50/70 text-rose-800`}
      >
        <Dot className="bg-rose-500" />
        Closed
      </Badge>
    );
  }

  return null;
};
