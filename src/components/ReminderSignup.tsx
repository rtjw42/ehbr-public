import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
});

const HOUR_OPTIONS = [
  { value: "1", label: "1 hour before" },
  { value: "3", label: "3 hours before" },
  { value: "12", label: "12 hours before" },
  { value: "24", label: "1 day before" },
  { value: "48", label: "2 days before" },
  { value: "168", label: "1 week before" },
];

export const ReminderSignup = () => {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("reminder_subscriptions").insert({
        email: parsed.data.email,
        hours_before: parseInt(hours, 10),
        confirmed: true,
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("This email is already subscribed.");
        } else {
          throw error;
        }
        return;
      }
      toast.success("Subscribed! You'll get reminders before each booking.");
      setEmail("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to subscribe"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 sm:mt-10">
      <form
        onSubmit={submit}
        className="rounded-2xl border bg-card/70 backdrop-blur p-4 sm:p-5 shadow-soft animate-pop-in"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
            <Bell className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg text-primary leading-tight">Get booking reminders</h2>
            <p className="text-xs text-muted-foreground">Email reminders before every approved booking.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_auto]">
          <div className="space-y-1">
            <Label htmlFor="rem-email" className="sr-only">Email</Label>
            <Input
              id="rem-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={255}
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="sr-only">Remind me</Label>
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy} className="w-full md:w-auto">
            {busy ? "Subscribing…" : "Subscribe"}
          </Button>
        </div>
        <p className="mt-2 text-[clamp(0.68rem,2vw,0.75rem)] text-muted-foreground">
          Email sending will activate once the admin connects a sender domain. Your preference is saved now.
        </p>
      </form>
    </section>
  );
};
