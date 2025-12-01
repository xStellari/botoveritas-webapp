import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Edit, CheckCircle2, Shield } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import type { CandidateSelection } from "@/pages/VotingKiosk";

export interface VoterData {
  id: string;
  email: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  year_level: string;
  org_affiliations?: string[] | null;
  rfid_tag?: string | null;
  face_id_hash?: string | null;
  created_at: string;
  rfidVerified?: boolean;
  faceVerified?: boolean;
}

interface ReviewScreenProps {
  voterData: VoterData;
  selections: CandidateSelection[];
  onConfirm: () => void;
  onEdit: (action: "edit-ballot") => void;  // simplified: only edit ballot
  showAll?: boolean;
}

const ReviewScreen = ({
  voterData,
  selections,
  onConfirm,
  onEdit,
  showAll = false
}: ReviewScreenProps) => {
  
  const groupedSelections = showAll
    ? selections.reduce((acc: Record<string, CandidateSelection[]>, sel) => {
        const key = sel.position.split(":")[0] || sel.slate;
        if (!acc[key]) acc[key] = [];
        acc[key].push(sel);
        return acc;
      }, {})
    : null;

  return (
    <div className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-4xl">

        {/* Header */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <img src={feuLogo} alt="FEU" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  {showAll ? "Final Review of All Ballots" : "Review Your Ballot"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {showAll
                    ? "Please review all your selections across every election before submitting."
                    : "Please review your selections before confirming."}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Warning */}
        <Card className="mb-6 border-2 border-warning/50 bg-warning/5">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <AlertCircle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-lg mb-2">Important Notice</h3>
                <p className="text-sm text-muted-foreground">
                  Once you confirm your vote, it <strong>cannot be changed</strong>.
                  Your vote will be permanently stored on the blockchain.
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Voter Information */}
        <Card className="mb-6 border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Voter Information
            </h2>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-medium">
                  {voterData.first_name}{" "}
                  {voterData.middle_name ? voterData.middle_name + " " : ""}
                  {voterData.last_name}
                </p>
              </div>

              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium">{voterData.email}</p>
              </div>

              <div>
                <p className="text-muted-foreground">Year Level</p>
                <p className="font-medium">{voterData.year_level}</p>
              </div>

              <div>
                <p className="text-muted-foreground">Authentication</p>
                <div className="flex gap-2 mt-1">
                  {voterData.rfidVerified && (
                    <Badge variant="outline" className="bg-success/5 text-success">
                      RFID ✓
                    </Badge>
                  )}
                  {voterData.faceVerified && (
                    <Badge variant="outline" className="bg-success/5 text-success">
                      Face ✓
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Selections */}
        <Card className="mb-6 border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              {showAll ? "All Selections" : "Selections"}
            </h2>

            <ScrollArea className="h-[60vh] pr-4 overflow-y-auto">
              <div className="space-y-6">
                {showAll
                  ? Object.entries(groupedSelections!).map(([group, list]) => (
                      <div key={group}>
                        <h3 className="font-semibold text-md mb-3">{group}</h3>

                        {list.map((sel, index) => (
                          <div key={index} className="mb-4">
                            <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg flex justify-between">
                              <div>
                                <p className="text-sm text-muted-foreground">{sel.position}</p>
                                <p className="font-semibold text-lg">{sel.candidateName}</p>
                                <Badge variant="outline" className="mt-2 bg-secondary/10">
                                  {sel.slate}
                                </Badge>
                              </div>
                              <CheckCircle2 className="h-6 w-6 text-success" />
                            </div>
                          </div>
                        ))}

                        <Separator className="my-4" />
                      </div>
                    ))
                  : selections.map((sel, index) => (
                      <div key={index}>
                        <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg flex justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">{sel.position}</p>
                            <p className="font-semibold text-lg">{sel.candidateName}</p>
                            <Badge variant="outline" className="mt-2 bg-secondary/10">
                              {sel.slate}
                            </Badge>
                          </div>
                          <CheckCircle2 className="h-6 w-6 text-success" />
                        </div>

                        {index < selections.length - 1 && <Separator className="my-4" />}
                      </div>
                    ))}
              </div>
            </ScrollArea>
          </div>
        </Card>

        {/* Buttons */}
        <div className="flex gap-4">
          
          {/* ONLY show Edit Ballot for single-election review */}
          {!showAll && (
            <Button
              variant="outline"
              className="flex-1 h-14 text-lg border-2"
              onClick={() => onEdit("edit-ballot")}
            >
              <Edit className="mr-2 h-5 w-5" />
              Edit Ballot
            </Button>
          )}

          {/* Confirm button */}
          <Button
            className="flex-1 h-14 text-lg bg-gradient-primary hover:opacity-90 shadow-glow"
            onClick={onConfirm}
          >
            <CheckCircle2 className="mr-2 h-6 w-6" />
            {showAll ? "Confirm & Submit All Votes" : "Confirm Vote"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ReviewScreen;
