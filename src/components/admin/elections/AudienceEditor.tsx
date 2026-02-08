import type { Dispatch, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import type { ElectionFormState, OrganizationRow } from "./types";

type Props = {
  audienceEditable: boolean;

  eForm: ElectionFormState;
  setEForm: Dispatch<SetStateAction<ElectionFormState>>;

  orgOptionsLoading: boolean;
  orgOptions: OrganizationRow[];

  toggleSelectedOrg: (code: string) => void;
  removeSelectedOrg: (code: string) => void;
  addCustomOrg: () => void;

  normalizeOrgList: (codes: string[]) => string[];
  getOrgLabel: (code: string) => string;
};

export function AudienceEditor(props: Props) {
  const {
    audienceEditable,
    eForm,
    setEForm,
    orgOptionsLoading,
    orgOptions,
    toggleSelectedOrg,
    removeSelectedOrg,
    addCustomOrg,
    normalizeOrgList,
    getOrgLabel,
  } = props;

  return (
    <div className="rounded-2xl border p-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold">Election audience</div>
                <div className="text-xs text-muted-foreground">
                  Controls who can participate in this election.
                </div>
              </div>

              {!audienceEditable ? (
                <Badge variant="outline" className="text-xs">
                  Audience locked (upcoming-only)
                </Badge>
              ) : null}
            </div>

            {!audienceEditable ? (
              <div className="rounded-xl border border-amber-600/30 bg-amber-600/5 p-3 text-sm">
                <div className="font-medium text-amber-900">
                  Audience editing is disabled
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Audience can only be edited for upcoming/scheduled
                  elections (not active/ongoing), and only when not finalized
                  and not archived.
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label>Voter audience</Label>
              <Select
                value={eForm.voter_audience}
                onValueChange={(v) =>
                  setEForm((p) => ({
                    ...p,
                    voter_audience: v as VoterAudience,
                  }))
                }
                disabled={!audienceEditable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select audience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="students">Students</SelectItem>
                  <SelectItem value="employees">Employees</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="font-semibold">Allow all organizations</div>
                <div className="text-xs text-muted-foreground">
                  If enabled, all orgs can vote. If disabled, restrict voting
                  to the selected orgs only.
                </div>
              </div>
              <Switch
                checked={eForm.allow_all_orgs}
                disabled={!audienceEditable}
                onCheckedChange={(v) =>
                  setEForm((p) => ({
                    ...p,
                    allow_all_orgs: v,
                    eligible_orgs_selected: v ? [] : p.eligible_orgs_selected,
                    custom_org_input: v ? "" : p.custom_org_input,
                  }))
                }
              />
            </div>

            {eForm.allow_all_orgs ? (
              <div className="text-xs text-muted-foreground">
                Eligible orgs: <span className="italic">all</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Label>Select eligible orgs</Label>

                  {orgOptionsLoading ? (
                    <div className="text-xs text-muted-foreground">
                      Loading organizations…
                    </div>
                  ) : orgOptions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No organizations loaded. You can still add custom org
                      codes below.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {orgOptions.map((o) => {
                        const selected = (eForm.eligible_orgs_selected || []).includes(
                          o.code
                        );
                        return (
                          <Button
                            key={o.code}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            onClick={() => toggleSelectedOrg(o.code)}
                            disabled={!audienceEditable}
                          >
                            {o.code}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Stored as <code>eligible_orgs</code> org codes (e.g., SCC
                    / ICpEP / HonSoc).
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Selected orgs</Label>
                  {(eForm.eligible_orgs_selected || []).length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">
                      None selected yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {normalizeOrgList(eForm.eligible_orgs_selected || []).map(
                        (code) => (
                          <Badge
                            key={code}
                            variant="secondary"
                            className="inline-flex items-center gap-2"
                          >
                            <span className="font-medium">{code}</span>
                            <span className="text-muted-foreground">
                              ({getOrgLabel(code)})
                            </span>
                            <button
                              type="button"
                              className="ml-1 rounded-sm px-1 text-xs hover:bg-muted"
                              onClick={() => removeSelectedOrg(code)}
                              disabled={!audienceEditable}
                              aria-label={`Remove ${code}`}
                            >
                              ×
                            </button>
                          </Badge>
                        )
                      )}
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>Add custom org code</Label>
                  <div className="flex gap-2">
                    <Input
                      value={eForm.custom_org_input}
                      onChange={(e) =>
                        setEForm((p) => ({
                          ...p,
                          custom_org_input: e.target.value,
                        }))
                      }
                      placeholder="e.g., ENGSC"
                      disabled={!audienceEditable}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomOrg();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addCustomOrg}
                      disabled={!audienceEditable}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use this only if the org isn’t in the list above.
                  </div>
                </div>
              </div>
            )}
          </div>
  );
}
