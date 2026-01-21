import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ElectionFinishedPopupProps {
  onContinue: () => void;
  hasRemaining: boolean; // ✅ new prop
}

const ElectionFinishedPopup = ({ onContinue, hasRemaining }: ElectionFinishedPopupProps) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/10 via-background to-secondary/10">
      <Card className="p-8 text-center max-w-md shadow-lg rounded-xl">
        <h2 className="text-2xl font-bold mb-4">
          {hasRemaining ? "Election Completed" : "All Elections Completed"}
        </h2>
        <p className="text-muted-foreground mb-6">
          {hasRemaining
            ? "Your vote for this organization has been saved. Please continue to vote in your other eligible elections. Blockchain receipt NFTs will be minted during final submission."
            : "All your votes have been saved. Please review your selections before final submission. Blockchain receipt NFTs will be minted after you submit."}
        </p>
        <Button
          onClick={onContinue}
          className="bg-gradient-to-r from-primary to-secondary text-white font-semibold hover:opacity-90"
        >
          {hasRemaining ? "Continue" : "Review Votes"}
        </Button>
      </Card>
    </div>
  );
};

export default ElectionFinishedPopup;
