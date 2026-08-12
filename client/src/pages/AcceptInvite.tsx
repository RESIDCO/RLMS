import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import residcoGlobePath from "@assets/residco-globe.svg";

function readInviteParams(): { tokenHash: string | null; type: string | null } {
  const fromSearch = new URLSearchParams(window.location.search);
  // Also support "#/accept-invite?token_hash=...&type=invite"
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const fromHash = new URLSearchParams(hashQuery);
  return {
    tokenHash: fromSearch.get("token_hash") || fromHash.get("token_hash"),
    type: fromSearch.get("type") || fromHash.get("type") || "invite",
  };
}

/**
 * Invite acceptance page.
 * Email links point here with token_hash (not a one-click verify URL), so
 * Gmail/Outlook link scanners cannot consume the invite. User sets a
 * password, then we verify the OTP and land them in the app.
 */
export default function AcceptInvite() {
  const { clearNeedsPasswordChange } = useAuth();
  const [{ tokenHash, type }] = useState(readInviteParams);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Mark that this browser is completing an invite (for AuthGate fallback)
    if (tokenHash) sessionStorage.setItem("rlms_needs_password", "invite");
  }, [tokenHash]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!tokenHash) {
      setError("This invite link is missing its token. Ask your admin to resend the invitation.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const otpType = type === "recovery" ? "recovery" : "invite";
    const { data, error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as "invite" | "recovery",
    });

    if (verifyErr || !data.session) {
      setLoading(false);
      setError(
        verifyErr?.message ||
          "This invite link is invalid or has expired. Ask your admin to resend it."
      );
      return;
    }

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (pwErr) {
      setError(pwErr.message);
      return;
    }

    clearNeedsPasswordChange();
    setDone(true);
    // Drop query params and enter the app
    window.history.replaceState(null, "", `${window.location.pathname}#/`);
    window.location.reload();
  }

  if (!tokenHash) {
    return (
      <Shell>
        <h1 className="font-serif text-base font-semibold text-foreground mb-1">Invalid invite link</h1>
        <p className="text-xs text-muted-foreground mb-4">
          This link is missing its invite token. Open the latest email from RESIDCO RLMS, or ask your
          admin to resend the invitation.
        </p>
        <Button className="w-full" onClick={() => { window.location.hash = "#/"; }}>
          Go to sign in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="font-eyebrow mb-1.5">Welcome</div>
      <h1 className="font-serif text-base font-semibold text-foreground mb-1">
        {done ? "You're in" : "Set your password"}
      </h1>
      <p className="text-xs text-muted-foreground mb-5">
        {done
          ? "Redirecting to RLMS…"
          : "Choose a password to activate your RESIDCO RLMS account. This is the only step — you will not see a separate sign-in screen."}
      </p>

      {!done && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-password" className="text-xs">New password</Label>
            <Input
              id="ai-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              autoComplete="new-password"
              data-testid="input-accept-password"
              className="bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-confirm" className="text-xs">Confirm password</Label>
            <Input
              id="ai-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              data-testid="input-accept-password-confirm"
              className="bg-background"
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading} data-testid="button-accept-invite">
            {loading ? "Activating…" : "Set password & enter RLMS"}
          </Button>
        </form>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <img src={residcoGlobePath} alt="RESIDCO globe emblem" className="w-14 h-14 object-contain" />
          <div className="text-center">
            <div className="font-serif text-lg font-semibold tracking-tight text-foreground">RLMS</div>
            <div className="font-eyebrow mt-1">RESIDCO</div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-card">{children}</div>
      </div>
    </div>
  );
}
