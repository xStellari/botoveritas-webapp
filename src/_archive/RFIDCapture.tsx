import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";   // ✅ import navigate

type Props = {
  onAuthenticated: () => void;
};

export default function RFIDCapture({ onAuthenticated }: Props) {
  const [capturing, setCapturing] = useState(false);
  const navigate = useNavigate();   // ✅ declare navigate inside component

  const simulateCapture = async () => {
    try {
      setCapturing(true);
      // TODO: replace with actual RFID + face capture pipeline.
      await new Promise((res) => setTimeout(res, 1500));
      toast.success("RFID + face verified.");
      onAuthenticated();            // sets authenticated = true in App
      navigate("/voting");           // ✅ redirect to ballot screen
    } catch (e: any) {
      toast.error(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-semibold">RFID + Face Capture</h1>
      <p className="text-sm text-muted-foreground">
        Place your RFID card and look at the camera to verify your identity.
      </p>
      <Button onClick={simulateCapture} disabled={capturing} className="w-full">
        {capturing ? "Verifying..." : "Start verification"}
      </Button>
    </div>
  );
}
