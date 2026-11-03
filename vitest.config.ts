import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Edge Function tests live in supabase/functions/_tests (the CLI ignores
    // underscore folders) and declare a node environment per file.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/_tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Focus coverage on the security- and contract-critical layer rather than
      // chasing a blanket repo number on trivial UI/formatting code.
      include: [
        "src/services/**/*.ts",
        "src/lib/booking-utils.ts",
        "supabase/functions/_shared/security.ts",
        "supabase/functions/_shared/health.ts",
        "supabase/functions/{submit-booking,register-admin,request-password-reset,log-funnel-step}/index.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        // Enforced on the service layer and the public Edge Function surface;
        // booking-utils is reported, not gated.
        "src/services/**/*.ts": {
          statements: 80,
          branches: 70,
          functions: 85,
          lines: 85,
        },
        "supabase/functions/**/*.ts": {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
      // Deno's npm: specifier, so Edge Function modules load under Vitest.
      { find: /^npm:@supabase\/supabase-js@2$/, replacement: "@supabase/supabase-js" },
    ],
  },
});
