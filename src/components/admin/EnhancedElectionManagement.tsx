import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Plus,
  Save,
  Trash2,
  Pencil,
  RefreshCcw,
  Users,
  Calendar,
  GripVertical,
  Upload,
  Image as ImageIcon,
  Lock,
} from "lucide-react";

type ElectionRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean | null;
  eligible_orgs: string[] | null;
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

function getElectionState(e: ElectionRow) {
  const now = Date.now();
  const start = new Date(e.start_date).getTime();
  const end = new Date(e.end_date).getTime();
  if (now < start) return "UPCOMING" as const;
  if (now > end) return "CLOSED" as const;
  return "ONGOING" as const;
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

export default function EnhancedElectionManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [selectedElectionId, setSelectedElectionId] = useState<string | null>(
    null
  );

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
    eligible_orgs_csv: "",
  });

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
    loadElections();
  }, []);

  useEffect(() => {
    if (!selectedElectionId) {
      setCandidates([]);
      return;
    }
    loadCandidates(selectedElectionId);
  }, [selectedElectionId]);

  useEffect(() => {
    // cleanup preview URL on dialog close / file changes
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadElections = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("elections")
      .select("*")
      // ✅ change: order by start_date (ascending)
      .order("start_date", { ascending: true });

    if (error) {
      toast.error(`Failed to load elections: ${error.message}`);
      setLoading(false);
      return;
    }

    setElections((data as ElectionRow[]) || []);
    setLoading(false);

    if (!selectedElectionId && data && data.length > 0) {
      const firstNonArchived = (data as any[]).find((x) => !x.is_archived) ?? (data as any[])[0];
      setSelectedElectionId(firstNonArchived?.id ?? null);
    }
  };

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
      eligible_orgs_csv: "",
    });
    setElectionDialogOpen(true);
  };

  const openEditElection = (e: ElectionRow) => {
    if (Boolean(e.is_final)) {
      toast.error("This election is finalized and cannot be edited.");
      return;
    }
    setEditingElection(e);
    setEForm({
      title: e.title ?? "",
      description: e.description ?? "",
      startLocal: isoLocalForInput(e.start_date),
      endLocal: isoLocalForInput(e.end_date),
      is_active: !!e.is_active,
      eligible_orgs_csv: (e.eligible_orgs || []).join(", "),
    });
    setElectionDialogOpen(true);
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

      const { error } = await supabase
        .from("elections")
        .update({
          is_final: true,
          // Optional but recommended: store who finalized
          finalized_by: user?.id ?? null,
          finalized_by_email: user?.email ?? null,
        })
        .eq("id", finalizeTarget.id);

      if (error) throw error;

      toast.success("Election finalized. Editing is now locked.");
      setFinalizeDialogOpen(false);
      setFinalizeTarget(null);
      setFinalizeConfirmText("");

      await loadElections();

      // If currently selected, refresh candidates too (read-only view)
      if (selectedElectionId) {
        await loadCandidates(selectedElectionId);
      }

      // Close any open edit dialogs (they may now be invalid)
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

      const { error } = await supabase
        .from("elections")
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archived_by_email: user?.email ?? null,
        } as any)
        .eq("id", archiveTarget.id);

      if (error) throw error;

      toast.success("Election archived.");
      await loadElections();

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
          archived_at: null,
          archived_by: null,
          archived_by_email: null,
        } as any)
        .eq("id", restoreTarget.id);

      if (error) throw error;

      toast.success("Election restored to operational list.");
      await loadElections();

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

    const eligible_orgs = eForm.eligible_orgs_csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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
            eligible_orgs: eligible_orgs.length ? eligible_orgs : null,
          })
          .select("*")
          .single();

        if (error) throw error;

        toast.success("Election created.");
        setElectionDialogOpen(false);
        await loadElections();
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
          eligible_orgs: eligible_orgs.length ? eligible_orgs : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingElection.id);

      if (error) throw error;

      toast.success("Election updated.");
      setElectionDialogOpen(false);
      await loadElections();
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
        // ✅ change: do NOT update updated_at here (prevents reorder side-effects)
        .update({ is_active: next })
        .eq("id", e.id);

      if (error) throw error;

      toast.success(next ? "Election activated." : "Election deactivated.");
      // ✅ change: removed loadElections() here to avoid reordering/jumping
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
      await loadElections();
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
    if (isSelectedFinal) return toast.error("This election is finalized. Candidates are locked.");
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
    if (isSelectedFinal) return toast.error("This election is finalized. Candidates are locked.");
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
    if (isSelectedFinal) return toast.error("This election is finalized. Candidates are locked.");
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
    const state = getElectionState(e);
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
      <Badge className="border-red-600 text-red-700 bg-red-600/10">
        Closed
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
  const persistOrderForPosition = async (position: string, orderedIds: string[]) => {
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
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Elections
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadElections}
              disabled={loading || saving}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-xs font-medium">Show Archived</span>
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            </div>

            <Button size="sm" onClick={openCreateElection}>
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading elections…</div>
          ) : operationalElections.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No elections yet. Click <b>New</b>.
            </div>
          ) : (
            operationalElections.map((e) => {
              const selected = e.id === selectedElectionId;
              return (
                <div
                  key={e.id}
                  className={`rounded-xl border p-3 transition ${
                    selected
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setSelectedElectionId(e.id)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold">{e.title}</div>
                        {activeBadge(e)}
                        {finalBadge(e)}
                        {statusBadge(e)}
                      </div>

                      {e.description ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {e.description}
                        </div>
                      ) : null}

                      {/* ✅ change: shorter time display */}
                      <div className="text-xs text-muted-foreground mt-2">
                        {formatDateTimeShort(e.start_date)} —{" "}
                        {formatDateTimeShort(e.end_date)}
                      </div>

                      {e.eligible_orgs?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.eligible_orgs.slice(0, 6).map((org) => (
                            <Badge key={org} variant="secondary">
                              {org}
                            </Badge>
                          ))}
                          {e.eligible_orgs.length > 6 ? (
                            <Badge variant="outline">
                              +{e.eligible_orgs.length - 6}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Eligible orgs: <span className="italic">all</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditElection(e)}
                        disabled={saving || Boolean(e.is_final)}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>

                      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <span className="text-xs font-medium">Active</span>
                        <Switch
                          checked={Boolean(e.is_active)}
                          disabled={saving || Boolean(e.is_final)}
                          onCheckedChange={() => toggleElectionActive(e)}
                        />
                      </div>

                      {Boolean(e.is_final) ? (
                        <>
                          <div className="rounded-md border px-3 py-2">

                          <div className="text-xs font-medium flex items-center gap-2">
                            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                            Finalized
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {e.finalized_at
                              ? formatDateTimeShort(e.finalized_at)
                              : "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Finalized by: {e.finalized_by_email || (e.finalized_by ? `${e.finalized_by.slice(0, 8)}…` : "—")}
                          </div>
                        </div>

                          {!Boolean(e.is_archived) ? (
                            <Button
                              className="mt-3 w-full"
                              variant="outline"
                              size="sm"
                              onClick={() => openArchiveElection(e)}
                              disabled={saving}
                            >
                              Archive
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openFinalizeElection(e)}
                          disabled={saving}
                        >
                          <Lock className="h-4 w-4 mr-2" />
                          Finalize
                        </Button>
                      )}

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteElection(e.id)}
                        disabled={saving || Boolean(e.is_final)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        
        {showArchived ? (
          <>
            <Separator className="my-6" />
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Archived Elections</div>
                <div className="text-xs text-muted-foreground">
                  Archived elections are hidden from the operational list, but remain viewable as read-only history.
                </div>
              </div>
              <Badge variant="outline">{archivedElections.length}</Badge>
            </div>

            {archivedElections.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-3">
                No archived elections.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {archivedElections.map((e) => (
                  <div
                    key={e.id}
                    className={`rounded-2xl border p-4 transition ${selectedElectionId === e.id ? "border-amber-500/60 bg-amber-500/5" : "hover:bg-muted/30"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div
                        className="flex-1 cursor-pointer"
                        onClick={() => setSelectedElectionId(e.id)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold">{e.title}</div>
                          {archiveBadge(e)}
                          {finalBadge(e)}
                          {statusBadge(e)}
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          {formatDateTimeShort(e.start_date)} — {formatDateTimeShort(e.end_date)}
                        </div>

                        <div className="text-xs text-muted-foreground mt-2">
                          Archived at: {e.archived_at ? formatDateTimeShort(e.archived_at) : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Archived by:{" "}
                          {e.archived_by_email ||
                            (e.archived_by ? `${e.archived_by.slice(0, 8)}…` : "—")}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRestoreElection(e)}
                          disabled={saving}
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
</CardContent>
      </Card>

      {/* RIGHT: Candidates */}
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Candidates
          </CardTitle>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedElectionId || candidatesLoading || saving}
              onClick={() => selectedElectionId && loadCandidates(selectedElectionId)}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>

            <Button
              size="sm"
              onClick={() => openCreateCandidate()}
              disabled={!selectedElectionId || isSelectedFinal}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Candidate
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!selectedElection ? (
            <div className="text-sm text-muted-foreground">
              Select an election to manage its candidates.
            </div>
          ) : (
            <>
              <div className="rounded-xl border p-3 bg-muted/20">
                <div className="font-semibold">{selectedElection.title}</div>

                {/* ✅ change: shorter time display */}
                <div className="text-xs text-muted-foreground mt-1">
                  {formatDateTimeShort(selectedElection.start_date)} —{" "}
                  {formatDateTimeShort(selectedElection.end_date)}
                </div>
                {isSelectedFinal ? (
                  <div className="mt-3 rounded-lg border border-violet-600/30 bg-violet-600/5 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium text-violet-800">
                      <Lock className="h-4 w-4" />
                      Finalized election (read-only)
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Editing election details, candidates, and votes is locked. Reporting remains available.
                    </div>
                  </div>
                ) : null}

              </div>

              {candidatesLoading ? (
                <div className="text-sm text-muted-foreground">Loading candidates…</div>
              ) : candidates.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No candidates yet. Click <b>Add Candidate</b>.
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.keys(candidatesByPosition)
                    .sort((a, b) => a.localeCompare(b))
                    .map((pos) => (
                      <div key={pos} className="rounded-2xl border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold">{pos}</div>
                            <div className="text-xs text-muted-foreground">
                              {candidatesByPosition[pos].length} candidate(s)
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Drag candidates to reorder (auto-saves).
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCreateCandidate(pos)}
                            disabled={isSelectedFinal}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add to {pos}
                          </Button>
                        </div>

                        <Separator className="my-4" />

                        <div className="space-y-3">
                          {candidatesByPosition[pos].map((c) => (
                            <div
                              key={c.id}
                              className="rounded-xl border p-3 flex items-start justify-between gap-3"
                              draggable={!isSelectedFinal}
                              onDragStart={() => !isSelectedFinal && onDragStartCandidate(pos, c.id)}
                              onDragOver={(e) => {
                                // allow drop
                                e.preventDefault();
                              }}
                              onDrop={() => onDropCandidate(pos, c.id)}
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                {/* Drag handle */}
                                <div className="mt-1 text-muted-foreground cursor-grab">
                                  <GripVertical className="h-5 w-5" />
                                </div>

                                {/* Candidate photo (auto-crop circle) */}
                                <div className="w-16 h-16 rounded-full overflow-hidden border bg-muted flex items-center justify-center flex-shrink-0">
                                  {c.photo_url ? (
                                    <img
                                      src={c.photo_url}
                                      alt={c.name}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).src = "";
                                      }}
                                    />
                                  ) : (
                                    <Users className="h-9 w-9 text-muted-foreground" />
                                  )}
                                </div>

                                {/* Candidate info */}
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className="font-semibold truncate">{getCandidateDisplayName(c)}</div>
                                    {c.slate ? (
                                      <Badge variant="secondary">{c.slate}</Badge>
                                    ) : null}
                                    <Badge variant="outline">
                                      Order: {c.display_order ?? 0}
                                    </Badge>
                                  </div>

                                  {c.bio ? (
                                    <div className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                      {c.bio}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground mt-2 italic">
                                      No bio.
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditCandidate(c)}
                                  disabled={saving || isSelectedFinal}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => deleteCandidate(c.id)}
                                  disabled={saving || isSelectedFinal}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Election dialog */}
      <Dialog open={electionDialogOpen} onOpenChange={setElectionDialogOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {editingElection ? "Edit Election" : "Create Election"}
            </DialogTitle>
            <DialogDescription>
              This will sync directly to your <b>elections</b> table.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={eForm.title}
                onChange={(e) => setEForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g., SCC Elections 2026"
              />
            </div>

            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={eForm.description}
                onChange={(e) =>
                  setEForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Optional details shown to voters"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Start date & time</Label>
                <Input
                  type="datetime-local"
                  value={eForm.startLocal}
                  onChange={(e) =>
                    setEForm((p) => ({ ...p, startLocal: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>End date & time</Label>
                <Input
                  type="datetime-local"
                  value={eForm.endLocal}
                  onChange={(e) =>
                    setEForm((p) => ({ ...p, endLocal: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="font-semibold">Active flag</div>
                <div className="text-xs text-muted-foreground">
                  Optional admin flag. The status badge uses time (Upcoming/Ongoing/Closed).
                </div>
              </div>
              <Switch
                checked={eForm.is_active}
                onCheckedChange={(v) => setEForm((p) => ({ ...p, is_active: v }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Eligible orgs (comma-separated)</Label>
              <Input
                value={eForm.eligible_orgs_csv}
                onChange={(e) =>
                  setEForm((p) => ({ ...p, eligible_orgs_csv: e.target.value }))
                }
                placeholder="e.g., SCC, ICpEP, HonSoc (leave blank = all)"
              />
              <div className="text-xs text-muted-foreground">
                This maps to your <code>eligible_orgs text[]</code> column.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setElectionDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveElection} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Candidate dialog */}
      <Dialog
        open={candidateDialogOpen}
        onOpenChange={(open) => {
          setCandidateDialogOpen(open);
          if (!open) resetPhotoState();
        }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {editingCandidate ? "Edit Candidate" : "Add Candidate"}
            </DialogTitle>
            <DialogDescription>
              Candidate photo uploads to Supabase Storage bucket:{" "}
              <b>{CANDIDATE_PHOTO_BUCKET}</b>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {/* Photo upload row */}
            <div className="rounded-xl border p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden border bg-muted flex items-center justify-center">
                  {photoPreviewUrl ? (
                    <img
                      src={photoPreviewUrl}
                      alt="Candidate preview"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "";
                      }}
                    />
                  ) : (
                    <ImageIcon className="h-7 w-7 text-muted-foreground" />
                  )}
                </div>

                <div>
                  <div className="font-semibold">Candidate photo</div>
                  <div className="text-xs text-muted-foreground">
                    Auto-cropped to a circle in admin + ballot UI.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setPhotoFile(f);

                    if (photoPreviewUrl && photoPreviewUrl.startsWith("blob:")) {
                      URL.revokeObjectURL(photoPreviewUrl);
                    }

                    if (f) {
                      const url = URL.createObjectURL(f);
                      setPhotoPreviewUrl(url);
                    } else {
                      // keep existing remote URL if editingCandidate had one
                      setPhotoPreviewUrl(editingCandidate?.photo_url ?? null);
                    }
                  }}
                />

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Choose
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetPhotoState();
                    // if editing existing candidate, restore remote url preview
                    if (editingCandidate?.photo_url)
                      setPhotoPreviewUrl(editingCandidate.photo_url);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>First name</Label>
                <Input
                  value={cForm.first_name}
                  onChange={(e) =>
                    setCForm((p) => ({ ...p, first_name: e.target.value }))
                  }
                  placeholder="e.g., Juan"
                />
              </div>

              <div className="grid gap-2">
                <Label>Last name</Label>
                <Input
                  value={cForm.last_name}
                  onChange={(e) =>
                    setCForm((p) => ({ ...p, last_name: e.target.value }))
                  }
                  placeholder="e.g., Dela Cruz"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Position</Label>
                <Input
                  value={cForm.position}
                  onChange={(e) =>
                    setCForm((p) => ({ ...p, position: e.target.value }))
                  }
                  placeholder="e.g., President"
                />
                {positions.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Existing positions:{" "}
                    <span className="font-medium">
                      {positions.slice(0, 6).join(", ")}
                      {positions.length > 6 ? "…" : ""}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label>Slate (optional)</Label>
                <Input
                  value={cForm.slate}
                  onChange={(e) =>
                    setCForm((p) => ({ ...p, slate: e.target.value }))
                  }
                  placeholder="e.g., Team A"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Bio (optional)</Label>
              <Textarea
                value={cForm.bio}
                onChange={(e) => setCForm((p) => ({ ...p, bio: e.target.value }))}
                placeholder="Short profile shown on ballot (optional)"
              />
            </div>

            <div className="grid gap-2">
              <Label>Display order</Label>
              <Select
                value={String(cForm.display_order)}
                onValueChange={(v) =>
                  setCForm((p) => ({ ...p, display_order: Number(v) }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select order" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 51 }).map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                Lower number = appears earlier.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCandidateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveCandidate} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              Finalizing is <b>permanent</b>. This will lock the election definition,
              candidates, and votes from any further modifications. Reporting and exports
              remain available.
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
                  saving || finalizeConfirmText.trim().toUpperCase() !== "FINALIZE"
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
              Archiving hides a finalized election from the operational list, but keeps it available as read-only history. This does not delete any data.
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
              <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmArchiveElection}
                disabled={saving || archiveConfirmText.trim().toUpperCase() !== "ARCHIVE"}
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
              Restoring returns the election to the operational list. The election remains finalized and read-only.
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
              <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmRestoreElection}
                disabled={saving || restoreConfirmText.trim().toUpperCase() !== "RESTORE"}
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