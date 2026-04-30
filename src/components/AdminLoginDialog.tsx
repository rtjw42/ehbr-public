import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { X, Lock } from "lucide-react";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { useAdmin } from "@/hooks/useAdmin";

type AuthMode = "sign-in" | "register" | "forgot";

interface Props {
  open: boolean;
  onClose: () => void;
  variant?: "center" | "dropdown";
}

const getRegistrationPasswordError = (password: string) => {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password)) return "Password must include at least one letter.";
  if (!/\d/.test(password)) return "Password must include at least one number.";
  return "";
};

const emailSchema = z.string().trim().email("Enter a valid email address.");

export const AdminLoginDialog = ({ open, onClose, variant = "center" }: Props) => {
  const { refreshAdmin } = useAdmin();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeError, setInviteCodeError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordError = mode === "register" ? getRegistrationPasswordError(password) : "";

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const verifyAdmin = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("No session");

    const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
    if (!data?.some((r) => r.role === "admin")) {
      await supabase.auth.signOut();
      throw new Error("Not an admin account");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const parsedEmail = emailSchema.safeParse(email);
      if (!parsedEmail.success) {
        setEmailError(parsedEmail.error.errors[0].message);
        toast.error(parsedEmail.error.errors[0].message);
        return;
      }
      const cleanEmail = parsedEmail.data;

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Password reset email sent");
        setMode("sign-in");
        return;
      }

      if (mode === "register") {
        const cleanInvite = inviteCode.trim();
        if (!cleanInvite) {
          setInviteCodeError("Invite code is required.");
          return;
        }
        if (passwordError) throw new Error(passwordError);

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/registration-success`,
            data: {
              invite_code: cleanInvite,
            },
          },
        });
        if (error) throw error;

        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setEmailError("This email is already registered. Sign in instead.");
          toast.error("This email is already registered. Sign in instead.");
          return;
        }

        if (!data.session) {
          toast.success("Check your email to confirm your account, then sign in");
          setPassword("");
          setInviteCode("");
          setMode("sign-in");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
      }

      await verifyAdmin();
      await refreshAdmin();
      toast.success("Welcome back");
      setPassword("");
      setInviteCode("");
      onClose();
    } catch (error: unknown) {
      if (mode === "register") {
        await supabase.auth.signOut();
      }
      const message = getErrorMessage(error, "Login failed");
      if (mode === "register" && /already registered|already exists|email.*exists|user.*registered/i.test(message)) {
        setEmailError("This email is already registered. Sign in instead.");
        toast.error("This email is already registered. Sign in instead.");
      } else if (mode === "register" && /invite|database|trigger|hook/i.test(message)) {
        setInviteCodeError("Invalid or expired invite code.");
        toast.error("Invalid or expired invite code.");
      } else {
        toast.error(message === "Invalid login credentials" ? "Wrong email or password" : message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const title = mode === "register" ? "Register" : mode === "forgot" ? "Reset password" : "Admin";
  const subtitle = mode === "register"
    ? "Create a band leader account."
    : mode === "forgot"
      ? "Send yourself a reset link."
      : "Sign in to manage bookings.";

  const panelClassName = variant === "dropdown"
    ? "fixed inset-x-3 top-[calc(var(--site-nav-height)+0.5rem)] z-[101] mx-auto max-h-[min(calc(100svh-var(--site-nav-height)-1rem),42rem)] max-w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto animate-admin-dropdown sm:inset-x-auto sm:right-4 sm:top-[calc(var(--site-nav-height)+0.75rem)] sm:mx-0 sm:w-[min(24rem,calc(100vw-2rem))]"
    : "absolute inset-x-3 top-3 z-[61] mx-auto max-h-[min(88svh,42rem)] max-w-[min(28rem,calc(100vw-1.5rem))] overflow-y-auto animate-admin-top-in sm:inset-x-auto sm:right-4 sm:top-16 sm:mx-0 sm:w-[min(24rem,calc(100vw-2rem))]";

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 bg-transparent"
      />
      {/* Panel sliding in from the top */}
      <div className={panelClassName} role="dialog" aria-modal="true" aria-label="Admin login">
        <div className="relative rounded-[clamp(1.25rem,6vw,2rem)] bg-card border shadow-elev p-5 sm:p-7">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 h-8 w-8 grid place-items-center rounded-full hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className="h-11 w-11 rounded-full bg-primary/10 grid place-items-center">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-[clamp(1.5rem,7vw,2rem)] text-primary leading-none">{title}</h2>
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError("");
                }}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "admin-email-error" : undefined}
              />
              {emailError && (
                <p id="admin-email-error" className="text-xs text-destructive">
                  {emailError}
                </p>
              )}
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-pw">Password</Label>
                <Input
                  id="admin-pw"
                  type="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "register" ? 8 : 6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={mode === "register" && !!password && !!passwordError}
                  aria-describedby={mode === "register" && passwordError ? "admin-pw-error" : undefined}
                />
                {mode === "register" && password && passwordError && (
                  <p id="admin-pw-error" className="text-xs text-destructive">
                    {passwordError}
                  </p>
                )}
              </div>
            )}
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-invite">Invite code</Label>
                <Input
                  id="admin-invite"
                  type="password"
                  autoComplete="off"
                  required
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value);
                    setInviteCodeError("");
                  }}
                  aria-invalid={!!inviteCodeError}
                  aria-describedby={inviteCodeError ? "admin-invite-error" : undefined}
                />
                {inviteCodeError && (
                  <p id="admin-invite-error" className="text-xs text-destructive">
                    {inviteCodeError}
                  </p>
                )}
              </div>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy
                ? "Please wait..."
                : mode === "register"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            {mode !== "sign-in" && (
              <button type="button" className="hover:text-foreground" onClick={() => { setMode("sign-in"); setEmailError(""); setInviteCodeError(""); }}>
                Sign in
              </button>
            )}
            {mode !== "register" && (
              <button type="button" className="hover:text-foreground" onClick={() => { setMode("register"); setEmailError(""); setInviteCodeError(""); }}>
                Register
              </button>
            )}
            {mode !== "forgot" && (
              <button type="button" className="hover:text-foreground" onClick={() => { setMode("forgot"); setEmailError(""); setInviteCodeError(""); }}>
                Forgot password?
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
