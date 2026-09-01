// Pre-paint theme bootstrap. Loaded as a plain blocking script from index.html —
// it must stay an external file because the CSP is `script-src 'self'` (inline
// scripts are blocked). Adds the stored dark-mode class before the app bundle
// loads, so dark users never see a light first frame. (No theme-color tinting:
// Safari keeps its native glass toolbars — see index.html.)
(function () {
  try {
    if (window.localStorage.getItem("dark-mode") === "1") {
      document.documentElement.classList.add("dark");
    }
  } catch (error) {
    // Storage unavailable (private mode) — keep the light defaults.
  }

  // Motion tier — the single motion authority, resolved once pre-paint and
  // written as data-motion on <html> so CSS ([data-motion="…"]) and JS
  // (useMotionTier) read the SAME decision from the first frame. POINTER-based,
  // not width-based: layout breakpoints stay width-based and separate.
  //   lite — coarse pointer (phones/tablets; performance tier)
  //   full — fine pointer (desktop)
  // Binary by design — no `reduced` tier (see src/hooks/useMotionTier.ts).
  // Mirror any change here in src/hooks/useMotionTier.ts.
  try {
    var mq = function (q) { return window.matchMedia(q).matches; };
    var tier = mq("(pointer: coarse)") ? "lite" : "full";
    document.documentElement.setAttribute("data-motion", tier);
  } catch (error) {
    // matchMedia unavailable — default to the richest tier; JS will reconcile.
    document.documentElement.setAttribute("data-motion", "full");
  }
})();
