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
  full_name: string;
  full_name_norm: string;
  source: string | null;
  created_at: string;
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
 * Basic name normalization for client-side de-dupe.
 * (DB trigger will compute the authoritative *_norm.)
 */
function normNameClient(s: string) {
  return normalizeLine(s).toLowerCase();
}

/**
 * Very small CSV reader: returns the first column for each row.
 * - Supports quoted first cell.
 * - Skips empty rows.
 * - Skips common headers (name, full_name, member, etc).
 */
function parseCsvFirstColumn(raw: string) {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    let cell = "";
    if (line.startsWith("\"")) {
      // Read first quoted cell, supporting escaped quotes ("").
      let i = 1;
      while (i < line.length) {
        const ch = line[i];
        if (ch === "\"" && line[i + 1] === "\"") {
          cell += "\"";
          i += 2;
          continue;
        }
        if (ch === "\"") break;
        cell += ch;
        i++;
      }
    } else {
      cell = line.split(",")[0] ?? "";
    }

    const v = normalizeLine(cell);
    if (!v) continue;

    const header = v.toLowerCase();
    if (
      [
        "name",
        "full name",
        "full_name",
        "member",
        "member name",
        "employee",
        "employee name",
      ].includes(header)
    ) {
      continue;
    }

    out.push(v);
  }

  return out;
}

function dedupeNames(names: string[]) {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const n of names) {
    const k = normNameClient(n);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  return uniq;
}

