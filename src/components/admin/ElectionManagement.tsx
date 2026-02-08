import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ElectionEditorDialog } from "@/components/admin/elections/ElectionEditorDialog";
import { CandidateEditorDialog } from "@/components/admin/elections/CandidateEditorDialog";
import { CandidatesManager } from "@/components/admin/elections/CandidatesManager";
import { ElectionsListPanel } from "@/components/admin/elections/ElectionsListPanel";
import { useOrganizations } from "@/components/admin/elections/hooks/useOrganizations";
import { useElectionsAdmin, type ElectionRow } from "@/components/admin/elections/hooks/useElectionsAdmin";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Lock,
} from "lucide-react";


type CandidateRow = {
  id: string;
  election_id: string;
  name: string; // display-only (DB trigger syncs from first/last)
  first_name?: string | null;
  last_name?: string | null;
  position: string;
  slate: string | null;
  photo_url: string | null;
  bio: string | null;
  display_order: number | null;
  vote_count: number | null;
  created_at?: string;
  updated_at?: string;
};



const getCandidateDisplayName = (c: CandidateRow) => {
  const first = (c.first_name ?? "").trim();
  const last = (c.last_name ?? "").trim();
  const composed = `${first} ${last}`.trim();
  return composed || (c.name ?? "").trim();
};

const splitLegacyName = (name: string) => {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return { first_name: "", last_name: "" };
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { first_name: "", last_name: parts[0] };
  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
};

const CANDIDATE_PHOTO_BUCKET = "candidate-photos";

function isoLocalForInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function inputToISO(value: string) {
  const d = new Date(value);
  return d.toISOString();
}

/**
 * IMPORTANT BUSINESS RULE:
 * - If election is finalized OR archived, it must NOT be treated as "ongoing"
 *   even if end_date hasn't passed yet.
 *
 * This lifecycle state is what we use for status badges in admin.
 */
function getElectionLifecycleState(e: ElectionRow) {
  if (Boolean(e.is_archived)) return "ARCHIVED" as const;
  if (Boolean(e.is_final)) return "FINALIZED" as const;

  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  const end = new Date(e.end_date).getTime();

  if (now < start) return "UPCOMING" as const;
  if (now > end) return "CLOSED" as const;
  return "ONGOING" as const;
}

function canEditElectionAudience(e: ElectionRow | null) {
  if (!e) return false;
  if (Boolean(e.is_final)) return false;
  if (Boolean(e.is_archived)) return false;

  // User requirement: audience should NOT be editable when active/ongoing.
  // Treat "editable" as upcoming/scheduled only.
  if (Boolean(e.is_active)) return false;

  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  return now < start;
}

function normalizeOrgList(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    // Keep original casing (codes like SCC / ICpEP), but dedupe case-insensitively.
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}


