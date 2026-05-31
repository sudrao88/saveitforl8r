#!/usr/bin/env bash
# Headless orchestrator for the l8rgram split.
# Each phase = one fresh Claude Code invocation with full autonomy.
# See tooling/build-l8rgram/README.md for usage.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
LOGS_DIR="$SCRIPT_DIR/logs"
STATE_DIR="$SCRIPT_DIR/state"
STATE_FILE="$STATE_DIR/completed-phases.md"

mkdir -p "$LOGS_DIR" "$STATE_DIR"
touch "$STATE_FILE"

cd "$REPO_ROOT"

MODEL="${L8R_BUILD_MODEL:-claude-opus-4-8}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# phase-id : verification-kind
PHASES=(
  "m0-workspace-scaffold:saveitforl8r"
  "m1-extract-shared:saveitforl8r"
  "m2a-photo-library-spike:spike"
  "m2b-l8rgram-skeleton:l8rgram"
  "m3-live-calendar:l8rgram-server"
  "m4-album-matching:l8rgram"
  "m5-gemini:l8rgram-server"
  "m6-build-deploy-native:all"
)

FROM=""
ONLY=""
FORCE=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)    FROM="$2"; shift 2 ;;
    --only)    ONLY="$2"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      cat <<EOF
Usage: bash tooling/build-l8rgram/run.sh [flags]

Flags:
  --from <phase-id>   Start at a specific phase.
  --only <phase-id>   Run a single phase.
  --force             Re-run completed phases.
  --dry-run           Print the plan without invoking Claude.

Env:
  CLAUDE_BIN          Path to claude (default: claude)
  L8R_BUILD_MODEL     Model id      (default: claude-opus-4-8)

See tooling/build-l8rgram/README.md for full docs.
EOF
      exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;34m[l8rgram-build]\033[0m %s\n' "$*"; }
err() { printf '\n\033[1;31m[l8rgram-build]\033[0m %s\n' "$*" >&2; }

# Preflight
command -v "$CLAUDE_BIN" >/dev/null 2>&1 || {
  err "claude CLI not found (set CLAUDE_BIN or install Claude Code)."; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || {
  err "node + npm required."; exit 1; }

if [[ $DRY_RUN -eq 0 && -z "$ONLY" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "Working tree has uncommitted changes. Commit or stash first."
    exit 1
  fi
fi

phase_done() { grep -qxF -- "- $1" "$STATE_FILE"; }
mark_done()  { printf -- '- %s\n' "$1" >> "$STATE_FILE"; }

verify_phase() {
  local kind="$1"
  # `-- --run` forwards `--run` to vitest so it runs once and exits even when
  # stdin is a TTY (default `vitest` enters watch mode and would hang the
  # orchestrator waiting for `q`).
  case "$kind" in
    saveitforl8r)
      npm install --silent && \
      npm run build -w saveitforl8r && \
      npm test -w saveitforl8r --silent -- --run
      ;;
    l8rgram)
      npm install --silent && \
      npm run build -w saveitforl8r && npm test -w saveitforl8r --silent -- --run && \
      npm run build -w l8rgram && npm test -w l8rgram --silent --if-present -- --run
      ;;
    l8rgram-server)
      npm install --silent && \
      npm run build -w saveitforl8r && npm test -w saveitforl8r --silent -- --run && \
      npm run build -w l8rgram && npm test -w l8rgram --silent --if-present -- --run && \
      (cd server && npm test --silent --if-present -- --run)
      ;;
    all)
      npm install --silent && \
      npm run build -ws --if-present && \
      npm test -ws --if-present -- --run && \
      test -d apps/l8rgram/ios && test -d apps/l8rgram/android
      ;;
    spike)
      test -f docs/l8rgram-m2-spike.md \
        && grep -q '^## Chosen plugin' docs/l8rgram-m2-spike.md \
        && grep -q '^## API surface' docs/l8rgram-m2-spike.md \
        && grep -q '^## Known gaps' docs/l8rgram-m2-spike.md \
        && grep -q '^## EXIF and capture-time strategy' docs/l8rgram-m2-spike.md \
        && grep -q '^## Recommendation' docs/l8rgram-m2-spike.md
      ;;
    *) err "Unknown verification kind: $kind"; return 1 ;;
  esac
}

