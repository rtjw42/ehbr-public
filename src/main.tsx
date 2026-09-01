// Must come first: it validates config before any module can import the Supabase
// client, whose constructor throws an unhelpful error when the keys are absent.
import "./lib/env-check";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { ConsentGate } from "@/components/ConsentGate";
import { PreferencesProvider } from "@/contexts/PreferencesContext";

createRoot(document.getElementById("root")!).render(
  <>
    <PreferencesProvider>
      <ConsentGate>
        <App />
        {/* Product analytics stays consent-gated. */}
        <Analytics />
      </ConsentGate>
    </PreferencesProvider>
    {/* Speed Insights is performance RUM only — cookieless, anonymized, no PII — so
        it runs OUTSIDE the consent gate to measure every visit from first paint,
        including the mobile cold-load vitals (LCP/FCP) the gate otherwise hides.
        Deliberate exception to the "analytics only after consent" rule; see CLAUDE.md. */}
    <SpeedInsights />
  </>
);
