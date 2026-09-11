# Verified Node bot releases

CI installs the unchanged checked-in Yarn lock with Node20.20.2, builds once, runs offline lifecycle/host validation tests, then Bun1.2.21 stages the Linux runtime and calls the pinned standard-library release helper. The manifest bunVersion is packaging-tool metadata; `runtime.json` records actual Node20.20.2. All locked dependencies are included because existing code imports some devDependencies at runtime. No environment file, runtime data or credentials enter the artifact.

The single `.github/workflows/ci.yml` checks the frozen Node/Yarn build on GitHub. Once first adoption is completed and `PLATFORM_RELEASES_ENABLED=true`, the same workflow builds the exact main commit on VPS and uses the installed trusted adapter. No GitHub build archives or external workflow repository are used. Temporary builds are removed on exit.

The trusted root-owned host profile runs outside the artifact. It binds the existing external env, validates Node and the runtime contract, requests an exact-PID/SHA Unix-socket drain, waits for the runner and every tracked middleware callback, then changes current and restarts as the existing service user. Readiness requires Mongo connection, live runner and exact process/release identity. No business command or Telegram message is used as a check. SIGTERM waits for callbacks before closing Mongo; systemd `SendSIGKILL=no` prevents an overlong task being forcibly killed. A failed deployment requires explicit recovery; there is no automatic restart rollback or migration.

## First adoption is a separate reviewed operation

The old deployed process has no active-work counter or reliable drain acknowledgment. Its PID/old HTTP200 cannot prove that stopping it is safe. Installing files or observing an idle log does not fix this. This profile deliberately refuses normal CD until a lifecycle-aware process is running; `ops/service.conf` is a review template, not a self-applying installer. Preserve the full old checkout/env and exact source/dependency provenance, arrange a controlled first stop with the service owner, then install the reviewed drop-in/trusted hooks and validate the new Unix socket before enabling the flag. Do not bypass the check or use kill -9. Future releases use the normal artifact path.

Static files and Google OAuth routes remain part of the same product behavior; no provider calls or credential changes are made by adoption. Search Lead's separate GramJS intake requires its own drain design and is not covered by this profile.
