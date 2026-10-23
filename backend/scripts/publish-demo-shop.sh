#!/usr/bin/env bash
# Publish demo-shop (with its full git history) as a public GitHub repo that Fixsi opens PRs against.
#
#   backend/scripts/publish-demo-shop.sh <github-owner> [repo-name]
#
# Uses the GitHub CLI (`gh`) to create the repo if it's installed and logged in; otherwise create an
# EMPTY public repo named <repo-name> on github.com first (no README/license), then run this script.
set -euo pipefail

OWNER="${1:?usage: $0 <github-owner> [repo-name]}"
NAME="${2:-demo-shop}"
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node "$BACKEND/demo-shop/setup-history.js" "$TMP/demo-shop"
cd "$TMP/demo-shop"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if ! gh repo view "$OWNER/$NAME" >/dev/null 2>&1; then
    gh repo create "$OWNER/$NAME" --public --description "Fixsi demo target: a tiny storefront with planted bugs"
  fi
fi

git remote add origin "https://github.com/$OWNER/$NAME.git"
git push -u origin main

cat <<MSG

Published https://github.com/$OWNER/$NAME
Now set in .env:
  GITHUB_REPO_OWNER=$OWNER
  GITHUB_REPO_NAME=$NAME
  GITHUB_BASE_BRANCH=main
  GITHUB_TOKEN=<fine-grained token: Contents + Pull requests read/write on $OWNER/$NAME only>
MSG
