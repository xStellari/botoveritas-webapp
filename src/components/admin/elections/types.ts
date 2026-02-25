export type VoterAudience = "students" | "associates" | "mixed";

export type ElectionFormState = {
  title: string;
  description: string;
  startLocal: string;
  endLocal: string;
  is_active: boolean;
  is_paused: boolean;
  voter_audience: VoterAudience;
  allow_all_orgs: boolean;
  eligible_orgs_selected: string[];
  custom_org_input: string;
};

export type OrganizationRow = {
  code: string;
  name: string;
  is_open: boolean | null;
  created_at?: string | null;
};
