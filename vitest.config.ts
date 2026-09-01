import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Focus coverage on the security- and contract-critical layer rather than
      // chasing a blanket repo number on trivial UI/formatting code.
      include: ["src/services/**/*.ts", "src/lib/booking-utils.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        // Enforced only on the service layer; booking-utils is reported, not gated.
        "src/services/**/*.ts": {
          statements: 80,
          branches: 70,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
