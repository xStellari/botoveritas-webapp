import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

// --- SIMULATION HELPERS ---
function generateSimulatedRFID() {
  return "RFID-" + Math.floor(1000000000 + Math.random() * 9000000000);
}

function generateSimulatedFaceHash() {
  const chars = "ABCDEF0123456789";
  let out = "FACE-";
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default function Register() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // Signup form state
  const [signupEmail, setSignupEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [orgAffiliations, setOrgAffiliations] = useState<string[]>([]);
  const orgs = ["Student Coordinating Council", "ICpEP", "Honor Society"];
  const fullEmail = `${signupEmail.trim()}@feualabang.edu.ph`;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Step 1: Create the Auth user
    const { data, error } = await supabase.auth.signUp({
      email: fullEmail,
      password: crypto.randomUUID(), // random, invisible to user
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const user = data.user;
    await supabase.auth.setSession(data.session);

    // --- SIMULATED BIOMETRIC DATA ---
    const simulatedRFID = generateSimulatedRFID();
    const simulatedFaceHash = generateSimulatedFaceHash();

    // Step 2: Insert voter row
    const { error: voterError } = await supabase.from("voters").insert([
      {
        id: user.id,
        email: fullEmail,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        year_level: yearLevel,
        org_affiliations: orgAffiliations,

        // --- NEW SIMULATED BIOMETRIC FIELDS ---
        rfid_tag: simulatedRFID,
        face_id_hash: simulatedFaceHash,
      },
    ]);

    if (voterError) {
      toast.error(voterError.message);
    } else {
      toast.success("Registration successful!");

      navigate("/registration-confirmation", {
        state: {
          firstName,
          lastName,
          orgAffiliations,
          simulatedRFID,
          simulatedFaceHash,
        },
      });
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-feu-green via-background to-feu-gold p-4">
      <Card className="w-full max-w-md backdrop-blur-sm bg-background/95">
        <CardHeader className="text-center">
          <img src="/src/assets/feu-logo.png" alt="FEU Alabang" className="h-20 mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold text-feu-green">BotoVeritas</CardTitle>
          <CardDescription>Blockchain-Based Voting System</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first-name">First Name</Label>
                <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middle-initial">M.I</Label>
                <Input id="middle-initial" value={middleName} onChange={(e) => setMiddleName(e.target.value)} required maxLength={1} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last Name</Label>
                <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="year-level">Year Level</Label>
              <select
                id="year-level"
                value={yearLevel}
                onChange={(e) => setYearLevel(e.target.value)}
                required
                className="w-full border rounded px-2 py-1"
              >
                <option value="" disabled>Select Year Level</option>
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Organizational Affiliations</Label>
              <div className="flex flex-col gap-2">
                {orgs.map((org) => (
                  <Button
                    key={org}
                    type="button"
                    variant="outline"
                    className={`transition-colors duration-200 ${
                      orgAffiliations.includes(org)
                        ? "border-2 border-feu-green text-feu-green"
                        : "border border-muted text-foreground hover:border-feu-green"
                    }`}
                    onClick={() =>
                      setOrgAffiliations((prev) =>
                        prev.includes(org) ? prev.filter((o) => o !== org) : [...prev, org]
                      )
                    }
                  >
                    {org}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="signup-email"
                  type="text"
                  placeholder="your.email"
                  value={signupEmail}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const cleaned = raw.replace(/@feualabang\.edu\.ph$/i, "").trim();
                    setSignupEmail(cleaned);
                  }}
                  required
                  className="w-2/3"
                />
                <span className="text-sm text-muted-foreground">@feualabang.edu.ph</span>
              </div>
              {signupEmail && (
                <p className="text-sm text-muted-foreground">
                  Email will be registered as <strong>{signupEmail}@feualabang.edu.ph</strong>
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating Account..." : "Sign Up"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
