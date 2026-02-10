import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  Edit,
  CheckCircle2,
  Shield,
  Clock,
  Loader2,
  User,
} from "lucide-react";
import feuLogo from "@/assets/feu-logo.png";
import type { CandidateSelection, VoterData } from "@/pages/VotingKiosk";

interface ReviewScreenProps {
  voterData: VoterData;
  selections: CandidateSelection[];
  onConfirm: () => void; // can be sync or async in practice (we handle both)
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // candidateId -> photo_url
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});
  const [photosLoading, setPhotosLoading] = useState(false);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleConfirmClick = async () => {
    if (isSubmitting) return; // hard guard vs double-click / double-tap
    setIsSubmitting(true);
    try {
      await Promise.resolve(onConfirm());
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------
  // GROUP BY ELECTION (using electionId & electionName)
  // ---------------------------------------------------------
  const groupedByElection = showAll
    ? selections.reduce(
        (
          acc: Record<string, { name: string; items: CandidateSelection[] }>,
          sel
        ) => {
          if (!acc[sel.electionId]) {
            acc[sel.electionId] = {
              name: sel.electionName ?? "Election",
              items: [],
            };
          }
          acc[sel.electionId].items.push(sel);
          return acc;
        },
        {}
      )
    : null;

  // ---------------------------------------------------------
  // Collect candidate IDs and fetch photo_url for review display
  // ---------------------------------------------------------
  const candidateIds = useMemo(() => {
    // CandidateSelection shape varies; this safely grabs candidateId if present
    const ids = new Set<string>();

    for (const sel of selections) {
      const id = sel.candidateId;
      if (id && id !== "ABSTAIN") {
        ids.add(id);
      }
      
    }

    return Array.from(ids);
  }, [selections]);

  useEffect(() => {
    const loadPhotos = async () => {
      if (!candidateIds.length) {
        setPhotoMap({});
        return;
      }

      setPhotosLoading(true);
      try {
        const { data, error } = await supabase
          .from("candidates")
          .select("id, photo_url")
          .in("id", candidateIds);

        if (error) throw error;

        const next: Record<string, string> = {};
        (data ?? []).forEach((row: any) => {
          if (row?.id && row?.photo_url) next[row.id] = row.photo_url;
        });
        setPhotoMap(next);
      } catch (e: any) {
        // Not fatal; we can still show fallback icons.
        console.error("Failed to load candidate photos for review:", e?.message ?? e);
        setPhotoMap({});
      } finally {
        setPhotosLoading(false);
      }
    };

    loadPhotos();
  }, [candidateIds]);

  const CandidateThumb = ({ candidateId, name }: { candidateId?: string | null; name?: string }) => {
    const url = candidateId ? photoMap[candidateId] : undefined;

    return (
      <div className="w-10 h-10 rounded-full overflow-hidden border bg-muted flex items-center justify-center flex-shrink-0">
        {url ? (
          <img
            src={url}
            alt={name ?? "Candidate"}
            className="w-full h-full object-cover"
            onError={(e) => {
              // If URL breaks, remove it visually and show fallback
              (e.currentTarget as HTMLImageElement).src = "";
            }}
          />
        ) : (
          <User className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
    );
  };

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
                <p className="text-xs text-muted-foreground mt-1">
                  At final submission, the kiosk will mint <strong>one blockchain receipt NFT per election</strong> you participated in.
                </p>
                {photosLoading ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Loading candidate photos…
                  </p>
                ) : null}
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
                Once you confirm, your selections for this election <strong>cannot be changed</strong>.
                We will generate a blockchain participation receipt (NFT) during <strong>final submission</strong> — one receipt per election you vote in.
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
                  {activeElections.map((election) => {
                    const voted = completedElections.includes(election.id);

                    return (
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
                          {group.items.map((sel, index) => {
                            const candidateId = (sel as any).candidateId as string | null | undefined;

                            return (
                              <div
                                key={index}
                                className="p-4 border border-primary/20 bg-white rounded-lg flex items-center justify-between shadow-sm"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <CandidateThumb
                                    candidateId={candidateId}
                                    name={sel.candidateName}
                                  />

                                  <div className="min-w-0">
                                    <p className="text-sm text-muted-foreground">
                                      {sel.position}
                                    </p>
                                    <p className="font-semibold text-lg truncate">
                                      {sel.candidateName}
                                    </p>

                                    <Badge className="mt-2 bg-secondary/10" variant="outline">
                                      {sel.slate}
                                    </Badge>
                                  </div>
                                </div>

                                <CheckCircle2 className="h-6 w-6 text-success" />
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    ))
                  : selections.map((sel, index) => {
                      const candidateId = (sel as any).candidateId as string | null | undefined;

                      return (
                        <div key={index}>
                          <div className="p-4 border border-primary/20 bg-primary/5 rounded-lg flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <CandidateThumb
                                candidateId={candidateId}
                                name={sel.candidateName}
                              />

                              <div className="min-w-0">
                                <p className="text-sm text-muted-foreground">{sel.position}</p>
                                <p className="font-semibold text-lg truncate">
                                  {sel.candidateName}
                                </p>

                                <Badge variant="outline" className="mt-2 bg-secondary/10">
                                  {sel.slate}
                                </Badge>
                              </div>
                            </div>

                            <CheckCircle2 className="h-6 w-6 text-success" />
                          </div>

                          {index < selections.length - 1 && (
                            <Separator className="my-4" />
                          )}
                        </div>
                      );
                    })}
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
              disabled={isSubmitting}
            >
              <Edit className="mr-2 h-5 w-5" />
              Edit Ballot
            </Button>
          )}

          <Button
            className="flex-1 h-14 text-lg bg-gradient-primary hover:opacity-90 shadow-glow"
            onClick={handleConfirmClick}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-6 w-6" />
                {showAll ? "Confirm & Proceed to Final Submission" : "Confirm Vote"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ReviewScreen;