import type { Dispatch, SetStateAction } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AudienceEditor } from "./AudienceEditor";
import { ElectionDetailsEditor } from "./ElectionDetailsEditor";

import type { ElectionFormState, OrganizationRow } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  editingElection: unknown | null;

  eForm: ElectionFormState;
  setEForm: Dispatch<SetStateAction<ElectionFormState>>;

  audienceEditable: boolean;

  orgOptionsLoading: boolean;
  orgOptions: OrganizationRow[];

  toggleSelectedOrg: (code: string) => void;
  removeSelectedOrg: (code: string) => void;
  addCustomOrg: () => void;

  normalizeOrgList: (codes: string[]) => string[];
  getOrgLabel: (code: string) => string;

  saveElection: () => void;
  saving: boolean;
};

export function ElectionEditorDialog(props: Props) {
  const {
    open,
    onOpenChange,
    editingElection,
    eForm,
    setEForm,
    audienceEditable,
    orgOptionsLoading,
    orgOptions,
    toggleSelectedOrg,
    removeSelectedOrg,
    addCustomOrg,
    normalizeOrgList,
    getOrgLabel,
    saveElection,
    saving,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[720px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {editingElection ? "Edit Election" : "Create Election"}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="audience">Audience</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto pr-1 pb-6">
            <TabsContent value="details" className="mt-4">
              <ElectionDetailsEditor eForm={eForm} setEForm={setEForm} />
            </TabsContent>

            <TabsContent value="audience" className="mt-4">
            <AudienceEditor
              audienceEditable={audienceEditable}
              eForm={eForm}
              setEForm={setEForm}
              orgOptionsLoading={orgOptionsLoading}
              orgOptions={orgOptions}
              toggleSelectedOrg={toggleSelectedOrg}
              removeSelectedOrg={removeSelectedOrg}
              addCustomOrg={addCustomOrg}
              normalizeOrgList={normalizeOrgList}
              getOrgLabel={getOrgLabel}
            />
          </TabsContent>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t bg-background sticky bottom-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={saveElection} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
