#!/bin/sh
# One-time local dev setup after cloning. Enables the project git hooks.
git config core.hooksPath .githooks
echo "✓ git hooks enabled (core.hooksPath=.githooks)"
