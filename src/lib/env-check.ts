// First-run guard. Without the Supabase variables, `createClient` throws
// "supabaseUrl is required." from inside the library at import time, which in an
// SPA means a blank white page and a stack trace pointing at node_modules. That
// is a miserable first five minutes for anyone who just cloned the repo.
//
// This runs before anything imports the Supabase client (it is the first import
// in main.tsx) and replaces the blank page with a message naming exactly what is
// missing and where to set it.

type RequiredVar = {
  name: string;
  value: string | undefined;
  purpose: string;
};

const REQUIRED: RequiredVar[] = [
  {
    name: "VITE_SUPABASE_URL",
    value: import.meta.env.VITE_SUPABASE_URL,
    purpose: "your Supabase project URL",
  },
  {
    name: "VITE_SUPABASE_PUBLISHABLE_KEY",
    value: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    purpose: "your Supabase anon key",
  },
];

const missing = REQUIRED.filter((entry) => !entry.value);

if (missing.length > 0) {
  const list = missing.map((entry) => `${entry.name} (${entry.purpose})`).join(", ");
  const message = `Missing environment ${missing.length === 1 ? "variable" : "variables"}: ${list}.`;

  // Plain DOM, no framework: this has to work before React mounts.
  const root = document.getElementById("root");
  if (root) {
    const escape = (value: string) =>
      value.replace(/[&<>"']/g, (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
      );

    root.innerHTML = `
      <div style="max-width:42rem;margin:12vh auto;padding:0 1.5rem;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6;color:#2b2119">
        <h1 style="font-size:1.5rem;margin:0 0 .75rem">Configuration needed</h1>
        <p style="margin:0 0 1rem">${escape(message)}</p>
        <p style="margin:0 0 .5rem">Copy the example file and fill in the values:</p>
        <pre style="background:#f3ede4;padding:.85rem 1rem;border-radius:.5rem;overflow-x:auto"><code>cp .env.example .env.local</code></pre>
        <p style="margin:1rem 0 0">Both values are in your Supabase dashboard under
        Project Settings, API. Restart the dev server after editing
        <code>.env.local</code>. See the README for the full setup.</p>
      </div>
    `;
  }

  // Stop here rather than letting the Supabase client throw a less useful error.
  throw new Error(`${message} See .env.example and the README.`);
}
