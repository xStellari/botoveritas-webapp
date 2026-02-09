import type { Dispatch, RefObject, SetStateAction } from "react";
import { Image as ImageIcon, Save, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  bucketName: string;

  photoPreviewUrl: string | null;
  setPhotoPreviewUrl: Dispatch<SetStateAction<string | null>>;
  setPhotoFile: Dispatch<SetStateAction<File | null>>;
  fileInputRef: RefObject<HTMLInputElement>;

  positions: string[];

  // Optional alias used by some callers (kept for backwards-compat)
  positionOrder?: string[];
  cForm: CandidateFormState;
  setCForm: Dispatch<SetStateAction<CandidateFormState>>;

  onClearPhoto: () => void;

  onSave: () => void;
  saving: boolean;
};

export function CandidateEditorDialog(props: Props) {
  const {
    open,
    onOpenChange,
    editingCandidate,
    bucketName,
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

                      // Revoke previous blob preview if needed
                      if (
                        photoPreviewUrl &&
                        photoPreviewUrl.startsWith("blob:")
                      ) {
                        URL.revokeObjectURL(photoPreviewUrl);
                      }

                      if (f) {
                        const url = URL.createObjectURL(f);
                        setPhotoPreviewUrl(url);
                      } else {
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

                  <Button type="button" variant="outline" onClick={onClearPhoto}>
                    Clear
                  </Button>
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