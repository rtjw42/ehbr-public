# Lovable to Vercel + Supabase Migration Roadmap

## Summary

Milestone 1 is approved for implementation as documentation-only work in `PLANS.md`.

Milestones 2-4 remain unapproved. Any step requiring owner-provided values is explicitly marked as blocked. No Supabase URLs, keys, Vercel project identifiers, admin credentials, or branch/deployment strategy should be assumed or invented.

## Milestone 1: Environment

- Create root `PLANS.md`.
- Document current Lovable assumptions:
  - `lovable-tagger` dependency exists.
  - `componentTagger()` is enabled in development in `vite.config.ts`.
  - `.lovable/plan.md` contains prior implementation notes.
  - Existing lockfiles include Lovable-origin traces.
- Document current environment variable names only:
  - `VITE_SUPABASE_PROJECT_ID`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Document package manager state:
  - `package-lock.json`, `bun.lock`, and `bun.lockb` all exist.
  - No package manager cleanup should happen in Milestone 1.
- Document future environment cleanup candidates:
  - Remove Lovable dev tooling later.
  - Add Vercel SPA fallback later.
  - Confirm deployment env vars later.

## Milestone 2: Auth-Sync

- BLOCKED: awaiting input from owner.
  - Need target Supabase project URL.
  - Need target Supabase publishable key.
  - Need confirmation of whether existing Supabase project is being reused or a new project is being created.

- BLOCKED: awaiting input from owner.
  - Need admin account strategy.
  - Need confirmation of admin email.
  - Need confirmation of how admin credentials should be provisioned or rotated.
  - Do not reuse or document any plaintext admin password.

- Once unblocked, preserve current auth behavior:
  - Supabase Auth remains source of truth.
  - Admin role remains checked through `user_roles`.
  - Non-admin users remain redirected away from `/admin`.

## Milestone 3: Schema-Migration

- BLOCKED: awaiting input from owner.
  - Need confirmation of target Supabase project.
  - Need confirmation that migrations should be applied to that project.
  - Need owner approval before touching any schema or running migrations.

- BLOCKED: awaiting input from owner.
  - Need decision on the migration that directly updates `auth.users`.
  - Placeholder decision: either remove/quarantine it or replace it with owner-approved admin provisioning.

- Once unblocked, audit and apply schema:
  - Tables: `bookings`, `booking_groups`, `events`, `reminder_subscriptions`, `user_roles`.
  - Enums: `app_role`, `booking_status`, `recurrence_type`.
  - Storage: `event-posters`.
  - RLS and realtime behavior must be verified after migration.

## Milestone 4: Vercel-Link

- BLOCKED: awaiting input from owner.
  - Need Vercel team/account.
  - Need Vercel project name or confirmation to create/link a new project.
  - Need production domain or confirmation to use the default Vercel domain.

- BLOCKED: awaiting input from owner.
  - Need preview branch strategy.
  - Need confirmation whether previews should deploy from all branches, selected branches, or PRs only.

- BLOCKED: awaiting input from owner.
  - Need approval to add Supabase env vars to Vercel.
  - Required names are known, but values are owner-provided:
    - `VITE_SUPABASE_PROJECT_ID`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_PUBLISHABLE_KEY`

- Once unblocked, configure Vercel:
  - Framework preset: Vite.
  - Build command: `npm run build`.
  - Output directory: `dist`.
  - Add SPA fallback for `/admin`, `/events`, and other client routes.

## Test Plan

- Milestone 1:
  - Confirm `PLANS.md` exists and contains roadmap only.
  - Confirm no application code was edited.

- Later milestones, after owner input:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - Manual auth, booking, events, poster upload, realtime, and Vercel deep-link smoke tests.

## Assumptions

- No Supabase, Vercel, admin credential, or branch strategy values are known yet.
- Milestone 1 may be implemented now as documentation only.
- Milestones 2-4 remain blocked until the owner provides the required inputs.
