import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OrganizationRow = {
  code: string;
  name: string;
  is_open: boolean | null;
  created_at?: string | null;
};

export function useOrganizations() {
  const [orgOptions, setOrgOptions] = useState<OrganizationRow[]>([]);
  const [orgOptionsLoading, setOrgOptionsLoading] = useState(false);

  const reloadOrganizations = useCallback(async () => {
    setOrgOptionsLoading(true);

    const { data, error } = await supabase
      .from("organizations")
      .select("code,name,is_open,created_at")
      .order("name", { ascending: true });

    if (error) {
      // Non-blocking: elections management can still work without picker data.
      console.warn("Failed to load organizations:", error);
      setOrgOptions([]);
      setOrgOptionsLoading(false);
      return;
    }

    setOrgOptions((data as OrganizationRow[]) || []);
    setOrgOptionsLoading(false);
  }, []);

  useEffect(() => {
    reloadOrganizations();
  }, [reloadOrganizations]);

  return { orgOptions, orgOptionsLoading, reloadOrganizations };
}
