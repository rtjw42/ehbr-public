# Project: Eusoff Bandits

## Repo Setup
One local folder: `band-room-eh` (private working repo).
Two GitHub remotes:
- `private` → https://github.com/rtjw42/band-room-eh.git (all active work)
- `public` → https://github.com/rtjw42/ehbr-public.git (recruiter-facing)

## Stack
- Frontend: React + Vite (localhost:5173)
- Backend/Auth: Supabase
- Deployment: Vercel

## Branch Meaning
- `dev` → The Workshop. Messy commits fine. Pushes to `private` only.
- `release` → The Stage. Clean commits only. Pushes to `public`.

## Git Rules
- All development happens on `dev`, pushed to `private` only
- `release` is the clean showcase branch — one squash commit per feature
- NEVER push `dev` directly to `public`
- NEVER force push to `public`

## Saving Work
git checkout dev
git add .
git commit -m "<descriptive message>"
git push private dev

## Publishing a Feature (only when I say it's ready)
git checkout release
git merge --squash dev
git commit -m "feat: <clean description>"
git push public release:main
git checkout dev

## Multi-Computer Rule
- Start every session: `git pull private dev`
- End every session: push to `private dev` before switching computers

## Commit Style
- `dev` → casual, descriptive (e.g. "fixing booking form css again")
- `release` → clean, professional (e.g. "feat: add booking history page")

## Rules
- Never push to public unless I explicitly say the feature is done
- Always confirm which branch I am on before any git operation
- Always pull from private dev at the start of a session

Before committing or pushing, run `git status --short --branch` and confirm the branch/remotes match the intended target.
