# build-l8rgram orchestrator

Headless orchestrator that implements the l8rgram split defined in
`docs/l8rgram-spec.md`. Invokes Claude Code in a **fresh context per
milestone** (M0–M6, with M2 split into spike + impl), runs verification
between phases, and commits on green. Halts on the first phase whose
verification fails.

## Prerequisites
- `claude` CLI installed and authenticated.
- Clean working tree on the branch you want to build l8rgram into.
- Node 20+, npm 10+.

## Run

```
bash tooling/build-l8rgram/run.sh
```

Runs all phases sequentially. If a phase fails, fix the issue and re-run —
completed phases are skipped automatically.

### Flags
- `--from <phase-id>` — start at a specific phase.
- `--only <phase-id>` — run a single phase.
- `--force` — re-run phases marked completed.
- `--dry-run` — print the plan without invoking Claude.

### Environment
- `CLAUDE_BIN` — claude binary path (default: `claude`).
- `L8R_BUILD_MODEL` — model id (default: `claude-opus-4-7`).

## Phase IDs

| Phase id | Milestone | Verification target |
|---|---|---|
| `m0-workspace-scaffold` | M0 | `saveitforl8r` |
| `m1-extract-shared` | M1 | `saveitforl8r` |
| `m2a-photo-library-spike` | M2 (research) | `docs/l8rgram-m2-spike.md` |
| `m2b-l8rgram-skeleton` | M2 (impl) | `l8rgram` |
| `m3-live-calendar` | M3 | `l8rgram` + `server` |
| `m4-album-matching` | M4 | `l8rgram` |
| `m5-gemini` | M5 | `l8rgram` + `server` |
| `m6-build-deploy-native` | M6 | all workspaces |

## Outputs
- One commit per phase on the current branch:
  `feat(l8rgram): <phase-id> — <summary>`
- Per-phase logs at `tooling/build-l8rgram/logs/<phase-id>.log` (gitignored).
- Phase progress at `tooling/build-l8rgram/state/completed-phases.md`
  (gitignored — the durable record is the commit history).
- Manual post-script tasks at `docs/l8rgram-setup-checklist.md` (created
  during M0).

## After it finishes
1. Complete every box in `docs/l8rgram-setup-checklist.md`.
2. Fill in `apps/l8rgram/.env.l8rgram` (real OAuth client id/secret).
3. Read `docs/l8rgram-m2-spike.md` and confirm findings against a real
   device if you haven't yet.
4. From the repo root: `npm install && npm run build -ws --if-present && npm test -ws --if-present`.
5. Open a PR against `native-app` (the branch this script ran on).

## Re-running
- Start over: `rm -rf tooling/build-l8rgram/state && git reset --hard <pre-script-sha>`.
- Re-run one phase: `bash tooling/build-l8rgram/run.sh --only m3-live-calendar --force`.
- Resume after a failure: just `bash tooling/build-l8rgram/run.sh` again.
