# Contributing

Requires Node.js 20.19 or newer and Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm ci
pnpm ci:act
```

Live-TV tests are opt-in and must never print or commit pairing tokens. Keep protocol fixtures synthetic or redacted.
