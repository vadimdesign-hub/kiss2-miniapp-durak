#!/usr/bin/env bash
set -euo pipefail

# Renames the template project to a real miniapp name.
#
# Usage:
#   ./scripts/rename-project.sh              # auto-detect from git remote or directory name
#   ./scripts/rename-project.sh my-miniapp   # explicit name (short form, without kiss2-miniapp- prefix)
#
# What it does:
#   1. Derives the full name (kiss2-miniapp-{name}), short name ({name}), and DB name (kiss2_miniapp_{name})
#   2. Replaces all template placeholders across the project
#   3. Renames the PostgreSQL database in connection strings
#   4. Shows a summary of changes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OLD_FULL="kiss2-miniapp-template"
OLD_SHORT="template"
OLD_DB="kiss2_miniapp"

# --- Resolve new project name ---

resolve_name() {
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi

  # Try git remote
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
    local remote_url
    remote_url="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
    if [[ -n "$remote_url" ]]; then
      # Extract repo name: git@github.com:org/kiss2-miniapp-foo.git -> kiss2-miniapp-foo
      local repo_name
      repo_name="$(basename "$remote_url" .git)"
      if [[ "$repo_name" != "$OLD_FULL" && "$repo_name" == kiss2-miniapp-* ]]; then
        echo "${repo_name#kiss2-miniapp-}"
        return
      fi
    fi
  fi

  # Fall back to directory name
  local dir_name
  dir_name="$(basename "$ROOT_DIR")"
  if [[ "$dir_name" != "$OLD_FULL" && "$dir_name" == kiss2-miniapp-* ]]; then
    echo "${dir_name#kiss2-miniapp-}"
    return
  fi

  echo ""
}

NEW_SHORT="$(resolve_name "${1:-}")"

if [[ -z "$NEW_SHORT" ]]; then
  echo "Error: Could not determine the new project name." >&2
  echo "" >&2
  echo "The name is resolved in this order:" >&2
  echo "  1. CLI argument:  ./scripts/rename-project.sh <short-name>" >&2
  echo "  2. Git remote:    origin URL like kiss2-miniapp-<name>.git" >&2
  echo "  3. Directory name: parent dir like kiss2-miniapp-<name>" >&2
  echo "" >&2
  echo "Either pass a name explicitly or run from a directory/repo that isn't '$OLD_FULL'." >&2
  exit 1
fi

# Validate: alphanumeric + hyphens, no leading/trailing hyphens
if [[ ! "$NEW_SHORT" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ && ! "$NEW_SHORT" =~ ^[a-z][a-z0-9]*$ ]]; then
  echo "Error: Invalid name '$NEW_SHORT'. Use lowercase alphanumeric characters and hyphens." >&2
  exit 1
fi

NEW_FULL="kiss2-miniapp-${NEW_SHORT}"
NEW_DB="kiss2_miniapp_${NEW_SHORT//-/_}"

echo "Renaming project:"
echo "  Full name:   $OLD_FULL -> $NEW_FULL"
echo "  Short name:  $OLD_SHORT -> $NEW_SHORT"
echo "  DB name:     $OLD_DB -> $NEW_DB"
echo ""

# --- Files to process ---
# Explicit list of files that contain template strings.
# We avoid blind recursive replacement to prevent touching node_modules,
# .git, generated files, lock files, etc.

FILES=(
  "package.json"
  "README.md"
  "CLAUDE.md"
  ".env.example"
  "packages/backend/.env"
  "deploy/k8s/values-stage.yaml"
  "deploy/k8s/values-prod.yaml"
)

changed_files=()

replace_in_file() {
  local file="$ROOT_DIR/$1"
  if [[ ! -f "$file" ]]; then
    echo "  [skip] $1 (not found)"
    return
  fi

  local original
  original="$(cat "$file")"
  local updated="$original"

  # In k8s values and env files, normalize SERVICE_NAME to the short name
  # before the global replacement, since the template may have the full name
  # (backend .env) or the short name (.env.example, k8s values).
  if [[ "$1" == deploy/k8s/* || "$1" == ".env.example" || "$1" == "packages/backend/.env" ]]; then
    updated="$(echo "$updated" | sed \
      -e "s|name: ${OLD_SHORT}$|name: ${NEW_SHORT}|g" \
      -e "s|value: ${OLD_SHORT}$|value: ${NEW_SHORT}|g" \
      -e "s|/${OLD_SHORT}/|/${NEW_SHORT}/|g" \
      -e "s|SERVICE_NAME=${OLD_FULL}$|SERVICE_NAME=${NEW_SHORT}|g" \
      -e "s|SERVICE_NAME=${OLD_SHORT}$|SERVICE_NAME=${NEW_SHORT}|g" \
      -e "s|VITE_SERVICE_NAME=${OLD_SHORT}$|VITE_SERVICE_NAME=${NEW_SHORT}|g"
    )"
  fi

  # Replace full name and DB name in the rest of the content
  updated="${updated//$OLD_FULL/$NEW_FULL}"
  updated="${updated//$OLD_DB/$NEW_DB}"

  if [[ "$updated" != "$original" ]]; then
    echo "$updated" > "$file"
    changed_files+=("$1")
    echo "  [done] $1"
  else
    echo "  [unchanged] $1"
  fi
}

echo "Processing files:"

for f in "${FILES[@]}"; do
  replace_in_file "$f"
done

echo ""
echo "---"
echo "Changed ${#changed_files[@]} file(s):"
for f in "${changed_files[@]}"; do
  echo "  - $f"
done

echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff"
echo "  2. Create the PostgreSQL database: createdb $NEW_DB"
echo "  3. Run migrations: npm run db:migrate:dev"
echo "  4. Install deps if needed: npm install"
