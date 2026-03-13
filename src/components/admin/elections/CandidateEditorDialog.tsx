import { useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
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

  // Optional (some parents pass this for display/debug)
  bucketName?: string;

  editingCandidate: CandidateRowLike | null;

  /** Candidate photo URL preview (existing URL OR a local blob URL while editing). */
  photoPreviewUrl: string | null;
  setPhotoPreviewUrl: Dispatch<SetStateAction<string | null>>;

  /** Parent-managed file state used to upload to Supabase Storage. */
  setPhotoFile: Dispatch<SetStateAction<File | null>>;

  /** Optional ref so the parent can reset the input value. */
  fileInputRef?: RefObject<HTMLInputElement | null>;

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

async function convertToSquareWebp512(file: File, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }
  // Soft guard: avoid freezing low-end admin machines.
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Image is too large (max 10MB).");
  }

  const img = await createImageBitmap(file);
  const srcW = img.width;
  const srcH = img.height;
  const side = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - side) / 2);
  const sy = Math.floor((srcH - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");

  ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image."))),
      "image/webp",
      quality
    );
  });

  const outName = `candidate-${Date.now()}.webp`;
  return new File([blob], outName, { type: "image/webp" });
}

export function CandidateEditorDialog(props: Props) {
  const {
    open,
    onOpenChange,
    editingCandidate,
    photoPreviewUrl,
    setPhotoPreviewUrl,
    setPhotoFile,
    fileInputRef,
    positions,
    cForm,
    setCForm,
    onClearPhoto,
    onSave,
    saving,
  } = props;

  const savedPhotoUrl = editingCandidate?.photo_url ?? null;

  const [photoUrlInput, setPhotoUrlInput] = useState<string>("");
  const [photoProcessing, setPhotoProcessing] = useState(false);

  const showSavedTag = useMemo(() => {
    if (!editingCandidate) return false;
    if (!savedPhotoUrl) return false;
    return photoPreviewUrl === savedPhotoUrl;
  }, [editingCandidate, photoPreviewUrl, savedPhotoUrl]);

  const handlePickFile = async (file: File | null) => {
    if (!file) return;

    setPhotoProcessing(true);
    let toastId: string | number | undefined;
    try {
      toastId = toast.loading("Converting image to WebP (512×512)…");
      const converted = await convertToSquareWebp512(file);

      setPhotoFile(converted);

      const localUrl = URL.createObjectURL(converted);
      setPhotoPreviewUrl((prev) => {
        if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return localUrl;
      });

      setPhotoUrlInput("");
      toast.success(`Ready (${Math.round(converted.size / 1024)} KB WebP)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to process image.");
      setPhotoFile(null);
    } finally {
      if (toastId !== undefined) toast.dismiss(toastId);
      setPhotoProcessing(false);
      if (fileInputRef?.current) fileInputRef.current.value = "";
    }
  };

  const applyUrlPhoto = () => {
    const v = normalizePhotoUrl(photoUrlInput);
    if (!v) {
      toast.error("Paste an image URL first.");
      return;
    }
    if (!isProbablyUrl(v)) {
      toast.error("Please enter a valid http(s) URL.");
      return;
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(v);
    toast.success("Photo URL set.");
  };

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
                    <Label>Given name</Label>
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
                      className="w-full h-10"
                      list="candidate-position-options"
                      value={cForm.position}
                      onChange={(e) =>
                        setCForm((p) => ({ ...p, position: e.target.value }))
                      }
                      placeholder="e.g., President"
                    />
                    {positions.length > 0 ? (
                      <datalist id="candidate-position-options">
                        {positions.map((pos) => (
                          <option key={pos} value={pos} />
                        ))}
                      </datalist>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      Type a new position or pick an existing one from suggestions.
                    </div>
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
                      <div className="font-semibold">Candidate photo</div>
                      <div className="text-xs text-muted-foreground">
                        Upload auto-converts to <b>WebP</b> and enforces <b>512×512</b> (square crop).
                      </div>
                      {showSavedTag ? (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Using saved photo.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={onClearPhoto}>
                      Clear
                    </Button>
                  </div>
                </div>

                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="w-full justify-start">
                    <TabsTrigger value="upload">Upload</TabsTrigger>
                    <TabsTrigger value="url">Use URL</TabsTrigger>
                  </TabsList>

                  <TabsContent value="upload" className="mt-3">
                    <div className="grid gap-2">
                      <Label>Upload image</Label>
                      <Input
                        ref={fileInputRef as any}
                        type="file"
                        accept="image/*"
                        disabled={photoProcessing || saving}
                        onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
                      />
                      <div className="text-xs text-muted-foreground">
                        Center-crop → resize to 512×512 → encode WebP.
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="url" className="mt-3">
                    <div className="grid gap-2">
                      <Label className="flex items-center gap-2">
                        <LinkIcon className="h-4 w-4" />
                        Image URL
                      </Label>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          value={photoUrlInput}
                          placeholder="https://example.com/candidate.jpg"
                          onChange={(e) => setPhotoUrlInput(e.target.value)}
                          disabled={photoProcessing || saving}
                          inputMode="url"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={applyUrlPhoto}
                          className="shrink-0"
                          disabled={photoProcessing || saving}
                        >
                          <LinkIcon className="h-4 w-4 mr-2" />
                          Apply
                        </Button>
                      </div>

                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <LinkIcon className="h-3.5 w-3.5" />
                        URL photos won't be converted/compressed. Prefer upload for kiosk performance.
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
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
          <Button onClick={onSave} disabled={saving || photoProcessing}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
