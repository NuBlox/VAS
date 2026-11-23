# Local release candidate management

**This is not production deployment.** `stage` copies a verified standalone application into an integrity-checked local release store. `promote` and `rollback` atomically update a **manifest pointer** for a local environment; they do not start, restart, replace or stop an application process, and they do not migrate or restore MySQL.

The source directory and release store must be separate. The tool excludes `.env*`, dependencies, local policies and build outputs. Symlinks are rejected. Keep the release store on a trusted local filesystem with restricted access. SHA-256 is an integrity check, not a publisher signature.

From a generated application (after `npm install`), run:

```bash
npm run deploy:stage -- --store ~/Developer/VAS-release-store
RELEASE_ID=$(node -p "JSON.parse(require('fs').readFileSync('release.json','utf8')).releaseId")
npm run deploy:promote -- --store ~/Developer/VAS-release-store --env local --release "$RELEASE_ID" --expect none --profile deployment/profiles/local.json
npm run deploy:status -- --store ~/Developer/VAS-release-store --env local
```

For subsequent releases, supply the previous active release ID to `--expect`. Rollback is allowed only to a previously active release:

```bash
npm run deploy:rollback -- --store ~/Developer/VAS-release-store --env local --release "$OLD_RELEASE_ID" --expect "$CURRENT_RELEASE_ID" --profile deployment/profiles/local.json
```

These commands change **local release metadata only**, not a running server. Before a real service switch, review database schema compatibility and verified backups. Production and public-network deployment profiles are refused.
