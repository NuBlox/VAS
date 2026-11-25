# VAS v1.0 — signed local release activation

**Local developer infrastructure only.** VAS stages immutable source and verifies its SHA-256 digest, then signs the release using Ed25519. The trust decision comes from a **public key you provision separately**; a release is not trusted merely because it supplies a signature. Only `local` and `staging` loopback profiles are permitted.

Activation now creates a separately prepared runtime directory (installs npm dependencies and builds the app) and atomically switches an on-disk `current` symlink to it. **It does not replace or stop a running server**, perform database migrations, install services, open a public port or reverse database changes. To start the verified active release on `127.0.0.1`, explicitly use `deploy:run` after activation. Stop any previous process yourself before starting a new one; this is not zero-downtime deployment.

## First-time setup

Run these commands from the exported standalone application after `npm install`. Keep the private key **outside** both the source and release store, backed up and limited to the publisher. Never commit it.

```bash
mkdir -p "$HOME/.config/vas/publisher" "$HOME/Developer/VAS-release-store"
chmod 700 "$HOME/.config/vas/publisher"
export VAS_STORE="$HOME/Developer/VAS-release-store"
export VAS_PRIVATE="$HOME/.config/vas/publisher/private.pem"
export VAS_PUBLIC="$HOME/.config/vas/publisher/public.pem"
npm run deploy:keygen -- --private-key "$VAS_PRIVATE" --public-key "$VAS_PUBLIC"
```

**Important:** Verify the displayed public-key SHA-256 fingerprint through a trusted channel before you use the public key to approve a release. Re-running keygen refuses to overwrite an existing key; rotating publisher keys requires an explicit trust-key change.

## Stage, sign, promote and activate

```bash
npm run verify:release
npm test && npm run check && npm run build
npm run deploy:stage -- --store "$VAS_STORE" --signing-key "$VAS_PRIVATE"
RELEASE_ID=$(node -p "JSON.parse(require('fs').readFileSync('release.json','utf8')).releaseId")
npm run deploy:promote -- --store "$VAS_STORE" --env local --release "$RELEASE_ID" --expect none --profile deployment/profiles/local.json --trusted-key "$VAS_PUBLIC"
npm run deploy:activate -- --store "$VAS_STORE" --env local --release "$RELEASE_ID" --profile deployment/profiles/local.json --trusted-key "$VAS_PUBLIC"
npm run deploy:status -- --store "$VAS_STORE" --env local --trusted-key "$VAS_PUBLIC"
# First stop other running instances; then explicitly run the verified release.
npm run deploy:run -- --store "$VAS_STORE" --env local --trusted-key "$VAS_PUBLIC"
```

`--expect none` applies only when this environment has never been promoted. For a subsequent release, supply the currently promoted release ID with `--expect`. Stage does not copy `.env*`, `.vas`, node_modules, `.pem` or `.key` files; a generated runtime needs secrets injected through your local shell environment, **not bundled in the release**. Activation executes `npm ci`, verifies the release, checks Svelte and builds in the isolated runtime; it aborts if those steps change signed source files. Your release should have a `package-lock.json` created by `npm install` before staging.

## Explicit rollback

If a previously promoted release is still compatible with your database, first update the metadata ledger, then re-activate the old signed directory:

```bash
npm run deploy:rollback -- --store "$VAS_STORE" --env local --release "$OLD_RELEASE_ID" --expect "$NEW_RELEASE_ID" --profile deployment/profiles/local.json --trusted-key "$VAS_PUBLIC"
npm run deploy:activate -- --store "$VAS_STORE" --env local --release "$OLD_RELEASE_ID" --profile deployment/profiles/local.json --trusted-key "$VAS_PUBLIC"
```

A promotion without activation leaves `pendingActivation: true`; the `deploy:run` command refuses to start a stale or tampered release. Existing running processes are **not** automatically switched. Old v0.9 unsigned staged artifacts are deliberately not trusted by v1.0: re-stage and sign from a known good original export. The audit of environment changes is a local JSON history, not a central tamper-resistant ledger. Public deployment and production identity are not supported.