function initials(name: string) {
  const parts = normalizeLine(name).split(" ").filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const out = (a + b).toUpperCase();
  return out || "•";
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 md:flex-none px-4 py-2 text-sm rounded-xl transition",
        active
          ? "bg-feu-green text-white shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function CsvPreview({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border bg-muted/30 p-3 text-xs">
      <div className="font-medium">Preview ({items.length})</div>
      <div className="mt-2 max-h-[140px] overflow-auto space-y-1">
        {items.slice(0, 12).map((n, idx) => (
          <div key={idx} className="truncate">
            {n}
          </div>
        ))}
        {items.length > 12 ? (
          <div className="text-muted-foreground">
            +{items.length - 12} more…
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function RostersManagement() {
  // ----------------------------
  // Organizations
  // ----------------------------
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [activePanel, setActivePanel] = useState<"org" | "employees">("org");

  // ----------------------------
  // Org member roster UI
  // ----------------------------
  const [orgMemberLoading, setOrgMemberLoading] = useState(false);
  const [orgMemberRows, setOrgMemberRows] = useState<OrgMemberRow[]>([]);
  const [orgMemberSearch, setOrgMemberSearch] = useState("");
  const [orgMemberPaste, setOrgMemberPaste] = useState("");
  const [orgMemberSource, setOrgMemberSource] = useState("Admin import");
  const [orgMemberBusy, setOrgMemberBusy] = useState(false);

  const [orgMemberCsvFile, setOrgMemberCsvFile] = useState<File | null>(null);
  const [orgMemberCsvPreview, setOrgMemberCsvPreview] = useState<string[]>([]);

  // ----------------------------
  // Employee registry (name-only) UI
  // ----------------------------
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeRows, setEmployeeRows] = useState<EmployeeRow[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePaste, setEmployeePaste] = useState("");
  const [employeeBusy, setEmployeeBusy] = useState(false);

  const [employeeCsvFile, setEmployeeCsvFile] = useState<File | null>(null);
  const [employeeCsvPreview, setEmployeeCsvPreview] = useState<string[]>([]);
  const [employeeSource, setEmployeeSource] = useState("Admin import");

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

    // Name-only registry lives in employee_names (Option A).
    // Cast table name to any to avoid typegen drift until you regenerate Supabase types.
    const { data, error } = await supabase
      .from("employee_names" as any)
      .select("id, full_name, full_name_norm, source, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("Failed to load employee names registry.");
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
        (r.full_name ?? "").toLowerCase().includes(q) ||
        (r.full_name_norm ?? "").toLowerCase().includes(q) ||
        (r.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [orgMemberRows, orgMemberSearch]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeeRows;
    return employeeRows.filter((r) => {
      const a = (r.full_name ?? "").toLowerCase();
      const b = (r.full_name_norm ?? "").toLowerCase();
      const c = (r.source ?? "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [employeeRows, employeeSearch]);

  // ----------------------------
  // CSV readers
  // ----------------------------
  const readOrgMemberCsv = async (file: File) => {
    const text = await file.text();
    const names = parseCsvFirstColumn(text);
    setOrgMemberCsvPreview(dedupeNames(names));
  };

  const readEmployeeCsv = async (file: File) => {
    const text = await file.text();
    const names = parseCsvFirstColumn(text);
    setEmployeeCsvPreview(dedupeNames(names));
  };

  // ----------------------------
  // Actions: Org roster
  // ----------------------------
  const addOrgMembers = async () => {
    if (!selectedOrg) {
      toast.error("Select an organization first.");
      return;
    }

    const fromCsv = orgMemberCsvPreview.length > 0 ? orgMemberCsvPreview : [];
    const fromPaste = orgMemberPaste ? parseLines(orgMemberPaste) : [];
    const combined = fromCsv.length > 0 ? fromCsv : fromPaste;

    if (combined.length === 0) {
      toast.error("Add at least one member name (CSV or paste).");
      return;
    }

    const unique = dedupeNames(combined);

    setOrgMemberBusy(true);
    try {
      const payload = unique.map((name) => ({
        org_code: selectedOrg,
        full_name: name,
        source: normalizeLine(orgMemberSource) || null,
      }));

      const { error } = await supabase.from("org_member_names").insert(payload as any);

      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      toast.success(`Imported ${unique.length} member(s) to ${selectedOrg}.`);
      setOrgMemberPaste("");
      setOrgMemberCsvFile(null);
      setOrgMemberCsvPreview([]);
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
  // Actions: Employee registry (name-only)
  // ----------------------------
  const addEmployees = async () => {
    const fromCsv = employeeCsvPreview.length > 0 ? employeeCsvPreview : [];
    const fromPaste = employeePaste ? parseLines(employeePaste) : [];
    const combined = fromCsv.length > 0 ? fromCsv : fromPaste;

    if (combined.length === 0) {
      toast.error("Add at least one employee name (CSV or paste).");
      return;
    }

    const unique = dedupeNames(combined);

    setEmployeeBusy(true);
    try {
      const payload = unique.map((full_name) => ({
        full_name,
        source: normalizeLine(employeeSource) || null,
      }));

      const { error } = await supabase.from("employee_names" as any).insert(payload as any);
      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      toast.success(`Imported ${unique.length} employee name(s).`);
      setEmployeePaste("");
      setEmployeeCsvFile(null);
      setEmployeeCsvPreview([]);
      await loadEmployees();
    } finally {
      setEmployeeBusy(false);
    }
  };

  const deleteEmployee = async (rowId: string) => {
    if (!confirm("Delete this employee entry?")) return;

    const { error } = await supabase.from("employee_names" as any).delete().eq("id", rowId);
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
      // Supabase delete requires at least one filter. This condition matches all rows.
      const { error } = await supabase.from("employee_names" as any).delete().not("id", "is", null);
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

  const renderOrgPanel = () => (
    <Card className="p-5 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">Org Member Roster</div>
            {selectedOrg ? <Badge variant="outline">{selectedOrg}</Badge> : null}
          </div>
          <div className="text-sm text-muted-foreground">
            Writes to <code>org_member_names</code>. Names are normalized automatically.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Organization:</span>
          <select
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
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
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Import members</div>
            <Badge variant="outline">{selectedOrg ? orgMemberRows.length : 0}</Badge>
          </div>

          <div className="text-xs text-muted-foreground">
            Upload a CSV (first column = full name) or paste one full name per line.
            Duplicates are removed client-side.
          </div>

          <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">CSV upload</div>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={orgMemberBusy || orgMemberLoading || !selectedOrg}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setOrgMemberCsvFile(f);
                setOrgMemberCsvPreview([]);
                if (f) {
                  readOrgMemberCsv(f).catch((err) => {
                    console.error(err);
                    toast.error("Failed to read CSV.");
                  });
                }
              }}
            />

            {orgMemberCsvFile ? (
              <div className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground truncate">Selected: {orgMemberCsvFile.name}</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOrgMemberCsvFile(null);
                    setOrgMemberCsvPreview([]);
                  }}
                  disabled={orgMemberBusy}
                >
                  Clear
                </Button>
              </div>
            ) : null}

            <CsvPreview items={orgMemberCsvPreview} />
          </div>

          <div className="text-xs text-muted-foreground">Paste names (optional)</div>
          <textarea
            className="w-full min-h-[160px] rounded-xl border border-border bg-background px-3 py-2 text-sm"
            placeholder={"Juan Dela Cruz\nMaria Santos\n..."}
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
        <div className="rounded-2xl border p-4 space-y-3">
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

          <div className="rounded-xl border max-h-[360px] overflow-auto">
            {orgMemberLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading roster…</div>
            ) : filteredOrgMembers.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No roster entries for this org.</div>
            ) : (
              <div className="divide-y">
                {filteredOrgMembers.map((r) => (
                  <div key={r.id} className="p-3 flex items-start justify-between gap-3 hover:bg-muted/20">
                    <div className="flex gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-xl bg-feu-green/10 flex items-center justify-center text-xs font-semibold text-feu-green">
                        {initials(r.full_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.source ? `Source: ${r.source}` : "Source: —"} •{" "}
                          {new Date(r.created_at).toLocaleString()}
                        </div>
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
  );

  const renderEmployeePanel = () => (
    <Card className="p-5 md:p-6 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold">Employee Registry</div>
          <Badge variant="outline">{filteredEmployees.length}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          Writes to <code>employee_names</code>. Names are normalized automatically.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Import */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Import employees</div>
            <Badge variant="outline">{employeeRows.length}</Badge>
          </div>

          <div className="text-xs text-muted-foreground">
            Upload a CSV (first column = full name) or paste one full name per line.
          </div>

          <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">CSV upload</div>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={employeeBusy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setEmployeeCsvFile(f);
                setEmployeeCsvPreview([]);
                if (f) {
                  readEmployeeCsv(f).catch((err) => {
                    console.error(err);
                    toast.error("Failed to read CSV.");
                  });
                }
              }}
            />

            {employeeCsvFile ? (
              <div className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground truncate">Selected: {employeeCsvFile.name}</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEmployeeCsvFile(null);
                    setEmployeeCsvPreview([]);
                  }}
                  disabled={employeeBusy}
                >
                  Clear
                </Button>
              </div>
            ) : null}

            <CsvPreview items={employeeCsvPreview} />
          </div>

          <div className="text-xs text-muted-foreground">Paste names (optional)</div>
          <textarea
            className="w-full min-h-[160px] rounded-xl border border-border bg-background px-3 py-2 text-sm"
            placeholder={"Juan Dela Cruz\nMaria Santos\n..."}
            value={employeePaste}
            onChange={(e) => setEmployeePaste(e.target.value)}
            disabled={employeeBusy}
          />

          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <Input
              placeholder="Source label (optional) e.g., HR list 2026"
              value={employeeSource}
              onChange={(e) => setEmployeeSource(e.target.value)}
              disabled={employeeBusy}
            />
            <div className="flex gap-2 md:ml-auto">
              <Button variant="destructive" onClick={clearEmployeeRegistry} disabled={employeeBusy}>
                Clear
              </Button>
              <Button onClick={addEmployees} disabled={employeeBusy}>
                Import
              </Button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Employee entries</div>
            <Badge variant="outline">{filteredEmployees.length}</Badge>
          </div>

          <Input
            placeholder="Search name/source…"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            disabled={employeeLoading}
          />

          <div className="rounded-xl border max-h-[360px] overflow-auto">
            {employeeLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading employees…</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No employee entries yet.</div>
            ) : (
              <div className="divide-y">
                {filteredEmployees.map((r) => (
                  <div key={r.id} className="p-3 flex items-start justify-between gap-3 hover:bg-muted/20">
                    <div className="flex gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-xl bg-feu-green/10 flex items-center justify-center text-xs font-semibold text-feu-green">
                        {initials(r.full_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.source ? `Source: ${r.source}` : "Source: —"} •{" "}
                          {new Date(r.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <Button variant="outline" size="sm" onClick={() => deleteEmployee(r.id)} disabled={employeeBusy}>
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Note: eligibility enforcement is server-side via <code>is_voter_eligible_for_election</code>.
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-feu-green/10 flex items-center justify-center">
                <span className="text-feu-green font-bold">BV</span>
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
                  Rosters & Eligibility
                </h2>
                <p className="text-sm text-muted-foreground">
                  Manage org rosters and employee name registry used for voter eligibility rules.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => loadOrganizations()} disabled={orgsLoading} className="justify-center">
              Refresh orgs
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (selectedOrg) void loadOrgMembers(selectedOrg);
                void loadEmployees();
              }}
              disabled={orgsLoading || orgMemberLoading || employeeLoading}
              className="justify-center"
            >
              Refresh lists
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Segmented control */}
          <div className="inline-flex w-full md:w-auto rounded-2xl border bg-background p-1">
            <SegButton active={activePanel === "org"} onClick={() => setActivePanel("org")}>
              Org roster
            </SegButton>
            <SegButton active={activePanel === "employees"} onClick={() => setActivePanel("employees")}>
              Employee registry
            </SegButton>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-2 text-xs">
            <div className="rounded-full border bg-muted/20 px-3 py-1">
              <span className="text-muted-foreground">Orgs:</span>{" "}
              <span className="font-medium">{orgs.length}</span>
            </div>
            <div className="rounded-full border bg-muted/20 px-3 py-1">
              <span className="text-muted-foreground">Roster:</span>{" "}
              <span className="font-medium">{selectedOrg ? orgMemberRows.length : 0}</span>
            </div>
            <div className="rounded-full border bg-muted/20 px-3 py-1">
              <span className="text-muted-foreground">Employees:</span>{" "}
              <span className="font-medium">{employeeRows.length}</span>
            </div>
          </div>
        </div>
      </Card>

      {activePanel === "org" ? renderOrgPanel() : renderEmployeePanel()}
    </div>
  );
}
