import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

const NotFound = () => {
  const { t } = useI18n();

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-6 py-[calc(var(--site-nav-height)+1rem)]">
      <div className="flex flex-col items-center text-center">
        <p className="type-page-title leading-none text-foreground">404</p>
        <p className="mt-4 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          {t("notFound.title")}
        </p>
        <Link
          to="/"
          className="group mt-10 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          {t("notFound.returnHome")}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
