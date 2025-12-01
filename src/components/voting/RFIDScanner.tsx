import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Scan, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface RFIDScannerProps {
  onSuccess: (rfidTag: string, userData: any) => void;
  onError: (error: string) => void;
}

const RFIDScanner = ({ onSuccess, onError }: RFIDScannerProps) => {
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [port, setPort] = useState<any>(null);
  const [rfidBuffer, setRfidBuffer] = useState("");

  useEffect(() => {
    return () => {
      // Cleanup serial port on unmount
      if (port) {
        port.close().catch(console.error);
      }
    };
  }, [port]);

  const startScanning = async () => {
    try {
      setScanning(true);
      setStatus('scanning');
      setRfidBuffer("");

      // Check if Web Serial API is supported
      if (!('serial' in navigator)) {
        throw new Error("Web Serial API not supported. Please use Chrome/Edge browser.");
      }

      // Request a port
      const selectedPort = await (navigator as any).serial.requestPort();
      await selectedPort.open({ baudRate: 9600 });

      setPort(selectedPort);
      toast.info("RFID scanner connected. Please tap your student ID...");

      const reader = selectedPort.readable.getReader();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // Convert byte array to string
          const text = new TextDecoder().decode(value);
          buffer += text;

          // Check if we have a complete RFID tag (usually ends with newline or carriage return)
          if (buffer.includes('\n') || buffer.includes('\r') || buffer.length >= 10) {
            const rfidTag = buffer.trim();
            
            if (rfidTag.length > 0) {
              console.log("RFID Tag scanned:", rfidTag);
              setRfidBuffer(rfidTag);
              
              // Query database for user with this RFID tag
              const { data: profile, error } = await supabase
                .from("profiles")
                .select("*")
                .eq("rfid_tag", rfidTag)
                .single();

              if (error || !profile) {
                setStatus('error');
                onError("RFID tag not registered. Please register first.");
                toast.error("RFID tag not found in system");
              } else {
                setStatus('success');
                toast.success(`Welcome, ${profile.first_name} ${profile.last_name}!`);
                
                // Fetch user roles
                const { data: roles } = await supabase
                  .from("user_roles")
                  .select("role")
                  .eq("user_id", profile.id);

                onSuccess(rfidTag, {
                  ...profile,
                  roles: roles?.map(r => r.role) || []
                });
              }
              
              reader.releaseLock();
              await selectedPort.close();
              break;
            }
          }
        }
      } catch (readError) {
        console.error("Read error:", readError);
        reader.releaseLock();
      }

    } catch (error: any) {
      console.error("RFID Scanner error:", error);
      setStatus('error');
      
      if (error.message.includes("No port selected")) {
        toast.error("No RFID scanner selected");
      } else {
        toast.error(error.message || "Failed to connect to RFID scanner");
      }
      onError(error.message || "RFID scanning failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className={`flex items-center gap-4 p-6 rounded-xl border-2 transition-all ${
      status === 'success'
        ? "border-success bg-success/5"
        : status === 'scanning'
        ? "border-primary bg-primary/5 animate-pulse"
        : status === 'error'
        ? "border-destructive bg-destructive/5"
        : "border-border bg-muted/30"
    }`}>
      <div className="flex-shrink-0">
        {status === 'success' ? (
          <CheckCircle2 className="h-10 w-10 text-success" />
        ) : status === 'scanning' ? (
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        ) : status === 'error' ? (
          <AlertCircle className="h-10 w-10 text-destructive" />
        ) : (
          <Scan className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-lg">RFID Authentication</h3>
        <p className="text-sm text-muted-foreground">
          {status === 'scanning' && "Waiting for RFID tap..."}
          {status === 'success' && "RFID verified successfully!"}
          {status === 'error' && "RFID verification failed"}
          {status === 'idle' && "Connect your Arduino RFID scanner"}
        </p>
        {rfidBuffer && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Tag: {rfidBuffer}
          </p>
        )}
      </div>
      {status === 'idle' && (
        <Button
          onClick={startScanning}
          disabled={scanning}
          className="bg-primary hover:bg-primary/90"
        >
          <Scan className="mr-2 h-4 w-4" />
          Scan RFID
        </Button>
      )}
      {status === 'success' && (
        <CheckCircle2 className="h-8 w-8 text-success" />
      )}
    </div>
  );
};

export default RFIDScanner;