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
} from "lucide-react";

type ElectionRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean | null;
  eligible_orgs: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CandidateRow = {
  id: string;
  election_id: string;
  name: string;
  position: string;
  slate: string | null;
  photo_url: string | null;
  bio: string | null;
  display_order: number | null;
  vote_count: number | null;
  created_at?: string;
  updated_at?: string;
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

  // Candidate dialog
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<CandidateRow | null>(
    null
  );
  const [cForm, setCForm] = useState({
    name: "",
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
      setSelectedElectionId((data[0] as any).id);
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

  const saveElection = async () => {
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
    setEditingCandidate(null);
    setCForm({
      name: "",
      position: prefillPosition ?? "",
      slate: "",
      bio: "",
      display_order: nextDisplayOrder(prefillPosition ?? ""),
    });
    resetPhotoState();
    setCandidateDialogOpen(true);
  };

  const openEditCandidate = (c: CandidateRow) => {
    setEditingCandidate(c);
    setCForm({
      name: c.name ?? "",
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
    if (!cForm.name.trim()) return toast.error("Candidate name is required.");
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
            name: cForm.name.trim(),
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
          name: cForm.name.trim(),
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


  // --- Drag & Drop reorder (per position) ---
  const persistOrderForPosition = async (position: string, orderedIds: string[]) => {
    if (!selectedElectionId) return;
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Elections
          </CardTitle>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadElections}
              disabled={loading || saving}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" onClick={openCreateElection}>
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading elections…</div>
          ) : elections.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No elections yet. Click <b>New</b>.
            </div>
          ) : (
            elections.map((e) => {
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
                        disabled={saving}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>

                      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <span className="text-xs font-medium">Active</span>
                        <Switch
                          checked={Boolean(e.is_active)}
                          disabled={saving}
                          onCheckedChange={() => toggleElectionActive(e)}
                        />
                      </div>

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteElection(e.id)}
                        disabled={saving}
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
              disabled={!selectedElectionId}
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
                              draggable
                              onDragStart={() => onDragStartCandidate(pos, c.id)}
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
                                    <div className="font-semibold truncate">{c.name}</div>
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
                                  disabled={saving}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => deleteCandidate(c.id)}
                                  disabled={saving}
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

            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={cForm.name}
                onChange={(e) => setCForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g., Juan Dela Cruz"
              />
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
    </div>
  );
}
