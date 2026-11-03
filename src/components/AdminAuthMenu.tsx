// ── Admin auth menu ──────────────────────────────────────────────────────────
// The sign-in / register / forgot-password panel inside the nav's Admin dropdown.
// All three modes are Turnstile-gated and go through the auth service (which routes
// register + password-reset through Edge Functions). Holds its own inline
// verification state separate from the booking form's.
import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, LogOut, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TurnstileVerificationDialog } from "@/components/TurnstileVerificationDialog";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { getErrorMessage } from "@/lib/errors";
import { stripHtmlText } from "@/lib/sanitize";
import { isValidEmail } from "@/lib/validation";
import { registerAdmin, requestPasswordReset, signInAdmin, validateAdminInvite } from "@/services/auth";
import { isPersistEnabled, setPersistEnabled } from "@/integrations/supabase/auth-storage";

type AuthMode = "sign-in" | "register" | "forgot";
type InlineVerificationState = "idle" | "loading" | "challenge" | "verified" | "submitting" | "error";

type AdminAuthMenuProps = {
  onClose: () => void;
  onSignedIn?: () => void;
  onSignedOut?: () => void;
};

// Lightweight, ReDoS-safe email check for the pre-submit hint only. The server
// (Supabase Auth + the register-admin / request-password-reset Edge Functions,
// behind Turnstile) is the authoritative validator — this just gates the inline
// error. Mirrors zod's `safeParse` shape so call sites stay identical, without
// pulling in ~50KB of zod for a single email regex. The pattern is linear (no
// nested quantifiers) so it can't catastrophically backtrack.
const parseEmail = (raw: string): { success: true; data: string } | { success: false } => {
  const data = raw.trim();
  return isValidEmail(data) ? { success: true, data } : { success: false };
};

const getRegistrationPasswordError = (password: string, t: ReturnType<typeof useI18n>["t"]) => {
  if (password.length < 8) return t("admin.login.passwordMin");
  if (!/[A-Za-z]/.test(password)) return t("admin.login.passwordLetter");
  if (!/\d/.test(password)) return t("admin.login.passwordNumber");
  return "";
};

