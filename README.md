# `@get-air/vizio`

[![CI](https://github.com/get-air/vizio/actions/workflows/ci.yml/badge.svg)](https://github.com/get-air/vizio/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@get-air/vizio.svg)](https://www.npmjs.com/package/@get-air/vizio)

Promise and Effect APIs for Vizio SmartCast TVs. The library speaks the TV's local HTTPS API for pairing, remote control, inputs, settings, state, and app launching.

## Features

- Pair with the four-digit PIN shown by a TV and reuse its durable `AUTH` token.
- Power, volume, mute, channels, navigation, media keys, raw key events, and ASCII text entry.
- List and switch inputs using the firmware-correct fresh `HASHVAL` + input `CNAME` flow.
- Read/write arbitrary TV settings, inspect options, trigger action settings, and blank the screen.
- List/launch known SmartCast apps, launch explicit app configs, and inspect the current app.
- Launch a hosted HTML application in Vizio's Conjure runtime.
- Read device identity, firmware/component versions, PIN status, and aggregate state.
- Persist named TV profiles through an injectable store or the Tauri store adapter.
- Root Promise API plus an Effect-native `/effect` API backed by the same implementation.

## Install

```sh
pnpm add @get-air/vizio
```

## Promise API

```ts
import { Vizio } from "@get-air/vizio"

const tv = await Vizio.connect({
  host: "192.168.1.50:7345",
  authToken: "the-token-returned-by-pairing",
})

await tv.setVolume(25)
await tv.setInput("HDMI-2")
await tv.sendKey("HOME")
```

Pairing is a two-step operation. Reuse the same `deviceId`; pairing again with that identity can invalidate the previous token.

```ts
const tv = await Vizio.connect({ host: "192.168.1.50" })
const challenge = await tv.beginPair("my-app-stable-id", "My App")
const token = await tv.finishPair(challenge, "1234", "my-app-stable-id")
```

## Smart app cast / Conjure

```ts
await tv.launchConjureUrl("http://192.168.1.20:4173/tv/")
```

The TV itself must be able to reach that URL. This launches app id `17`, namespace `4`, with the URL in `MESSAGE`, matching Vizio's Conjure launcher. It does **not** permanently install an application or add a launcher tile; no verified local SmartCast endpoint provides that behavior.

Use `launchAppConfig` for any known Vizio configuration that is not in the bundled fallback catalog:

```ts
await tv.launchAppConfig({ appId: "1", nameSpace: 3 })
```

## Effect API

```ts
import { FunctionHttpTransport } from "@get-air/http"
import { Effect } from "effect"
import { makeVizioClient } from "@get-air/vizio/effect"

const program = Effect.gen(function* () {
  const tv = yield* makeVizioClient(
    { host: "192.168.1.50:7345", authToken: "token" },
    { transport: FunctionHttpTransport.global() },
  )
  yield* tv.powerOn()
  return yield* tv.getState()
})
```

All failures are explicit `Schema.TaggedError` values and can be handled with `Effect.catchTag`/`catchTags`.

## Tauri v2

There is no separate Vizio Tauri plugin. The `/tauri` export uses the shared [`@get-air/http`](https://github.com/get-air/http) Tauri transport, so requests run through Rust instead of the WebView and do not hit browser CORS restrictions.

```sh
pnpm tauri add http
pnpm tauri add store
pnpm add @tauri-apps/plugin-http @tauri-apps/plugin-store
```

```ts
import { createTauriVizio } from "@get-air/vizio/tauri"

const tv = await createTauriVizio({
  host: "192.168.1.50:7345",
  authToken: "token",
})

await tv.powerOn()
```

The adapter enables `acceptInvalidCerts` and `acceptInvalidHostnames`, because SmartCast TVs present a self-signed certificate whose hostname does not match the TV's LAN address. Those settings are confined to the Tauri HTTP client supplied to this Vizio instance.

Allow local HTTPS and the store plugin in the consuming Tauri capability:

```json
{
  "permissions": [
    {
      "identifier": "http:default",
      "allow": [{ "url": "https://**" }]
    },
    "store:default"
  ]
}
```

Effect applications use `makeTauriVizioClient` or `layerTauriVizioClient` from `@get-air/vizio/effect/tauri`.

## Profile persistence

```ts
import { createTauriVizioProfiles } from "@get-air/vizio/tauri"

const profiles = await createTauriVizioProfiles()
await profiles.set({
  id: "living-room-id",
  alias: "living-room",
  host: "192.168.1.50:7345",
  authToken: "token",
  deviceId: "my-app-stable-id",
  deviceName: "My App",
})
await profiles.setDefault("living-room-id")
```

The default adapter stores the auth token in the application's Tauri store file. Treat it as a bearer credential. Applications needing OS-backed encrypted storage should implement the small `VizioPersistence` interface and construct `VizioProfiles` with it.

## Transport and platform notes

- Every HTTP request goes through the injected `@get-air/http` `HttpTransport`.
- Browser/global `fetch` can still be blocked by the TV's certificate policy; prefer the Tauri adapter or another native transport.
- Newer TVs normally use port `7345`; older firmware may use `9000`.
- HTTP power-on requires the TV's network API to remain reachable, normally through Quick Start mode. Wake-on-LAN is not implemented because this package deliberately has no native Vizio plugin.
- Automatic mDNS/SSDP discovery is not available in the portable Web API. Applications can probe known addresses with `ping()` or provide discovery outside this package.
- Setting writes are validated when metadata is available, but firmware-reported ranges can be wrong. Invalid low-level settings can damage TV configuration; prefer the high-level controls.

## Protocol acknowledgements

Protocol behavior was independently implemented from public SmartCast research and clients including [Vizio's Conjure launcher](https://vizio-pm.s3-us-west-1.amazonaws.com/conjure-launcher.html), [pyvizio](https://github.com/raman325/pyvizio), [vizaio](https://github.com/raman325/vizaio), [junohouse/vizio](https://github.com/junohouse/vizio), and [open_beam](https://github.com/Leeous/open_beam).

MIT
