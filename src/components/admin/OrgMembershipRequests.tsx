import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

type RequestRow = {
  id: string;
  voter_id: string;
  requested_org: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewer_note: string | null;
  voters?: {
    email: string;
    first_name: string;
    last_name: string;
    suffix: string | null;
  } | null;
};

const formatFullName = (v?: RequestRow["voters"] | null) => {
  if (!v) return "Unknown voter";
  const suffix = v.suffix ? ` ${v.suffix}` : "";
  return `${v.first_name} ${v.last_name}${suffix}`;
};

const prettyTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });

export default function OrgMembershipRequests() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(
    () => rows.filter((r) => r.status === tab),
    [rows, tab]
  );

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("org_membership_requests")
      .select(
        `
        id,
        voter_id,
        requested_org,
        reason,
        status,
        created_at,
        reviewed_at,
        reviewed_by,
        reviewer_note,
        voters: voters (
          email,
          first_name,
          last_name,
          suffix
        )
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data as any) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const process = async (reqId: string, action: "approved" | "rejected") => {
    setBusyId(reqId);
    try {
      const note = (noteById[reqId] ?? "").trim() || null;

      const { data, error } = await supabase.rpc(
        "process_org_membership_request" as any,
        {
          p_request_id: reqId,
          p_action: action,
          p_reviewer_note: note,
        } as any
      );

      if (error) {
        toast.error(error.message);
        return;
      }

      if (action === "approved") {
        toast.success("Approved. Voter eligibility updated.");
      } else {
        toast.success("Rejected.");
      }

      // refresh
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-feu-green">
              Membership Review Requests
            </h2>
            <p className="text-sm text-muted-foreground">
              Approve/reject requests when voters believe they should be eligible for ICpEP/HonSoc.
              Approving adds them to the official roster and recomputes eligibility.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button
          variant={tab === "pending" ? "default" : "outline"}
          onClick={() => setTab("pending")}
        >
          Pending
        </Button>
        <Button
          variant={tab === "approved" ? "default" : "outline"}
          onClick={() => setTab("approved")}
        >
          Approved
        </Button>
        <Button
          variant={tab === "rejected" ? "default" : "outline"}
          onClick={() => setTab("rejected")}
        >
          Rejected
        </Button>
      </div>

      <Card className="p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading requests…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {tab} requests.</p>
        ) : (
          <div className="space-y-4">
            {visible.map((r) => {
              const voterName = formatFullName(r.voters);
              const voterEmail = r.voters?.email ?? "Unknown email";
              const noteVal = noteById[r.id] ?? r.reviewer_note ?? "";

              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-border bg-background p-4"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {voterName}
                        </span>{" "}
                        • {voterEmail}
                      </div>

                      <div className="text-base font-semibold">
                        Requested:{" "}
                        <span className="text-feu-green">{r.requested_org}</span>
                      </div>

                      {r.reason && (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Reason:</span>{" "}
                          {r.reason}
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        Submitted: {prettyTime(r.created_at)}
                        {r.reviewed_at ? ` • Reviewed: ${prettyTime(r.reviewed_at)}` : ""}
                      </div>
                    </div>

                    {r.status === "pending" ? (
                      <div className="md:w-[360px] space-y-2">
                        <div className="text-left">
                          <label className="text-xs font-medium text-muted-foreground">
                            Reviewer note (optional)
                          </label>
                          <textarea
                            className="mt-1 w-full min-h-[76px] rounded-md border border-border bg-background px-3 py-2 text-sm"
                            placeholder="Optional note (e.g., roster updated, name variant, etc.)"
                            value={noteVal}
                            onChange={(e) =>
                              setNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            disabled={busyId === r.id}
                          />
                        </div>

                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            onClick={() => process(r.id, "rejected")}
                            disabled={busyId === r.id}
                          >
                            Reject
                          </Button>
                          <Button
                            onClick={() => process(r.id, "approved")}
                            disabled={busyId === r.id}
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="md:w-[360px] space-y-1">
                        <div className="text-sm">
                          Status:{" "}
                          <span className="font-semibold">
                            {r.status.toUpperCase()}
                          </span>
                        </div>
                        {r.reviewer_note && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Note:</span>{" "}
                            {r.reviewer_note}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
