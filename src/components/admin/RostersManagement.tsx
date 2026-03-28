import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SuperAdminOtpGate } from "@/components/admin/SuperAdminOtpGate";

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

type AssociateRow = {
  id: string;
  email: string;
  email_norm: string | null;
  full_name: string | null;
  source: string | null;
  created_at: string;
};

type EnrolledRow = {
  id: string;
  email: string;
  email_norm: string | null;
  full_name: string | null;
  year_level: string | null;
  is_enrolled: boolean;
  source: string | null;
  created_at: string;
};


type ParsedCsvRecord = {
  email: string;
  full_name: string | null;
  year_level: string | null;
  source_row: number;
};

type VoterLookupRow = {
  id: string;
  email: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  year_level?: string | null;
  created_at?: string | null;
};

function normalizeLine(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function buildVoterFullName(v: Pick<VoterLookupRow, "first_name" | "middle_name" | "last_name" | "suffix">) {
  // Build a consistent display name from the voters table schema.
  const parts = [v.first_name, v.middle_name ?? "", v.last_name, v.suffix ?? ""].map((x) => normalizeLine(String(x || "")));
  return normalizeLine(parts.filter(Boolean).join(" "));
}

function buildVoterRosterName(v: Pick<VoterLookupRow, "first_name" | "last_name" | "suffix">) {
  // Roster matching should mirror compute_voter_org_affiliations(): first_name + last_name (+ suffix).
  // Note: first_name in this project may already contain multiple given names.
  const parts = [v.first_name, v.last_name, v.suffix ?? ""].map((x) => normalizeLine(String(x || "")));
  return normalizeLine(parts.filter(Boolean).join(" "));
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

function normEmailClient(s: string) {
  return normalizeLine(s).toLowerCase();
}

function isValidEmail(s: string) {
  // Simple, practical validation for admin input (not RFC-perfect).
  const v = normEmailClient(s);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function dedupeEmails(emails: string[]) {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const e of emails) {
    const v = normEmailClient(e);
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    uniq.push(v);
  }
  return uniq;
}


function normalizeCsvHeader(value: string) {
  return normalizeLine(value)
    .toLowerCase()
    .replace(/[._-]+/g, " ");
}

function splitCsvRow(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells.map((cell) => normalizeLine(cell));
}

function detectHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map((alias) => normalizeCsvHeader(alias));
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function buildCsvFullName(parts: Array<string | null | undefined>) {
  const joined = parts
    .map((part) => normalizeLine(String(part || "")))
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

function parseFlexibleCsv(raw: string): ParsedCsvRecord[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const rows = lines.map(splitCsvRow);
  const headerRow = rows[0].map((cell) => normalizeCsvHeader(cell));

  const emailIndex = detectHeaderIndex(headerRow, [
    "email",
    "email address",
    "e-mail",
    "student email",
    "school email",
    "institutional email",
  ]);

  const fullNameIndex = detectHeaderIndex(headerRow, [
    "full name",
    "fullname",
    "student name",
    "name",
  ]);
  const firstNameIndex = detectHeaderIndex(headerRow, ["first name", "firstname", "given name"]);
  const middleNameIndex = detectHeaderIndex(headerRow, ["middle name", "middlename", "middle initial", "mi"]);
  const lastNameIndex = detectHeaderIndex(headerRow, ["last name", "lastname", "surname", "family name"]);
  const suffixIndex = detectHeaderIndex(headerRow, ["suffix"]);
  const yearLevelIndex = detectHeaderIndex(headerRow, ["year level", "year", "yearlevel"]);

  const hasStructuredHeaders =
    emailIndex >= 0 ||
    fullNameIndex >= 0 ||
    firstNameIndex >= 0 ||
    lastNameIndex >= 0 ||
    yearLevelIndex >= 0;

  const startRow = hasStructuredHeaders ? 1 : 0;
  const parsed: ParsedCsvRecord[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    const emailRaw = emailIndex >= 0 ? row[emailIndex] ?? "" : row[0] ?? "";
    const email = normEmailClient(emailRaw || "");
    if (!email || !isValidEmail(email)) continue;

    const fullName = fullNameIndex >= 0
      ? buildCsvFullName([row[fullNameIndex]])
      : buildCsvFullName([
          firstNameIndex >= 0 ? row[firstNameIndex] : null,
          middleNameIndex >= 0 ? row[middleNameIndex] : null,
          lastNameIndex >= 0 ? row[lastNameIndex] : null,
          suffixIndex >= 0 ? row[suffixIndex] : null,
        ]);

    const yearLevel = yearLevelIndex >= 0 ? normalizeLine(row[yearLevelIndex] ?? "") || null : null;

    parsed.push({
      email,
      full_name: fullName,
      year_level: yearLevel,
      source_row: i + 1,
    });
  }

  const deduped = new Map<string, ParsedCsvRecord>();
  for (const row of parsed) {
    if (!deduped.has(row.email)) deduped.set(row.email, row);
  }
  return Array.from(deduped.values());
}

function namesMatch(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeLine(String(a || ""))
    .toLowerCase()
    .replace(/[.,]/g, "");
  const right = normalizeLine(String(b || ""))
    .toLowerCase()
    .replace(/[.,]/g, "");
  return !!left && !!right && left === right;
}

function yearLevelsMatch(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeLine(String(a || "")).toLowerCase();
  const right = normalizeLine(String(b || "")).toLowerCase();
  return !!left && !!right && left === right;
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

function CsvPreview({ items }: { items: Array<string | ParsedCsvRecord> }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border bg-muted/30 p-3 text-xs">
      <div className="font-medium">Preview ({items.length})</div>
      <div className="mt-2 max-h-[140px] overflow-auto space-y-1">
        {items.slice(0, 12).map((item, idx) => {
          const label = typeof item === "string"
            ? item
            : item.full_name
              ? `${item.email} - ${item.full_name}${item.year_level ? ` - ${item.year_level}` : ""}`
              : `${item.email}${item.year_level ? ` - ${item.year_level}` : ""}`;
          return (
            <div key={idx} className="truncate">
              {label}
            </div>
          );
        })}
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
  const [activePanel, setActivePanel] = useState<"org" | "associates" | "enrolled">("org");

  // ----------------------------
  // Org member roster UI
  // ----------------------------
  const [orgMemberLoading, setOrgMemberLoading] = useState(false);
  const [orgMemberRows, setOrgMemberRows] = useState<OrgMemberRow[]>([]);
  const [orgMemberSearch, setOrgMemberSearch] = useState("");
const [orgMemberSource, setOrgMemberSource] = useState("Admin import");
  const [orgMemberBusy, setOrgMemberBusy] = useState(false);

  const [orgMemberCsvFile, setOrgMemberCsvFile] = useState<File | null>(null);
  const [orgMemberCsvPreview, setOrgMemberCsvPreview] = useState<ParsedCsvRecord[]>([]);

  // Quick-add: pull exact full_name from registered voters to avoid
  // "same person, different spelling" eligibility mismatches.
  const [voterLookupQuery, setVoterLookupQuery] = useState("");
  const [voterLookupLoading, setVoterLookupLoading] = useState(false);
  const [voterLookupRows, setVoterLookupRows] = useState<VoterLookupRow[]>([]);
  const [voterAddBusyId, setVoterAddBusyId] = useState<string | null>(null);

  // Quick-add associates from registered voters
  const [associateVoterLookupQuery, setAssociateVoterLookupQuery] = useState("");
  const [associateVoterLookupLoading, setAssociateVoterLookupLoading] = useState(false);
  const [associateVoterLookupRows, setAssociateVoterLookupRows] = useState<VoterLookupRow[]>([]);
  const [associateVoterAddBusyId, setAssociateVoterAddBusyId] = useState<string | null>(null);


  // ----------------------------
  // Associate registry (email) UI
  // ----------------------------
  const [associateLoading, setAssociateLoading] = useState(false);

  // ── Enrolled students ──────────────────────────────────────────────
  const [enrolledRows, setEnrolledRows] = useState<EnrolledRow[]>([]);
  const [enrolledLoading, setEnrolledLoading] = useState(false);
  const [enrolledCsvFile, setEnrolledCsvFile] = useState<File | null>(null);
  const [enrolledCsvPreview, setEnrolledCsvPreview] = useState<ParsedCsvRecord[]>([]);
  const [enrolledQuickEmail, setEnrolledQuickEmail] = useState("");
  const [enrolledQuickName, setEnrolledQuickName] = useState("");
  const [enrolledQuickYear, setEnrolledQuickYear] = useState("");
  const [enrolledSource, setEnrolledSource] = useState("");
  const [associateRows, setAssociateRows] = useState<AssociateRow[]>([]);
  const [associateSearch, setAssociateSearch] = useState("");
const [associateBusy, setAssociateBusy] = useState(false);
  const [associateManualEmails, setAssociateManualEmails] = useState("");

  const associateEmailPreview = useMemo(() => {
    const raw = associateManualEmails;
    if (!raw.trim()) return [];
    const tokens = raw
      .split(/[\r\n,;]+/)
      .map((x) => normalizeLine(x))
      .filter(Boolean);

    // Skip common header tokens like "email".
    const cleaned = tokens.length === 1 && /^e-?mail$/i.test(tokens[0]) ? [] : tokens;

    const valid = cleaned.filter(isValidEmail);
    return dedupeEmails(valid);
  }, [associateManualEmails]);

  const [associateSource, setAssociateSource] = useState("Admin import");

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

  const loadAssociates = async () => {
    setAssociateLoading(true);

    // Associate registry lives in associate_registry.
    // Cast table name to any to avoid typegen drift until you regenerate Supabase types.
    const { data, error } = await supabase
      .from("associate_registry" as any)
      .select("id, email, email_norm, full_name, source, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error("Failed to load associate registry.");
      setAssociateRows([]);
    } else {
      setAssociateRows((data as any) || []);
    }

    setAssociateLoading(false);
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
    void loadAssociates();
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

  const filteredAssociates = useMemo(() => {
    const q = associateSearch.trim().toLowerCase();
    if (!q) return associateRows;
    return associateRows.filter((r) => {
      const a = (r.email ?? "").toLowerCase();
      const b = (r.full_name ?? "").toLowerCase();
      const c = (r.source ?? "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [associateRows, associateSearch]);

  // ----------------------------
  // CSV readers
  // ----------------------------
  const readOrgMemberCsv = async (file: File) => {
    const text = await file.text();
    const rows = parseFlexibleCsv(text);
    setOrgMemberCsvPreview(rows);

    if (rows.length === 0) {
      toast.error("No valid email column detected in the CSV.");
      return;
    }

    const withNames = rows.filter((row) => !!row.full_name).length;
    const withYear = rows.filter((row) => !!row.year_level).length;
    toast.success(`Loaded ${rows.length} row(s) from CSV.${withNames ? ` Name checks: ${withNames}.` : ""}${withYear ? ` Year-level checks: ${withYear}.` : ""}`);
  };

  // ----------------------------
  // Actions: Org roster
  // ----------------------------

  const searchVotersForQuickAdd = async () => {
    if (!selectedOrg) {
      toast.error("Select an organization first.");
      return;
    }

    const q = normalizeLine(voterLookupQuery);
    if (!q) {
      toast.error("Enter an email or name to search.");
      return;
    }

    setVoterLookupLoading(true);
    try {
      // NOTE: Cast to any to avoid typegen drift if the voters table
      // isn't present in your generated Supabase types.
      const qb = supabase
        .from("voters" as any)
        .select("id, email, first_name, middle_name, last_name, suffix, year_level, created_at")
        .limit(15) as any;

      // Heuristics:
      // - If it looks like an email, prioritize email match (email is unique in voters).
      // - If it looks like a UUID, allow exact ID match.
      const looksLikeEmail = q.includes("@");
      const looksLikeUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(q);

      let res;
      if (looksLikeEmail) {
        res = await qb.ilike("email", `%${q}%`);
      } else if (looksLikeUuid) {
        res = await qb.or(`id.eq.${q},email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
      } else {
        // Name-ish query: try email and name fields.
        res = await qb.or(
          `email.ilike.%${q}%,first_name.ilike.%${q}%,middle_name.ilike.%${q}%,last_name.ilike.%${q}%`
        );
      }

      const { data, error } = res;
      if (error) {
        console.error(error);
        toast.error(error.message);
        setVoterLookupRows([]);
        return;
      }

      setVoterLookupRows(((data as any) || []) as VoterLookupRow[]);
      if (!data || (data as any[]).length === 0) {
        toast.message("No matching voters found.");
      }
    } finally {
      setVoterLookupLoading(false);
    }
  };

  const quickAddVoterToOrgRoster = async (v: VoterLookupRow) => {
    if (!selectedOrg) {
      toast.error("Select an organization first.");
      return;
    }

    const fullName = buildVoterRosterName(v);
    if (!fullName) {
      toast.error("This voter record has incomplete name fields to add.");
      return;
    }

    setVoterAddBusyId(v.id);
    try {
      const sourceBits = ["From voter"].concat(
        v.email ? [`${v.email}`] : [],
        v.id ? [`ID: ${v.id}`] : []
      );

      const payload = {
        org_code: selectedOrg,
        full_name: fullName,
        email: v.email,
        source: sourceBits.join(" • "),
      };

      const { error } = await supabase.from("org_member_names").insert([payload] as any);
      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      // Keep the cached org_affiliations on the voter record in sync.
      // (RegistrationVerify does this; election eligibility checks commonly read voters.org_affiliations.)
      const { error: refreshErr } = await supabase.rpc(
        "refresh_voter_org_affiliations" as any,
        { voter_id: v.id } as any
      );
      if (refreshErr) {
        console.error(refreshErr);
        toast.message("Added to roster, but failed to refresh voter org affiliations.");
      }

      toast.success(`Added ${fullName} to ${selectedOrg}.`);
      await loadOrgMembers(selectedOrg);
    } finally {
      setVoterAddBusyId(null);
    }

  };

  const searchVotersForAssociateQuickAdd = async () => {
    const q = normalizeLine(associateVoterLookupQuery);
    if (!q) {
      toast.error("Enter an email or name to search.");
      return;
    }

    setAssociateVoterLookupLoading(true);
    try {
      const qb = (supabase
        .from("voters" as any)
        .select("id, email, first_name, middle_name, last_name, suffix, year_level, created_at")
        .limit(15) as any);

      const looksLikeEmail = q.includes("@");
      const looksLikeUuid =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(q);

      let res;
      if (looksLikeEmail) {
        res = await qb.ilike("email", `%${q}%`);
      } else if (looksLikeUuid) {
        res = await qb.or(`id.eq.${q},email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
      } else {
        res = await qb.or(
          `email.ilike.%${q}%,first_name.ilike.%${q}%,middle_name.ilike.%${q}%,last_name.ilike.%${q}%`
        );
      }

      const { data, error } = res;
      if (error) {
        console.error(error);
        toast.error(error.message);
        setAssociateVoterLookupRows([]);
        return;
      }

      setAssociateVoterLookupRows(((data as any) || []) as VoterLookupRow[]);
      if (!data || (data as any[]).length === 0) {
        toast.message("No matching voters found.");
      }
    } finally {
      setAssociateVoterLookupLoading(false);
    }
  };

  const quickAddVoterToAssociateRegistry = async (v: VoterLookupRow) => {
    const email = normalizeLine(v.email || "");
    if (!email || !isValidEmail(email)) {
      toast.error("This voter record has no valid email.");
      return;
    }

    setAssociateVoterAddBusyId(v.id);
    try {
      const fullName = buildVoterFullName(v) || null;
      const sourceBits = ["From voter"].concat(email ? [`${email}`] : [], v.id ? [`ID: ${v.id}`] : []);
      const payload = {
        email,
        full_name: fullName,
        source: normalizeLine(associateSource) || sourceBits.join(" • "),
      };

      const { error } = await supabase.from("associate_registry" as any).insert([payload] as any);
      if (error) {
        console.error(error);
        // Friendly message for duplicates
        if ((error as any).code === "23505") {
          toast.message("Associate already in registry.");
        } else {
          toast.error(error.message);
        }
        return;
      }

      toast.success(`Added ${email} to associate registry.`);
      await loadAssociates();
    } finally {
      setAssociateVoterAddBusyId(null);
    }
  };
  const addOrgMembers = async () => {
    if (!selectedOrg) {
      toast.error("Select an organization first.");
      return;
    }

    const combined = orgMemberCsvPreview;

    if (combined.length === 0) {
      toast.error("Import at least one member email (CSV).");
      return;
    }

    const unique = dedupeEmails(combined.map((row) => row.email));

    if (unique.length === 0) {
      toast.error("No valid member emails found.");
      return;
    }

    setOrgMemberBusy(true);
    try {
      // Resolve emails -> voters to produce an exact name string and a voter_id list for refresh.
      const { data: voterData, error: voterErr } = await (supabase
        .from("voters" as any)
        .select("id, email, first_name, middle_name, last_name, suffix, year_level")
        .in("email", unique)
        .limit(unique.length) as any);

      if (voterErr) {
        console.error(voterErr);
        toast.error(voterErr.message);
        return;
      }

      const voterByEmail = new Map<string, VoterLookupRow>();
      (voterData as any[] | null | undefined)?.forEach((v) => {
        const key = normEmailClient(v.email ?? "");
        if (key) voterByEmail.set(key, v as any);
      });


      const csvByEmail = new Map(orgMemberCsvPreview.map((row) => [normEmailClient(row.email), row]));
      const matched: { voter: VoterLookupRow; email: string }[] = [];
      const unmatched: string[] = [];
      const conflicts: string[] = [];

      for (const email of unique) {
        const key = normEmailClient(email);
        const v = voterByEmail.get(key);
        const csvRow = csvByEmail.get(key) || null;
        if (!v) {
          unmatched.push(email);
          continue;
        }

        if (csvRow?.full_name) {
          const rosterName = buildVoterRosterName(v);
          const fullName = buildVoterFullName(v);
          if (!namesMatch(csvRow.full_name, rosterName) && !namesMatch(csvRow.full_name, fullName)) {
            conflicts.push(`${email} (name mismatch)`);
            continue;
          }
        }

        if (csvRow?.year_level && v.year_level && !yearLevelsMatch(csvRow.year_level, v.year_level)) {
          conflicts.push(`${email} (year level mismatch)`);
          continue;
        }

        matched.push({ voter: v, email });
      }

      if (matched.length === 0) {
        toast.error("No CSV rows passed the voter cross-check.");
        return;
      }

      const sourceLabel = normalizeLine(orgMemberSource) || null;
      const payload = matched.map(({ voter, email }) => {
        const fullName = buildVoterRosterName(voter);
        return {
          org_code: selectedOrg,
          full_name: fullName,
          email,
          source: sourceLabel ? sourceLabel : `CSV import • ${email} • ID: ${voter.id}`,
        };
      });

      const { error } = await supabase.from("org_member_names").insert(payload as any);

      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      // Refresh org affiliations for matched voters so election eligibility updates immediately.
      const refreshResults = await Promise.allSettled(
        matched.map(({ voter }) =>
          supabase.rpc("refresh_voter_org_affiliations" as any, { voter_id: voter.id } as any)
        )
      );
      const refreshFailures = refreshResults.filter((r) => r.status === "rejected").length;
      if (refreshFailures > 0) {
        toast.message(`Imported roster, but ${refreshFailures} voter affiliation refresh(es) failed.`);
      }

      if (unmatched.length > 0 || conflicts.length > 0) {
        toast.message(`Imported ${matched.length} member(s). Skipped ${unmatched.length} unmatched and ${conflicts.length} conflicting row(s).`);
      } else {
        toast.success(`Imported ${matched.length} member(s) to ${selectedOrg}.`);
      }
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
  // Actions: Associate registry (email)
  // ----------------------------
  const addAssociates = async () => {
    const combined = associateEmailPreview;

    if (combined.length === 0) {
      toast.error("Enter at least one associate email, or add from voters.");
      return;
    }

    const unique = combined;

    if (unique.length === 0) {
      toast.error("No valid associate emails found.");
      return;
    }

    setAssociateBusy(true);
    try {
      // Optional: populate full_name when the email already exists in voters (for readability).
      const { data: voterData } = await supabase
        .from("voters" as any)
        .select("email, first_name, middle_name, last_name, suffix")
        .in("email", unique)
        .limit(unique.length) as any;

      const voterByEmail = new Map<string, any>();
      (voterData as any[] | null | undefined)?.forEach((v) => {
        const key = normEmailClient(v.email ?? "");
        if (key) voterByEmail.set(key, v);
      });

      const payload = unique.map((email) => {
        const v = voterByEmail.get(normEmailClient(email));
        const full_name = v ? buildVoterFullName(v) : null;
        return {
          email,
          full_name,
          source: normalizeLine(associateSource) || null,
        };
      });

      const { error } = await supabase.from("associate_registry" as any).insert(payload as any);
      if (error) {
        console.error(error);
        toast.error(error.message);
        return;
      }

      toast.success(`Imported ${unique.length} associate email(s).`);
      setAssociateManualEmails("");
      await loadAssociates();
    } finally {
      setAssociateBusy(false);
    }
  };

  const deleteAssociate = async (rowId: string) => {
    if (!confirm("Delete this associate entry?")) return;

    const { error } = await supabase.from("associate_registry" as any).delete().eq("id", rowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted associate entry.");
    await loadAssociates();
  };

  const clearAssociateRegistry = async () => {
    if (!confirm("Delete ALL associate registry entries?")) return;

    setAssociateBusy(true);
    try {
      // Supabase delete requires at least one filter. This condition matches all rows.
      const { error } = await supabase.from("associate_registry" as any).delete().not("id", "is", null);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Cleared associate registry.");
      await loadAssociates();
    } finally {
      setAssociateBusy(false);
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
            Add from registered voters or import a CSV with an email column anywhere in the file.
            Full name and year level are used for cross-checking when present.
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

          {/* Quick-add from voters table */}
          <div className="rounded-2xl border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">Add from registered voters</div>
              <Badge variant="outline" className="text-[10px]">
                exact name
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Search voter (email or name).
            </div>

            <div className="flex flex-col md:flex-row gap-2">
              <Input
                placeholder="Search by email or name"
                value={voterLookupQuery}
                onChange={(e) => setVoterLookupQuery(e.target.value)}
                disabled={orgMemberBusy || orgMemberLoading || voterLookupLoading || !selectedOrg}
              />
              <Button
                variant="outline"
                onClick={searchVotersForQuickAdd}
                disabled={orgMemberBusy || orgMemberLoading || voterLookupLoading || !selectedOrg}
              >
                {voterLookupLoading ? "Searching…" : "Search"}
              </Button>
            </div>

            {voterLookupRows.length > 0 ? (
              <div className="rounded-xl border bg-background max-h-[220px] overflow-auto">
                <div className="divide-y">
                  {voterLookupRows.map((v) => {
                    const fullName = buildVoterRosterName(v);
                    const meta = [v.email ? v.email : null, v.id ? `ID: ${v.id}` : null]
                      .filter(Boolean)
                      .join(" • ");

                    return (
                      <div key={v.id} className="p-3 flex items-start justify-between gap-3 hover:bg-muted/20">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{fullName || "(no name)"}</div>
                          <div className="text-xs text-muted-foreground truncate">{meta || "—"}</div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => quickAddVoterToOrgRoster(v)}
                          disabled={orgMemberBusy || voterAddBusyId === v.id || !fullName}
                        >
                          {voterAddBusyId === v.id ? "Adding…" : "Add"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                If eligibility fails, add yourself here.
              </div>
            )}
          </div>

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
            placeholder="Search email/name/source…"
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

  // ── Enrolled students: load, add, CSV import, delete, toggle ─────────

  const loadEnrolled = async () => {
    setEnrolledLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("enrolled_students")
        .select("id,email,email_norm,full_name,year_level,is_enrolled,source,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setEnrolledRows(data ?? []);
    } catch (e: any) {
      toast.error("Failed to load enrolled students: " + (e?.message || String(e)));
    } finally {
      setEnrolledLoading(false);
    }
  };

  useEffect(() => {
    if (activePanel === "enrolled") void loadEnrolled();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel]);

  const handleEnrolledQuickAdd = async () => {
    const email = enrolledQuickEmail.trim().toLowerCase();
    if (!isValidEmail(email)) { toast.error("Enter a valid email."); return; }
    const { error } = await (supabase as any).from("enrolled_students").upsert(
      [{ email, full_name: enrolledQuickName.trim() || null, year_level: enrolledQuickYear.trim() || null, source: enrolledSource.trim() || null, is_enrolled: true }],
      { onConflict: "email_norm" }
    );
    if (error) { toast.error("Failed to add: " + error.message); return; }
    toast.success("Added to enrolled students.");
    setEnrolledQuickEmail(""); setEnrolledQuickName(""); setEnrolledQuickYear("");
    void loadEnrolled();
  };

  const readEnrolledCsv = async (file: File) => {
    const text = await file.text();
    const rows = parseFlexibleCsv(text);
    setEnrolledCsvPreview(rows);

    if (rows.length === 0) {
      toast.error("No valid email column detected in the CSV.");
      return;
    }

    const withNames = rows.filter((row) => !!row.full_name).length;
    const withYear = rows.filter((row) => !!row.year_level).length;
    toast.success(`Loaded ${rows.length} enrolled row(s).${withNames ? ` Name checks: ${withNames}.` : ""}${withYear ? ` Year-level checks: ${withYear}.` : ""}`);
  };

  const handleEnrolledCsvImport = async () => {
    if (!enrolledCsvPreview.length) { toast.error("No valid rows to import."); return; }
    const payload = enrolledCsvPreview.map((row) => ({
      email: row.email.toLowerCase(),
      full_name: row.full_name,
      year_level: row.year_level,
      source: enrolledSource.trim() || null,
      is_enrolled: true,
    }));
    const { error } = await (supabase as any).from("enrolled_students")
      .upsert(payload, { onConflict: "email_norm" });
    if (error) { toast.error("Import failed: " + error.message); return; }
    toast.success(`Imported ${payload.length} enrolled student(s).`);
    setEnrolledCsvFile(null); setEnrolledCsvPreview([]);
    void loadEnrolled();
  };

  const handleEnrolledToggle = async (row: EnrolledRow) => {
    const { error } = await (supabase as any).from("enrolled_students")
      .update({ is_enrolled: !row.is_enrolled })
      .eq("id", row.id);
    if (error) { toast.error("Failed to update: " + error.message); return; }
    toast.success(row.is_enrolled ? "Marked as not enrolled." : "Marked as enrolled.");
    void loadEnrolled();
  };

  const handleEnrolledDelete = async (id: string) => {
    if (!confirm("Remove this student from the enrolled list?")) return;
    const { error } = await (supabase as any).from("enrolled_students").delete().eq("id", id);
    if (error) { toast.error("Delete failed: " + error.message); return; }
    toast.success("Removed.");
    void loadEnrolled();
  };

  const handleEnrolledClearAll = async () => {
    if (!confirm("Delete ALL enrolled students? This will block ALL registrations until you re-import.")) return;
    const { error } = await (supabase as any).from("enrolled_students").delete().not("id", "is", null);
    if (error) { toast.error("Clear failed: " + error.message); return; }
    toast.success("Cleared all enrolled students.");
    void loadEnrolled();
  };

  const renderEnrolledPanel = () => (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-1">
        <p className="font-semibold">What this list does</p>
        <p className="text-emerald-800">
          When a student tries to register, their FEU email is checked against this list
          before RFID and Face ID capture. If the email is not here or is marked{" "}
          <strong>Blocked</strong>, they are stopped immediately with a clear message.
          Import the official enrolled student list (CSV with an email column). If full name and year level are present, they are stored and checked during registration.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <p className="font-semibold text-sm">Add single student</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="student@feualabang.edu.ph" value={enrolledQuickEmail} onChange={(e) => setEnrolledQuickEmail(e.target.value)} />
          <Input placeholder="Full name (optional)" value={enrolledQuickName} onChange={(e) => setEnrolledQuickName(e.target.value)} />
          <Input placeholder="Year level (optional)" value={enrolledQuickYear} onChange={(e) => setEnrolledQuickYear(e.target.value)} />
          <Input placeholder="Source label (optional)" value={enrolledSource} onChange={(e) => setEnrolledSource(e.target.value)} />
        </div>
        <Button className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={handleEnrolledQuickAdd}>Add Student</Button>
      </div>

      <div className="rounded-2xl border bg-white p-5 space-y-3">
        <p className="font-semibold text-sm">CSV import (email column auto-detected)</p>
        <Input placeholder="Source label e.g. AY 2025-2026 official list" value={enrolledSource} onChange={(e) => setEnrolledSource(e.target.value)} />
        <input
          type="file"
          accept=".csv,.txt"
          className="block text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            setEnrolledCsvFile(f);
            if (f) await readEnrolledCsv(f);
          }}
        />
        {enrolledCsvPreview.length > 0 && (
          <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">{enrolledCsvPreview.length} valid row(s) - preview (first 5):</p>
            {enrolledCsvPreview.slice(0, 5).map((row) => (
              <p key={row.email} className="text-xs font-mono text-slate-700">{row.email}{row.full_name ? ` - ${row.full_name}` : ""}{row.year_level ? ` - ${row.year_level}` : ""}</p>
            ))}
            {enrolledCsvPreview.length > 5 && (
              <p className="text-xs text-muted-foreground">and {enrolledCsvPreview.length - 5} more</p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <SuperAdminOtpGate action="enrolled_import" onVerified={handleEnrolledCsvImport}>
            <Button className="flex-1 bg-emerald-700 hover:bg-emerald-800" disabled={!enrolledCsvPreview.length}>
              Import {enrolledCsvPreview.length > 0 ? `${enrolledCsvPreview.length} students` : ""}
            </Button>
          </SuperAdminOtpGate>
          <SuperAdminOtpGate action="enrolled_import" onVerified={handleEnrolledClearAll}>
            <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5">
              Clear all
            </Button>
          </SuperAdminOtpGate>
        </div>
        <p className="text-xs text-muted-foreground">Duplicate emails are upserted. When CSV includes full name and year level, those values are stored for later registration checks.</p>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <p className="font-semibold text-sm">Enrolled students ({enrolledRows.length})</p>
          <Button variant="outline" size="sm" onClick={loadEnrolled} disabled={enrolledLoading}>Refresh</Button>
        </div>
        {enrolledLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading...</div>
        ) : enrolledRows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No enrolled students imported yet. Import a CSV above to enable enrollment blocking.</div>
        ) : (
          <div className="divide-y">
            {enrolledRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{row.email}</p>
                  {row.full_name && <p className="text-xs text-muted-foreground">{row.full_name}{row.year_level ? ` - ${row.year_level}` : ""}</p>}
                  {row.source && <p className="text-xs text-muted-foreground italic">{row.source}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={row.is_enrolled ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-red-100 text-red-800 border-red-200"}>
                    {row.is_enrolled ? "Enrolled" : "Blocked"}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => handleEnrolledToggle(row)}>
                    {row.is_enrolled ? "Block" : "Unblock"}
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive border-destructive/30" onClick={() => handleEnrolledDelete(row.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

    const renderAssociatePanel = () => (
    <Card className="p-5 md:p-6 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold">Associate Registry</div>
          <Badge variant="outline">{filteredAssociates.length}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          Writes to <code>associate_registry</code>.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Import */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Import associates</div>
            <Badge variant="outline">{associateRows.length}</Badge>
          </div>

          <div className="text-xs text-muted-foreground">
            Add from registered voters or import a CSV (first column = email).
          </div>

          
          <div className="rounded-2xl border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium">Add from registered voters</div>
              <Badge variant="outline" className="text-[10px]">
                email
              </Badge>
            </div>

            <div className="flex flex-col md:flex-row gap-2">
              <Input
                placeholder="Search voter (email or name)…"
                value={associateVoterLookupQuery}
                onChange={(e) => setAssociateVoterLookupQuery(e.target.value)}
                disabled={associateBusy || associateVoterLookupLoading}
              />
              <div className="flex gap-2 md:ml-auto">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAssociateVoterLookupQuery("");
                    setAssociateVoterLookupRows([]);
                  }}
                  disabled={associateBusy || associateVoterLookupLoading}
                >
                  Clear
                </Button>
                <Button onClick={searchVotersForAssociateQuickAdd} disabled={associateBusy || associateVoterLookupLoading}>
                  {associateVoterLookupLoading ? "Searching…" : "Search"}
                </Button>
              </div>
            </div>

            {associateVoterLookupRows.length > 0 ? (
              <div className="rounded-xl border max-h-[220px] overflow-auto">
                <div className="divide-y">
                  {associateVoterLookupRows.map((v) => {
                    const name = buildVoterFullName(v) || "—";
                    return (
                      <div key={v.id} className="p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{name}</div>
                          <div className="text-xs text-muted-foreground truncate">{v.email}</div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => quickAddVoterToAssociateRegistry(v)}
                          disabled={associateBusy || associateVoterAddBusyId === v.id}
                        >
                          {associateVoterAddBusyId === v.id ? "Adding…" : "Add"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">Manual email entry</div>
            <textarea
              className="w-full min-h-[120px] rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder={"Paste associate emails (one per line)\njadelacruz@feualabang.edu.ph"}
              value={associateManualEmails}
              onChange={(e) => setAssociateManualEmails(e.target.value)}
              disabled={associateBusy}
            />
            <div className="text-xs text-muted-foreground">
              Tip: separate emails by new lines, commas, or semicolons.
            </div>
            <CsvPreview items={associateEmailPreview} />
          </div>

<div className="flex flex-col md:flex-row gap-2 md:items-center">
            <Input
              placeholder="Source label (optional) e.g., HR list 2026"
              value={associateSource}
              onChange={(e) => setAssociateSource(e.target.value)}
              disabled={associateBusy}
            />
            <div className="flex gap-2 md:ml-auto">
              <Button variant="destructive" onClick={clearAssociateRegistry} disabled={associateBusy}>
                Clear
              </Button>
              <Button onClick={addAssociates} disabled={associateBusy}>
                Import
              </Button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Associate entries</div>
            <Badge variant="outline">{filteredAssociates.length}</Badge>
          </div>

          <Input
            placeholder="Search email/name/source…"
            value={associateSearch}
            onChange={(e) => setAssociateSearch(e.target.value)}
            disabled={associateLoading}
          />

          <div className="rounded-xl border max-h-[360px] overflow-auto">
            {associateLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading associates…</div>
            ) : filteredAssociates.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No associate entries yet.</div>
            ) : (
              <div className="divide-y">
                {filteredAssociates.map((r) => {
                  const display = r.full_name || r.email;
                  return (
                    <div key={r.id} className="p-3 flex items-start justify-between gap-3 hover:bg-muted/20">
                      <div className="flex gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-feu-green/10 flex items-center justify-center text-xs font-semibold text-feu-green">
                          {initials(display)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{display}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {r.email ? `Email: ${r.email}` : "Email: —"} •{" "}
                            {r.source ? `Source: ${r.source}` : "Source: —"} •{" "}
                            {new Date(r.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>

                    <Button variant="outline" size="sm" onClick={() => deleteAssociate(r.id)} disabled={associateBusy}>
                      Delete
                    </Button>
                  </div>
                  );
                })}
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
              <div>
                <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
                  Rosters & Eligibility
                </h2>
                <p className="text-sm text-muted-foreground">
                  Manage org rosters and associate registry used for voter eligibility rules.
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
                void loadAssociates();
              }}
              disabled={orgsLoading || orgMemberLoading || associateLoading}
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
            <SegButton active={activePanel === "associates"} onClick={() => setActivePanel("associates")}>
              Associate registry
            </SegButton>
            <SegButton active={activePanel === "enrolled"} onClick={() => setActivePanel("enrolled")}>
              Enrolled students
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
              <span className="text-muted-foreground">Associates:</span>{" "}
              <span className="font-medium">{associateRows.length}</span>
            </div>
            <div className="rounded-full border bg-muted/20 px-3 py-1">
              <span className="text-muted-foreground">Enrolled:</span>{" "}
              <span className="font-medium">{enrolledRows.length}</span>
            </div>
          </div>
        </div>
      </Card>

      {activePanel === "org" ? renderOrgPanel() : activePanel === "associates" ? renderAssociatePanel() : renderEnrolledPanel()}
    </div>
  );
}
