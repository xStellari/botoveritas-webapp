import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type OrgRow = {
  code: string;
  name: string;
  is_open: boolean;
  created_at: string;
};

type OrgMemberRow = {
  id: string;
  org_code: string;
  full_name: string;
  full_name_norm: string;
  source: string | null;
  created_at: string;
};

type EmployeeRow = {
  id: string;
  email: string;
  email_norm?: string | null;
  full_name?: string | null; // optional (only if your table has it)
  created_at?: string | null;
};

function normalizeLine(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function parseLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((l) => normalizeLine(l))
    .filter(Boolean);
}

/**
 * Accept formats:
 *  - "email@feualabang.edu.ph"
 *  - "email@feualabang.edu.ph, Full Name"
 *  - "email@feualabang.edu.ph | Full Name"
 */
function parseEmployeeLines(raw: string) {
  const lines = parseLines(raw);
  return lines
    .map((line) => {
      const parts = line.includes("|")
        ? line.split("|").map((x) => normalizeLine(x))
        : line.split(",").map((x) => normalizeLine(x));

      const email = (parts[0] ?? "").trim();
      const full_name = (parts[1] ?? "").trim();

      if (!email || !email.includes("@")) return null;

      return {
        email,
        full_name: full_name || null,
      };
    })
    .filter(Boolean) as { email: string; full_name: string | null }[];
}

