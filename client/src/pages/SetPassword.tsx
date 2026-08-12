import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import residcoGlobePath from "@assets/residco-globe.svg";

/** First-login / invite / recovery: set a password while already sessioned. */
export default function SetPassword() {
  const { clearNeedsPasswordChange, user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    clearNeedsPasswordChange();
    // Clean hash so wouter lands on dashboard
    if (window.location.hash.includes("access_token") || window.location.hash.includes("type=")) {
      window.location.hash = "#/";
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
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

        <div className="rounded-xl border border-border bg-card p-6 shadow-card">
          <div className="font-eyebrow mb-1.5">Welcome</div>
          <h1 className="font-serif text-base font-semibold text-foreground mb-1">Set your password</h1>
          <p className="text-xs text-muted-foreground mb-5">
            {user?.email
              ? `Choose a password for ${user.email} to finish activating your RESIDCO RLMS account.`
              : "Choose a password to finish activating your RESIDCO RLMS account."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sp-password" className="text-xs">New password</Label>
              <Input
                id="sp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                autoComplete="new-password"
                data-testid="input-set-password"
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-confirm" className="text-xs">Confirm password</Label>
              <Input
                id="sp-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                data-testid="input-set-password-confirm"
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
              disabled={loading}
              data-testid="button-set-password"
            >
              {loading ? "Saving…" : "Set password & continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
