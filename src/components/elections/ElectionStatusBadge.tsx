import { Badge } from "@/components/ui/badge";

export const ElectionStatusBadge = ({ election }: { election: any }) => {
  const now = Date.now();
  const start = new Date(election.start_date).getTime();
  const end = new Date(election.end_date).getTime();

  const isArchived = Boolean(election?.is_archived);
  const isFinal = Boolean(election?.is_final);

  // ✅ Strict lifecycle override:
  // If election is archived OR finalized, it must NEVER show as Ongoing/Upcoming
  // even if the current time is still inside the date window.
  if (isArchived) {
    return (
      <Badge variant="outline" className="text-amber-700 border-amber-600">
        Finished (Archived)
      </Badge>
    );
  }

  if (isFinal) {
    return (
      <Badge variant="outline" className="text-violet-700 border-violet-600">
        Finished (Finalized)
      </Badge>
    );
  }

  const isUpcoming = now < start;
  const isOngoing = now >= start && now <= end;
  const isClosed = now > end;

  if (isOngoing) {
    return (
      <Badge variant="outline" className="text-primary border-primary">
        Ongoing
      </Badge>
    );
  }

  if (isUpcoming) {
    return (
      <Badge variant="outline" className="text-blue-600 border-blue-600">
        Upcoming
      </Badge>
    );
  }

  if (isClosed) {
    return (
      <Badge variant="outline" className="text-destructive border-destructive">
        Finished
      </Badge>
    );
  }

  return null;
};