run_phase() {
  local id="$1" kind="$2"
  local prompt_file="$PROMPTS_DIR/$id.md"
  local log_file="$LOGS_DIR/$id.log"

  if [[ $FORCE -eq 0 ]] && phase_done "$id"; then
    log "Skipping $id (already completed)."
    return 0
  fi

  [[ -f "$prompt_file" ]] || { err "Missing prompt: $prompt_file"; exit 1; }

  log "──────────────────────────────────────────────"
  log "Phase: $id  ($kind)"
  log "Prompt: $prompt_file"
  log "Log:    $log_file"

  if [[ $DRY_RUN -eq 1 ]]; then
    log "(dry-run) would invoke: $CLAUDE_BIN --print --dangerously-skip-permissions --model $MODEL"
    return 0
  fi

  local completed
  completed="$(cat "$STATE_FILE")"
  [[ -z "$completed" ]] && completed="(none)"

  local invocation_prompt
  invocation_prompt="$(cat <<EOF
You are implementing phase **$id** of the l8rgram split.

Read these files before doing anything:
1. docs/l8rgram-spec.md — the architectural plan (source of truth).
2. tooling/build-l8rgram/prompts/$id.md — your concrete task list for THIS phase.
3. CLAUDE.md — repo conventions (design system, PR policy, etc).

Phases already completed (do not redo, but you may inspect their output):
$completed

CRITICAL rules:
- Stay strictly in scope for $id. Do not pre-emptively do work scheduled for later phases.
- Follow CLAUDE.md design system rules for any UI you add.
- When the work is done, commit with: feat(l8rgram): $id — <short summary>
- Do NOT push. Do NOT amend prior commits. Create a single new commit.
- If you need to leave any TODO for a later phase, write it into docs/l8rgram-setup-checklist.md
  (do not invent new doc files).

Begin.
EOF
)"

  set +e
  "$CLAUDE_BIN" --print --dangerously-skip-permissions --model "$MODEL" \
    "$invocation_prompt" 2>&1 | tee "$log_file"
  local claude_status=${PIPESTATUS[0]}
  set -e

  if [[ $claude_status -ne 0 ]]; then
    err "Claude invocation for $id exited with status $claude_status. See $log_file."
    exit 1
  fi

  log "Verifying $id ($kind)..."
  if ! verify_phase "$kind"; then
    err "Phase $id failed verification. Inspect $log_file and the working tree. Halting."
    exit 1
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    log "Uncommitted changes after $id — committing as fallback."
    git add -A
    git commit -m "feat(l8rgram): $id — fallback commit (Claude did not commit cleanly)" \
      || log "No changes to commit (working tree clean)."
  fi

  mark_done "$id"
  log "Phase $id complete."
}

log "Orchestrating l8rgram build."
log "Repo:    $REPO_ROOT"
log "Model:   $MODEL"
log "Branch:  $(git rev-parse --abbrev-ref HEAD)"

started=0
for entry in "${PHASES[@]}"; do
  id="${entry%%:*}"
  kind="${entry##*:}"

  if [[ -n "$ONLY" ]]; then
    [[ "$id" == "$ONLY" ]] || continue
  elif [[ -n "$FROM" && $started -eq 0 ]]; then
    [[ "$id" == "$FROM" ]] && started=1
    [[ $started -eq 1 ]] || continue
  fi

  run_phase "$id" "$kind"
done

log "All requested phases complete."
log "Setup checklist (manual steps): docs/l8rgram-setup-checklist.md"
