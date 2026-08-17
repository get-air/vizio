# `@get-air/vizio` repository guidance

- This is one standalone npm package and Git repository. Do not add workspace packages or `workspace:` dependencies.
- All SmartCast business logic lives in Effect. The root entrypoint is a Promise/plain-JavaScript facade over that implementation.
- Use `@get-air/http` for every Request-based network operation and `@get-air/cache` only for serialized response/catalog caching.
- The Tauri adapter belongs in this package under `/tauri`; do not introduce a native Tauri plugin without an explicit architecture change.
- Never log an `AUTH` token or include one in a serialized error.
- Vizio setting writes require a current `HASHVAL`; input writes require a freshly read hash and the target input's `CNAME`.
- Run `pnpm ci` and `pnpm ci:act` before pushing. Releases use npm trusted publishing with provenance.
