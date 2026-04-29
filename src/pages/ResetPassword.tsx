import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Lock } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";

const getPasswordError = (password: string) => {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password)) return "Password must include at least one letter.";
  if (!/\d/.test(password)) return "Password must include at least one number.";
  return "";
};

const ResetPassword = () => {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordError = getPasswordError(password);

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(!!session);
      }
    });

    const prepareRecoverySession = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) toast.error(error.message);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) {
        setReady(!!session);
        setChecking(false);
      }
    };

    prepareRecoverySession();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      setPassword("");
      setConfirmPassword("");
      nav("/");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not update password"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page-bg min-h-screen flex items-center justify-center px-4 page-transition">
      <main className="w-full max-w-md rounded-[2rem] bg-card border shadow-elev p-6 sm:p-7 hero-enter">
        <Button variant="ghost" size="sm" onClick={() => nav("/")} className="mb-5 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-full bg-primary/10 grid place-items-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-primary leading-none">Reset password</h1>
            <p className="text-xs text-muted-foreground mt-1">Choose a new password for your account.</p>
          </div>
        </div>

        {checking ? (
          <p className="text-sm text-muted-foreground">Checking reset link...</p>
        ) : !ready ? (
          <p className="text-sm text-muted-foreground">
            This reset link is invalid or expired. Request a new link from the admin login dialog.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!password && !!passwordError}
                aria-describedby={passwordError ? "new-password-error" : undefined}
              />
              {password && passwordError && (
                <p id="new-password-error" className="text-xs text-destructive">
                  {passwordError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Updating..." : "Update password"}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
};

export default ResetPassword;
