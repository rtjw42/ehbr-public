<div align="center">

# Eusoff Bandits Band Room

**Booking and management for a student band room, built for phones.**

[![CI](https://img.shields.io/github/actions/workflow/status/rtjw42/ehbr-public/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/rtjw42/ehbr-public/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Live](https://img.shields.io/badge/live-ehbandits.com-2ea44f?style=flat-square)](https://ehbandits.com)

![React](https://img.shields.io/badge/React-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646cff?style=flat-square&logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ecf8e?style=flat-square&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

[What it does](#what-it-does) · [Why it works this way](#why-it-works-this-way) · [Quick start](#quick-start) · [Deploy your own](#deploy-your-own) · [Security](#security-model)

</div>

<br>

![The landing page](docs/screenshots/home-page.webp)

Members reserve the band room from their phones, see what's coming up, and check what gear
is in the room. Admins approve requests and manage the content inside the same app, behind
a login. I built it for the band at my hall, and it is in daily use at
[ehbandits.com](https://ehbandits.com).

This is a personal project. It is not an official Eusoff Hall or NUS platform.

<table align="center">
  <tr>
    <td align="center" width="50%"><img src="docs/screenshots/booking-calendar.webp" alt="Weekly booking calendar"></td>
    <td align="center" width="50%"><img src="docs/screenshots/booking-form.webp" alt="Booking request form with the date picker open"></td>
  </tr>
  <tr>
    <td align="center"><sub>The weekly calendar, updating live as bookings are approved</sub></td>
    <td align="center"><sub>Requesting a slot: one day, weekly, or a set of picked dates</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/admin-queue.webp" alt="Admin approval queue"></td>
    <td align="center"><img src="docs/screenshots/event-detail.webp" alt="Event detail with poster"></td>
  </tr>
  <tr>
    <td align="center"><sub>The admin queue, where requests are approved or rejected</sub></td>
    <td align="center"><sub>An event with its poster, setlist, and media</sub></td>
  </tr>
</table>

![The same calendar in dark mode](docs/screenshots/dark-mode.webp)

<sub>Screenshots are from the live site. The repository ships neutral placeholder images in
place of the band's photographs, so a fresh clone looks a little different.</sub>

## What it does

- **Booking.** A weekly calendar on Supabase Realtime, so an approval made on one device
  shows up on every other device without a refresh. A request can be a single slot, a
  weekly repeat, or a set of hand-picked dates, submitted as one unit that an admin approves
  or rejects together. A database constraint rejects overlapping approved bookings, so two
  people cannot end up with the same slot even if they submit at the same moment.
- **Events and media.** A public event listing with posters, plus a per-event page for
  recap videos, photo album links, and typed setlists.
- **Backline catalog.** The room's shared gear and rental rates, editable by admins as
  text, images, or PDFs.
- **Admin overlay.** Approvals and content management live inside the public app behind a
  login. New admins join with a single-use invite code that expires after seven days. Only
  the SHA-256 hash of a code is stored, never the code itself.
- **Consent gate.** First-time visitors see how their booking details are used before the
  app loads. Error monitoring and analytics start only after consent. The one thing that
  runs before it is Vercel Speed Insights, which measures page load time, sets no cookies
  or storage, and cannot identify anyone.

Three roles, all enforced server side:

| Role | Stored in | Can |
| --- | --- | --- |
| Band Leader | `user_roles.role = 'admin'` | Approve bookings; manage events, backline, and contacts |
| Band Head | `admin_capabilities.is_head` | The above, plus issue invite codes for new admins |
| Owner | `admin_capabilities.is_owner` | The above, plus promote and deactivate staff |

## Why it works this way

Almost every visit is from a phone, so layout stability matters more than usual. Pinch-zoom
is never disabled, safe-area insets are respected, the form shell keeps one height and
slides instead of resizing when the keyboard appears, and pickers open as overlays so
nothing jumps under a thumb mid-tap.

The band's committee changes every year, so nothing should depend on me being around.
Roles, invite codes, and account recovery are handled in the app or with documented SQL,
and the next committee inherits a runbook rather than a phone number.

It has to stay on free tiers. Reads are bounded, a scheduled ping keeps the Edge Functions
warm, realtime is used only on the screens that need it, and usage is checked against the
actual quotas. The free database plan takes no backups, so a nightly job of my own does.

<br>

---

<div align="center">

## For developers

Everything below is for running or deploying the code yourself.

[Architecture](#architecture) · [Quick start](#quick-start) · [Deploy your own](#deploy-your-own) · [Environment variables](#environment-variables) · [Scripts](#scripts) · [Troubleshooting](#troubleshooting)<br>
[Security model](#security-model) · [Backups](#backups) · [Testing](#testing) · [Design](#design) · [License](#license)

</div>

---

## Architecture

```
React + Vite SPA (TypeScript, Tailwind)
│
├─ Supabase Auth          admin sessions, invite-code registration
├─ Supabase Postgres      all data, row-level security on every table
├─ Supabase Realtime      live updates on the calendar and content pages
├─ Supabase Storage       event posters, backline files
└─ Supabase Edge Funcs    public form validation, privileged writes

Vercel                    static hosting
Cloudflare Turnstile      bot check on every public form
Resend                    custom SMTP for auth email (optional)
```

Two rules keep the codebase easy to read:

1. **Persistence lives in `src/services/`.** Components and pages never call Supabase
   directly. Query rules, validation, and the row-level-security contract sit in five
   modules (`auth`, `bookings`, `events`, `backline`, `contacts`), each with its tests
   beside it, so the data layer is tested without rendering any UI.
2. **Realtime subscriptions stay in components.** They are set up in the component that
   renders the data, never inside a service, so a live screen reads top to bottom and you
   can see where its data comes from.

Public writes never touch the database directly. Booking submission, admin registration,
and password reset go through Edge Functions that check the request origin, verify a
Turnstile token, rate limit by IP, and validate the payload before anything is written.
The shared helpers for that live in `supabase/functions/_shared/`.

## Quick start

Runs the app locally against your own Supabase project. You do not need a Cloudflare
account for this: Turnstile publishes test keys that always pass.

**You need:** Node 20 or newer (there is an `.nvmrc`), npm, the
[Supabase CLI](https://supabase.com/docs/guides/cli), and a free
[Supabase](https://supabase.com) project.

**1. Clone and install**

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
cp .env.example .env.local
```

`npm install` also sets up a pre-commit hook (Husky) that runs `eslint --fix` on staged
`.ts` and `.tsx` files.

**2. Fill in three values** in `.env.local`. The first two are in your Supabase dashboard
under Project Settings → API. The third is Cloudflare's public test key.

```ini
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

**3. Apply the schema and start the dev server**

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
npm run dev
```

The app is at <http://localhost:8080>.

> [!NOTE]
> A fresh database has no events or backline content, so those pages start empty. Nothing
> is broken; content appears once an admin adds it.
>
> **Submitting a booking will not work yet.** Public writes go through Edge Functions that
> are not deployed. The next section covers that.

If you see a **Configuration needed** page, one of the three values above is missing.

## Deploy your own

Continues from Quick start and covers the parts that need real infrastructure. Beyond
Supabase you need a static host (the live site uses Vercel) and a Cloudflare account for a
real Turnstile widget. Telegram and custom email are optional.

### 1. Set the Edge Function secrets

```bash
supabase secrets set TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
supabase secrets set RATE_LIMIT_SALT=<random-32-char-string>
supabase secrets set SITE_URL=https://your-domain.example
supabase secrets set ALLOWED_ORIGINS=https://your-domain.example,https://www.your-domain.example,http://localhost:8080
```

The Turnstile value above is the test secret that pairs with the test site key. Swap both
for real ones from your own widget before going live.

`ALLOWED_ORIGINS` is the CORS allow-list for the public functions. Keep
`http://localhost:8080` in it while you are developing and drop it before launch. If it is
unset the functions fall back to `SITE_URL`, and if both are unset every request is
rejected.

### 2. Deploy the Edge Functions

```bash
supabase functions deploy submit-booking register-admin request-password-reset \
  upload-admin-file set-staff-ban telegram-weekly
```

> [!IMPORTANT]
> Deploy all six together, every time. `supabase/functions/_shared/` is bundled into each
> function at deploy time, so each one carries its own copy. Redeploy a subset and the rest
> keep running the old code.

Bookings can be submitted once this succeeds.

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

The first statement grants the admin role, which creates the profile and capability rows.
The second promotes that account to owner. Everyone after that joins with an invite code
issued from the Manage screen.

### 4. Email, cron jobs, and Telegram

**Email.** Registration and password reset send mail through Supabase Auth. The built-in
sender works out of the box but is rate-limited, so the live site uses
[Resend](https://resend.com) as custom SMTP, set in the Supabase dashboard's auth settings.
Any SMTP provider works.

**Cron jobs.** `supabase db push` scheduled four `pg_cron` jobs: a five-minute ping that
keeps the public functions warm, the Telegram board's drain and weekly rollover, and a
daily purge of cron history. The warm-up and Telegram jobs do nothing until the matching
secrets exist in Supabase Vault, so they are safe to leave alone.

<details>
<summary>Turn on the warm-up ping</summary>

<br>

Set an Edge secret, redeploy the three public functions, then store the same token in
Vault along with your project URL and anon key (SQL editor):

```bash
supabase secrets set WARMUP_SECRET=<random-32-char-token>
supabase functions deploy submit-booking register-admin request-password-reset
```

```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
select vault.create_secret('<your-anon-key>',                        'edge_anon_key');
select vault.create_secret('<same token as WARMUP_SECRET>',          'warmup_secret');
```

Check it after a few minutes:

```sql
select status, status_code from net._http_response order by created desc limit 5;
```

</details>

**Telegram.** Optional. Without a bot token the app works normally and sends nothing. The
variables are under [Environment variables](#environment-variables); the board drain also
needs one Vault secret, `telegram_trigger_secret`, holding the same value as
`TELEGRAM_TRIGGER_SECRET`.

### 5. Make it yours

The copy and branding are written for one specific band. Before putting it in front of
anyone else:

- [ ] Replace the legal copy in `src/lib/legal.en.ts` and `src/lib/legal.zh.ts`
- [ ] Set `VITE_CONTACT_EMAIL` to a real address, since the privacy policy points at it
- [ ] Swap the icons in `public/` and the images in `src/assets/`
- [ ] Update the name and description in `index.html` and `public/manifest.webmanifest`

### 6. Host it

Any static host works. On Vercel, import the repo, set the `VITE_*` variables under
Project Settings → Environment Variables, and deploy.

> [!TIP]
> `VITE_*` values are baked in at build time. Changing one means a redeploy.

## Environment variables

**Client** · set in `.env.local` locally and in your host's environment for production

| Variable | Required | Purpose |
| --- | :---: | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon key |
| `VITE_TURNSTILE_SITE_KEY` | Yes | Turnstile site key (public) |
| `VITE_CONTACT_EMAIL` | Recommended | Address shown in the privacy policy for data requests |
| `VITE_SENTRY_DSN` | No | Client error monitoring, production only |

**Edge Functions** · set with `supabase secrets set`

| Variable | Required | Purpose |
| --- | :---: | --- |
| `TURNSTILE_SECRET_KEY` | Yes | Server-side Turnstile verification |
| `RATE_LIMIT_SALT` | Yes | Salts hashed IPs in the rate-limit ledger |
| `SITE_URL` | Yes | Public origin for absolute links, and the CORS fallback |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated CORS allow-list |
| `WARMUP_SECRET` | Recommended | Token the warm-up cron sends, so the ping skips real work |

<details>
<summary><b>Telegram</b> · all optional</summary>

<br>

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Enables outbound notifications. Unset means nothing is sent |
| `TELEGRAM_TRIGGER_SECRET` | Authorises the weekly board run. `telegram-weekly` **fails closed** without it |
| `TELEGRAM_ADMIN_CHAT_ID` | Destination for new-booking pings |
| `TELEGRAM_BOARD_CHAT_ID` | Destination for the weekly schedule board |
| `TELEGRAM_ADMIN_THREAD_ID` · `TELEGRAM_BOARD_THREAD_ID` | Forum topic ids, if the chat uses topics |
| `TELEGRAM_BOARD_MODE` | `edit` (default: one self-healing pinned message) or `announce` (new post each week) |

</details>

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by the
platform. Do not set them yourself.

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

CI runs `typecheck`, `lint`, `test:coverage`, and `build` on every push, then
`npm audit` gated at high severity.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| A **Configuration needed** page | A `VITE_*` value is missing | Fill in `.env.local` (or the host's env) and restart |
| Booking fails and the browser console shows a CORS error | Your origin is not in `ALLOWED_ORIGINS` | Add it, including `http://localhost:8080` while developing, and redeploy the functions |
| "Verification failed or expired" on every booking | Turnstile site key and secret are from different widgets, or a test key is paired with a real secret | Use a matching pair |
| Registration or reset email never arrives | Supabase's built-in sender is rate-limited | Check the Auth logs in the Supabase dashboard, then set custom SMTP |
| A function still behaves like the old code after a deploy | Only some functions were redeployed | Deploy all six together |

## Security model

Public forms, narrow write access.

- **Row-level security on every table.** Anonymous reads are limited to safe columns, and
  every select carries an explicit limit.
- **No direct public writes.** Every public submission goes through an Edge Function that
  checks the origin, verifies a Turnstile token, applies a per-IP rate limit, and validates
  the payload. Every other write is tightly filtered, goes through an RPC, or goes through
  an Edge Function.
- **Server-side authorization.** Admin actions re-verify the live session and role against
  the database on every call. Frontend state is never trusted on its own, and privileged
  RPCs are `SECURITY DEFINER` with execute revoked from the anonymous and authenticated
  roles.
- **Minimal data collection.** A public booking captures a session title and a display
  name. No contact details, no personal identifiers. The only place those two fields go is
  the band's private Telegram group, when a booking is approved, so the shared schedule
  stays current. Rate limiting stores a salted hash of the submitter's IP, never the
  address, and drops it after 24 hours.
- **Hardened client.** A Content Security Policy with no inline scripts, and no `innerHTML`
  or `eval` anywhere in the source. Admin tokens sit behind a storage adapter with a 14-day
  idle timeout.
- **Encrypted backups.** Every copy is encrypted with a passphrase before it is stored
  anywhere, and is unreadable without it. Details under [Backups](#backups).

## Backups

Supabase's free plan keeps no backups, so the live deployment runs its own. A GitHub
Actions job dumps the `public` schema every night at 03:00 Singapore time, checks that
every table is present and that the ones which are never empty actually have rows, encrypts
the archive with a GPG passphrase, and stores it in two places: as a workflow artifact for
90 days, and as a commit on an orphan `backups` branch that is never pruned. The same run
mirrors the two Storage buckets. A restore is a paste into the SQL editor, and both the
whole-database and single-table paths have been used for real. A red run emails me, which
is the alarm for the most likely failure: the free-tier project pausing itself.

<details>
<summary>More detail</summary>

<br>

- The dump holds roles, schema, and every table's rows as plain `INSERT` statements, plus
  a manifest recording the commit and latest migration at dump time. A night's copy is
  about 17 KB.
- The pre-storage check exists so a dump of an empty or half-migrated database fails loudly
  instead of quietly replacing a good copy.
- The passphrase is the one secret in the project that cannot be re-issued. It lives in a
  password manager and is never rotated, because every copy ever taken would become noise.
- Both Storage buckets (event posters, backline files) are public by URL, so the mirror is
  stored as-is rather than encrypted. Git addresses files by content, so an unchanged
  poster costs nothing on later nights. Restoring one is uploading it back into its bucket
  under the same name.
- Not included: `auth.users`. Admins re-register with an invite code.
- The workflow itself is not in this repository. It belongs to the private working copy,
  where the database connection string and the passphrase live as secrets; here it would
  fail every night without them.

</details>

## Testing

Vitest covers the service layer and the pure Edge Function helpers: booking rules,
recurrence expansion, auth and role checks, text sanitization, message formatting, and the
error boundary that decides which server messages a caller may see. That is where the
logic worth protecting is, so that is where the tests are.

Dependabot batches minor and patch updates weekly on the working branch.

## Design

A warm, textured palette in light and dark mode. Color, spacing, motion, and typography
are semantic tokens, not one-off values. The backdrop is a tiling paper texture painted on
the root canvas as one continuous surface, which avoids the seams and re-fit glitches that
a fixed background layer causes on iOS Safari.

Animations only use transforms and opacity, never layout properties. iOS Low Power Mode
caps the main thread at about 30fps, and anything that animates height stutters under it,
so an expanding section sets its final layout first and then reveals its content, and forms
never change size at all. The target is smooth on a phone in Low Power Mode, not smooth on
a desktop.

## License

MIT. See [LICENSE](LICENSE).

The code is MIT licensed. The band's name, logo, icons, and photographs are not. Replace
the assets in `public/` and `src/assets/` if you deploy your own copy.
