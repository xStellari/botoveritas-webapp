import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, User, Clock, ArrowRight, Ban } from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import { supabase } from "@/integrations/supabase/client";

interface BallotScreenProps {
  voterData: any;
  electionId: string;
  electionData: any;
  onComplete: (selections: any[]) => void;
  initialSelections?: any[];
}

const BallotScreenWithAbstain = ({
  voterData,
  electionId,
  electionData,
  onComplete,
  initialSelections = []
}: BallotScreenProps) => {

  const { toast } = useToast();
  const [selections, setSelections] = useState<{ [positionId: string]: string }>({});
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(600);

  const [abstainConfirm, setAbstainConfirm] = useState<{ show: boolean; positionId: string }>({
    show: false,
    positionId: ""
  });

  useEffect(() => {
    loadPositionsAndCandidates();
    initializeSelections();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const loadPositionsAndCandidates = async () => {
    setLoading(true);

    const { data: candidatesData, error } = await supabase
      .from("candidates")
      .select("*")
      .eq("election_id", electionId)
      .order("position", { ascending: true })
      .order("display_order", { ascending: true });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to load ballot",
        variant: "destructive"
      });
      setLoading(false);
      return;
    }

    // Remove any "Abstain" that might remain from old DB entries
    const filteredCandidates = candidatesData?.filter(
      (c) => c.name.toLowerCase() !== "abstain"
    );

    // Group candidates by position
    const positionsMap = new Map<string, any[]>();
    filteredCandidates?.forEach(candidate => {
      if (!positionsMap.has(candidate.position)) {
        positionsMap.set(candidate.position, []);
      }
      positionsMap.get(candidate.position)!.push(candidate);
    });

    const positionsArray = Array.from(positionsMap.entries()).map(
      ([position, candidates]) => ({
        id: position.toLowerCase().replace(/\s+/g, "-"),
        title: position,
        candidates
      })
    );

    setPositions(positionsArray);
    setLoading(false);
  };

  const initializeSelections = () => {
    const initialState: { [key: string]: string } = {};
    initialSelections.forEach(sel => {
      initialState[sel.position] = sel.candidateId;
    });
    setSelections(initialState);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSelection = (positionId: string, candidateId: string) => {
    if (candidateId === "ABSTAIN") {
      setAbstainConfirm({ show: true, positionId });
    } else {
      setSelections(prev => ({
        ...prev,
        [positionId]: candidateId
      }));
    }
  };

  const confirmAbstain = () => {
    setSelections(prev => ({
      ...prev,
      [abstainConfirm.positionId]: "ABSTAIN"
    }));
    setAbstainConfirm({ show: false, positionId: "" });

    toast({
      title: "Abstention Recorded",
      description: "Your abstention has been recorded."
    });
  };

  const handleSubmit = () => {
    const selectedCount = Object.keys(selections).length;

    if (selectedCount === 0) {
      toast({
        title: "No selections made",
        description: "Select at least one candidate or abstain.",
        variant: "destructive"
      });
      return;
    }

    // Convert selections to proper format
    const candidateSelections = Object.entries(selections).map(
      ([positionId, candidateId]) => {
        const position = positions.find(p => p.id === positionId);

        if (candidateId === "ABSTAIN") {
          return {
            position: position?.title,
            candidateId: "ABSTAIN",
            candidateName: "ABSTAIN",
            slate: "N/A",
          };
        }

        const candidate = position?.candidates.find((c: any) => c.id === candidateId);

        return {
          position: position?.title,
          candidateId: candidate.id,
          candidateName: candidate.name,
          slate: candidate.slate || "N/A",
        };
      }
    );

    onComplete(candidateSelections);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Loading ballot...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <Card className="mb-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <img src={feuLogo} alt="FEU" className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  {electionData.title}
                </h1>
                <p className="text-sm text-muted-foreground">Cast Your Vote</p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {voterData.first_name} {voterData.last_name}
                </span>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div
                className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                  timeRemaining < 60
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
                }`}
              >
                <Clock className="h-5 w-5" />
                <span className="font-mono text-lg font-bold">
                  {formatTime(timeRemaining)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Info Card */}
        <Card className="mb-6 p-4 bg-info/5 border-info/20">
          <p className="text-sm text-center">
            <strong>Note:</strong> You may abstain from any position by selecting
            the "Abstain" option.
          </p>
        </Card>

        {/* Ballot Positions */}
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="space-y-6 pr-4">
            {positions.map(position => (
              <Card
                key={position.id}
                className="border-2 border-primary/10 bg-card/95 backdrop-blur-sm"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">{position.title}</h2>
                      <Badge variant="outline" className="bg-primary/5">
                        {electionData.title}
                      </Badge>
                    </div>
                    {selections[position.id] && (
                      <CheckCircle2 className="h-6 w-6 text-success" />
                    )}
                  </div>

                  <RadioGroup
                    value={selections[position.id] || ""}
                    onValueChange={(value) =>
                      handleSelection(position.id, value)
                    }
                  >
                    <div className="space-y-4">

                      {/* Candidate List */}
                      {position.candidates.map((candidate: any) => (
                        <div
                          key={candidate.id}
                          className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all cursor-pointer hover:border-primary/50 ${
                            selections[position.id] === candidate.id
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background"
                          }`}
                          onClick={() =>
                            handleSelection(position.id, candidate.id)
                          }
                        >
                          <RadioGroupItem
                            value={candidate.id}
                            id={candidate.id}
                            className="mt-1"
                          />
                          <Label htmlFor={candidate.id} className="flex-1 cursor-pointer">
                            <div className="flex items-start gap-4">
                              <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-gradient-primary flex items-center justify-center">
                                <User className="h-8 w-8 text-white" />
                              </div>
                              <div className="flex-1">
                                <h3 className="font-semibold text-lg">
                                  {candidate.name}
                                </h3>
                                {candidate.slate && (
                                  <p className="text-sm text-secondary font-medium mb-2">
                                    {candidate.slate}
                                  </p>
                                )}
                                {candidate.bio && (
                                  <p className="text-sm text-muted-foreground">
                                    {candidate.bio}
                                  </p>
                                )}
                              </div>
                            </div>
                          </Label>
                        </div>
                      ))}

                      {/* ABSTAIN OPTION (the ONLY one) */}
                      <div
                        className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all cursor-pointer hover:border-warning/50 ${
                          selections[position.id] === "ABSTAIN"
                            ? "border-warning bg-warning/5"
                            : "border-border bg-muted/20"
                        }`}
                        onClick={() =>
                          handleSelection(position.id, "ABSTAIN")
                        }
                      >
                        <RadioGroupItem
                          value="ABSTAIN"
                          id={`${position.id}-abstain`}
                          className="mt-1"
                        />

                        <Label
                          htmlFor={`${position.id}-abstain`}
                          className="flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-warning/20 flex items-center justify-center">
                              <Ban className="h-6 w-6 text-warning" />
                            </div>
                            <div>
                              <h3 className="font-semibold">
                                Abstain from this position
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                I choose not to vote for this position.
                              </p>
                            </div>
                          </div>
                        </Label>
                      </div>
                    </div>
                  </RadioGroup>
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {/* Submit Button */}
        <Card className="mt-6 border-2 border-primary/20 bg-card/95 backdrop-blur-sm">
          <div className="p-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {Object.keys(selections).length} of {positions.length} positions selected/abstained
            </p>

            <Button
              onClick={handleSubmit}
              className="bg-gradient-primary hover:opacity-90 shadow-glow h-12 px-8 text-lg"
              disabled={Object.keys(selections).length === 0}
            >
              Review Selections
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Abstain Confirm Dialog */}
      <AlertDialog
        open={abstainConfirm.show}
        onOpenChange={(open) =>
          setAbstainConfirm({ ...abstainConfirm, show: open })
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Abstention</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to abstain from this position?
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <AlertDialogAction
              onClick={confirmAbstain}
              className="bg-warning hover:bg-warning/90"
            >
              Yes, Abstain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default BallotScreenWithAbstain;
