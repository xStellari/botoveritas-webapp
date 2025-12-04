import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Edit, CheckCircle2, Shield, Clock } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import type { CandidateSelection } from "@/pages/VotingKiosk";

export interface VoterData {
  id: string;
  email: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  suffix: string;
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
  onEdit: (action: "edit-ballot") => void;
  showAll?: boolean;
  timeLeft: number;
  activeElections: any[];
  completedElections: string[];
}

const ReviewScreen = ({
  voterData,
  selections,
  onConfirm,
  onEdit,
  showAll = false,
  timeLeft,
  activeElections,
  completedElections,
}: ReviewScreenProps) => {

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // ---------------------------------------------------------
  // GROUP BY ELECTION (using electionId & electionName)
  // ---------------------------------------------------------
  const groupedByElection = showAll
    ? selections.reduce((acc: Record<string, { name: string; items: CandidateSelection[] }>, sel) => {
        if (!acc[sel.electionId]) {
          acc[sel.electionId] = {
            name: sel.electionName ?? "Election",
            items: []
          };
        }
        acc[sel.electionId].items.push(sel);
        return acc;
      }, {})
    : null;

  return (
    <div className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-4xl">

        {/* ------------------------------------ */}
        {/* HEADER WITH TIMER                    */}
        {/* ------------------------------------ */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img src={feuLogo} alt="FEU" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  {showAll ? "Final Review of All Ballots" : "Review Your Ballot"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {showAll
                    ? "Review your selections across all elections before submitting."
                    : "Please review your selections before confirming."}
                </p>
              </div>
            </div>

            {/* TIMER */}
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                timeLeft < 60000
                  ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              }`}
            >
              <Clock className="h-5 w-5" />
              <span className="font-mono text-lg font-bold">
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </Card>

        {/* ------------------------------------ */}
        {/* WARNING CARD                         */}
        {/* ------------------------------------ */}
        <Card className="mb-6 border-2 border-warning/50 bg-warning/5">
          <div className="p-6 flex items-start gap-4">
            <AlertCircle className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-lg mb-2">Important Notice</h3>
              <p className="text-sm text-muted-foreground">
                Once you confirm your vote, it <strong>cannot be changed</strong>.  
                Your vote will be permanently stored on the blockchain.
              </p>
            </div>
          </div>
        </Card>

        {/* ------------------------------------ */}
        {/* VOTER INFORMATION                     */}
        {/* ------------------------------------ */}
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
                  {voterData.middle_name ? voterData.middle_name + ". " : ""}
                  {voterData.last_name}
                  {voterData.suffix}
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
                <p className="text-muted-foreground">Eligible Elections</p>
                <div className="mt-1 space-y-1 text-sm">
                  {activeElections.map((election)=> {
                    const voted = completedElections.includes(election.id);

                    return(
                      <div key={election.id} className="flex items-center gap-2">
                        <span className="font-medium">{election.title}</span>

                        {voted ? (
                          <Badge
                            variant="outline"
                            className="bg-success/10 text-success text-xs px-2 py-0.5"
                          >
                            Voted ✓
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-warning/10 text-warning text=xs px-2 py-0.5"
                            >
                              Pending
                            </Badge>
                        )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ------------------------------------ */}
        {/* SELECTIONS DISPLAY (CARD LAYOUT)      */}
        {/* ------------------------------------ */}
        <Card className="mb-6 border-2 border-primary/10 bg-card/95 backdrop-blur-sm">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              {showAll ? "Your Completed Ballots" : "Selections"}
            </h2>

            <ScrollArea className="h-[60vh] pr-4 overflow-y-auto">
              <div className="space-y-8">

                {/* ------------------------------------------------ */}
                {/* MULTI-ELECTION REVIEW (FINAL REVIEW MODE)       */}
                {/* ------------------------------------------------ */}
                {showAll && groupedByElection
                  ? Object.entries(groupedByElection).map(([electionId, group]) => (
                      <Card
                        key={electionId}
                        className="border border-primary/30 bg-primary/5 rounded-xl shadow-sm px-6 py-5"
                      >
                        {/* ELECTION TITLE */}
                        <h3 className="text-xl font-bold text-primary mb-4">
                          {group.name}
                        </h3>

                        <div className="space-y-5">
                          {group.items.map((sel, index) => (
                            <div
                              key={index}
                              className="p-4 border border-primary/20 bg-white rounded-lg flex items-center justify-between shadow-sm"
                            >
                              <div>
                                <p className="text-sm text-muted-foreground">{sel.position}</p>
                                <p className="font-semibold text-lg">{sel.candidateName}</p>

                                <Badge className="mt-2 bg-secondary/10" variant="outline">
                                  {sel.slate}
                                </Badge>
                              </div>
                              <CheckCircle2 className="h-6 w-6 text-success" />
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))

                  /* ------------------------------------------------ */
                  /* SINGLE BALLOT REVIEW (NORMAL REVIEW MODE)      */
                  /* ------------------------------------------------ */
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

                        {index < selections.length - 1 && (
                          <Separator className="my-4" />
                        )}
                      </div>
                    ))}
              </div>
            </ScrollArea>
          </div>
        </Card>

        {/* ------------------------------------ */}
        {/* ACTION BUTTONS                       */}
        {/* ------------------------------------ */}
        <div className="flex gap-4">
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
