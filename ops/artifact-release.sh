#!/usr/bin/env bash
set -euo pipefail
umask 022
[[ $# == 4 ]] || exit 2
readonly root=/opt/google-meet-bot
readonly helper=/usr/local/lib/platform-release/release.py
candidate="$(python3 "$helper" prepare --archive "$1" --descriptor "$2" \
  --app google-meet-bot --expected-sha "$3" --expected-run-id "$4" --expected-arch x64 \
  --expected-bun-version 1.2.21 --root "$root")"
python3 "$helper" bind --root "$root" --release "$candidate" --link .env=/home/mahhis/bots/google-meet-bot/.env
python3 "$helper" promote --root "$root" --release "$candidate" \
  --hook-dir /usr/local/lib/platform-release/apps/google-meet-bot/hooks --rollback-policy forbid --hook-timeout 150
