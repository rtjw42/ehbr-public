// ── Turnstile verification dialog ────────────────────────────────────────────
// A standalone "verify, then run this action" dialog wrapping the Turnstile sub-flow
// (same VerificationState machine as the booking form). Used by flows that need a
// challenge outside the booking form — e.g. password reset. The *_BEAT_MS constants
// hold the verified/success states on screen briefly so the transitions read.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { getErrorMessage } from "@/lib/errors";
import { useI18n } from "@/hooks/useI18n";

type VerificationState = "loading" | "challenge" | "verified" | "submitting" | "success" | "error";

type Props = {
  open: boolean;
  siteKey: string;
  onCancel: () => void;
  onVerifiedSubmit: (token: string) => Promise<void>;
  onSuccessComplete?: () => void;
  title?: string;
  description?: string;
  submittingLabel?: string;
  submitErrorFallback?: string;
};

const VERIFIED_BEAT_MS = 100; // Minimum time to show the "verified" state before moving to "submitting"
const SUCCESS_BEAT_MS = 500;

export const TurnstileVerificationDialog = ({
  open,
  siteKey,
  onCancel,
  onVerifiedSubmit,
  onSuccessComplete,
  title,
  description,
  submittingLabel,
  submitErrorFallback,
}: Props) => {
  const [state, setState] = useState<VerificationState>("loading");
  const [error, setError] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const { t } = useI18n();
  const dialogTitle = title ?? t("turnstile.title");
  const dialogDescription = description ?? t("turnstile.description");
  const submitLabel = submittingLabel ?? t("turnstile.submitting");
  const submitFallback = submitErrorFallback ?? t("turnstile.submitError");

  const canCancel = state !== "verified" && state !== "submitting" && state !== "success";

  useEffect(() => {
    if (!open) return;
    setState("loading");
    setError("");
    setResetSignal((value) => value + 1);
  }, [open]);

  const resetChallenge = useCallback((message: string) => {
    setError(message);
    setState("error");
    setResetSignal((value) => value + 1);
  }, []);

  const handleToken = useCallback(async (token: string) => {
    if (!token) return;
    setError("");
    setState("verified");
    await new Promise((resolve) => window.setTimeout(resolve, VERIFIED_BEAT_MS));
    setState("submitting");
    try {
      await onVerifiedSubmit(token);
      setState("success");
      await new Promise((resolve) => window.setTimeout(resolve, SUCCESS_BEAT_MS));
      setResetSignal((value) => value + 1);
      onSuccessComplete?.();
    } catch (submitError: unknown) {
      resetChallenge(getErrorMessage(submitError, submitFallback));
    }
  }, [onSuccessComplete, onVerifiedSubmit, resetChallenge, submitFallback]);

  const handleCancel = useCallback(() => {
    if (!canCancel) return;
    setResetSignal((value) => value + 1);
    onCancel();
  }, [canCancel, onCancel]);

  const statusText = (() => {
    if (state === "loading") return t("turnstile.loading");
    if (state === "verified") return t("turnstile.verified");
    if (state === "submitting") return submitLabel;
    if (state === "success") return t("turnstile.success");
    if (state === "error") return t("turnstile.retry");
    return t("turnstile.challenge");
  })();

  const helperText = (() => {
    if (state === "loading") return t("turnstile.waiting");
    if (state === "verified") return t("turnstile.verifying");
    if (state === "submitting") return t("turnstile.submittingDescription");
    if (state === "success") return t("turnstile.successDescription");
    if (state === "error") return error;
    return t("turnstile.challengeDescription");
  })();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && canCancel) handleCancel();
    }}>
      <DialogContent
        className="overflow-hidden border-border bg-card p-0 shadow-lg dark:shadow-none sm:max-w-[26rem]"
        onEscapeKeyDown={(event) => {
          if (!canCancel) event.preventDefault();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="turnstile-verification-slot space-y-5">
          {(state === "verified" || state === "submitting" || state === "success") ? (
            <div key={state} className="grid min-h-[9rem] place-items-center p-4 text-center">
              <div className="space-y-2">
                {state === "submitting" ? (
                  <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
                ) : (
                  <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
                )}
                <div>
                  <p className="text-sm font-semibold">{statusText}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
                </div>
              </div>
            </div>
          ) : (
            <div key={state} className="grid min-h-[9rem] place-items-center p-1">
              <div className="w-full space-y-3">
                {state === "loading" && (
                  <div className="grid min-h-[65px] place-items-center text-center">
                    <div className="space-y-2">
                      <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
                      <p className="text-sm font-medium">{statusText}</p>
                    </div>
                  </div>
                )}
                {siteKey && (
                  <TurnstileWidget
                    siteKey={siteKey}
                    onTokenChange={handleToken}
                    onExpired={() => resetChallenge(t("turnstile.expired"))}
                    onError={() => resetChallenge(t("turnstile.loadFailed"))}
                    onReady={() => setState((current) => current === "loading" ? "challenge" : current)}
                    resetSignal={resetSignal}
                  />
                )}
                <p className={`text-center text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {helperText}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancel}
              disabled={!canCancel}
              className="w-full sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
};
