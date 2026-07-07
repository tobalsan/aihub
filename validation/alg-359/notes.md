# ALG-359 validation notes

- Issue: ALG-359 — Hardening: encrypt tokens at rest + operator OAuth setup docs
- Branch: alg-359-encrypt-tokens (worktree, based on origin/teams)
- Temp home: .aihub-e2e (isolated AIHUB_HOME, removed after run)

## Unit / scoped tests
- pnpm exec vitest run apps/gateway/src/oauth/store.test.ts   -> 8 passed (TokenCipher + store-at-rest)
- pnpm exec vitest run service.test.ts routes.test.ts          -> 21 passed (no regressions)
- pnpm test:gateway  -> 64 files / 360 passed
- pnpm test:shared   -> 16 files / 96 passed (types.ts change)

## E2E (real runtime path, isolated AIHUB_HOME)
Script: validation/alg-359/e2e-token-encryption.mts
Seeded aihub.json: oauth.providers.google ($env: refs) + oauth.encryptionKey ($env:AIHUB_OAUTH_ENCRYPTION_KEY),
seeded $AIHUB_HOME/.env with the key + client id/secret.
Drove the REAL OAuthService (real loadConfig, real file-backed store, real config-sourced
resolveTokenCipher): startAuthorization -> handleCallback -> store.save -> on-disk file.
Only Google's HTTP token/userinfo endpoints were faked (network boundary), same strategy as ALG-357.

Asserted on the on-disk row ($AIHUB_HOME/oauth/main__google.json, captured as 01-token-row-on-disk.json):
- accessToken + refreshToken are `enc:v1:...` AES-256-GCM ciphertext
- NO plaintext token substring appears anywhere in the file
- file mode 0600
- read-back through the real service transparently decrypts to the original tokens
RESULT: E2E PASS.

Command:
  AIHUB_HOME="$(pwd)/.aihub-e2e" pnpm exec tsx validation/alg-359/e2e-token-encryption.mts

## Known gap
Full browser consent round-trip against real Google is not exercised (needs real Google
credentials + human consent the harness cannot provide). The token-at-rest behavior — the
subject of this issue — is fully exercised end-to-end through the real gateway store/config path.
