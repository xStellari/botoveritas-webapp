import type { Dispatch, SetStateAction } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { ElectionFormState } from "./types";

type Props = {
  eForm: ElectionFormState;
  setEForm: Dispatch<SetStateAction<ElectionFormState>>;
};

export function ElectionDetailsEditor({ eForm, setEForm }: Props) {
  return (
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
            onChange={(e) => setEForm((p) => ({ ...p, endLocal: e.target.value }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <div className="font-semibold">Active flag</div>
          <div className="text-xs text-muted-foreground">
            Optional admin flag. The status badge uses time unless the election
            is finalized/archived.
          </div>
        </div>
        <Switch
          checked={eForm.is_active}
          onCheckedChange={(v) => setEForm((p) => ({ ...p, is_active: v }))}
        />
      </div>
    </div>
  );
}
