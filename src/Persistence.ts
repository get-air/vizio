import { Effect, Schema } from "effect"
import {
  VizioPersistenceReadError,
  VizioPersistenceWriteError,
} from "./Errors.js"
import { StoredTvProfile, type StoredTvProfile as StoredTvProfileType } from "./Schemas.js"

export interface VizioPersistence {
  readonly read: () => Promise<string | undefined>
  readonly write: (value: string) => Promise<void>
}

interface RegistryDocument {
  readonly version: 1
  readonly defaultProfileId?: string
  readonly profiles: ReadonlyArray<StoredTvProfileType>
}

const RegistryDocument = Schema.Struct({
  version: Schema.Literal(1),
  defaultProfileId: Schema.optional(Schema.String),
  profiles: Schema.Array(StoredTvProfile),
})

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

export class MemoryVizioPersistence implements VizioPersistence {
  private value: string | undefined

  async read(): Promise<string | undefined> { return this.value }
  async write(value: string): Promise<void> { this.value = value }
}

export const makeVizioProfileStore = (persistence: VizioPersistence) => {
  const load = Effect.fn("VizioProfileStore.load")(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => persistence.read(),
      catch: (cause) => new VizioPersistenceReadError({ message: message(cause) }),
    })
    if (raw === undefined) {
      return { version: 1, profiles: [] } satisfies RegistryDocument
    }
    const unknown = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new VizioPersistenceReadError({ message: message(cause) }),
    })
    return yield* Schema.decodeUnknown(RegistryDocument)(unknown).pipe(
      Effect.catchTag("ParseError", (cause) =>
        Effect.fail(new VizioPersistenceReadError({ message: message(cause) }))),
    )
  })

  const save = Effect.fn("VizioProfileStore.save")(function* (document: RegistryDocument) {
    yield* Effect.tryPromise({
      try: () => persistence.write(JSON.stringify(document)),
      catch: (cause) => new VizioPersistenceWriteError({ message: message(cause) }),
    })
  })

  const list = Effect.fn("VizioProfileStore.list")(function* () {
    return (yield* load()).profiles
  })

  const get = Effect.fn("VizioProfileStore.get")(function* (idOrAlias: string) {
    const document = yield* load()
    return document.profiles.find((profile) =>
      profile.id === idOrAlias || profile.alias.toLowerCase() === idOrAlias.toLowerCase())
  })

  const set = Effect.fn("VizioProfileStore.set")(function* (profile: StoredTvProfileType) {
    const document = yield* load()
    const profiles = document.profiles.filter((item) =>
      item.id !== profile.id && item.alias.toLowerCase() !== profile.alias.toLowerCase())
    yield* save({
      version: 1,
      profiles: [...profiles, profile],
      ...(document.defaultProfileId === undefined ? {} : { defaultProfileId: document.defaultProfileId }),
    })
  })

  const remove = Effect.fn("VizioProfileStore.remove")(function* (idOrAlias: string) {
    const document = yield* load()
    const removed = document.profiles.find((profile) =>
      profile.id === idOrAlias || profile.alias.toLowerCase() === idOrAlias.toLowerCase())
    const profiles = document.profiles.filter((profile) => profile !== removed)
    yield* save({
      version: 1,
      profiles,
      ...(removed !== undefined && document.defaultProfileId === removed.id
        ? {}
        : document.defaultProfileId === undefined ? {} : { defaultProfileId: document.defaultProfileId }),
    })
  })

  const getDefault = Effect.fn("VizioProfileStore.getDefault")(function* () {
    const document = yield* load()
    return document.profiles.find((profile) => profile.id === document.defaultProfileId)
  })

  const setDefault = Effect.fn("VizioProfileStore.setDefault")(function* (profileId: string) {
    const document = yield* load()
    if (!document.profiles.some((profile) => profile.id === profileId)) {
      return yield* new VizioPersistenceWriteError({
        message: `Cannot select unknown TV profile ${profileId}`,
      })
    }
    yield* save({ ...document, defaultProfileId: profileId })
  })

  return { list, get, set, remove, getDefault, setDefault }
}

export type VizioProfileStore = ReturnType<typeof makeVizioProfileStore>
