#!/bin/sh
# Include the tracked .gitconfig in this clone. Quiet and idempotent.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config --local --get-all include.path 2>/dev/null | grep -qx '../.gitconfig' \
  || git config --local --add include.path ../.gitconfig
