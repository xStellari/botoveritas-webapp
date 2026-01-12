import { Badge } from "@/components/ui/badge";

export const ElectionStatusBadge = ({ election }: { election: any }) => {
  const now = Date.now();
  const start = new Date(election.start_date).getTime();
  const end = new Date(election.end_date).getTime();

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
        Closed
      </Badge>
    );
  }

  return null;
};
