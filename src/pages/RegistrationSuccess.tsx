import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

const RegistrationSuccess = () => {
  const nav = useNavigate();

  return (
    <div className="app-page-bg min-h-screen flex items-center justify-center px-4 page-transition">
      <main className="w-full max-w-md rounded-[2rem] bg-card border shadow-elev p-6 sm:p-7 text-center hero-enter">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 grid place-items-center">
          <CheckCircle2 className="h-6 w-6 text-primary" />
        </div>
        <h1 className="font-display text-3xl text-primary leading-none">You have successfully registered.</h1>
        <p className="text-sm text-muted-foreground mt-3">Go to login to access the admin area.</p>
        <Button className="mt-6 w-full" onClick={() => nav("/?admin=login")}>
          Go to login
        </Button>
      </main>
    </div>
  );
};

export default RegistrationSuccess;
