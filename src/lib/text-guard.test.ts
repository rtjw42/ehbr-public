// Tables for the untrusted free-text guard used on the public booking form and
// re-checked in the submit-booking Edge Function. src/lib/text-guard.ts is kept
// in sync with supabase/functions/_shared/text-guard.ts (mirror copy).
import { describe, expect, it } from "vitest";
import edgeSource from "../../supabase/functions/_shared/text-guard.ts?raw";
import clientSource from "./text-guard.ts?raw";
import { containsLink, sanitizeFreeText } from "./text-guard";

// Built from codepoints so this source file contains no literal invisible chars.
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const RLO = String.fromCharCode(0x202e); // right-to-left override

describe("containsLink", () => {
  it.each([
    "http://evil.example",
    "https://free-robux.tk/claim",
    "visit www.spam.co now",
    "ftp://files.example",
    "join t.me/scamchannel",
    "book at booking.com",
    "dm me @scammer_bot",
    "HTTPS://Loud.Example", // case-insensitive
    "tg://resolve?domain=x", // non-http scheme
  ])("flags %p as a link", (value) => {
    expect(containsLink(value)).toBe(true);
  });

  it.each([
    "Jazz jam session",
    "Rock.Pop fusion night", // .pop is not a TLD in the list
    "feat. the drummer",
    "Band practice @ 5pm", // "@ " has a space, not a handle
    "@Home vibes only", // 4 chars after @ (< Telegram's 5 min) — allowed
    "O'Brien-Smith", // apostrophe + hyphen, no dot
    "Set list: 12 songs",
    "3.5 hour rehearsal", // number.number, no TLD
  ])("does not flag ordinary text %p", (value) => {
    expect(containsLink(value)).toBe(false);
  });
});

describe("sanitizeFreeText", () => {
  it("returns empty string for non-strings", () => {
    expect(sanitizeFreeText(undefined)).toBe("");
    expect(sanitizeFreeText(null)).toBe("");
    expect(sanitizeFreeText(42)).toBe("");
  });

  it("strips zero-width and bidi control characters", () => {
    expect(sanitizeFreeText(`goo${ZWSP}gle.com`)).toBe("google.com");
    expect(sanitizeFreeText(`safe${RLO}txet`)).toBe("safetxet");
  });

  it("collapses whitespace flooding on single-line fields", () => {
    expect(sanitizeFreeText("Jam    \n\n\n  session")).toBe("Jam session");
  });

  it("keeps single newlines but caps blank-line runs on multiline fields", () => {
    expect(sanitizeFreeText("line1\n\n\n\nline2", true)).toBe("line1\n\nline2");
    expect(sanitizeFreeText("a  \t b", true)).toBe("a b");
  });

  it("hidden-char evasion is caught once sanitized then link-checked", () => {
    const raw = `robux.t${ZWSP}k`; // ZWSP inside the TLD breaks the match
    expect(containsLink(raw)).toBe(false); // zero-width breaks the pattern
    expect(containsLink(sanitizeFreeText(raw))).toBe(true); // sanitizing restores it
  });
});

// The guard runs in two places: this client copy (form-side) and the mirror at
// supabase/functions/_shared/text-guard.ts (the Edge Function — the real security
// boundary). They're hand-synced (the client build root can't import from the Deno
// functions root). Only the header comment is allowed to diverge (each points at
// the other); the code must be identical, or the tested behaviour and the enforced
// behaviour drift apart silently.
describe("text-guard mirror parity", () => {
  // Read both files as raw text via Vite's ?raw loader (no node:fs — keeps this
  // typecheckable under the browser tsconfig). Strip full-line comments (the
  // header block is the sole intended divergence), collapse whitespace, and
  // require what's left — the code — to match exactly.
  const codeOf = (source: string) => source.replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ").trim();

  it("client and edge copies share identical code", () => {
    expect(codeOf(clientSource)).toBe(codeOf(edgeSource));
  });
});
