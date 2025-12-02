import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export default function Register() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [orgAffiliations, setOrgAffiliations] = useState<string[]>([]);
  const [signupEmail, setSignupEmail] = useState("");

  const orgs = ["Student Coordinating Council", "ICpEP", "Honor Society"];
  const fullEmail = `${signupEmail.trim()}@feualabang.edu.ph`;

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName || !lastName || !signupEmail || !yearLevel) {
      toast.error("Please fill out all required fields.");
      return;
    }

    navigate("/register/verify", {
      state: {
        firstName,
        middleName,
        lastName,
        yearLevel,
        orgAffiliations,
        fullEmail,
      },
    });
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
      {/* Animated FEU gradient background */}
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
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in-up {
            animation: fadeInUp 0.4s ease-out forwards;
          }
        `}
      </style>

      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <div className="max-w-2xl w-full animate-fade-in-up">
        <Card className="shadow-xl rounded-2xl border border-primary/20 bg-white/90 backdrop-blur">
          <CardHeader className="text-center py-10 overflow-visible">
            <h1
              className="
                text-4xl
                font-extrabold
                mb-3
                leading-[1.2]
                bg-gradient-to-r
                from-primary
                to-secondary
                bg-clip-text
                text-transparent
              "
            >
              Student Registration
            </h1>

            <CardDescription className="text-muted-foreground text-lg">
              Step 1 of 2 — Enter your personal information
            </CardDescription>

            {/* Stepper circles */}
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="flex items-center gap-6">
                {/* Step 1 - active */}
                <div className="flex flex-col items-center">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center bg-gradient-to-r from-primary to-secondary text-white font-semibold shadow-md">
                    1
                  </div>
                  <span className="mt-1 text-xs font-medium text-primary">
                    Personal Info
                  </span>
                </div>

                {/* Connector */}
                <div className="h-[2px] w-16 md:w-24 bg-primary/40" />

                {/* Step 2 - upcoming */}
                <div className="flex flex-col items-center">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center border-2 border-muted text-muted-foreground font-semibold bg-background">
                    2
                  </div>
                  <span className="mt-1 text-xs text-muted-foreground">
                    Identity
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-1 tracking-[0.18em] uppercase">
                Step 1 of 2
              </p>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 px-8 pb-10">
            <form onSubmit={handleProceed} className="space-y-6">
              {/* NAME FIELDS */}
              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <Label className="font-semibold">First Name</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="font-semibold">M.I.</Label>
                  <Input
                    value={middleName}
                    maxLength={1}
                    onChange={(e) => setMiddleName(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="font-semibold">Last Name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>
              </div>

              {/* YEAR LEVEL */}
              <div>
                <Label className="font-semibold">Year Level</Label>
                <select
                  value={yearLevel}
                  onChange={(e) => setYearLevel(e.target.value)}
                  className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm"
                  required
                >
                  <option value="" disabled>Select Year Level</option>
                  <option>1st Year</option>
                  <option>2nd Year</option>
                  <option>3rd Year</option>
                  <option>4th Year</option>
                </select>
              </div>

              {/* ORG AFFILIATIONS */}
              <div>
                <Label className="font-semibold">Organizational Affiliations</Label>
                <div className="grid md:grid-cols-3 gap-3 mt-3">
                  {orgs.map((org) => (
                    <Button
                      key={org}
                      type="button"
                      variant={orgAffiliations.includes(org) ? "default" : "outline"}
                      onClick={() =>
                        setOrgAffiliations((prev) =>
                          prev.includes(org)
                            ? prev.filter((o) => o !== org)
                            : [...prev, org]
                        )
                      }
                      className={`w-full ${
                        orgAffiliations.includes(org)
                          ? "bg-gradient-to-r from-primary to-secondary text-white"
                          : "border-primary/40 text-primary"
                      }`}
                    >
                      {org}
                    </Button>
                  ))}
                </div>
              </div>

              {/* EMAIL */}
              <div>
                <Label className="font-semibold">FEU Email</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder="your.email"
                    value={signupEmail}
                    onChange={(e) =>
                      setSignupEmail(
                        e.target.value.replace(/@feualabang\.edu\.ph$/i, "").trim()
                      )
                    }
                    required
                  />
                  <span className="text-muted-foreground">@feualabang.edu.ph</span>
                </div>
              </div>

              {/* PROCEED BUTTON */}
              <Button
                type="submit"
                className="w-full text-lg py-6 font-semibold bg-gradient-to-r from-primary to-secondary hover:opacity-90"
              >
                Proceed to Identity Verification
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
