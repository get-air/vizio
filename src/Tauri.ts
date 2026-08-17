import { TauriCacheStore } from "@get-air/cache/tauri"
import { makeTauriHttpTransport } from "@get-air/http/tauri"
import type { ClientOptions } from "@tauri-apps/plugin-http"
import { load } from "@tauri-apps/plugin-store"
import { Effect, Layer, Schema } from "effect"
import { makeVizioClient, VizioClient, type VizioClientShape } from "./Client.js"
import type { VizioInvalidConfigError } from "./Errors.js"
import { Vizio, VizioProfiles } from "./PromiseClient.js"
import type { VizioPersistence } from "./Persistence.js"
import type { TvConfig } from "./Schemas.js"

export class VizioTauriInitializationError extends Schema.TaggedError<VizioTauriInitializationError>()(
  "VizioTauriInitializationError",
  { component: Schema.String, message: Schema.String },
) {}

export interface TauriVizioOptions {
  readonly http?: ClientOptions
  readonly cache?: false | {
    readonly path?: string
    readonly autoSave?: boolean | number
  }
}

export interface TauriVizioProfilesOptions {
  readonly path?: string
  readonly autoSave?: boolean | number
}

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const httpOptions = (options: ClientOptions = {}): ClientOptions => ({
  ...options,
  danger: {
    acceptInvalidCerts: true,
    acceptInvalidHostnames: true,
    ...options.danger,
  },
})

/** Effect-native Tauri client using @get-air/http's Rust-backed transport. */
export const makeTauriVizioClient = Effect.fn("VizioTauri.makeClient")(function* (
  config: TvConfig,
  options: TauriVizioOptions = {},
) {
  const transport = makeTauriHttpTransport(httpOptions(options.http))
  if (options.cache === false) return yield* makeVizioClient(config, { transport })

  const cacheOptions = options.cache
  const cachePath = cacheOptions?.path ?? "vizio-cache.json"
  const cache = yield* Effect.tryPromise({
    try: () => TauriCacheStore.make(cachePath, { autoSave: cacheOptions?.autoSave ?? 100 }),
    catch: (cause) => new VizioTauriInitializationError({
      component: "cache",
      message: message(cause),
    }),
  })
  return yield* makeVizioClient(config, { transport, cache })
})

export const layerTauriVizioClient = (
  config: TvConfig,
  options: TauriVizioOptions = {},
): Layer.Layer<VizioClient, VizioTauriInitializationError | VizioInvalidConfigError> =>
  Layer.effect(
    VizioClient,
    makeTauriVizioClient(config, options).pipe(Effect.map(VizioClient.make)),
  )

/** Promise facade over makeTauriVizioClient. */
export const createTauriVizio = async (
  config: TvConfig,
  options: TauriVizioOptions = {},
): Promise<Vizio> => {
  const transport = makeTauriHttpTransport(httpOptions(options.http))
  if (options.cache === false) return Vizio.connect(config, { transport })
  const cache = await TauriCacheStore.make(
    options.cache?.path ?? "vizio-cache.json",
    { autoSave: options.cache?.autoSave ?? 100 },
  )
  return Vizio.connect(config, { transport, cache })
}

export const makeTauriVizioPersistence = Effect.fn("VizioTauri.makePersistence")(function* (
  options: TauriVizioProfilesOptions = {},
) {
  const path = options.path ?? "vizio-devices.json"
  const store = yield* Effect.tryPromise({
    try: () => load(path, { autoSave: options.autoSave ?? 100 }),
    catch: (cause) => new VizioTauriInitializationError({
      component: "profiles",
      message: message(cause),
    }),
  })
  return {
    read: () => store.get<string>("registry").then((value) => value ?? undefined),
    write: async (value: string) => {
      await store.set("registry", value)
      await store.save()
    },
  } satisfies VizioPersistence
})

export const createTauriVizioProfiles = async (
  options: TauriVizioProfilesOptions = {},
): Promise<VizioProfiles> => {
  const persistence = await Effect.runPromise(makeTauriVizioPersistence(options))
  return new VizioProfiles(persistence)
}

export type { VizioClientShape }
