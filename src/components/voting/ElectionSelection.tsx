import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface ElectionSelectionProps {
  voterData: any;
  onElectionSelect: (electionId: string, electionData: any) => void;
  completedElections: string[];
  activeElections: any[];
  expiredElections: any[];
}

const ElectionSelection = ({
  voterData,
  onElectionSelect,
  completedElections,
  activeElections,
  expiredElections,
}: ElectionSelectionProps) => {
  const handleSelectElection = (election: any) => {
    if (completedElections.includes(election.id)) {
      toast.error("You have already voted in this election");
      return;
    }
    onElectionSelect(election.id, election);
  };

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
          .animate-fade-in {
            animation: fadeIn 0.4s ease-out forwards;
          }
        `}
      </style>

      <div className="max-w-4xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Select an Election
          </h1>
          <p className="text-muted-foreground">
            Welcome{" "}
            <span className="font-semibold">
              {voterData.first_name} {voterData.middle_name} {voterData.last_name}
            </span>
            . Choose which election you'd like to vote in.
          </p>
        </div>

        {/* Active Elections */}
        <h2 className="text-xl font-bold mb-4">Active Elections</h2>
        {activeElections.length === 0 ? (
          <div className="flex items-center justify-center">
            <Card className="p-12 text-center max-w-md shadow-xl rounded-xl bg-gradient-to-tr from-secondary/20 to-primary/10">
              <h2 className="text-2xl font-bold mb-4">No Active Elections</h2>
              <p className="text-muted-foreground">
                There are currently no active elections available for voting.
              </p>
            </Card>
          </div>
        ) : (
          <div
            className={`grid gap-6 ${
              activeElections.length === 1
                ? "grid-cols-1 place-items-center"
                : "md:grid-cols-2"
            }`}
          >
            {activeElections.map((election) => {
              const hasVoted = completedElections.includes(election.id);
              return (
                <Card
                  key={election.id}
                  className={`p-6 rounded-xl shadow-md transition-transform transform flex flex-col h-full max-w-md w-full animate-fade-in ${
                    hasVoted
                      ? "border-muted bg-muted/20 opacity-60"
                      : "border-primary/20 hover:scale-105 hover:shadow-lg hover:border-primary/50 cursor-pointer"
                  }`}
                  onClick={() => !hasVoted && handleSelectElection(election)}
                >
                  <div className="flex flex-col flex-grow justify-between h-full">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-2xl font-bold leading-tight line-clamp-2">
                          {election.title}
                        </h2>
                        {hasVoted ? (
                          <Badge
                            variant="secondary"
                            className="bg-success/10 text-success inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Voted
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-primary border-primary/40"
                          >
                            Active
                          </Badge>
                        )}
                      </div>

                      {election.description && (
                        <p className="text-muted-foreground">
                          {election.description}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-primary" />
                          <span>
                            {new Date(election.start_date).toLocaleDateString()} -{" "}
                            {new Date(election.end_date).toLocaleDateString()}
                          </span>
                        </div>
                        {election.total_voters && (
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-secondary" />
                            <span>{election.total_voters} voters</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-auto pt-6">
                      <Button
                        disabled={hasVoted}
                        className={`w-full font-semibold ${
                          hasVoted
                            ? "bg-gray-400 text-gray-700 cursor-not-allowed"
                            : "bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 animate-pulse"
                        }`}
                      >
                        {hasVoted ? (
                          <>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Completed
                          </>
                        ) : (
                          <>
                            Vote Now
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Expired Elections */}
        {expiredElections.length > 0 && (
          <>
            <h2 className="text-xl font-bold mt-10 mb-4">Expired Elections</h2>
            <div className="grid gap-6 md:grid-cols-2">
              {expiredElections.map((election) => (
                <Card
                  key={election.id}
                  className="p-6 rounded-xl shadow-md flex flex-col h-full max-w-md w-full border-muted bg-muted/20 opacity-60 animate-fade-in"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl font-bold">{election.title}</h2>
                    <Badge variant="secondary" className="bg-gray-300 text-gray-700">
                      Closed
                    </Badge>
                  </div>
                  {election.description && (
                    <p className="text-muted-foreground">{election.description}</p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm mt-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span>
                        {new Date(election.start_date).toLocaleDateString()} -{" "}
                        {new Date(election.end_date).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <Button disabled className="mt-auto bg-gray-400 text-gray-700">
                    Closed
                  </Button>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ElectionSelection;
