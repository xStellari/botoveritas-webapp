export const sortElections = (elections: any[]) => {
  const now = new Date();

  const isArchived = (e: any) => Boolean(e?.is_archived);
  const isFinal = (e: any) => Boolean(e?.is_final);
  const isLifecycleClosed = (e: any) => isFinal(e) || isArchived(e);

  const isActive = (e: any) => {
    const start = new Date(e.start_date);
    const end = new Date(e.end_date);

    // ✅ STRICT: must be admin-active AND inside time window AND NOT lifecycle-closed
    return (
      Boolean(e?.is_active) &&
      !isLifecycleClosed(e) &&
      now >= start &&
      now <= end
    );
  };

  const isUpcoming = (e: any) => {
    const start = new Date(e.start_date);

    // ✅ STRICT: upcoming should also respect admin-active AND lifecycle (no finalized/archived)
    // This prevents a finalized/archived election from being sorted as "upcoming"
    // and prevents inactive elections from being promoted above closed.
    return Boolean(e?.is_active) && !isLifecycleClosed(e) && now < start;
  };

  const isTimeEnded = (e: any) => {
    const end = new Date(e.end_date);
    return now > end;
  };

  const bucketRank = (e: any) => {
    // 1) Active (best)
    if (isActive(e)) return 1;

    // 2) Upcoming
    if (isUpcoming(e)) return 2;

    // 5) Archived (always last)
    if (isArchived(e)) return 5;

    // 3) Finalized (closed early or after end)
    if (isFinal(e)) return 3;

    // 4) Time-ended (not final, not archived)
    if (isTimeEnded(e)) return 4;

    // Fallback (rare): treat as time-ended-ish
    return 4;
  };

  const closedSortKeyDesc = (e: any) => {
    // For ordering inside closed buckets (DESC: newest first)
    // Archived bucket: archived_at (fallback updated_at/end_date)
    if (isArchived(e))
      return new Date(e.archived_at ?? e.updated_at ?? e.end_date).getTime();

    // Finalized bucket: finalized_at (fallback updated_at/end_date)
    if (isFinal(e))
      return new Date(e.finalized_at ?? e.updated_at ?? e.end_date).getTime();

    // Time-ended bucket: end_date
    return new Date(e.end_date).getTime();
  };

  return elections.sort((a, b) => {
    const rankA = bucketRank(a);
    const rankB = bucketRank(b);

    // Primary: bucket priority
    if (rankA !== rankB) return rankA - rankB;

    // Bucket-specific ordering:
    // Active: soonest end first (urgent/ending elections first)
    if (rankA === 1) {
      const endA = new Date(a.end_date).getTime();
      const endB = new Date(b.end_date).getTime();
      return endA - endB;
    }

    // Upcoming: soonest start first
    if (rankA === 2) {
      const startA = new Date(a.start_date).getTime();
      const startB = new Date(b.start_date).getTime();
      return startA - startB;
    }

    // Closed/Finalized/Archived: newest "closure moment" first
    const closedA = closedSortKeyDesc(a);
    const closedB = closedSortKeyDesc(b);
    if (closedA !== closedB) return closedB - closedA;

    // Stable fallback: start_date newest first
    const startA = new Date(a.start_date).getTime();
    const startB = new Date(b.start_date).getTime();
    return startB - startA;
  });
};