function getPublicUrlForPath(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function safeUUID() {
  // browser environments should have crypto.randomUUID
  try {
    // @ts-ignore
    return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

/**
 * Time format you wanted:
 * - "8 AM" if minutes == 0
 * - "8:15 AM" otherwise
 */
function formatTimeShort(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h >= 12 ? "PM" : "AM";
  return m === 0
    ? `${hour12} ${ampm}`
    : `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDateTimeShort(iso: string) {
  const d = new Date(iso);

  const datePart = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }); // -> "Jan 12, 2026"

  return `${datePart} ${formatTimeShort(iso)}`; // -> "Jan 12, 2026 8 AM"
}

export default function ElectionManagement() {
  const [saving, setSaving] = useState(false);

  const { orgOptions, orgOptionsLoading, reloadOrganizations } = useOrganizations();
  const [selectedElectionId, setSelectedElectionId] = useState<string | null>(
    null
  );

  const { elections, setElections, electionsLoading, reloadElections } = useElectionsAdmin({
    selectedElectionId,
    setSelectedElectionId,
  });

  const selectedElection = useMemo(
    () => elections.find((e) => e.id === selectedElectionId) || null,
    [elections, selectedElectionId]
  );

  const operationalElections = useMemo(
    () => elections.filter((e) => !e.is_archived),
    [elections]
  );

  const archivedElections = useMemo(
    () => elections.filter((e) => Boolean(e.is_archived)),
    [elections]
  );

  const isSelectedFinal = Boolean(selectedElection?.is_final);
  const isSelectedArchived = Boolean(selectedElection?.is_archived);

  // Candidates
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // Drag + drop state (per position)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingPos, setDraggingPos] = useState<string | null>(null);

  
  // Organizations (for eligible_orgs picker)

  const orgLabelByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of orgOptions) {
      map[o.code] = o.name || o.code;
    }
    return map;
  }, [orgOptions]);

  const getOrgLabel = (code: string) => orgLabelByCode[code] || code;

// Election dialog
  const [electionDialogOpen, setElectionDialogOpen] = useState(false);
  const [editingElection, setEditingElection] = useState<ElectionRow | null>(
    null
  );
  const [eForm, setEForm] = useState({
    title: "",
    description: "",
    startLocal: "",
    endLocal: "",
    is_active: false,
    voter_audience: "students" as "students" | "employees" | "mixed",
    allow_all_orgs: true,
    eligible_orgs_selected: [] as string[],
    custom_org_input: "",
  });


  const audienceEditable = useMemo(() => {
    return !editingElection || canEditElectionAudience(editingElection);
  }, [editingElection]);

  // Finalize election (irreversible) dialog
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizeTarget, setFinalizeTarget] = useState<ElectionRow | null>(null);
  const [finalizeConfirmText, setFinalizeConfirmText] = useState("");

  // Archive (hide from operational lists, keep history)
  const [showArchived, setShowArchived] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ElectionRow | null>(null);
  const [archiveConfirmText, setArchiveConfirmText] = useState("");

  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<ElectionRow | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");

  // Candidate dialog
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<CandidateRow | null>(
    null
  );
  const [cForm, setCForm] = useState({
    first_name: "",
    last_name: "",
    position: "",
    slate: "",
    bio: "",
    display_order: 0,
  });

  // Photo upload state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const positions = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((c) => set.add(c.position));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [candidates]);

  const candidatesByPosition = useMemo(() => {
    const map: Record<string, CandidateRow[]> = {};
    for (const c of candidates) {
      const key = c.position || "Unassigned";
      map[key] = map[key] || [];
      map[key].push(c);
    }
    for (const key of Object.keys(map)) {
      map[key].sort(
        (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
      );
    }
    return map;
  }, [candidates]);

  useEffect(() => {
    // Organizations are loaded via useOrganizations()
    // Elections are loaded via useElectionsAdmin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedElectionId) {
      setCandidates([]);
      return;
    }
    loadCandidates(selectedElectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElectionId]);

  useEffect(() => {
    // cleanup preview URL on dialog close / file changes
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCandidates = async (electionId: string) => {
    setCandidatesLoading(true);
    const { data, error } = await supabase
      .from("candidates")
      .select("*")
      .eq("election_id", electionId)
      .order("position", { ascending: true })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      toast.error(`Failed to load candidates: ${error.message}`);
      setCandidatesLoading(false);
      return;
    }

    setCandidates((data as CandidateRow[]) || []);
    setCandidatesLoading(false);
  };

  const openCreateElection = () => {
    setEditingElection(null);
    setEForm({
      title: "",
      description: "",
      startLocal: "",
      endLocal: "",
      is_active: false,
      voter_audience: "students",
      allow_all_orgs: true,
      eligible_orgs_selected: [],
      custom_org_input: "",
    });
    setElectionDialogOpen(true);
  };

  const openEditElection = (e: ElectionRow) => {
    if (Boolean(e.is_final)) {
      toast.error("This election is finalized and cannot be edited.");
      return;
    }
    setEditingElection(e);

    const eligible = normalizeOrgList(e.eligible_orgs || []);
    const allowAll = !eligible.length;

    setEForm({
      title: e.title ?? "",
      description: e.description ?? "",
      startLocal: isoLocalForInput(e.start_date),
      endLocal: isoLocalForInput(e.end_date),
      is_active: !!e.is_active,
      voter_audience: (e.voter_audience as any) || "students",
      allow_all_orgs: allowAll,
      eligible_orgs_selected: eligible,
      custom_org_input: "",
    });
    setElectionDialogOpen(true);
  };

  const toggleSelectedOrg = (code: string) => {
    setEForm((p) => {
      const current = new Set(p.eligible_orgs_selected || []);
      if (current.has(code)) current.delete(code);
      else current.add(code);
      return { ...p, eligible_orgs_selected: Array.from(current) };
    });
  };

  const removeSelectedOrg = (code: string) => {
    setEForm((p) => ({
      ...p,
      eligible_orgs_selected: (p.eligible_orgs_selected || []).filter(
        (x) => x !== code
      ),
    }));
  };

  const addCustomOrg = () => {
    setEForm((p) => {
      const v = (p.custom_org_input || "").trim();
      if (!v) return p;
      const next = normalizeOrgList([...(p.eligible_orgs_selected || []), v]);
      return { ...p, eligible_orgs_selected: next, custom_org_input: "" };
    });
  };



  const openFinalizeElection = (e: ElectionRow) => {
    if (Boolean(e.is_final)) return;
    setFinalizeTarget(e);
    setFinalizeConfirmText("");
    setFinalizeDialogOpen(true);
  };

  const confirmFinalizeElection = async () => {
    if (!finalizeTarget) return;

    if (finalizeConfirmText.trim().toUpperCase() !== "FINALIZE") {
      toast.error('Type "FINALIZE" to confirm.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // IMPORTANT RULE:
      // Once finalized, election must no longer be considered active (even if end_date is in the future).
      // So we force is_active=false at finalize-time.
      const { error } = await supabase
        .from("elections")
        .update({
          is_final: true,
          is_active: false,
          finalized_at: new Date().toISOString(),
          finalized_by: user?.id ?? null,
          finalized_by_email: user?.email ?? null,
        } as any)
        .eq("id", finalizeTarget.id);

      if (error) throw error;

      toast.success("Election finalized. Editing is now locked.");
      setFinalizeDialogOpen(false);
      setFinalizeTarget(null);
      setFinalizeConfirmText("");

      await reloadElections();

      if (selectedElectionId) {
        await loadCandidates(selectedElectionId);
      }

      setElectionDialogOpen(false);
      setCandidateDialogOpen(false);
    } catch (err: any) {
      toast.error(`Failed to finalize election: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const openArchiveElection = (e: ElectionRow) => {
    if (!Boolean(e.is_final)) {
      toast.error("Only finalized elections can be archived.");
      return;
    }
    if (Boolean(e.is_archived)) return;
    setArchiveTarget(e);
    setArchiveConfirmText("");
    setArchiveDialogOpen(true);
  };

  const confirmArchiveElection = async () => {
    if (!archiveTarget) return;

    if (archiveConfirmText.trim().toUpperCase() !== "ARCHIVE") {
      toast.error('Type "ARCHIVE" to confirm.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Safety: archived elections should never be active.
      const { error } = await supabase
        .from("elections")
        .update({
          is_archived: true,
          is_active: false,
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archived_by_email: user?.email ?? null,
        } as any)
        .eq("id", archiveTarget.id);

      if (error) throw error;

      toast.success("Election archived.");
      await reloadElections();

      setArchiveDialogOpen(false);
      setArchiveTarget(null);
      setArchiveConfirmText("");
    } catch (err: any) {
      toast.error(`Failed to archive election: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const openRestoreElection = (e: ElectionRow) => {
    if (!Boolean(e.is_archived)) return;
    setRestoreTarget(e);
    setRestoreConfirmText("");
    setRestoreDialogOpen(true);
  };

  const confirmRestoreElection = async () => {
    if (!restoreTarget) return;

    if (restoreConfirmText.trim().toUpperCase() !== "RESTORE") {
      toast.error('Type "RESTORE" to confirm.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("elections")
        .update({
          is_archived: false,
          is_active: false, // remains inactive after restore (still finalized/read-only)
          archived_at: null,
          archived_by: null,
          archived_by_email: null,
        } as any)
        .eq("id", restoreTarget.id);

      if (error) throw error;

      toast.success("Election restored to operational list.");
      await reloadElections();

      setRestoreDialogOpen(false);
      setRestoreTarget(null);
      setRestoreConfirmText("");
    } catch (err: any) {
      toast.error(`Failed to restore election: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const saveElection = async () => {
    if (editingElection && Boolean(editingElection.is_final)) {
      toast.error("This election is finalized and cannot be edited.");
      return;
    }
    if (!eForm.title.trim()) return toast.error("Election title is required.");
    if (!eForm.startLocal || !eForm.endLocal)
      return toast.error("Start and end date/time are required.");

    const startISO = inputToISO(eForm.startLocal);
    const endISO = inputToISO(eForm.endLocal);
    if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
      return toast.error("End date/time must be after start date/time.");
    }

    const canEditAudienceNow = !editingElection || canEditElectionAudience(editingElection);

    let voterAudience = eForm.voter_audience;
    let eligibleOrgsToSave: string[] | null = eForm.allow_all_orgs
      ? null
      : normalizeOrgList([
          ...(eForm.eligible_orgs_selected || []),
          eForm.custom_org_input || "",
        ]);

    if (!canEditAudienceNow && editingElection) {
      voterAudience = (editingElection.voter_audience as any) || "students";
      eligibleOrgsToSave =
        editingElection.eligible_orgs && editingElection.eligible_orgs.length
          ? normalizeOrgList(editingElection.eligible_orgs)
          : null;
    }

    setSaving(true);

    try {
      if (!editingElection) {
        const { data, error } = await supabase
          .from("elections")
          .insert({
            title: eForm.title.trim(),
            description: eForm.description.trim() || null,
            start_date: startISO,
            end_date: endISO,
            is_active: eForm.is_active,
            voter_audience: voterAudience,
            eligible_orgs: eligibleOrgsToSave,
          })
          .select("*")
          .single();

        if (error) throw error;

        toast.success("Election created.");
        setElectionDialogOpen(false);
        await reloadElections();
        setSelectedElectionId((data as any).id);
        return;
      }

      const { error } = await supabase
        .from("elections")
        .update({
          title: eForm.title.trim(),
          description: eForm.description.trim() || null,
          start_date: startISO,
          end_date: endISO,
          is_active: eForm.is_active,
          voter_audience: voterAudience,
          eligible_orgs: eligibleOrgsToSave,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingElection.id);

      if (error) throw error;

      toast.success("Election updated.");
      setElectionDialogOpen(false);
      await reloadElections();
    } catch (err: any) {
      toast.error(`Failed to save election: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleElectionActive = async (e: ElectionRow) => {
    if (Boolean(e.is_final)) {
      toast.error("This election is finalized and cannot be modified.");
      return;
    }
    if (Boolean(e.is_archived)) {
      toast.error("This election is archived and cannot be activated.");
      return;
    }
    if (saving) return;

    const next = !Boolean(e.is_active);

    // optimistic UI: update only this row
    setElections((prev) =>
      prev.map((x) => (x.id === e.id ? { ...x, is_active: next } : x))
    );

    setSaving(true);
    try {
      const { error } = await supabase
        .from("elections")
        .update({ is_active: next })
        .eq("id", e.id);

      if (error) throw error;

      toast.success(next ? "Election activated." : "Election deactivated.");
    } catch (err: any) {
      // rollback on error
      setElections((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, is_active: e.is_active } : x))
      );
      toast.error(`Failed to update election status: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteElection = async (electionId: string) => {
    const target = elections.find((x) => x.id === electionId);
    if (target?.is_final) {
      toast.error("This election is finalized and cannot be deleted.");
      return;
    }
    if (!confirm("Delete this election? This will also delete its candidates."))
      return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("elections")
        .delete()
        .eq("id", electionId);

      if (error) throw error;

      toast.success("Election deleted.");
      setSelectedElectionId(null);
      setCandidates([]);
      await reloadElections();
    } catch (err: any) {
      toast.error(`Failed to delete election: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const nextDisplayOrder = (position: string) => {
    const samePos = candidates.filter((c) => c.position === position);
    const max = samePos.reduce((m, c) => Math.max(m, c.display_order ?? 0), 0);
    return samePos.length ? max + 1 : 0;
  };

  const resetPhotoState = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoPreviewUrl(null);
    setPhotoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openCreateCandidate = (prefillPosition?: string) => {
    if (!selectedElectionId) return toast.error("Select an election first.");
    if (isSelectedFinal)
      return toast.error("This election is finalized. Candidates are locked.");
    setEditingCandidate(null);
    setCForm({
      first_name: "",
      last_name: "",
      position: prefillPosition ?? "",
      slate: "",
      bio: "",
      display_order: nextDisplayOrder(prefillPosition ?? ""),
    });
    resetPhotoState();
    setCandidateDialogOpen(true);
  };

  const openEditCandidate = (c: CandidateRow) => {
    if (isSelectedFinal)
      return toast.error("This election is finalized. Candidates are locked.");
    setEditingCandidate(c);
    const legacy = splitLegacyName(c.name ?? "");
    setCForm({
      first_name: (c.first_name ?? legacy.first_name) ?? "",
      last_name: (c.last_name ?? legacy.last_name) ?? "",
      position: c.position ?? "",
      slate: c.slate ?? "",
      bio: c.bio ?? "",
      display_order: c.display_order ?? 0,
    });
    resetPhotoState();
    // show existing image as preview (if any)
    if (c.photo_url) setPhotoPreviewUrl(c.photo_url);
    setCandidateDialogOpen(true);
  };

  const uploadCandidatePhoto = async (opts: {
    electionId: string;
    candidateId: string;
    file: File;
  }) => {
    const ext = opts.file.name.split(".").pop() || "jpg";
    const path = `${opts.electionId}/${opts.candidateId}-${safeUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(CANDIDATE_PHOTO_BUCKET)
      .upload(path, opts.file, {
        upsert: true,
        contentType: opts.file.type || "image/*",
        cacheControl: "3600",
      });

    if (upErr) throw upErr;

    if (upErr) {
      console.error("Storage upload error:", upErr);
      console.log("file:", opts.file?.name, opts.file?.type, opts.file?.size);
      console.log("bucket/path:", CANDIDATE_PHOTO_BUCKET, path);
      throw upErr;
    }
    return getPublicUrlForPath(CANDIDATE_PHOTO_BUCKET, path);
  };

  const saveCandidate = async () => {
    if (!selectedElectionId) return toast.error("Select an election first.");
    if (isSelectedFinal)
      return toast.error("This election is finalized. Candidates are locked.");
    if (!cForm.last_name.trim()) return toast.error("Last name is required.");
    const displayName = `${cForm.first_name.trim()} ${cForm.last_name.trim()}`.trim();
    if (!displayName) return toast.error("Candidate name is required.");
    if (!cForm.position.trim()) return toast.error("Position is required.");

    setSaving(true);

    try {
      // Create
      if (!editingCandidate) {
        // 1) Insert candidate without photo first (to get ID)
        const { data: inserted, error: insErr } = await supabase
          .from("candidates")
          .insert({
            election_id: selectedElectionId,
            first_name: cForm.first_name.trim(),
            last_name: cForm.last_name.trim(),
            name: `${cForm.first_name.trim()} ${cForm.last_name.trim()}`.trim(),
            position: cForm.position.trim(),
            slate: cForm.slate.trim() || null,
            bio: cForm.bio.trim() || null,
            display_order: Number(cForm.display_order) || 0,
          })
          .select("*")
          .single();

        if (insErr) throw insErr;

        // 2) Upload photo if selected, then update candidate.photo_url
        if (photoFile) {
          const url = await uploadCandidatePhoto({
            electionId: selectedElectionId,
            candidateId: (inserted as any).id,
            file: photoFile,
          });

          const { error: upErr } = await supabase
            .from("candidates")
            .update({
              photo_url: url,
              updated_at: new Date().toISOString(),
            })
            .eq("id", (inserted as any).id);

          if (upErr) throw upErr;
        }

        toast.success("Candidate added.");
        setCandidateDialogOpen(false);
        resetPhotoState();
        await loadCandidates(selectedElectionId);
        return;
      }

      // Update
      let nextPhotoUrl: string | null | undefined = undefined;

      // If a new file was chosen, upload & replace URL
      if (photoFile && selectedElectionId) {
        nextPhotoUrl = await uploadCandidatePhoto({
          electionId: selectedElectionId,
          candidateId: editingCandidate.id,
          file: photoFile,
        });
      }

      const { error } = await supabase
        .from("candidates")
        .update({
          first_name: cForm.first_name.trim(),
          last_name: cForm.last_name.trim(),
          name: `${cForm.first_name.trim()} ${cForm.last_name.trim()}`.trim(),
          position: cForm.position.trim(),
          slate: cForm.slate.trim() || null,
          bio: cForm.bio.trim() || null,
          display_order: Number(cForm.display_order) || 0,
          ...(nextPhotoUrl !== undefined ? { photo_url: nextPhotoUrl } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingCandidate.id);

      if (error) throw error;

      toast.success("Candidate updated.");
      setCandidateDialogOpen(false);
      resetPhotoState();
      await loadCandidates(selectedElectionId);
    } catch (err: any) {
      toast.error(`Failed to save candidate: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteCandidate = async (candidateId: string) => {
    if (isSelectedFinal) {
      toast.error("This election is finalized. Candidates are locked.");
      return;
    }
    if (!confirm("Delete this candidate?")) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("candidates")
        .delete()
        .eq("id", candidateId);
      if (error) throw error;

      toast.success("Candidate deleted.");
      if (selectedElectionId) await loadCandidates(selectedElectionId);
    } catch (err: any) {
      toast.error(`Failed to delete candidate: ${err.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const statusBadge = (e: ElectionRow) => {
    const state = getElectionLifecycleState(e);

    if (state === "ARCHIVED") {
      return (
        <Badge className="border-amber-600 text-amber-700 bg-amber-600/10">
          Archived
        </Badge>
      );
    }

    if (state === "FINALIZED") {
      return (
        <Badge className="border-violet-600 text-violet-700 bg-violet-600/10">
          Finalized
        </Badge>
      );
    }

    if (state === "ONGOING") {
      return (
        <Badge className="border-green-600 text-green-700 bg-green-600/10">
          Ongoing
        </Badge>
      );
    }
    if (state === "UPCOMING") {
      return (
        <Badge className="border-blue-600 text-blue-700 bg-blue-600/10">
          Upcoming
        </Badge>
      );
    }
    return (
      <Badge className="border-red-600 text-red-700 bg-red-600/10">Closed</Badge>
    );
  };


  const audienceBadge = (e: ElectionRow) => {
    const v = (e.voter_audience || "students").toString();
    const label =
      v === "employees" ? "Employees" : v === "mixed" ? "Mixed" : "Students";
    return (
      <Badge variant="outline" className="text-xs">
        {label}
      </Badge>
    );
  };

  const activeBadge = (e: ElectionRow) => {
    return Boolean(e.is_active) ? (
      <Badge className="border-emerald-600 text-emerald-700 bg-emerald-600/10">
        Active
      </Badge>
    ) : (
      <Badge className="border-zinc-400 text-zinc-600 bg-zinc-500/10">
        Inactive
      </Badge>
    );
  };

  const finalBadge = (e: ElectionRow) => {
    return Boolean(e.is_final) ? (
      <Badge className="border-violet-600 text-violet-700 bg-violet-600/10">
        <span className="inline-flex items-center gap-1">
          <Lock className="h-3.5 w-3.5" />
          Final
        </span>
      </Badge>
    ) : null;
  };

  const archiveBadge = (e: ElectionRow) => {
    return Boolean(e.is_archived) ? (
      <Badge className="border-amber-600 text-amber-700 bg-amber-600/10">
        Archived
      </Badge>
    ) : null;
  };

  // --- Drag & Drop reorder (per position) ---
  const persistOrderForPosition = async (
    position: string,
    orderedIds: string[]
  ) => {
    if (!selectedElectionId) return;
    if (isSelectedFinal) {
      toast.error("This election is finalized. Candidate order is locked.");
      return;
    }
    setSaving(true);

    try {
      // update display_order sequentially
      const updates = orderedIds.map((id, idx) => ({
        id,
        display_order: idx,
        updated_at: new Date().toISOString(),
      }));

      // optimistic local update
      setCandidates((prev) =>
        prev.map((c) => {
          const u = updates.find((x) => x.id === c.id);
          return u ? { ...c, display_order: u.display_order } : c;
        })
      );

      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from("candidates")
            .update({ display_order: u.display_order, updated_at: u.updated_at })
            .eq("id", u.id)
        )
      );

      const anyErr = results.find((r) => r.error)?.error;
      if (anyErr) throw anyErr;

      toast.success("Order updated.");
      await loadCandidates(selectedElectionId);
    } catch (err: any) {
      toast.error(`Failed to update order: ${err.message ?? err}`);
      // reload to revert local state if needed
      if (selectedElectionId) await loadCandidates(selectedElectionId);
    } finally {
      setSaving(false);
    }
  };

  const onDragStartCandidate = (pos: string, id: string) => {
    setDraggingId(id);
    setDraggingPos(pos);
  };

  const onDropCandidate = async (pos: string, overId: string) => {
    if (!draggingId || draggingPos !== pos) return;

    const list = [...(candidatesByPosition[pos] || [])];
    const fromIdx = list.findIndex((c) => c.id === draggingId);
    const toIdx = list.findIndex((c) => c.id === overId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
      setDraggingId(null);
      setDraggingPos(null);
      return;
    }

    // reorder
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);

    // update local immediately
    const orderedIds = list.map((c) => c.id);
    setCandidates((prev) => {
      const others = prev.filter((c) => c.position !== pos);
      const reordered = list.map((c, idx) => ({
        ...c,
        display_order: idx,
      }));
      return [...others, ...reordered];
    });

    setDraggingId(null);
    setDraggingPos(null);

    // persist
    await persistOrderForPosition(pos, orderedIds);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      {/* LEFT: Elections */}
      <ElectionsListPanel
        loading={electionsLoading}
        saving={saving}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        onRefresh={reloadElections}
        openCreateElection={openCreateElection}
        operationalElections={operationalElections}
        archivedElections={archivedElections}
        selectedElectionId={selectedElectionId}
        setSelectedElectionId={setSelectedElectionId}
        activeBadge={activeBadge}
        audienceBadge={audienceBadge}
        finalBadge={finalBadge}
        statusBadge={statusBadge}
        archiveBadge={archiveBadge}
        formatDateTimeShort={formatDateTimeShort}
        openEditElection={openEditElection}
        toggleElectionActive={toggleElectionActive}
        openFinalizeElection={openFinalizeElection}
        openArchiveElection={openArchiveElection}
        deleteElection={deleteElection}
        openRestoreElection={openRestoreElection}
      />
      {/* RIGHT: Candidates */}
      <CandidatesManager
        selectedElection={selectedElection}
        selectedElectionId={selectedElectionId}
        candidates={candidates}
        candidatesByPosition={candidatesByPosition}
        candidatesLoading={candidatesLoading}
        saving={saving}
        isSelectedFinal={isSelectedFinal}
        isSelectedArchived={isSelectedArchived}
        loadCandidates={loadCandidates}
        openCreateCandidate={openCreateCandidate}
        openEditCandidate={openEditCandidate}
        deleteCandidate={deleteCandidate}
        onDragStartCandidate={onDragStartCandidate}
        onDropCandidate={onDropCandidate}
        formatDateTimeShort={formatDateTimeShort}
        getCandidateDisplayName={getCandidateDisplayName}
      />

      {/* Election dialog */}
      <ElectionEditorDialog
  open={electionDialogOpen}
  onOpenChange={setElectionDialogOpen}
  editingElection={editingElection}
  eForm={eForm}
  setEForm={setEForm}
  audienceEditable={audienceEditable}
  orgOptionsLoading={orgOptionsLoading}
  orgOptions={orgOptions}
  toggleSelectedOrg={toggleSelectedOrg}
  normalizeOrgList={normalizeOrgList}
  getOrgLabel={getOrgLabel}
  removeSelectedOrg={removeSelectedOrg}
  addCustomOrg={addCustomOrg}
  saveElection={saveElection}
  saving={saving}
/>


<CandidateEditorDialog
        open={candidateDialogOpen}
        onOpenChange={(open) => {
          setCandidateDialogOpen(open);
          if (!open) resetPhotoState();
        }}
        editingCandidate={editingCandidate}
        bucketName={CANDIDATE_PHOTO_BUCKET}
        photoPreviewUrl={photoPreviewUrl}
        setPhotoPreviewUrl={setPhotoPreviewUrl}
        setPhotoFile={setPhotoFile}
        fileInputRef={fileInputRef}
        positions={positions}
        cForm={cForm}
        setCForm={setCForm}
        onClearPhoto={() => {
          resetPhotoState();
          if (editingCandidate?.photo_url) setPhotoPreviewUrl(editingCandidate.photo_url);
        }}
        onSave={saveCandidate}
        saving={saving}
      />

      {/* Finalize election dialog */}
      <Dialog
        open={finalizeDialogOpen}
        onOpenChange={(open) => {
          setFinalizeDialogOpen(open);
          if (!open) {
            setFinalizeTarget(null);
            setFinalizeConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Finalize Election
            </DialogTitle>
            <DialogDescription>
              Finalizing is <b>permanent</b>. This will lock the election
              definition, candidates, and votes from any further modifications.
              Reporting and exports remain available.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="rounded-xl border p-3 bg-muted/20">
              <div className="font-semibold">{finalizeTarget?.title ?? "—"}</div>
              {finalizeTarget ? (
                <div className="text-xs text-muted-foreground mt-1">
                  {formatDateTimeShort(finalizeTarget.start_date)} —{" "}
                  {formatDateTimeShort(finalizeTarget.end_date)}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-red-600/30 bg-red-600/5 p-3">
              <div className="text-sm font-medium text-red-800">
                This action cannot be undone.
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Type <b>FINALIZE</b> below to confirm.
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Confirmation</Label>
              <Input
                value={finalizeConfirmText}
                onChange={(e) => setFinalizeConfirmText(e.target.value)}
                placeholder='Type "FINALIZE"'
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setFinalizeDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmFinalizeElection}
                disabled={
                  saving ||
                  finalizeConfirmText.trim().toUpperCase() !== "FINALIZE"
                }
              >
                <Lock className="h-4 w-4 mr-2" />
                Finalize (Permanent)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive election dialog */}
      <Dialog
        open={archiveDialogOpen}
        onOpenChange={(open) => {
          setArchiveDialogOpen(open);
          if (!open) {
            setArchiveTarget(null);
            setArchiveConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Archive Election</DialogTitle>
            <DialogDescription>
              Archiving hides a finalized election from the operational list, but
              keeps it available as read-only history. This does not delete any
              data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="font-semibold">{archiveTarget?.title ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Type <b>ARCHIVE</b> to confirm.
              </div>
            </div>

            <div className="space-y-2">
              <Label>Confirmation</Label>
              <Input
                value={archiveConfirmText}
                onChange={(e) => setArchiveConfirmText(e.target.value)}
                placeholder="Type ARCHIVE"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setArchiveDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmArchiveElection}
                disabled={
                  saving || archiveConfirmText.trim().toUpperCase() !== "ARCHIVE"
                }
              >
                Archive
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore election dialog */}
      <Dialog
        open={restoreDialogOpen}
        onOpenChange={(open) => {
          setRestoreDialogOpen(open);
          if (!open) {
            setRestoreTarget(null);
            setRestoreConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Restore Archived Election</DialogTitle>
            <DialogDescription>
              Restoring returns the election to the operational list. The election
              remains finalized and read-only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="font-semibold">{restoreTarget?.title ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Type <b>RESTORE</b> to confirm.
              </div>
            </div>

            <div className="space-y-2">
              <Label>Confirmation</Label>
              <Input
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="Type RESTORE"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setRestoreDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmRestoreElection}
                disabled={
                  saving || restoreConfirmText.trim().toUpperCase() !== "RESTORE"
                }
              >
                Restore
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}