import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type AuthProps = {
  onSuccess?: () => void; // optional callback
};

export default function Auth({ onSuccess }: AuthProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode"); // "register" or null

  const [loading, setLoading] = useState(false);
  
  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  // Signup form
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [orgAffiliations, setOrgAffiliations] = useState<string[]>([]);
  const orgs = ["Student Coordinating Council", "ICpEP", "Honor Society"];
  const fullEmail = `${signupEmail.trim()}@feualabang.edu.ph`;

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const role = session.user?.user_metadata?.role;
        const params = new URLSearchParams(location.search);
        const mode = params.get("mode");
        if (!mode) {
          if (role === "admin") {
            navigate("/admin");
          } else {
            navigate("/");
          }
        }
      }
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Logged in successfully!");
      if (onSuccess) onSuccess();
      navigate("/admin");
    }
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Step 1: Create the Auth user (UID is generated here)
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

    // Step 2: Insert voter row tied to auth.uid()
    const { error: voterError } = await supabase.from("voters" as any).insert([
      {
        id: user.id,
        email: fullEmail,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        year_level: yearLevel,
        org_affiliations: orgAffiliations
      },
    ]);
    if (voterError) {
      toast.error(voterError.message);
    } else {
      // ✅ Updated toast message
      toast.success("Registration successful! You’ll be able to vote once the election period begins.");
      // ✅ Redirect to confirmation screen with voter info
      navigate("/registration-confirmation", {
        state: { firstName, lastName, orgAffiliations }
      });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-feu-green via-background to-feu-gold p-4">
      <Card className="w-full max-w-md backdrop-blur-sm bg-background/95">
        <CardHeader className="text-center">
          <img 
            src="/src/assets/feu-logo.png" 
            alt="FEU Alabang" 
            className="h-20 mx-auto mb-4"
          />
          <CardTitle className="text-2xl font-bold text-feu-green">BotoVeritas</CardTitle>
          <CardDescription>Blockchain-Based Voting System</CardDescription>
        </CardHeader>
        <CardContent>
          {/* 👇 use mode to set default tab */}
          <Tabs defaultValue={mode === "register" ? "signup" : "login"} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="jadelacruz@feualabang.edu.ph"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Logging in..." : "Login"}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first-name">First Name</Label>
                    <Input
                      id="first-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="middle-initial">M.I</Label>
                    <Input
                      id="middle-initial"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      required
                      maxLength={1}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last-name">Last Name</Label>
                    <Input
                      id="last-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
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
                  <Label htmlFor="org-affiliations">Organizational Affiliations</Label>
                  <div className="flex flex-col gap-2">
                    {orgs.map((org) => (
                      <Button
                        key={org}
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
                        type="button"
                      >
                        {org}                      
                      </Button>
                    ))}
                  </div>               
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email"> Email</Label>
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
                    <span className="text0sm text-muted-foreground">@feualabang.edu.ph</span>
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
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
                