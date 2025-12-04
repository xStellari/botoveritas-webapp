import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";

// OPTIONAL: Your capitalization helper (keep your preferred version)
const formatName = (str: string) => {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (/^(ii|iii|iv|v)$/i.test(word)) return word.toUpperCase();
      if (word.endsWith(".")) return word.charAt(0).toUpperCase() + word.slice(1);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

export default function Register() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
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
        suffix,
        yearLevel,
        orgAffiliations,
        fullEmail,
      },
    });
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
      {/* Background animation */}
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

          /* Progress bar fill animation */
          @keyframes progressFill {
            0% { width: 0%; }
            100% { width: 50%; }
          }
        `}
      </style>

      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background to-secondary/15 animate-gradient" />

      <div className="max-w-2xl w-full animate-fade-in-up">
        <Card className="shadow-xl rounded-2xl border border-primary/20 bg-white/90 backdrop-blur">

          {/* ========================== */}
          {/*   REDESIGNED HEADER + STEPPER   */}
          {/* ========================== */}
          <CardHeader className="text-center pb-8 pt-10 space-y-4">

            <h1
              className="
                text-4xl font-extrabold leading-tight
                bg-gradient-to-r from-primary to-secondary
                bg-clip-text text-transparent
              "
            >
              Student Registration
            </h1>

            <CardDescription className="text-muted-foreground text-lg">
              Step 1 of 2 — Personal Information
            </CardDescription>

            {/* Animated Progress Bar */}
            <div className="relative w-64 h-2 bg-gray-200 rounded-full mx-auto mt-4 overflow-hidden">
              <div
                className="
                  absolute left-0 top-0 h-full
                  bg-gradient-to-r from-primary to-secondary
                  rounded-full
                "
                style={{
                  animation: "progressFill 1.4s ease-out forwards",
                }}
              ></div>
            </div>

            {/* Stepper Circles */}
            <div className="flex justify-center mt-6 gap-12">

              {/* STEP 1 */}
              <div className="flex flex-col items-center">
                <div
                  className="
                    h-10 w-10 rounded-full flex items-center justify-center
                    bg-gradient-to-r from-primary to-secondary text-white
                    font-semibold shadow-md
                  "
                >
                  1
                </div>
                <span className="mt-2 text-xs font-medium text-primary tracking-wide">
                  Personal Info
                </span>
              </div>

              {/* STEP 2 */}
              <div className="flex flex-col items-center opacity-60">
                <div
                  className="
                    h-10 w-10 rounded-full flex items-center justify-center
                    border-2 border-gray-300 text-gray-400 font-semibold
                  "
                >
                  2
                </div>
                <span className="mt-2 text-xs text-muted-foreground tracking-wide">
                  Identity
                </span>
              </div>

            </div>
          </CardHeader>

          {/* ========================== */}
          {/* FORM CONTENT (unchanged)    */}
          {/* ========================== */}
          <CardContent className="space-y-6 px-8 pb-10">

            <form onSubmit={handleProceed} className="space-y-6">

              {/* NAME ROW */}
              <div className="grid gap-6 md:grid-cols-[2fr_0.5fr_2fr_1.2fr]">

                {/* First Name */}
                <div>
                  <Label className="font-semibold">First Name</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(formatName(e.target.value))}
                    required
                    className="mt-1"
                  />
                </div>

                {/* M.I. */}
                <div>
                  <Label className="font-semibold">M.I.</Label>
                  <Input
                    value={middleName}
                    maxLength={1}
                    onChange={(e) =>
                      setMiddleName(e.target.value.toUpperCase())
                    }
                    className="mt-1 text-center"
                  />
                </div>

                {/* Last Name */}
                <div>
                  <Label className="font-semibold">Last Name</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(formatName(e.target.value))}
                    required
                    className="mt-1"
                  />
                </div>

                {/* Suffix */}
                <div>
                  <Label className="font-semibold">Suffix</Label>
                  <select
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    className="w-full border rounded px-3 py-2 mt-1 bg-white shadow-sm"
                  >
                    <option value="">None</option>
                    <option value="Jr.">Jr.</option>
                    <option value="Sr.">Sr.</option>
                    <option value="II">II</option>
                    <option value="III">III</option>
                    <option value="IV">IV</option>
                  </select>
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
                          ? "bg-emerald-600 text-white shadow-md"
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
                    onChange={(e) => {
                      let value = e.target.value;

                      if (value.includes("@")) {
                        toast.error(
                          <div>
                            Please enter only the email prefix (before @).<br /><br />
                            The domain is automatically added.
                          </div>
                        );
                        e.target.blur();
                        return;
                      }

                      setSignupEmail(value.trim());
                    }}
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