export const AdminAuthMenu = ({ onClose, onSignedIn, onSignedOut }: AdminAuthMenuProps) => {
  const { authChecked, isAdmin, userEmail, refreshAdmin, signOutAdmin } = useAdmin();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFieldError, setPasswordFieldError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeError, setInviteCodeError] = useState("");
  // "Keep me signed in" — default ON (owner decision); seeds from the stored
  // flag so the toggle reflects the last choice on this device.
  const [rememberMe, setRememberMe] = useState(isPersistEnabled);
  const [busy, setBusy] = useState(false);
  const [resetVerificationOpen, setResetVerificationOpen] = useState(false);
  const [accountResetConfirmOpen, setAccountResetConfirmOpen] = useState(false);
  const [registerVerificationState, setRegisterVerificationState] = useState<InlineVerificationState>("idle");
  const [registerVerificationError, setRegisterVerificationError] = useState("");
  const [registerResetSignal, setRegisterResetSignal] = useState(0);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const passwordError = mode === "register" ? getRegistrationPasswordError(password, t) : "";

  const resetRegisterVerification = () => {
    setRegisterVerificationState("idle");
    setRegisterVerificationError("");
    setRegisterResetSignal((value) => value + 1);
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setEmailError("");
    setPasswordFieldError("");
    setInviteCodeError("");
    setShowPassword(false);
    resetRegisterVerification();
  };

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOutAdmin();
      onSignedOut?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const requestRegistration = async (cleanEmail: string, cleanInvite: string, turnstileToken: string) => {
    let result: Awaited<ReturnType<typeof registerAdmin>>;
    try {
      result = await registerAdmin({
        email: cleanEmail,
        password,
        inviteCode: cleanInvite,
        emailRedirectTo: `${window.location.origin}/registration-success`,
        turnstileToken,
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error, t("admin.login.createFailed"));
      if (/already registered|already exists|email.*exists|user.*registered/i.test(message)) {
        setEmailError(t("admin.login.emailRegistered"));
      }
      if (/invite|database|trigger|hook/i.test(message)) {
        setInviteCodeError(t("admin.login.inviteInvalid"));
      }
      throw error;
    }

    toast.success(result.needsEmailConfirmation
      ? t("admin.login.confirmEmail")
      : t("admin.login.accountCreated"));
    setPassword("");
    setInviteCode("");
    setMode("sign-in");
  };

  const requestVerifiedRegistration = async (turnstileToken: string) => {
    if (!turnstileToken || registerVerificationState === "submitting") return;
    setRegisterVerificationError("");
    setRegisterVerificationState("verified");
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    setRegisterVerificationState("submitting");
    try {
      const parsedEmail = parseEmail(stripHtmlText(email));
      if (!parsedEmail.success) throw new Error(t("admin.login.emailInvalid"));
      const cleanInvite = stripHtmlText(inviteCode);
      if (!cleanInvite) throw new Error(t("admin.login.inviteRequired"));
      if (passwordError) throw new Error(passwordError);
      await requestRegistration(parsedEmail.data, cleanInvite, turnstileToken);
      resetRegisterVerification();
    } catch (error: unknown) {
      setRegisterVerificationError(getErrorMessage(error, t("admin.login.createRetry")));
      setRegisterVerificationState("error");
      setRegisterResetSignal((value) => value + 1);
    }
  };

  const requestVerifiedReset = async (turnstileToken: string) => {
    const resetEmail = isAdmin ? userEmail : email;
    const parsedEmail = parseEmail(stripHtmlText(resetEmail));
    if (!parsedEmail.success) {
      toast.error(t("admin.login.emailInvalid"));
      throw new Error(t("admin.login.emailInvalid"));
    }
    try {
      await requestPasswordReset({
        email: parsedEmail.data,
        turnstileToken,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      toast.success(t("admin.login.resetEmailSent"));
      setResetVerificationOpen(false);
      setAccountResetConfirmOpen(false);
      setMode("sign-in");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("admin.login.resetSubmitFailed")));
      throw error;
    }
  };

  const confirmAccountReset = () => {
    if (busy) return;
    if (!turnstileSiteKey) {
      toast.error(t("admin.login.resetVerificationMissing"));
      return;
    }
    const parsedEmail = parseEmail(stripHtmlText(userEmail));
    if (!parsedEmail.success) {
      toast.error(t("admin.login.emailInvalid"));
      return;
    }
    setResetVerificationOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const parsedEmail = parseEmail(stripHtmlText(email));
      if (!parsedEmail.success) {
        setEmailError(t("admin.login.emailInvalid"));
        return;
      }
      const cleanEmail = parsedEmail.data;

      if (mode === "forgot") {
        if (!turnstileSiteKey) {
          toast.error(t("admin.login.resetVerificationMissing"));
          return;
        }
        setResetVerificationOpen(true);
        return;
      }

      if (mode === "register") {
        const cleanInvite = stripHtmlText(inviteCode);
        if (!cleanInvite) {
          setInviteCodeError(t("admin.login.inviteRequired"));
          return;
        }
        if (passwordError) {
          setPasswordFieldError(passwordError);
          return;
        }
        if (!turnstileSiteKey) {
          toast.error(t("admin.login.registrationVerificationMissing"));
          return;
        }
        await validateAdminInvite({ inviteCode: cleanInvite });
        setRegisterVerificationState("loading");
        setRegisterVerificationError("");
        setRegisterResetSignal((value) => value + 1);
        return;
      }

      if (!password) {
        setPasswordFieldError(t("admin.login.passwordRequired"));
        return;
      }

      // Route the token to the right store BEFORE it exists: local (persistent)
      // when on, session when off. setPersistEnabled also migrates any stray
      // token so the choice takes effect immediately.
      setPersistEnabled(rememberMe);
      await signInAdmin({ email: cleanEmail, password });
      await refreshAdmin();
      toast.success(t("admin.login.welcomeBack"));
      setPassword("");
      setInviteCode("");
      onSignedIn?.();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("admin.login.loginFailed"));
      if (mode === "register" && /already registered|already exists|email.*exists|user.*registered/i.test(message)) {
        setEmailError(t("admin.login.emailRegistered"));
      } else if (mode === "register" && /invite|database|trigger|hook/i.test(message)) {
        setInviteCodeError(t("admin.login.inviteInvalid"));
      } else {
        toast.error(message === "Invalid login credentials" ? t("admin.login.wrongCredentials") : message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="grid min-h-28 place-items-center p-5 text-base text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (isAdmin) {
    return (
      <>
      <div className="space-y-5 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="type-dialog-title">{t("admin.account.title")}</h2>
          </div>
          <p className="truncate text-sm text-muted-foreground">{userEmail || t("admin.account.verified")}</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-3 text-sm leading-relaxed text-muted-foreground">
          {!accountResetConfirmOpen ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setAccountResetConfirmOpen(true)}
              disabled={busy}
              className="w-full justify-center rounded-full shadow-[0_14px_34px_-26px_hsl(var(--destructive)/0.78)] transition-[background-color,box-shadow,transform] duration-fast hover:shadow-[0_18px_42px_-28px_hsl(var(--destructive)/0.82)]"
            >
              <KeyRound className="h-4 w-4" />
              {t("admin.account.resetPassword")}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{t("admin.account.resetConfirmTitle")}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("admin.account.resetConfirmDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAccountResetConfirmOpen(false);
                  }}
                  className="btn-interactive grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground"
                  aria-label={t("common.cancel")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={confirmAccountReset}
                disabled={busy}
                className="flex h-11 w-full rounded-full bg-destructive px-4 text-base font-semibold text-destructive-foreground transition-[background-color,transform] duration-fast hover:bg-destructive/90 active:scale-[0.97] active:duration-tap disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100"
              >
                <span className="m-auto inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {t("admin.account.resetConfirmButton")}
                </span>
              </button>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleSignOut}
          disabled={busy}
          className="btn-interactive w-full justify-center rounded-full border-border bg-card"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {t("admin.signOut")}
        </Button>
      </div>

      {turnstileSiteKey && (
        <TurnstileVerificationDialog
          open={resetVerificationOpen}
          siteKey={turnstileSiteKey}
          onCancel={() => setResetVerificationOpen(false)}
          onVerifiedSubmit={requestVerifiedReset}
          title={t("admin.login.resetVerifyTitle")}
          description={t("admin.login.resetVerifyDescription")}
          submittingLabel={t("admin.login.sendingReset")}
          submitErrorFallback={t("admin.login.resetSubmitFailed")}
        />
      )}
      </>
    );
  }

  const title = mode === "register" ? t("admin.login.title.register") : mode === "forgot" ? t("admin.login.title.forgot") : t("admin.login.title.signIn");
  const subtitle = mode === "register"
    ? t("admin.login.subtitle.register")
    : mode === "forgot"
      ? t("admin.login.subtitle.forgot")
      : t("admin.login.subtitle.signIn");
  const registerVerificationBusy = mode === "register" && (
    registerVerificationState === "loading" ||
    registerVerificationState === "challenge" ||
    registerVerificationState === "verified" ||
    registerVerificationState === "submitting"
  );

  return (
    <>
      <div className="p-4">
        <div className="mb-5 space-y-1">
          <div className="flex items-center gap-2 text-foreground">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h2 className="type-dialog-title">{title}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">{t("admin.login.email")}</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError("");
                if (mode === "register") resetRegisterVerification();
              }}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "admin-email-error" : undefined}
            />
            {emailError && <p id="admin-email-error" className="text-sm text-destructive">{emailError}</p>}
          </div>

          {mode !== "forgot" && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-pw">{t("admin.login.password")}</Label>
              <div className="relative">
                <Input
                  id="admin-pw"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordFieldError("");
                    if (mode === "register") resetRegisterVerification();
                  }}
                  className="pr-10"
                  aria-invalid={!!passwordFieldError || (mode === "register" && !!password && !!passwordError)}
                  aria-describedby={passwordFieldError || (mode === "register" && passwordError) ? "admin-pw-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? t("admin.login.hidePassword") : t("admin.login.showPassword")}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors duration-base hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {(passwordFieldError || (mode === "register" && password && passwordError)) && (
                <p id="admin-pw-error" className="text-sm text-destructive">{passwordFieldError || passwordError}</p>
              )}
            </div>
          )}

          {mode === "register" && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-invite">{t("admin.login.inviteCode")}</Label>
              <Input
                id="admin-invite"
                type="password"
                autoComplete="off"
                value={inviteCode}
                onChange={(event) => {
                  setInviteCode(event.target.value);
                  setInviteCodeError("");
                  resetRegisterVerification();
                }}
                aria-invalid={!!inviteCodeError}
                aria-describedby={inviteCodeError ? "admin-invite-error" : undefined}
              />
              {inviteCodeError && <p id="admin-invite-error" className="text-sm text-destructive">{inviteCodeError}</p>}
            </div>
          )}

          {mode === "register" && registerVerificationState !== "idle" && turnstileSiteKey && (
            <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-card p-3">
              <div className="min-h-[106px] overflow-hidden rounded-[0.9rem] bg-white/70 dark:bg-card/50 p-2">
                {(registerVerificationState === "verified" || registerVerificationState === "submitting") ? (
                  <div className="grid min-h-[90px] place-items-center text-center">
                    <div className="space-y-2">
                      {registerVerificationState === "verified" ? (
                        <CheckCircle2 className="mx-auto h-8 w-8 text-foreground" />
                      ) : (
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-foreground" />
                      )}
                      <p className="text-base font-medium">
                        {registerVerificationState === "verified" ? t("admin.login.verified") : t("admin.login.creatingAccount")}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-[90px] place-items-center">
                    {registerVerificationState === "loading" && (
                      <p className="text-base text-muted-foreground">{t("admin.login.verificationLoading")}</p>
                    )}
                    <TurnstileWidget
                      siteKey={turnstileSiteKey}
                      onTokenChange={requestVerifiedRegistration}
                      onExpired={() => {
                        setRegisterVerificationError(t("admin.login.verificationExpired"));
                        setRegisterVerificationState("error");
                        setRegisterResetSignal((value) => value + 1);
                      }}
                      onError={() => {
                        setRegisterVerificationError(t("admin.login.verificationLoadFailed"));
                        setRegisterVerificationState("error");
                        setRegisterResetSignal((value) => value + 1);
                      }}
                      onReady={() => setRegisterVerificationState((current) => current === "loading" ? "challenge" : current)}
                      resetSignal={registerResetSignal}
                    />
                  </div>
                )}
              </div>
              {registerVerificationError && <p className="text-sm text-destructive">{registerVerificationError}</p>}
            </div>
          )}

          {mode === "sign-in" && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="admin-remember" className="min-w-0 text-sm leading-snug text-muted-foreground">
                {t("admin.login.rememberMe")}
              </Label>
              <Switch id="admin-remember" checked={rememberMe} onCheckedChange={setRememberMe} />
            </div>
          )}

          <Button
            className={`w-full rounded-full transition-[background-color,transform] duration-fast ${mode === "forgot" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-interactive text-interactive-text hover:opacity-90"}`}
            type="submit"
            disabled={busy || registerVerificationBusy}
          >
            {busy
              ? mode === "register" ? t("admin.login.checkingInvite") : t("admin.login.pleaseWait")
              : mode === "register"
                ? registerVerificationState === "idle" ? t("admin.login.continue") : t("admin.login.completeVerification")
                : mode === "forgot"
                  ? t("admin.login.sendResetLink")
                  : t("admin.login.signIn")}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {mode !== "sign-in" && (
            <button type="button" className="hover:text-foreground" onClick={() => switchMode("sign-in")}>
              {t("admin.login.signIn")}
            </button>
          )}
          {mode !== "register" && (
            <button type="button" className="hover:text-foreground" onClick={() => switchMode("register")}>
              {t("admin.login.register")}
            </button>
          )}
          {mode !== "forgot" && (
            <button type="button" className="hover:text-foreground" onClick={() => switchMode("forgot")}>
              {t("admin.login.forgotPassword")}
            </button>
          )}
        </div>
      </div>

      {turnstileSiteKey && (
        <TurnstileVerificationDialog
          open={resetVerificationOpen}
          siteKey={turnstileSiteKey}
          onCancel={() => setResetVerificationOpen(false)}
          onVerifiedSubmit={requestVerifiedReset}
          title={t("admin.login.resetVerifyTitle")}
          description={t("admin.login.resetVerifyDescription")}
          submittingLabel={t("admin.login.sendingReset")}
          submitErrorFallback={t("admin.login.resetSubmitFailed")}
        />
      )}
    </>
  );
};
