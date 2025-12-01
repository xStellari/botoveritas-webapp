import { Badge } from "@/components/ui/badge";

export const ElectionStatusBadge = ({ election }: { election: any }) => {
  const now = new Date();
  const start = new Date(election.start_date);
  const end = new Date(election.end_date);

  const isActive = election.is_active && now >= start && now <= end;
  const isUpcoming = now < start;
  const isInactive = now > end;

  if (isActive) {
    return (
      <Badge variant="outline" className="text-primary border-primary">
        Active
      </Badge>
    );
  }

  if (isUpcoming) {
    return (
      <Badge
        variant="outline"
        className="text-blue-600 border-blue-600"
      >
        Upcoming
      </Badge>
    );
  }

  if (isInactive) {
    return (
      <Badge
        variant="outline"
        className="text-destructive border-destructive"
      >
        Inactive
      </Badge>
    );
  }

  return null;
};
