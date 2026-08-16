import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import residcoGlobePath from "@assets/residco-globe.svg";

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function Login({ accessDenied = false }: { accessDenied?: boolean }) {
  const { clearAccessDenied } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    clearAccessDenied();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleMicrosoft() {
    setError(null);
    clearAccessDenied();
    setMicrosoftLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email openid profile",
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError(error.message);
      setMicrosoftLoading(false);
    }
  }

  const busy = loading || microsoftLoading;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src={residcoGlobePath}
            alt="RESIDCO globe emblem"
            className="w-14 h-14 object-contain"
          />
          <div className="text-center">
            <div className="font-serif text-lg font-semibold tracking-tight text-foreground">RLMS</div>
            <div className="font-eyebrow mt-1">RESIDCO</div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-serif text-base font-semibold text-foreground mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-5">
            Railcar Lease Management System. New users: open the invite email and use{" "}
            <span className="text-foreground">Accept invitation</span> to set your password —
            this sign-in form is only for accounts that already have a password.
          </p>

          {accessDenied && (
            <div
              className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-3 mb-5 text-sm text-foreground"
              data-testid="access-denied-message"
            >
              <div className="font-semibold">You're not authorized to access RLMS.</div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                If you believe you should have access, please contact Bruce Harbridge at{" "}
                <a
                  href="mailto:harbridge@residco.com"
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                >
                  harbridge@residco.com
                </a>{" "}
                to request it.
              </p>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={handleMicrosoft}
            data-testid="button-sign-in-microsoft"
          >
            <MicrosoftLogo className="h-4 w-4" />
            {microsoftLoading ? "Redirecting…" : "Sign in with Microsoft"}
          </Button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@residco.com"
                required
                autoComplete="email"
                data-testid="input-email"
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                data-testid="input-password"
                className="bg-background"
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={busy}
              data-testid="button-sign-in"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Contact your administrator to request access.
        </p>
      </div>
    </div>
  );
}
