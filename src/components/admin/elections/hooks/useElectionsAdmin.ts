import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ElectionRow = {
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

  created_at?: string | null;
  updated_at?: string | null;
};

type Params = {
  selectedElectionId: string | null;
  setSelectedElectionId: (id: string | null) => void;
};

export function useElectionsAdmin({ selectedElectionId, setSelectedElectionId }: Params) {
  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [electionsLoading, setElectionsLoading] = useState(true);

  const reloadElections = useCallback(async () => {
    setElectionsLoading(true);

    const { data, error } = await supabase
      .from("elections")
      .select("*")
      .order("start_date", { ascending: true });

    if (error) {
      toast.error(`Failed to load elections: ${error.message}`);
      setElectionsLoading(false);
      return;
    }

    const rows = (data as ElectionRow[]) || [];
    setElections(rows);
    setElectionsLoading(false);

    if (!selectedElectionId && rows.length > 0) {
      const firstNonArchived = rows.find((x) => !x.is_archived) ?? rows[0];
      setSelectedElectionId(firstNonArchived?.id ?? null);
    }
  }, [selectedElectionId, setSelectedElectionId]);

  useEffect(() => {
    reloadElections();
  }, [reloadElections]);

  return { elections, setElections, electionsLoading, reloadElections };
}
