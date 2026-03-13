import { useEffect, useRef } from "react";

interface Props {
  onScan: (uid: string) => void;
  /** Ignore subsequent scans for this many ms after a successful scan (default 3000ms) */
  debounceMs?: number;
  /** When true the scanner is disabled entirely — use this during face-ID step */
  disabled?: boolean;
}

/**
 * RFIDScanner
 * - Debounces repeated scans of the same tag (voters holding card too long)
 * - Ignores duplicate UIDs within debounceMs window
 * - Can be fully disabled via the `disabled` prop (face-ID step, done, error)
 */
export default function RFIDScanner({ onScan, debounceMs = 3000, disabled = false }: Props) {
  const lastUidRef = useRef<string>("");
  const lastTimeRef = useRef<number>(0);
  const disabledRef = useRef(disabled);

  // Keep disabledRef in sync without re-registering the event listener
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    let buffer = "";

    const handler = (e: KeyboardEvent) => {
      // Always block if disabled (face step, done, error)
      if (disabledRef.current) {
        e.preventDefault();
        return;
      }

      if (e.key === "Enter") {
        if (buffer.length >= 4) {
          const uid = buffer.trim();
          const now = Date.now();

          // Debounce: same UID within debounceMs window → ignore
          if (uid === lastUidRef.current && now - lastTimeRef.current < debounceMs) {
            buffer = "";
            e.preventDefault();
            return;
          }

          lastUidRef.current = uid;
          lastTimeRef.current = now;
          onScan(uid);
        }
        buffer = "";
        e.preventDefault();
        return;
      }

      // Some HID readers send the entire UID as e.key in one burst event
      if (e.key.length > 1 && e.key !== "Unidentified") {
        buffer = e.key;
        return;
      }

      // Digit-by-digit fallback
      if (/^[0-9A-Fa-f]$/.test(e.key)) {
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onScan, debounceMs]); // disabled intentionally excluded — managed via ref

  return null;
}
