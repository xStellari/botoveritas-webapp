import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  CheckCircle2,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";
import { ElectionStatusBadge } from "@/components/elections/ElectionStatusBadge";
import { sortElections } from "@/utils/sortElections";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ConfirmationState = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  orgAffiliations?: string[];
  email?: string;
};

const ORG_REQUEST_OPTIONS = ["ICpEP", "HonSoc"] as const;

const prettyOrgLabel = (org: string) => {
  if (org === "SCC") return "Student Coordinating Council (SCC)";
  if (org === "ICpEP") return "Institute of Computer Engineers of the Philippines (ICpEP)";
  if (org === "HonSoc") return "Honor Society (HonSoc)";
  return org;
};

const orgShort = (org: string) => {
  if (org === "SCC") return "SCC";
  if (org === "ICpEP") return "ICpEP";
  if (org === "HonSoc") return "HonSoc";
  return org;
};

const RegistrationConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    firstName = "",
    middleName = "",
    lastName = "",
    suffix = "",
    orgAffiliations = [],
    email = "",
  } = (location.state || {}) as ConfirmationState;

  const [elections, setElections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Request state
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [reqOrg, setReqOrg] = useState<string>("");
  const [reqReason, setReqReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const fullName = [firstName, middleName && `${middleName}.`, lastName, suffix]
    .filter(Boolean)
    .join(" ");

  const orgSet = useMemo(
    () => new Set((orgAffiliations || []).filter(Boolean)),
    [orgAffiliations]
  );

  const detectedOrgs = useMemo(() => {
    const uniq = Array.from(new Set((orgAffiliations || []).filter(Boolean)));
    uniq.sort((a, b) => {
      if (a === "SCC") return -1;
      if (b === "SCC") return 1;
      return a.localeCompare(b);
    });
    return uniq;
  }, [orgAffiliations]);

  const missingRequestableOrgs = useMemo(() => {
    // SCC is open to all; only request ICpEP/HonSoc if missing
    return ORG_REQUEST_OPTIONS.filter((o) => !orgSet.has(o));
  }, [orgSet]);

  // Grab auth user (if session exists)
  useEffect(() => {
    const loadAuthUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setAuthUserId(null);
        return;
      }
      setAuthUserId(data.user?.id ?? null);
    };
    loadAuthUser();
  }, []);

  // Load elections (filter schedule by eligible_orgs vs detected orgs)
  useEffect(() => {
    const loadElections = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("elections")
        .select("title, start_date, end_date, is_active, eligible_orgs");

      if (error) {
        console.error("Error loading elections:", error.message);
        setElections([]);
        setLoading(false);
        return;
      }

      const all = data || [];

      const visible = all.filter((e) => {
        const eligibleOrgs: string[] | null = e.eligible_orgs ?? null;
        if (!eligibleOrgs || eligibleOrgs.length === 0) return true; // open to all (SCC)
        return eligibleOrgs.some((org) => orgSet.has(org));
      });

      setElections(sortElections(visible));
      setLoading(false);
    };

    loadElections();
  }, [orgSet]);

  const submitMembershipRequest = async () => {
    if (!reqOrg) {
      toast.error("Please select which organization you want to request.");
      return;
    }

    if (!authUserId) {
      toast.error(
        "No active session detected on this screen. Please proceed to the admin desk to file a membership review request."
      );
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("org_membership_requests").insert([
        {
          voter_id: authUserId,
          requested_org: reqOrg,
          reason: reqReason?.trim() ? reqReason.trim() : null,
        },
      ]);

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success("Request submitted. An admin will review your membership.");
      setReqOrg("");
      setReqReason("");
      setRequestOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Local keyframes for background + icon animation */}
      <style>
        {`
          @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .animate-gradient {
            background-size: 200% 200%;
            animation: gradientShift 12s ease-in-out infinite;
          }

          @keyframes successPop {
            0% { transform: scale(0.6); opacity: 0; }
            60% { transform: scale(1.05); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }

          @keyframes ringPulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45); }
            100% { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0); }
          }

          .success-icon {
            animation: successPop 0.6s ease-out forwards, ringPulse 1.6s ease-out infinite;
          }
        `}
      </style>

      {/* Animated background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <Card className="max-w-3xl w-full p-10 text-center shadow-xl border border-primary/20 bg-card/90 backdrop-blur-md">
        {/* Success badge */}
        <div className="flex justify-center mb-6">
          <div className="success-icon rounded-full bg-gradient-to-br from-emerald-500 to-primary p-4 text-white flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10" />
          </div>
        </div>

        <h1 className="text-4xl font-extrabold mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Registration Submitted
        </h1>

        <p className="text-muted-foreground mb-5 text-base">
          Thanks,&nbsp;
          <span className="font-semibold text-foreground">{fullName}</span>.
          <br />
          To activate your registration, you must verify your email first.
        </p>

        {/* ✅ Email verification required */}
        <div className="mb-8 rounded-xl border border-primary/20 bg-muted/10 p-5 text-left">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>

            <div className="flex-1">
              <div className="font-semibold text-foreground">
                Email verification required (expires in 72 hours)
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                We sent a verification link to{" "}
                <span className="font-medium text-foreground">
                  {email ? email : "your registered email"}
                </span>
                . Open the email and click the link to complete your registration.
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                After verification, return to the kiosk and proceed to voting.
              </div>
            </div>
          </div>
        </div>


        {/* ✅ HERO: Eligible orgs */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">
              Your Eligible Organizations
            </h2>
          </div>

          {detectedOrgs.length > 0 ? (
            <>
              {/* ✅ Fix 1 + optional: centered auto-fit grid */}
              <div className="mx-auto max-w-3xl">
                <div className="grid gap-3 justify-items-stretch [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                  {detectedOrgs.map((org) => (
                    <div
                      key={org}
                      className="rounded-xl border border-primary/15 bg-white/70 backdrop-blur px-4 py-4 text-left shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm text-muted-foreground font-medium">
                            Eligible for
                          </div>
                          <div className="mt-1 text-lg font-extrabold text-foreground">
                            {orgShort(org)}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {prettyOrgLabel(org)}
                          </div>
                        </div>

                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ✅ Fix 2: small trigger → modal */}
              {missingRequestableOrgs.length > 0 && (
                <div className="mt-3 flex justify-center">
                  <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="text-sm text-primary underline underline-offset-4 hover:opacity-80 flex items-center gap-2"
                      >
                        <HelpCircle className="h-4 w-4" />
                        Not seeing an organization you expected? Click here.
                      </button>
                    </DialogTrigger>

                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Request Membership Review</DialogTitle>
                        <DialogDescription>
                          Eligibility is based on the official roster. If you believe you should be included,
                          submit a review request so an admin can verify and update the roster if needed.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="grid gap-4 mt-2">
                        <div className="text-left">
                          <label className="text-sm font-medium">Request membership for</label>
                          <select
                            value={reqOrg}
                            onChange={(e) => setReqOrg(e.target.value)}
                            className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm"
                          >
                            <option value="">Select organization</option>
                            {missingRequestableOrgs.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="text-left">
                          <label className="text-sm font-medium">Reason (optional)</label>
                          <textarea
                            value={reqReason}
                            onChange={(e) => setReqReason(e.target.value)}
                            className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm min-h-[110px]"
                            placeholder="Ex: My name may be listed differently in the roster (nickname, spacing, suffix)."
                          />
                        </div>

                        {!authUserId && (
                          <div className="text-xs text-muted-foreground text-left">
                            Note: This screen may not have an active session (depending on email verification).
                            If submit is blocked, please proceed to the admin desk to file the request.
                          </div>
                        )}

                        <div className="flex gap-2 justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setRequestOpen(false)}
                            disabled={submitting}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            className="bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90"
                            onClick={submitMembershipRequest}
                            disabled={submitting || !reqOrg}
                          >
                            {submitting ? "Submitting..." : "Submit Request"}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-border bg-muted/10 p-5">
              <p className="text-sm text-muted-foreground">
                No memberships were detected. Please contact the admin desk for assistance.
              </p>
            </div>
          )}
        </div>

        {/* Election schedule */}
        <div className="mb-8 text-left">
          <h2 className="text-lg font-semibold mb-2 text-primary text-center">
            Your Election Schedule
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground text-center">
              Loading election schedule...
            </p>
          ) : elections.length > 0 ? (
            <div className="grid gap-4 mt-3">
              {elections.map((election) => (
                <div
                  key={election.title}
                  className="border border-border rounded-lg p-4 bg-muted/10"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-bold text-foreground">
                      {election.title}
                    </h3>
                    <ElectionStatusBadge election={election} />
                  </div>

                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary mt-[2px]" />
                    <div className="flex flex-col gap-0.5">
                      <span>
                        <strong>Opens:</strong>{" "}
                        {new Date(election.start_date).toLocaleDateString()}{" "}
                        {new Date(election.start_date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>
                        <strong>Closes:</strong>{" "}
                        {new Date(election.end_date).toLocaleDateString()}{" "}
                        {new Date(election.end_date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center mt-2">
              No election schedule found yet.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Button
            className="w-full bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90 text-base py-5 font-semibold"
            onClick={() => navigate("/")}
          >
            Go to Home
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default RegistrationConfirmation;
