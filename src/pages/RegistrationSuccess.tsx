import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

const RegistrationSuccess = () => {
  const nav = useNavigate();
  const { t } = useI18n();

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-4 py-[calc(var(--site-nav-height)+1rem)]">
      <main className="w-full max-w-md rounded-[2rem] bg-card border shadow-elev p-6 sm:p-7 text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 grid place-items-center">
          <CheckCircle2 className="h-6 w-6 text-primary" />
        </div>
        <h1 className="type-auth-title text-primary">{t("registrationSuccess.title")}</h1>
        <p className="text-sm text-muted-foreground mt-3">{t("registrationSuccess.description")}</p>
        <Button className="mt-6 w-full" onClick={() => nav("/?admin=login")}>
          {t("registrationSuccess.goToLogin")}
        </Button>
      </main>
    </div>
  );
};

export default RegistrationSuccess;
