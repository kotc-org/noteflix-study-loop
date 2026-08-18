#!/usr/bin/env bash

# Static guard for the PolinRider / TasksJacker attack classes.
# It never executes project code or suspicious files.

set -uo pipefail

fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  BLOCKED: %s\n' "$*"; fail=1; }

say "Scanning tracked files for PolinRider and hidden editor auto-run behavior..."

tracked_files="$(git ls-files 2>/dev/null || true)"

# Block all tracked VS Code tasks that run when a folder is opened.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  if grep -qE '"runOn"[[:space:]]*:[[:space:]]*"folderOpen"' "$file" 2>/dev/null; then
    bad "$file contains runOn: folderOpen"
  fi
  if grep -qEi '\b(node|python[0-9.]*|deno|bun|ruby|perl|sh|bash|powershell|pwsh)\b[^"[:cntrl:]]{0,160}\.(woff2?|ttf|eot|otf|png|jpe?g|gif|svg|ico|mp[34]|webm|zip|gz|pdf|bin|dat)\b' "$file" 2>/dev/null; then
    bad "$file executes a non-code asset through an interpreter"
  fi
done < <(printf '%s\n' "$tracked_files" | grep -E '(^|/)\.vscode/tasks\.json$' || true)

# Block settings that auto-approve tasks or conceal their terminal.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  if grep -qE '"task\.allowAutomaticTasks"[[:space:]]*:[[:space:]]*(true|"on")' "$file" 2>/dev/null; then
    bad "$file enables automatic tasks without a prompt"
  fi
  if grep -qE '"terminal\.integrated\.hideOnStartup"[[:space:]]*:[[:space:]]*"always"' "$file" 2>/dev/null; then
    bad "$file hides the terminal on startup"
  fi
done < <(printf '%s\n' "$tracked_files" | grep -E '(^|/)\.vscode/settings\.json$' || true)

# Block both published obfuscator variants and their decoder/global markers.
marker_hits="$(git grep -l -I -F \
  -e 'rmcej%otb%' \
  -e 'Cot%3t=shtP' \
  -e '_$_1e42' \
  -e 'function MDy' \
  -e "global['!']='8-270-2'" \
  -e "global['_V']='8-" \
  -- '*.js' '*.mjs' '*.cjs' '*.jsx' '*.ts' '*.tsx' 2>/dev/null || true)"
if [ -n "$marker_hits" ]; then
  while IFS= read -r file; do [ -n "$file" ] && bad "$file contains a PolinRider obfuscator marker"; done <<< "$marker_hits"
fi

# Block known TasksJacker C2 strings in editor configuration.
c2_hits="$(git grep -l -I -F \
  -e 'default-configuration.vercel.app' \
  -e 'vscode-settings-bootstrap.vercel.app' \
  -e 'vscode-settings-config.vercel.app' \
  -e 'vscode-bootstrapper.vercel.app' \
  -e 'vscode-load-config.vercel.app' \
  -e '260120.vercel.app' \
  -e 'e9b53a7c-2342-4b15-b02d-bd8b8f6a03f9' \
  -- '*.json' 2>/dev/null || true)"
if [ -n "$c2_hits" ]; then
  while IFS= read -r file; do [ -n "$file" ] && bad "$file contains a known TasksJacker marker"; done <<< "$c2_hits"
fi

# Block propagation artifacts and the fake-font payload path at any depth.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  case "$file" in
    temp_auto_push.bat|*/temp_auto_push.bat|config.bat|*/config.bat)
      bad "$file is a PolinRider propagation artifact"
      ;;
    public/fonts/fa-solid-400.woff2|*/public/fonts/fa-solid-400.woff2)
      bad "$file is the known fake-font payload path"
      ;;
  esac
done <<< "$tracked_files"

# Block every malicious blob observed in this incident, regardless of pathname.
known_bad_blobs=(
  5e226620d2e360205cc8634e3c581a008d382561
  934d55548c36ff0e330f2a2ba69bf74b10a7dcba
  bb0703e3572c9d21adbce8b2ac2d2bb8de768d82
  6ca8c7a8b8e20e2662998a76914b755956890d78
  8e14837c2c9eb2fd21e15ddbd40b267491764593
  79f337cfd4b69907e57322f73ccee2f26c12c742
  2b005693b3de6872973f1c33dfeba9790890fab0
  fbb558cda86a1d9599c9b1b5f4fb69543bfc19f2
  175a3d1b8feeb211c1081727590ac46edb9ff6e5
  a2cb2c70a8aa1a9fce05b0731b11fa52badd2c0b
  a62f54b4790689ec148fd7afc6b955e86baa2401
)

tracked_blobs="$(git ls-files -s 2>/dev/null | awk '{print $2}' | sort -u)"
for blob in "${known_bad_blobs[@]}"; do
  if grep -qx "$blob" <<< "$tracked_blobs"; then
    bad "a tracked file matches known-malicious blob $blob"
  fi
done

# Block the malicious Tailwind/PostCSS-adjacent packages documented by OSM.
while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -f "$file" ] || continue
  if grep -qE '"(tailwindcss-style-animate|tailwind-mainanimation|tailwind-autoanimation|tailwind-animationbased|tailwindcss-typography-style|tailwindcss-style-modify|tailwindcss-animate-style)"[[:space:]]*:' "$file" 2>/dev/null; then
    bad "$file references a documented malicious npm package"
  fi
  if grep -qEi '"(preinstall|postinstall|install|prepare)"[[:space:]]*:[[:space:]]*"[^"]*\.(woff2?|ttf|eot|otf|png|jpe?g|gif|ico|bin|dat)\b' "$file" 2>/dev/null; then
    bad "$file executes a non-code asset from an npm lifecycle script"
  fi
done < <(printf '%s\n' "$tracked_files" | grep -E '(^|/)package\.json$' || true)

if [ "$fail" -ne 0 ]; then
  say ""
  say "PolinRider security check FAILED. Do not merge or bypass this check."
  exit 1
fi

say "PolinRider security check passed."
exit 0
