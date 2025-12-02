import { useEffect } from "react";

interface Props {
  onScan: (uid: string) => void;
}

/**
 * RFIDScanner (for readers that emit the tag in one burst, not digit-by-digit)
 */
export default function RFIDScanner({ onScan }: Props) {
  useEffect(() => {
    let buffer = "";

    const handler = (e: KeyboardEvent) => {
      // If the event.key is "Enter", we finalize the scan
      if (e.key === "Enter") {
        if (buffer.length >= 4) {
          onScan(buffer);
        }
        buffer = "";
        e.preventDefault();
        return;
      }

      // Many readers send the whole UID as a "string" in a single keydown event.
      // So check if the key is actually more than one char.
      if (e.key.length > 1 && e.key !== "Unidentified") {
        // Some HID readers send the entire UID as e.key in one event
        buffer = e.key;
        return;
      }

      // Fallback: if it's a digit (some readers still send digit bursts)
      if (/^[0-9]$/.test(e.key)) {
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onScan]);

  return null;
}
