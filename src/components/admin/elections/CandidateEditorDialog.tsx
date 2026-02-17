import type { Dispatch, SetStateAction } from "react";
import { Image as ImageIcon, Save, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type CandidateFormState = {
  first_name: string;
  last_name: string;
  position: string;
  slate: string;
  bio: string;
  display_order: number;
};

type CandidateRowLike = {
  id: string;
  photo_url: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  editingCandidate: CandidateRowLike | null;

  /**
   * Candidate photo URL preview. This should be the final URL that ends up in `candidates.photo_url`.
   * We intentionally do URL-only photos (no Supabase Storage uploads) to avoid storage plan limits.
   */
  photoPreviewUrl: string | null;
  setPhotoPreviewUrl: Dispatch<SetStateAction<string | null>>;

  /**
   * Kept for backwards compatibility with callers that previously managed file uploads.
   * In URL-only mode we always clear file state in the parent (if any) by calling `setPhotoFile(null)`.
   */
  setPhotoFile: Dispatch<SetStateAction<File | null>>;

  positions: string[];

  // Optional alias used by some callers (kept for backwards-compat)
  positionOrder?: string[];
  cForm: CandidateFormState;
  setCForm: Dispatch<SetStateAction<CandidateFormState>>;

  onClearPhoto: () => void;

  onSave: () => void;
  saving: boolean;
};

function normalizePhotoUrl(value: string): string {
  return value.trim();
}

function isProbablyUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function CandidateEditorDialog(props: Props) {
  const {
    open,
    onOpenChange,
    editingCandidate,
    photoPreviewUrl,
    setPhotoPreviewUrl,
    setPhotoFile,
    positions,
    cForm,
    setCForm,
    onClearPhoto,
    onSave,
    saving,
  } = props;

  const savedPhotoUrl = editingCandidate?.photo_url ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Match ElectionEditorDialog layout: viewport-bounded, internal scroll, sticky header/footer */}
      <DialogContent className="w-full sm:max-w-[720px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="sticky top-0 z-8 bg-background border-b pb-2">
          <DialogTitle>
            {editingCandidate ? "Edit Candidate" : "Add Candidate"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 pb-6">
          <Tabs defaultValue="basic" className="mt-2">
            <TabsList className="sticky top-0 z-10 bg-background border-b w-full justify-start rounded-none px-0">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="bio">Bio</TabsTrigger>
              <TabsTrigger value="photo">Photo</TabsTrigger>
              <TabsTrigger value="order">Order</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="mt-4">
              <div className="grid gap-4">
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

                    {positions.length > 0 ? (
                      <Select
                        value={cForm.position}
                        onValueChange={(value) =>
                          setCForm((p) => ({ ...p, position: value }))
                        }
                      >
                        <SelectTrigger className="w-full h-10">
                          <SelectValue placeholder="Select a position" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64 overflow-y-auto">
                          {positions.map((pos) => (
                            <SelectItem key={pos} value={pos}>
                              {pos}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="w-full h-10"
                        value={cForm.position}
                        onChange={(e) =>
                          setCForm((p) => ({ ...p, position: e.target.value }))
                        }
                        placeholder="e.g., President"
                      />
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label>Slate (optional)</Label>
                    <Input
                      className="w-full h-10"
                      value={cForm.slate}
                      onChange={(e) =>
                        setCForm((p) => ({ ...p, slate: e.target.value }))
                      }
                      placeholder="e.g., Team A"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="bio" className="mt-4">
              <div className="grid gap-2">
                <Label>Bio (optional)</Label>
                <Textarea
                  value={cForm.bio}
                  onChange={(e) =>
                    setCForm((p) => ({ ...p, bio: e.target.value }))
                  }
                  placeholder="Short profile shown on ballot (optional)"
                />
              </div>
            </TabsContent>

            <TabsContent value="photo" className="mt-4">
              <div className="rounded-xl border p-4 grid gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden border bg-muted flex items-center justify-center">
                      {photoPreviewUrl ? (
                        <img
                          src={photoPreviewUrl}
                          alt="Candidate preview"
                          className="w-full h-full object-cover"
                          onError={() => {
                            // If the URL is invalid / blocked, keep the text input but drop the broken preview.
                            toast.error(
                              "Could not load that image URL. Check that it is publicly accessible."
                            );
                            setPhotoPreviewUrl(null);
                          }}
                        />
                      ) : (
                        <ImageIcon className="h-7 w-7 text-muted-foreground" />
                      )}
                    </div>

                    <div>
                      <div className="font-semibold">Candidate photo (URL)</div>
                      <div className="text-xs text-muted-foreground">
                        Paste a public HTTPS image URL (recommended). This avoids Supabase Storage limits.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={onClearPhoto}>
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="candidate-photo-url">Photo URL</Label>
                  <Input
                    id="candidate-photo-url"
                    value={photoPreviewUrl ?? ""}
                    placeholder="https://example.com/candidate.jpg"
                    onChange={(e) => {
                      // URL-only mode: ensure any legacy file state is cleared in parent
                      setPhotoFile(null);

                      const next = normalizePhotoUrl(e.target.value);
                      setPhotoPreviewUrl(next.length > 0 ? next : null);
                    }}
                    onBlur={(e) => {
                      const next = normalizePhotoUrl(e.target.value);
                      if (next.length === 0) {
                        setPhotoPreviewUrl(null);
                        return;
                      }

                      if (!isProbablyUrl(next)) {
                        toast.error("Please enter a valid http(s) URL.");
                        setPhotoPreviewUrl(savedPhotoUrl);
                        return;
                      }

                      // Normalize to trimmed string
                      if (next !== e.target.value) {
                        setPhotoPreviewUrl(next);
                      }
                    }}
                  />

                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <LinkIcon className="h-3.5 w-3.5" />
                    Tip: use a publicly accessible URL (CDN / GitHub raw / school site).
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="order" className="mt-4">
              <div className="grid gap-2">
                <Label>Display order</Label>
                <Select
                  value={String(cForm.display_order)}
                  onValueChange={(v) =>
                    setCForm((p) => ({ ...p, display_order: Number(v) }))
                  }
                >
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="Select order" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 overflow-y-auto">
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
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t bg-background sticky bottom-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
