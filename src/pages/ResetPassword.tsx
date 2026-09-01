// ── Reset password (/reset-password) ─────────────────────────────────────────
// Reached from the password-reset email link. Exchanges the link's code for a
// recovery session (preparePasswordRecoverySession), then lets the user set a new
// password. Renders nothing actionable if the link is invalid/expired.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, Lock } from "lucide-react";
import { getErrorMessage } from "@/lib/errors";
import { preparePasswordRecoverySession, signOut, subscribeToAuthChanges, updatePassword } from "@/services/auth";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationKey } from "@/lib/i18n";

const getPasswordErrorKey = (password: string): TranslationKey | "" => {
  if (password.length < 8) return "resetPassword.minLength";
  if (!/[A-Za-z]/.test(password)) return "resetPassword.letterRequired";
  if (!/\d/.test(password)) return "resetPassword.numberRequired";
  return "";
};

const ResetPassword = () => {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFieldError, setPasswordFieldError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const passwordErrorKey = getPasswordErrorKey(password);
  const passwordError = passwordErrorKey ? t(passwordErrorKey) : "";

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeToAuthChanges((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(!!session);
      }
    });

    const prepareRecoverySession = async () => {
      try {
        const hasSession = await preparePasswordRecoverySession();
        if (mounted) setReady(hasSession);
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("resetPassword.invalidLink")));
        if (mounted) setReady(false);
      } finally {
        if (mounted) setChecking(false);
      }
    };

    prepareRecoverySession();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setPasswordFieldError("");
    setConfirmPasswordError("");
    if (passwordError) {
      setPasswordFieldError(passwordError);
      return;
    }
    if (!confirmPassword) {
      setConfirmPasswordError(t("resetPassword.confirmRequired"));
      return;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError(t("resetPassword.passwordsDoNotMatch"));
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      toast.success(t("resetPassword.passwordUpdated"));
      setPassword("");
      setConfirmPassword("");
      // Drop the recovery session so the user signs in fresh with the new password
      // (best-effort — the password change already succeeded regardless).
      await signOut().catch(() => {});
      nav("/");
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("resetPassword.updateFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-4 py-[calc(var(--site-nav-height)+1rem)]">
      <main className="w-full max-w-md rounded-[2rem] bg-card border shadow-elev p-6 sm:p-7">
        <Button variant="ghost" size="sm" onClick={() => nav("/")} className="mb-5 -ml-2">
          <ArrowLeft className="h-4 w-4" /> {t("common.back")}
        </Button>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-11 w-11 rounded-full bg-primary/10 grid place-items-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="type-auth-title text-primary">{t("resetPassword.title")}</h1>
            <p className="text-xs text-muted-foreground mt-1">{t("resetPassword.description")}</p>
          </div>
        </div>

        {checking ? (
          <p className="text-sm text-muted-foreground">{t("resetPassword.checkingLink")}</p>
        ) : !ready ? (
          <p className="text-sm text-muted-foreground">
            {t("resetPassword.invalidLinkDescription")}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t("resetPassword.newPassword")}</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordFieldError("");
                  }}
                  className="pr-10"
                  aria-invalid={!!passwordFieldError || (!!password && !!passwordError)}
                  aria-describedby={passwordFieldError || passwordError ? "new-password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? t("resetPassword.hidePassword") : t("resetPassword.showPassword")}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors duration-base hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {(passwordFieldError || (password && passwordError)) && (
                <p id="new-password-error" className="text-xs text-destructive">
                  {passwordFieldError || passwordError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">{t("resetPassword.confirmPassword")}</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setConfirmPasswordError("");
                  }}
                  className="pr-10"
                  aria-invalid={!!confirmPasswordError}
                  aria-describedby={confirmPasswordError ? "confirm-password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? t("resetPassword.hidePassword") : t("resetPassword.showPassword")}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors duration-base hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPasswordError && (
                <p id="confirm-password-error" className="text-xs text-destructive">
                  {confirmPasswordError}
                </p>
              )}
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? t("resetPassword.updating") : t("resetPassword.updatePassword")}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
};

export default ResetPassword;
