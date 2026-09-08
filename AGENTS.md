# google-meet-bot

## Purpose
Standalone deployed Telegram bot. The archived local directory name does not mean the VPS service is inactive.

## Layout
`src/` contains TypeScript application code; `locales/` contains messages; `dist/` is generated output. Runtime env and MongoDB data remain external.

## Toolchain
Target direction is Bun, but this repository currently has a verified Node/Yarn exception. CI pins Node 20.20.2 and executes the checked-in `.yarn/releases/yarn-3.1.0.cjs` directly, matching the existing lockfile and yarnPath. Do not use the stale packageManager field to silently select a different Yarn release. Bun 1.2.21 cannot import this Berry lockfile directly: it ignores it and resolves new versions. A Bun migration must compare dependency resolutions first; do not add a competing lockfile generated from ranges.

## Commands
`node .yarn/releases/yarn-3.1.0.cjs install --immutable` installs the locked graph. `node .yarn/releases/yarn-3.1.0.cjs build` compiles TypeScript without starting the bot. Source checks/install must use an isolated environment without production env or credentials. CI disables dependency install scripts.

## Validation
The initial CI gate verifies frozen installation, compilation and absence of tracked-source mutation. Existing `lint` is a separate failing baseline (formatting and/or ESLint issues); CI does not claim it passes. Fix those issues with focused review before adding a required lint gate. Offline lifecycle tests use Node built-in tests after compilation: `node --test ops/tests/*.test.cjs`. Host readiness validation tests use `python3 -m unittest discover -s ops/tests -p "test_*.py"`. They use fake adapters and no Telegram/Mongo credentials. Do not launch the bot as a CI smoke test.

## Boundaries
Preserve user changes and existing database/Telegram contracts. `start` and `develop` launch the live application and are not checks. Do not read personal Downloads, bot sessions, .env files, or real database data for CI. Production keeps Node20.20.2. Bun1.2.21 only packages the checked Linux artifact. `ops/DEPLOY.md` describes readiness/drain and the mandatory first-adoption boundary; automatic deployment remains off until the trusted profile and first lifecycle-aware process are reviewed.
