import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, ChevronDown, ChevronUp, FileSearch, ShieldCheck } from "lucide-react";

import feuLogo from "@/assets/feu-logo.png";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());
}

export default function Verify() {
  const navigate = useNavigate();

  const [voteId, setVoteId] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [showOversightTools, setShowOversightTools] = useState(false);

  const voteIdTrim = useMemo(() => voteId.trim(), [voteId]);
  const tokenIdTrim = useMemo(() => tokenId.trim(), [tokenId]);

  const onOpenVoteVerify = () => {
    if (!voteIdTrim) {
      toast.error("Please enter a Vote ID.");
      return;
    }
    if (!looksLikeUuid(voteIdTrim)) {
      toast.warning("That doesn't look like a UUID Vote ID — opening anyway.");
    }
    openInNewTab(`/verify/vote/${encodeURIComponent(voteIdTrim)}`);
  };

  const onOpenNftVerify = () => {
    if (!tokenIdTrim) {
      toast.error("Please enter a Token ID.");
      return;
    }
    openInNewTab(`/verify/nft/${encodeURIComponent(tokenIdTrim)}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 via-white to-white">
      <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={feuLogo} alt="FEU" className="h-12" />
            <div className="leading-tight">
              <div className="font-extrabold text-lg text-emerald-900">BotoVeritas</div>
              <div className="text-xs text-muted-foreground">Public Verification</div>
            </div>
          </div>

          <Button variant="outline" className="border-emerald-200 text-emerald-800" onClick={() => navigate("/")}>
            Back to Home
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-7 py-10 space-y-8">
          <section className="space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-hero bg-clip-text text-transparent">Verify your receipt</h1>
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl">
              This page is <span className="font-semibold text-emerald-900">public</span> and{" "}
              <span className="font-semibold text-emerald-900">read-only</span>. Voters typically only need the{" "}
              <span className="font-semibold text-emerald-900">NFT receipt</span> section below.
            </p>

            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant="outline" className="border-emerald-500 text-emerald-700">
                FEU Theme
              </Badge>
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                Minimal & Professional
              </Badge>
              <Badge variant="outline" className="border-blue-500 text-blue-700">
                Verifiable, not trust-based
              </Badge>
            </div>
          </section>

          {/* Voter-first: NFT receipt */}
          <section className="grid lg:grid-cols-3 gap-6">
            <Card className="p-6 rounded-2xl border-2 border-amber-200 hover:border-amber-400 transition lg:col-span-2">
              <div className="flex items-start gap-3">
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <BadgeCheck className="h-6 w-6 text-amber-800" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-lg">Verify NFT Receipt</h2>
                    <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white text-xs">For Voters</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter the Token ID from your receipt email. Confirms participation and links to the on-chain mint.
                    The NFT contains no ballot choices.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <label className="text-xs font-semibold text-amber-900">Token ID</label>
                <Input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="e.g., 1234" />
                <div className="flex gap-2 pt-2">
                  <Button className="w-full bg-gradient-gold text-black hover:opacity-90" onClick={onOpenNftVerify}>
                    Open NFT Receipt Verification
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Opens in a new tab.</p>
              </div>
            </Card>

            <Card className="p-6 rounded-2xl border border-emerald-200 bg-white">
              <h3 className="font-bold text-emerald-900 mb-2">What this proves</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• You participated in the election (proof of participation).</li>
                <li>• The mint exists on-chain and can be independently checked.</li>
                <li>• Your ballot choices are not stored in the NFT.</li>
              </ul>
              <div className="mt-4 rounded-xl border bg-emerald-50 p-3">
                <div className="text-xs font-semibold text-emerald-900">Tip</div>
                <div className="text-xs text-muted-foreground">
                  If you are testing locally, use <span className="font-mono">vercel dev</span> so the{" "}
                  <span className="font-mono">/verify/*</span> rewrites work the same as production.
                </div>
              </div>
            </Card>
          </section>

          {/* Progressive disclosure: Oversight tools */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowOversightTools((v) => !v)}
              className="w-full flex items-center justify-between rounded-2xl border bg-white px-5 py-4 hover:bg-emerald-50 transition"
            >
              <div className="text-left">
                <div className="font-bold text-emerald-900">For Auditors & Public Oversight</div>
                <div className="text-xs text-muted-foreground">
                  Tools for auditors/panelists. Voters usually don’t need these.
                </div>
              </div>
              {showOversightTools ? (
                <ChevronUp className="h-5 w-5 text-emerald-700" />
              ) : (
                <ChevronDown className="h-5 w-5 text-emerald-700" />
              )}
            </button>

            {showOversightTools ? (
              <div className="grid lg:grid-cols-3 gap-6">
                {/* Vote inclusion */}
                <Card className="p-6 rounded-2xl border-2 border-emerald-200 hover:border-emerald-400 transition">
                  <div className="flex items-start gap-3">
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <ShieldCheck className="h-6 w-6 text-emerald-800" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-lg">Verify Vote Inclusion</h2>
                        <Badge variant="outline" className="border-emerald-600 text-emerald-700 text-xs">
                          Auditor Tool
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Enter a Vote ID to open the official verification page. Vote IDs are provided to authorized
                        auditors.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <label className="text-xs font-semibold text-emerald-900">Vote ID</label>
                    <Input
                      value={voteId}
                      onChange={(e) => setVoteId(e.target.value)}
                      placeholder="e.g., 9b2f9c6a-... (UUID)"
                    />
                    <div className="flex gap-2 pt-2">
                      <Button className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={onOpenVoteVerify}>
                        Open Vote Verification
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Opens in a new tab.</p>
                  </div>
                </Card>

                {/* ZK tally */}
                <Card className="p-6 rounded-2xl border-2 border-slate-200 opacity-95">
                  <div className="flex items-start gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <FileSearch className="h-6 w-6 text-slate-700" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-lg">Verify ZK Tally</h2>
                        <Badge variant="secondary" className="text-xs">
                          Available after finalization
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Verifies that published election results match the on-chain committed votes using a
                        zero-knowledge proof (once submitted).
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <label className="text-xs font-semibold text-slate-700">Election ID</label>
                    <Input disabled placeholder="e.g., election UUID" />
                    <Button disabled className="w-full mt-2">
                      Open ZK Tally Verification
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Enable this once your on-chain tally registry is populated.
                    </p>
                  </div>
                </Card>

                {/* Local dev note */}
                <Card className="p-6 rounded-2xl border border-amber-200 bg-white">
                  <h3 className="font-bold text-amber-900 mb-2">Local testing note</h3>
                  <p className="text-sm text-muted-foreground">
                    If you run <span className="font-mono">npm run dev</span>, Vercel rewrites won’t apply. Use{" "}
                    <span className="font-mono">vercel dev</span> (recommended) or open the API routes directly:
                  </p>
                  <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                    <li>• <span className="font-mono">/api/verify/nft/&lt;tokenId&gt;</span></li>
                    <li>• <span className="font-mono">/api/verify/vote/&lt;voteId&gt;</span></li>
                  </ul>
                </Card>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-white p-6">
            <h3 className="font-bold text-emerald-900 mb-2">What verification means</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Verification pages are public and read-only.</li>
              <li>• They prove integrity (inclusion / authenticity) without revealing ballot choices.</li>
              <li>• If verification fails, the page will show the mismatch and the on-chain anchors used as truth.</li>
            </ul>
          </section>
        </div>
      </main>

      <footer className="border-t bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-muted-foreground">
          © {new Date().getFullYear()} BotoVeritas • FEU Alabang
        </div>
      </footer>
    </div>
  );
}
