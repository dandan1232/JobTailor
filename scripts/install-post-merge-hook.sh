#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook_path="$project_dir/.git/hooks/post-merge"

cat >"$hook_path" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
bash "$project_dir/scripts/deploy.sh" --skip-pull
EOF

chmod 700 "$hook_path"
echo "Installed Git post-merge hook: $hook_path"
