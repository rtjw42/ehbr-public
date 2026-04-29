# Project: Eusoff Bandits

## Repo Setup
One local folder: `band-room-eh` (private working repo).
Two GitHub remotes:
- `private` → https://github.com/rtjw42/band-room-eh.git (all active work)
- `public` → https://github.com/rtjw42/eusoff-bandits-public.git (recruiter-facing)

## Stack
- Frontend: React + Vite (localhost:8080)
- Backend/Auth: Supabase
- Deployment: Vercel

## Git Rules
- All development happens on `main`, pushed to `private` only
- `public-main` is the clean release branch — one squash commit per feature
- NEVER push `main` directly to `public`
- NEVER suggest `--force` pushes to `public`

## Saving Work
```bash
git add .
git commit -m "<descriptive message>"
git push private main
```

## Publishing a Feature (only when I say it's ready)
```bash
git checkout public-main
git merge --squash main
git commit -m "feat: <clean description>"
git push public public-main:main
git checkout main
```

## Multi-Computer Rule
- Start every session: `git pull private main`
- End every session: push to `private main` before switching computers

## Commit Style
- `main` → casual, descriptive (e.g. "fixing booking form css again")
- `public-main` → clean, professional (e.g. "feat: add booking history page")

## Rules
- Never push to public unless I explicitly say the feature is done
- Always confirm which branch I'm on before any git operation
- Always pull from private at the start of a session