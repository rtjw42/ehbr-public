# Eusoff Bandits Band Room

Booking and management for a student band room, built for phones.

[![CI](https://github.com/rtjw42/ehbr-public/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rtjw42/ehbr-public/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Members reserve the band room from their phones, browse upcoming events and past media,
and check what backline gear is available. Admins approve requests and manage the content
inside the same app. There is no separate dashboard.

**Live at [ehbandits.com](https://ehbandits.com)**, in daily use by the band.

This is a personal project. It is not an official Eusoff Hall or NUS platform.

![The landing page](docs/screenshots/home-page.webp)

| | |
| --- | --- |
| ![Weekly booking calendar](docs/screenshots/booking-calendar.webp) | ![Booking request form with the date picker open](docs/screenshots/booking-form.webp) |
| The weekly calendar, updating live as bookings are approved | Requesting a slot: one day, weekly, or a set of picked dates |
| ![Admin approval queue](docs/screenshots/admin-queue.webp) | ![Event detail with poster](docs/screenshots/event-detail.webp) |
| The admin queue, where requests are approved or rejected | An event with its poster, setlist, and media |

![The same calendar in dark mode](docs/screenshots/dark-mode.webp)

<sub>Screenshots are of the live deployment. The repository ships neutral placeholder
images in place of the band's photographs, so a fresh clone looks slightly different.</sub>

## Contents

For anyone: [What it does](#what-it-does) · [Why it works this way](#why-it-works-this-way)

For developers: [Architecture](#architecture) · [Quick start](#quick-start) ·
[Deploy your own](#deploy-your-own) · [Environment variables](#environment-variables) ·
[Scripts](#scripts) · [Security model](#security-model) · [Backups](#backups) ·
[Testing](#testing) · [Design](#design) · [License](#license)

## What it does

**Booking.** A weekly calendar backed by Supabase Realtime, so an approval made on one
device appears on every other device without a refresh. A request can be a single slot, a
weekly repeat, or a set of hand-picked dates, and all of it is submitted as one unit that
an admin approves or rejects together. A database constraint rejects overlapping approved
bookings, so two people cannot end up with the same slot even if they submit at the same
time.

**Events and media.** A public event listing with posters, plus a per-event gallery for
recap videos, photo album links, and typed setlists.

**Backline catalog.** The room's shared gear and rental rates, editable by admins as text,
images, or PDFs.

**Admin overlay.** Approvals and content management live inside the public app behind an
auth gate. Three tiers, all enforced server side:

| Tier | Stored in | Can |
| --- | --- | --- |
| Band Leader | `user_roles.role = 'admin'` | Approve bookings, manage events, backline, and contacts |
| Band Head | `admin_capabilities.is_head` | The above, plus issuing invite codes for new admins |
| Owner | `admin_capabilities.is_owner` | The above, plus promoting and deactivating staff |

New admins register with a single-use invite code that expires after seven days. Only the
SHA-256 hash of a code is stored, never the code itself.

**Consent gate.** First-time visitors see how their booking details are used before the app
loads. Error monitoring and product analytics only start after consent is given. The only
thing that runs before that is Vercel Speed Insights, which measures page load time, sets no
cookies or storage, and cannot identify anyone.

## Why it works this way

Three constraints shaped most of the decisions.

**Almost everyone uses it on a phone.** So layout stability matters more than usual.
Pinch-zoom is never disabled, safe-area insets are respected, the form shell keeps one
height and slides instead of resizing when the keyboard appears, and pickers open as
overlays so nothing jumps under a thumb mid-tap.

**It has to survive a handover.** The band's committee changes every year, so nothing
should depend on the original author being around. Roles, invite codes, and account
recovery are handled in the app or with documented SQL, and the runbook lives in the
repository.

**It has to stay on free tiers.** Reads are bounded, a scheduled ping keeps the Edge
Functions warm, realtime is only used on the screens that need it, and usage is checked
against the actual quotas. The free database plan takes no backups, so a nightly job of
our own does.

---

# For developers

Everything below is for running or deploying the code yourself.

## Architecture

```
React + Vite SPA (TypeScript)
  |
  |-- Supabase Auth         admin sessions, invite-code registration
  |-- Supabase Postgres     all data, row-level security on every table
  |-- Supabase Realtime     live updates on the calendar and content pages
  |-- Supabase Storage      event posters, backline files
  |-- Supabase Edge Funcs   public form validation, privileged writes
  |
Vercel                      static hosting
Cloudflare Turnstile        bot protection on every public form
Resend                      SMTP for admin account email (invites, password resets)
```

Two rules keep the codebase organised:

1. **Persistence lives in `src/services/`.** Components and pages never call Supabase
   directly. Query rules, validation, and the row-level-security contract sit in five
   service modules (`auth`, `bookings`, `events`, `backline`, `contacts`), each with
   colocated tests. It also means the data layer can be tested without rendering any UI.
2. **Realtime subscriptions stay in components.** They are set up in the component that
   renders the data, not hidden inside a service, so you can read a live screen top to
   bottom and see where its data comes from.

Public writes never touch the database directly. Booking submission, admin registration,
and password reset all route through Edge Functions that verify a Turnstile token, check
the request origin, apply a per-IP rate limit, and validate the payload before anything is
written.

## Quick start

Gets the app running against your own Supabase project. You do not need a Cloudflare
account for this. Turnstile publishes test keys that always pass.

Requires Node 20 or newer (there is an `.nvmrc`), npm, the
[Supabase CLI](https://supabase.com/docs/guides/cli), and a free
[Supabase](https://supabase.com) project.

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
cp .env.example .env.local
```

Fill in three values in `.env.local`. The first two are in your Supabase dashboard under
Project Settings, API. The third is Cloudflare's public test key.

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Apply the schema and start the dev server:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
npm run dev
```

The app is on <http://localhost:8080>. Browsing, events, and the backline catalog work
immediately. **Submitting a booking will not work yet**, because public writes go through
Edge Functions that are not deployed. The next section covers that.

If you see a "Configuration needed" page, one of the three values above is missing.

## Deploy your own

Continues from Quick start and covers the parts that need real infrastructure.

### 1. Set the Edge Function secrets

```bash
supabase secrets set TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
supabase secrets set RATE_LIMIT_SALT=<random-32-char-string>
supabase secrets set SITE_URL=https://your-domain.example
supabase secrets set ALLOWED_ORIGINS=https://your-domain.example,https://www.your-domain.example
```

The Turnstile value above is the test secret that pairs with the test site key. Swap both
for real ones from your own Turnstile widget before going live.

`ALLOWED_ORIGINS` is the CORS allow-list for the public functions. If it is unset they fall
back to `SITE_URL`, and if both are unset every request is rejected.

### 2. Deploy the Edge Functions

```bash
supabase functions deploy submit-booking register-admin request-password-reset \
  upload-admin-file set-staff-ban telegram-weekly
```

Deploy all of them together. The helpers in `supabase/functions/_shared/` are bundled into
each function at deploy time, so each function has its own copy. If you redeploy only some
of them, the rest keep running the old code.

Once this succeeds, bookings can be submitted.

### 3. Create the first owner

There is no way to grant ownership from inside the app, on purpose. Register an account
through the app first, then run this in the Supabase SQL editor with your own email:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = 'you@example.com'
on conflict do nothing;

update public.admin_capabilities set is_owner = true, is_head = true
where user_id = (select id from auth.users where lower(email) = 'you@example.com');
```

The first statement grants the admin role, which triggers creation of the profile and
capability rows. The second promotes that account to owner. Everyone else then joins
through invite codes issued from the Manage screen.

### 4. Make it yours

The copy and branding are written for one specific band. Before putting it in front of
anyone else:

- Replace the legal copy in `src/lib/legal.en.ts` and `src/lib/legal.zh.ts`
- Set `VITE_CONTACT_EMAIL` to a real address, since the privacy policy points at it
- Swap the icons in `public/` and the images in `src/assets/`
- Update the name and description in `index.html` and `public/manifest.webmanifest`

### 5. Host it

Any static host works. On Vercel, point it at the repo, set the `VITE_*` variables in
Project Settings, and deploy. Remember that `VITE_*` values are baked in at build time, so
changing one requires a redeploy.

## Environment variables

**Client, set in `.env.local` and in your host's environment**

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon key |
| `VITE_TURNSTILE_SITE_KEY` | Yes | Turnstile site key (public) |
| `VITE_CONTACT_EMAIL` | Recommended | Address shown in the privacy policy for data requests |
| `VITE_SENTRY_DSN` | No | Client error monitoring, production only |

**Edge Functions, set with `supabase secrets set`**

| Variable | Required | Purpose |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | Yes | Server-side Turnstile verification |
| `RATE_LIMIT_SALT` | Yes | Salts hashed IPs in the rate-limit ledger |
| `SITE_URL` | Yes | Public origin for absolute links, and the CORS fallback |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated CORS allow-list |
| `WARMUP_SECRET` | Recommended | Lets the warm-up cron ping skip real work (`x-warmup-secret`) |
| `TELEGRAM_BOT_TOKEN` | No | Enables outbound Telegram notifications |
| `TELEGRAM_TRIGGER_SECRET` | With Telegram | Authorises the weekly board run. `telegram-weekly` **fails closed** without it |
| `TELEGRAM_ADMIN_CHAT_ID` | No | Destination for new-booking pings |
| `TELEGRAM_BOARD_CHAT_ID` | No | Destination for the weekly schedule board |
| `TELEGRAM_ADMIN_THREAD_ID` · `TELEGRAM_BOARD_THREAD_ID` | No | Forum topic ids, if the chat uses topics |
| `TELEGRAM_BOARD_MODE` | No | `edit` (default: one self-healing pinned message) or `announce` (new post each week) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by the
platform. Do not set them yourself.

Telegram is optional. Without a bot token the app works normally and simply sends nothing.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 8080 |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, strict, no unused locals or parameters |
| `npm test` | Vitest |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Tests with a coverage report |

## Security model

The app exposes public forms while keeping write access narrow.

- **Row-level security on every table.** Anonymous reads are limited to safe columns, and
  every select has an explicit limit.
- **No direct public writes.** Every public submission goes through an Edge Function that
  checks the origin, verifies a Turnstile token, applies a per-IP rate limit, and validates
  the payload. Writes are either tightly filtered, go through an RPC, or go through an Edge
  Function.
- **Server-side authorization.** Admin actions re-verify the live session and role against
  the database on every call. Frontend state is never trusted on its own, and privileged
  RPCs are `SECURITY DEFINER` with execute revoked from anonymous and authenticated roles.
- **Minimal data collection.** A public booking captures a session title and a display name.
  No contact details, no personal identifiers. The only place those two fields go is the
  band's private Telegram group, when a booking is approved, so the shared schedule stays
  up to date. Rate limiting stores a salted hash of the submitter's IP, never the address,
  and drops it after 24 hours.
- **Content Security Policy** with no inline scripts, and no `innerHTML` or `eval` anywhere
  in the source. Admin tokens use a storage adapter with a 14-day idle timeout.
- **Encrypted backups.** Every copy is encrypted with a passphrase before it is stored
  anywhere, and is unreadable without it. Details under [Backups](#backups).

## Backups

Supabase's free plan keeps no backups, so the live deployment runs its own. A GitHub
Actions job dumps the `public` schema every night at 03:00 Singapore time: roles, schema,
and every table's rows as plain `INSERT` statements, plus a manifest recording the commit
and latest migration at dump time. Before anything is stored, it checks that every table is
present and that the tables which are never empty actually have rows, so a dump of an empty
or half-migrated database fails loudly instead of quietly replacing a good copy. The archive
is then encrypted with a GPG passphrase and kept in two places: as a workflow artifact for
90 days, which is the easy download, and as a commit on an orphan `backups` branch that is
never pruned. A night's copy is about 17 KB. A red run emails the owner, and that email is
the alarm for the most likely failure, which is the free-tier project pausing itself.

The passphrase is the one secret in the project that cannot be re-issued. It lives in a
password manager and is never rotated, because every copy ever taken would become noise.

A restore is a paste into the Supabase SQL editor: the whole database into a fresh project,
or one table back into production with everything else untouched. Both paths have been
exercised. A drill into a throwaway project reproduced every row, and the single-table path
has already been used for real.

The same nightly commit refreshes a mirror of the two Storage buckets (event posters and
backline files) on that branch. Both buckets are public by URL, so the mirror is stored as-is
rather than encrypted, and because git addresses files by content, an unchanged poster costs
nothing on later nights. Restoring one is uploading the file back into its bucket under the
same name.

Not included: `auth.users`. Admins re-register with an invite code.

The workflow itself is not in this repository. It belongs to the private working copy,
where the database connection string and the passphrase live as secrets; here it would
fail every night without them.

## Testing

Vitest covers the service layer and the pure Edge Function helpers: booking rules,
recurrence expansion, auth and role checks, text sanitization, message formatting, and the
error boundary that decides which server messages a caller may see. That is where the
important logic is, so that is where the tests are, not the UI.

CI runs on every push and pull request: typecheck, lint, tests with coverage, production
build, and `npm audit` gated at high severity. Dependabot batches minor and patch updates
weekly.

## Design

A warm, textured palette in both light and dark mode. Color, spacing, motion, and
typography are all defined as semantic tokens, not one-off values. The backdrop is a tiling
paper texture painted on the root canvas as one continuous surface, which avoids the seams
and re-fit glitches that a fixed background layer causes on iOS Safari.

Animations only use transforms and opacity, never layout properties. iOS Low Power Mode
caps the main thread at about 30fps, and anything that animates height stutters under it,
so an expanding section sets its final layout first and then reveals its content, and forms
never change size at all. The target is smooth on a phone in Low Power Mode, not smooth on
a desktop.

## License

MIT. See [LICENSE](LICENSE).

The code is MIT licensed. The band's name, logo, icons, and photographs are not. Replace
the assets in `public/` and `src/assets/` if you deploy your own copy.