export default function RostersManagement() {
  // ----------------------------
  // Organizations
  // ----------------------------
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>("");

  // ----------------------------
  // Org member roster UI
  // ----------------------------
  const [orgMemberLoading, setOrgMemberLoading] = useState(false);
  const [orgMemberRows, setOrgMemberRows] = useState<OrgMemberRow[]>([]);
  const [orgMemberSearch, setOrgMemberSearch] = useState("");
  const [orgMemberPaste, setOrgMemberPaste] = useState("");
  const [orgMemberSource, setOrgMemberSource] = useState("Admin import");

  const [orgMemberBusy, setOrgMemberBusy] = useState(false);

  // ----------------------------
  // Employee registry UI
  // ----------------------------
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeRows, setEmployeeRows] = useState<EmployeeRow[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePaste, setEmployeePaste] = useState("");
  const [employeeBusy, setEmployeeBusy] = useState(false);

  // If your employee_registry table has NO full_name column, keep this OFF.
  const [employeeIncludeNames, setEmployeeIncludeNames] = useState(true);

  // ----------------------------
  // Loaders
  // ----------------------------
  const loadOrganizations = async () => {
    setOrgsLoading(true);
    const { data, error } = await supabase
      .from("organizations")
      .select("code, name, is_open, created_at")
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      toast.error("Failed to load organizations.");
      setOrgs([]);
    } else {
      setOrgs((data as any) || []);
      // Auto-select first org if nothing selected
      if (!selectedOrg && data && data.length > 0) {
        setSelectedOrg((data as any)[0].code);
      }
    }
    setOrgsLoading(false);
  };

  const loadOrgMembers = async (orgCode: string) => {
    if (!orgCode) return;
    setOrgMemberLoading(true);

    const { data, error } = await supabase
      .from("org_member_names")
      .select("id, org_code, full_name, full_name_norm, source, created_at")
      .eq("org_code", orgCode)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("Failed to load org roster.");
      setOrgMemberRows([]);
    } else {
      setOrgMemberRows((data as any) || []);
    }

    setOrgMemberLoading(false);
  };

  const loadEmployees = async () => {
    setEmployeeLoading(true);

    // NOTE: we select full_name optionally (won't break if column exists).
    // If your table doesn't have full_name, Supabase will error.
    // If you hit that, tell me and I'll adjust to select only email fields.
    const { data, error } = await supabase
      .from("employee_registry")
      .select("id, email, email_norm, full_name, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error(
        "Failed to load employee registry. If your table has no full_name column, tell me and I’ll adjust the select()."
      );
      setEmployeeRows([]);
    } else {
      setEmployeeRows((data as any) || []);
    }

    setEmployeeLoading(false);
  };

  useEffect(() => {
    void loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedOrg) return;
    void loadOrgMembers(selectedOrg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg]);

  useEffect(() => {
    void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------
  // Derived UI lists
  // ----------------------------
  const selectedOrgName = useMemo(() => {
    const o = orgs.find((x) => x.code === selectedOrg);
    return o ? `${o.name} (${o.code})` : selectedOrg;
  }, [orgs, selectedOrg]);

  const filteredOrgMembers = useMemo(() => {
    const q = orgMemberSearch.trim().toLowerCase();
    if (!q) return orgMemberRows;
    return orgMemberRows.filter((r) => {
      return (
        r.full_name?.toLowerCase().includes(q) ||
        r.full_name_norm?.toLowerCase().includes(q) ||
        r.source?.toLowerCase().includes(q)
      );
    });
  }, [orgMemberRows, orgMemberSearch]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeeRows;
    return employeeRows.filter((r) => {
      return (
        r.email?.toLowerCase().includes(q) ||
        (r.email_norm ?? "").toLowerCase().includes(q) ||
        (r.full_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [employeeRows, employeeSearch]);

  // ----------------------------
  // Actions: Org roster
  // ----------------------------
  const addOrgMembers = async () => {
    if (!selectedOrg) {
      toast.error("Select an organization first.");
      return;
    }

    const lines = parseLines(orgMemberPaste);
    if (lines.length === 0) {
      toast.error("Paste at least one name.");
      return;
    }

    // Dedupe in this payload
    const unique = Array.from(new Set(lines.map((x) => x.toLowerCase()))).map((lc) => {
      const original = lines.find((x) => x.toLowerCase() === lc) ?? lc;
      return original;
    });

    setOrgMemberBusy(true);
    try {
      const payload = unique.map((name) => ({
        org_code: selectedOrg,
        full_name: name,
        source: orgMemberSource.trim() || null,
      }));

      const { error } = await supabase.from("org_member_names").insert(payload as any);

      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      toast.success(`Imported ${unique.length} member(s) to ${selectedOrg}.`);
      setOrgMemberPaste("");
      await loadOrgMembers(selectedOrg);
    } finally {
      setOrgMemberBusy(false);
    }
  };

  const deleteOrgMember = async (rowId: string) => {
    if (!confirm("Delete this roster entry?")) return;

    const { error } = await supabase.from("org_member_names").delete().eq("id", rowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted roster entry.");
    await loadOrgMembers(selectedOrg);
  };

  const clearOrgRoster = async () => {
    if (!selectedOrg) return;
    if (!confirm(`Delete ALL roster entries for ${selectedOrg}?`)) return;

    setOrgMemberBusy(true);
    try {
      const { error } = await supabase.from("org_member_names").delete().eq("org_code", selectedOrg);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Cleared roster for ${selectedOrg}.`);
      await loadOrgMembers(selectedOrg);
    } finally {
      setOrgMemberBusy(false);
    }
  };

  // ----------------------------
  // Actions: Employee registry
  // ----------------------------
  const addEmployees = async () => {
    const parsed = parseEmployeeLines(employeePaste);
    if (parsed.length === 0) {
      toast.error("Paste at least one email.");
      return;
    }

    // Dedupe by email_norm-ish behavior
    const map = new Map<string, { email: string; full_name: string | null }>();
    for (const p of parsed) {
      map.set(p.email.trim().toLowerCase(), p);
    }
    const unique = Array.from(map.values());

    setEmployeeBusy(true);
    try {
      // Insert only fields that are safe:
      // - always send email
      // - only send full_name if the admin wants it AND input contains it
      const payload = unique.map((x) => {
        const base: any = { email: x.email.trim() };
        if (employeeIncludeNames && x.full_name) base.full_name = x.full_name;
        return base;
      });

      const { error } = await supabase.from("employee_registry").insert(payload);

      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      toast.success(`Imported ${unique.length} employee email(s).`);
      setEmployeePaste("");
      await loadEmployees();
    } finally {
      setEmployeeBusy(false);
    }
  };

  const deleteEmployee = async (rowId: string) => {
    if (!confirm("Delete this employee registry entry?")) return;

    const { error } = await supabase.from("employee_registry").delete().eq("id", rowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted employee entry.");
    await loadEmployees();
  };

  const clearEmployeeRegistry = async () => {
    if (!confirm("Delete ALL employee registry entries?")) return;

    setEmployeeBusy(true);
    try {
      const { error } = await supabase.from("employee_registry").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Cleared employee registry.");
      await loadEmployees();
    } finally {
      setEmployeeBusy(false);
    }
  };

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-feu-green">Rosters & Eligibility Data</h2>
            <p className="text-sm text-muted-foreground">
              Manage official org membership rosters (for org elections) and employee registry
              (to exclude employees from org elections).
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => loadOrganizations()} disabled={orgsLoading}>
              Refresh Orgs
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (selectedOrg) void loadOrgMembers(selectedOrg);
                void loadEmployees();
              }}
              disabled={orgsLoading || orgMemberLoading || employeeLoading}
            >
              Refresh Lists
            </Button>
          </div>
        </div>
      </Card>

      {/* Org roster */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-lg font-semibold">Org Member Roster</div>
              {selectedOrg ? <Badge variant="outline">{selectedOrg}</Badge> : null}
            </div>
            <div className="text-sm text-muted-foreground">
              This writes to <code>org_member_names</code>. Your trigger will normalize names automatically.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Organization:</span>
            <select
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              disabled={orgsLoading}
            >
              <option value="" disabled>
                Select org…
              </option>
              {orgs.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Import */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="font-semibold">Import names</div>
            <div className="text-xs text-muted-foreground">
              Paste one full name per line (e.g., “Juan Dela Cruz”). Duplicates in the paste are auto-removed.
            </div>

            <textarea
              className="w-full min-h-[170px] rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Juan Dela Cruz&#10;Maria Santos&#10;..."
              value={orgMemberPaste}
              onChange={(e) => setOrgMemberPaste(e.target.value)}
              disabled={orgMemberBusy || orgMemberLoading || !selectedOrg}
            />

            <div className="flex flex-col md:flex-row gap-2 md:items-center">
              <Input
                placeholder="Source label (optional) e.g., 2026 official roster"
                value={orgMemberSource}
                onChange={(e) => setOrgMemberSource(e.target.value)}
                disabled={orgMemberBusy}
              />
              <Button onClick={addOrgMembers} disabled={orgMemberBusy || !selectedOrg}>
                Import
              </Button>
            </div>

            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <div>
                Selected: <span className="font-medium">{selectedOrgName}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearOrgRoster}
                disabled={orgMemberBusy || !selectedOrg}
              >
                Clear roster
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Roster entries</div>
              <Badge variant="outline">{filteredOrgMembers.length}</Badge>
            </div>

            <Input
              placeholder="Search name/source…"
              value={orgMemberSearch}
              onChange={(e) => setOrgMemberSearch(e.target.value)}
              disabled={orgMemberLoading}
            />

            <div className="rounded-md border max-h-[320px] overflow-auto">
              {orgMemberLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading roster…</div>
              ) : filteredOrgMembers.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No roster entries for this org.</div>
              ) : (
                <div className="divide-y">
                  {filteredOrgMembers.map((r) => (
                    <div key={r.id} className="p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.source ? `Source: ${r.source}` : "Source: —"} • {new Date(r.created_at).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteOrgMember(r.id)}
                        disabled={orgMemberBusy}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Employee registry */}
      <Card className="p-4 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">Employee Registry</div>
            <Badge variant="outline">{filteredEmployees.length}</Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            This writes to <code>employee_registry</code>. The DB trigger keeps <code>email_norm</code> consistent.
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Import */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="font-semibold">Import employee emails</div>
            <div className="text-xs text-muted-foreground">
              Paste one per line:
              <div className="mt-1">
                <span className="font-medium">email</span>
                {"  "}or{"  "}
                <span className="font-medium">email, Full Name</span>
              </div>
            </div>

            <textarea
              className="w-full min-h-[170px] rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={"employee@feualabang.edu.ph\nemployee2@feualabang.edu.ph, Juan Dela Cruz\n..."}
              value={employeePaste}
              onChange={(e) => setEmployeePaste(e.target.value)}
              disabled={employeeBusy}
            />

            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={employeeIncludeNames}
                  onChange={(e) => setEmployeeIncludeNames(e.target.checked)}
                />
                Include names if provided (requires <code>full_name</code> column)
              </label>

              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={clearEmployeeRegistry} disabled={employeeBusy}>
                  Clear registry
                </Button>
                <Button onClick={addEmployees} disabled={employeeBusy}>
                  Import
                </Button>
              </div>
            </div>
          </div>

          {/* List */}
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Employee entries</div>
              <Badge variant="outline">{employeeRows.length}</Badge>
            </div>

            <Input
              placeholder="Search email/name…"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              disabled={employeeLoading}
            />

            <div className="rounded-md border max-h-[320px] overflow-auto">
              {employeeLoading ? (
                <div className="p-3 text-sm text-muted-foreground">Loading employees…</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">No employee entries yet.</div>
              ) : (
                <div className="divide-y">
                  {filteredEmployees.map((r) => (
                    <div key={r.id} className="p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.email}</div>
                        {r.full_name ? (
                          <div className="text-xs text-muted-foreground truncate">{r.full_name}</div>
                        ) : (
                          <div className="text-xs text-muted-foreground truncate">—</div>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteEmployee(r.id)}
                        disabled={employeeBusy}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Next step: we will enforce “employees cannot vote for org elections” in the eligibility RPC.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
