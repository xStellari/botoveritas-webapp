export const sortElections = (elections: any[]) => {
  const now = new Date();

  return elections.sort((a, b) => {
    const startA = new Date(a.start_date);
    const endA = new Date(a.end_date);

    const startB = new Date(b.start_date);
    const endB = new Date(b.end_date);

    const isActiveA = a.is_active && now >= startA && now <= endA;
    const isActiveB = b.is_active && now >= startB && now <= endB;

    const isUpcomingA = now < startA;
    const isUpcomingB = now < startB;

    const isInactiveA = now > endA;
    const isInactiveB = now > endB;

    // 1. Active first
    if (isActiveA !== isActiveB) return isActiveA ? -1 : 1;

    // 2. Upcoming second (soonest start first)
    if (isUpcomingA !== isUpcomingB) return isUpcomingA ? -1 : 1;

    if (isUpcomingA && isUpcomingB) {
      return startA.getTime() - startB.getTime();
    }

    // 3. Inactive last (most recent first)
    if (isInactiveA && isInactiveB) {
      return endB.getTime() - endA.getTime();
    }

    return 0;
  });
};
