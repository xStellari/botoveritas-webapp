/**
 * ResultsVerify.tsx
 * Route: /results/:electionId
 *
 * Public, no-auth page that:
 *  1. Shows the official live vote tallies for an election straight from the DB.
 *  2. Lets anyone drop their PDF onto the page — we compute the SHA-256 of the
 *     file in-browser and compare it to the hash stored when the PDF was generated.
 *
 * This is the page whose URL is printed as a QR code inside every results PDF.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import feuLogo from "@/assets/feu-logo.png";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Upload,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ElectionRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  eligible_orgs: string[] | null;
  is_final: boolean | null;
};

type TallyRow = {
  position: string;
  candidate_name: string;
  slate: string | null;
  vote_count: number;
  abstain_count: number | null;
  total_ballots_for_position: number | null;
};

type PdfHashRow = {
  pdf_sha256: string;
  generated_at: string;
  mode: string;
};

type VerifyState =
  | { status: "idle" }
  | { status: "hashing" }
  | { status: "match"; hash: string; generatedAt: string; mode: string }
  | { status: "mismatch"; computedHash: string; storedHash: string }
  | { status: "no_record"; computedHash: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pct(n: number, d: number) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

async function sha256File(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ResultsVerify() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();

  const [election, setElection] = useState<ElectionRow | null>(null);
  const [tallies, setTallies] = useState<TallyRow[]>([]);
  const [pdfHash, setPdfHash] = useState<PdfHashRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [verifyState, setVerifyState] = useState<VerifyState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const [showAllPositions, setShowAllPositions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch election data ──────────────────────────────────────────────────
  useEffect(() => {
    if (!electionId) return;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [elecRes, tallyRes, hashRes] = await Promise.all([
          supabase
            .from("elections")
            .select("id,title,start_date,end_date,eligible_orgs,is_final")
            .eq("id", electionId!)
            .maybeSingle(),

          supabase
            .from("vote_tally_view")
            .select(
              "position,candidate_name,slate,vote_count,abstain_count,total_ballots_for_position"
            )
            .eq("election_id", electionId!),

          supabase
            .from("election_result_pdf_hashes")
            .select("pdf_sha256,generated_at,mode")
            .eq("election_id", electionId!)
            .order("generated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (elecRes.error) throw new Error(elecRes.error.message);
        if (tallyRes.error) throw new Error(tallyRes.error.message);

        setElection(elecRes.data as ElectionRow | null);
        setTallies((tallyRes.data ?? []) as TallyRow[]);
        setPdfHash(hashRes.data as PdfHashRow | null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [electionId]);

  // ── PDF hash verification ─────────────────────────────────────────────────
  const verifyPdf = useCallback(
    async (file: File) => {
      setVerifyState({ status: "hashing" });
      try {
        const computedHash = await sha256File(file);

        if (!pdfHash) {
          setVerifyState({ status: "no_record", computedHash });
          return;
        }

        if (computedHash.toLowerCase() === pdfHash.pdf_sha256.toLowerCase()) {
          setVerifyState({
            status: "match",
            hash: computedHash,
            generatedAt: pdfHash.generated_at,
            mode: pdfHash.mode,
          });
        } else {
          setVerifyState({
            status: "mismatch",
            computedHash,
            storedHash: pdfHash.pdf_sha256,
          });
        }
      } catch (err) {
        setVerifyState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [pdfHash]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) verifyPdf(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) verifyPdf(file);
  };

  // ── Derive positions ──────────────────────────────────────────────────────
  // Canonical position order — matches the PDF report order.
  const POSITION_ORDER = [
    "President", "Vice President", "Secretary", "Treasurer",
    "Auditor", "Public Information Officer", "P.I.O.",
    "Business Manager", "Sergeant-at-Arms",
  ];

  function positionRank(p: string) {
    const idx = POSITION_ORDER.findIndex((o) =>
      p.toLowerCase().includes(o.toLowerCase())
    );
    return idx === -1 ? 999 : idx;
  }

  const positionMap = new Map<string, { candidates: TallyRow[]; abstainCount: number; total: number }>();
  for (const row of tallies) {
    const pos = row.position || "General";
    if (!positionMap.has(pos)) {
      positionMap.set(pos, { candidates: [], abstainCount: 0, total: row.total_ballots_for_position ?? 0 });
    }
    const entry = positionMap.get(pos)!;
    // Rows with candidate_name = "ABSTAIN" (or blank) are abstain bookkeeping rows — don't show as candidates.
    if (row.candidate_name && row.candidate_name.trim().toUpperCase() !== "ABSTAIN") {
      entry.candidates.push(row);
    }
    // abstain_count is the same on every row for this position; just take the latest non-null value.
    if (row.abstain_count != null) {
      entry.abstainCount = row.abstain_count;
    }
    if (row.total_ballots_for_position != null) {
      entry.total = row.total_ballots_for_position;
    }
  }

  const positions = Array.from(positionMap.entries()).sort(
    ([a], [b]) => positionRank(a) - positionRank(b) || a.localeCompare(b)
  );
  const visiblePositions = showAllPositions ? positions : positions.slice(0, 4);

  // ── Status badge ──────────────────────────────────────────────────────────
  const now = Date.now();
  const electionStatus = !election
    ? null
    : now < new Date(election.start_date).getTime()
    ? "Upcoming"
    : now > new Date(election.end_date).getTime()
    ? "Ended"
    : "Live";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 via-white to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={feuLogo} alt="FEU" className="h-10" />
            <div className="leading-tight">
              <div className="font-extrabold text-lg text-emerald-900">BotoVeritas</div>
              <div className="text-xs text-muted-foreground">Official Results & PDF Verification</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-200 text-emerald-800"
              onClick={() => navigate("/verify")}
            >
              All Verify Tools
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-200 text-emerald-800"
              onClick={() => navigate("/")}
            >
              Home
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10 space-y-10">

        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center gap-3 text-muted-foreground py-20 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading election results…</span>
          </div>
        )}

        {!loading && loadError && (
          <Card className="p-8 border-red-200 bg-red-50 text-center space-y-2">
            <XCircle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="font-semibold text-red-700">Failed to load election data</p>
            <p className="text-sm text-red-600 font-mono break-all">{loadError}</p>
          </Card>
        )}

        {!loading && !loadError && !election && (
          <Card className="p-8 border-amber-200 bg-amber-50 text-center space-y-2">
            <p className="font-semibold text-amber-800">Election not found</p>
            <p className="text-sm text-muted-foreground font-mono break-all">{electionId}</p>
          </Card>
        )}

        {!loading && !loadError && election && (
          <>
            {/* ── Election header card ───────────────────────────────────── */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold text-emerald-900">{election.title}</h1>
                {electionStatus && (
                  <Badge
                    className={
                      electionStatus === "Live"
                        ? "bg-emerald-600 text-white"
                        : electionStatus === "Ended"
                        ? "bg-slate-500 text-white"
                        : "bg-amber-500 text-white"
                    }
                  >
                    {electionStatus}
                  </Badge>
                )}
                {election.is_final && (
                  <Badge className="bg-emerald-900 text-white flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Finalized
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {fmtDate(election.start_date)} → {fmtDate(election.end_date)}
              </p>
              {election.eligible_orgs?.length ? (
                <p className="text-sm text-muted-foreground">
                  Eligible organizations:{" "}
                  <span className="font-medium text-emerald-800">
                    {election.eligible_orgs.join(", ")}
                  </span>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground font-mono break-all">
                Election ID: {election.id}
              </p>
            </section>

            {/* ── Live tallies ──────────────────────────────────────────── */}
            <section className="space-y-5">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-600" />
                <h2 className="text-xl font-bold text-emerald-900">Official Vote Tallies</h2>
                <Badge variant="outline" className="border-emerald-500 text-emerald-700 text-xs ml-1">
                  Live from database
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground -mt-2">
                These results are fetched directly from the BotoVeritas database — they are
                the authoritative source of truth, not the PDF.
              </p>

              {tallies.length === 0 ? (
                <Card className="p-6 text-center text-muted-foreground">
                  No tally data available yet for this election.
                </Card>
              ) : (
                <>
                  <div className="space-y-4">
                    {visiblePositions.map(([position, { candidates, abstainCount, total }]) => {
                      const sorted = [...candidates].sort((a, b) => b.vote_count - a.vote_count);
                      const topVotes = sorted[0]?.vote_count ?? 0;

                      return (
                        <Card key={position} className="overflow-hidden border border-emerald-100">
                          {/* Position header */}
                          <div className="bg-emerald-900 px-5 py-3 flex items-center justify-between">
                            <span className="font-bold text-white text-sm">{position}</span>
                            {total > 0 && (
                              <span className="text-xs text-emerald-200">
                                {total} ballot{total !== 1 ? "s" : ""} cast
                              </span>
                            )}
                          </div>

                          {/* Candidate rows */}
                          <div className="divide-y divide-slate-100">
                            {sorted.map((row, i) => {
                              const isWinner = row.vote_count === topVotes && row.vote_count > 0;
                              const barPct = total > 0 ? (row.vote_count / total) * 100 : 0;

                              return (
                                <div key={`${position}-${row.candidate_name}-${i}`} className="px-5 py-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {isWinner && i === 0 && (
                                        <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                      )}
                                      <span
                                        className={`text-sm font-medium truncate ${
                                          isWinner && i === 0 ? "text-emerald-900" : "text-slate-700"
                                        }`}
                                      >
                                        {row.candidate_name}
                                      </span>
                                      {row.slate && (
                                        <span className="text-xs text-muted-foreground shrink-0">
                                          ({row.slate})
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0 ml-4">
                                      <span className="text-sm font-bold text-emerald-900 tabular-nums">
                                        {row.vote_count}
                                      </span>
                                      {total > 0 && (
                                        <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
                                          {pct(row.vote_count, total)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        isWinner && i === 0 ? "bg-amber-500" : "bg-emerald-400"
                                      }`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}

                            {/* Abstain row — uses the dedicated abstain_count column, not a candidate row */}
                            {abstainCount > 0 && (
                              <div className="px-5 py-2 flex items-center justify-between bg-slate-50">
                                <span className="text-xs text-muted-foreground italic">Abstain</span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {abstainCount}
                                </span>
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {positions.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAllPositions((v) => !v)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-200 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 transition"
                    >
                      {showAllPositions ? (
                        <>
                          <ChevronUp className="h-4 w-4" /> Show fewer positions
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" /> Show all {positions.length}{" "}
                          positions
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </section>

            {/* ── PDF integrity verification ────────────────────────────── */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-700" />
                <h2 className="text-xl font-bold text-emerald-900">Verify Your PDF Copy</h2>
              </div>

              <p className="text-sm text-muted-foreground">
                If you received a PDF of these results, you can verify here that it has not
                been altered. We compute the file's SHA-256 fingerprint in your browser
                (nothing is uploaded) and compare it against the fingerprint we recorded
                when the PDF was officially generated.
              </p>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors select-none ${
                  dragging
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Upload className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
                <p className="font-semibold text-emerald-800">
                  Drop the results PDF here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  The file is processed entirely in your browser. It is never uploaded.
                </p>
              </div>

              {/* Verification result */}
              {verifyState.status === "hashing" && (
                <Card className="p-6 border-slate-200 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600 shrink-0" />
                  <span className="text-sm">Computing SHA-256 fingerprint…</span>
                </Card>
              )}

              {verifyState.status === "match" && (
                <Card className="p-6 border-emerald-400 bg-emerald-50 space-y-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-emerald-800 text-lg">
                        ✓ Document is authentic — fingerprints match
                      </p>
                      <p className="text-sm text-emerald-700">
                        This PDF is the exact file that BotoVeritas generated. It has not
                        been modified.
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-emerald-200 p-4 space-y-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        SHA-256 Fingerprint
                      </span>
                      <p className="font-mono text-xs text-emerald-900 break-all mt-0.5">
                        {verifyState.hash}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground pt-1">
                      <div>
                        <span className="font-semibold text-slate-600">PDF Generated: </span>
                        {fmtDate(verifyState.generatedAt)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-600">Mode: </span>
                        <span className="capitalize">{verifyState.mode}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {verifyState.status === "mismatch" && (
                <Card className="p-6 border-red-400 bg-red-50 space-y-3">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-7 w-7 text-red-600 shrink-0" />
                    <div>
                      <p className="font-bold text-red-800 text-lg">
                        ⚠ Fingerprint mismatch — document may have been altered
                      </p>
                      <p className="text-sm text-red-700">
                        The PDF you uploaded does not match the official file. Either the
                        contents have been modified, or you uploaded the wrong file.
                        Trust the live results shown above instead.
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-red-200 p-4 space-y-2 text-xs font-mono">
                    <div>
                      <span className="text-slate-500 font-sans font-semibold uppercase tracking-wide text-xs">
                        Your file's SHA-256
                      </span>
                      <p className="text-red-700 break-all mt-0.5">{verifyState.computedHash}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans font-semibold uppercase tracking-wide text-xs">
                        Official SHA-256
                      </span>
                      <p className="text-emerald-800 break-all mt-0.5">{verifyState.storedHash}</p>
                    </div>
                  </div>
                </Card>
              )}

              {verifyState.status === "no_record" && (
                <Card className="p-6 border-amber-300 bg-amber-50 space-y-2">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-6 w-6 text-amber-600 shrink-0" />
                    <div>
                      <p className="font-bold text-amber-800">
                        No official PDF hash on record for this election
                      </p>
                      <p className="text-sm text-amber-700">
                        A hash record is stored when the final PDF is generated. It may
                        not have been generated yet, or the hash table migration may not
                        have been run. Rely on the live tallies above.
                      </p>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-amber-200 p-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Your file's SHA-256
                    </span>
                    <p className="font-mono text-xs text-slate-700 break-all mt-0.5">
                      {verifyState.computedHash}
                    </p>
                  </div>
                </Card>
              )}

              {verifyState.status === "error" && (
                <Card className="p-6 border-red-200 bg-red-50">
                  <p className="font-semibold text-red-700">Error computing fingerprint</p>
                  <p className="text-sm text-red-600 font-mono mt-1">{verifyState.message}</p>
                </Card>
              )}

              {/* Stored hash info (shown when idle / after result) */}
              {pdfHash && verifyState.status === "idle" && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Official PDF Fingerprint on Record
                  </p>
                  <p className="font-mono text-xs text-slate-700 break-all">
                    {pdfHash.pdf_sha256}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Generated {fmtDate(pdfHash.generated_at)} ·{" "}
                    <span className="capitalize">{pdfHash.mode}</span> PDF
                  </p>
                </div>
              )}

              {!pdfHash && !loading && verifyState.status === "idle" && (
                <p className="text-xs text-muted-foreground">
                  No official PDF has been generated yet for this election.
                </p>
              )}
            </section>

            {/* ── Info footer ───────────────────────────────────────────── */}
            <section className="rounded-2xl border bg-white p-6 space-y-2">
              <h3 className="font-bold text-emerald-900">Why trust this page over the PDF?</h3>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li className="flex gap-2">
                  <span className="text-emerald-600 font-bold shrink-0">•</span>
                  The tallies above come directly from the BotoVeritas database, the same
                  source that generated the PDF. They cannot be changed by whoever
                  distributed the PDF.
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-600 font-bold shrink-0">•</span>
                  The PDF is a formatted printout. If someone changed a number in it, the
                  SHA-256 fingerprint check above will catch it.
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-600 font-bold shrink-0">•</span>
                  Fingerprint verification runs entirely in your browser — the PDF is
                  never sent anywhere.
                </li>
              </ul>
              <div className="pt-2">
                <a
                  href="https://emn178.github.io/online-tools/sha256_checksum.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Verify the hash independently using an external SHA-256 tool
                </a>
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="border-t bg-white mt-10">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-muted-foreground">
          © {new Date().getFullYear()} BotoVeritas · FEU Alabang · Public Verification Page
        </div>
      </footer>
    </div>
  );
}
