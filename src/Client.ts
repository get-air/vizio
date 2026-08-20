import type { CacheStore } from "@get-air/cache"
import { CacheStoreService, EffectCache } from "@get-air/cache/effect"
import { FunctionHttpTransport, type HttpTransport } from "@get-air/http"
import { Effect, Layer, Option, Ref } from "effect"
import {
  BUILTIN_APPS,
  parseRemoteAppCatalog,
  VIZIO_APP_AVAILABILITY_URL,
  VIZIO_APP_CATALOG_URL,
} from "./Apps.js"
import {
  VizioEndpointNotFoundError,
  VizioInvalidConfigError,
  VizioInvalidInputError,
  VizioInvalidParameterError,
  VizioInvalidResponseError,
  VizioItemNotFoundError,
  VizioHttpStatusError,
  VizioTransportError,
  type VizioError,
} from "./Errors.js"
import {
  booleanField,
  field,
  makeProtocolClient,
  numberField,
  recordField,
  responseItem,
  responseItems,
  stringField,
  type JsonRecord,
  type ProtocolRequest,
  type ProtocolResponse,
} from "./Protocol.js"
import { REMOTE_KEYS, remoteEvent, textEvents, type RemoteKey } from "./Remote.js"
import type {
  AppConfig,
  AppRecord,
  DeviceInfo,
  InputInfo,
  PairingChallenge,
  RemoteEvent,
  SettingInfo,
  SettingKind,
  SettingValue,
  StateSnapshot,
  TvConfig,
} from "./Schemas.js"

const ROOT = "/menu_native/dynamic/tv_settings"
const STATIC_ROOT = "/menu_native/static/tv_settings"
const APP_CACHE_NAMESPACE = "@get-air/vizio/apps/v1"
const DEFAULT_TIMEOUT_MILLIS = 10_000

export interface VizioClientOptions {
  readonly transport?: HttpTransport
  readonly cache?: CacheStore
  readonly appCatalog?: ReadonlyArray<AppRecord>
}

export interface RawVizioRequest extends ProtocolRequest {}

const unknownMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const settingValue = (value: unknown): SettingValue | undefined =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined

const settingKind = (value: unknown): SettingKind => {
  switch (value) {
    case "T_VALUE_V1":
    case "T_LIST_V1":
    case "T_LIST_X_V1":
    case "T_VALUE_ABS_V1":
    case "T_MENU_V1":
    case "T_ACTION_V1":
      return value
    default:
      return "UNKNOWN"
  }
}

const optionNames = (item: JsonRecord): ReadonlyArray<string> => {
  const elements = field(item, "ELEMENTS")
  if (!Array.isArray(elements)) return []
  return elements.flatMap((element) => {
    if (typeof element === "string") return [element]
    if (typeof element !== "object" || element === null || Array.isArray(element)) return []
    const candidate = element as JsonRecord
    const name = stringField(candidate, "NAME") ?? stringField(candidate, "VALUE")
    return name === undefined ? [] : [name]
  })
}

const parseSetting = (
  category: string,
  item: JsonRecord,
): Effect.Effect<SettingInfo, VizioInvalidResponseError> => {
  const name = stringField(item, "CNAME")
  const value = settingValue(field(item, "VALUE"))
  const hashValue = numberField(item, "HASHVAL")
  if (name === undefined || value === undefined || hashValue === undefined) {
    return Effect.fail(new VizioInvalidResponseError({
      path: `${ROOT}/${category}`,
      message: "Setting item is missing CNAME, VALUE, or HASHVAL",
    }))
  }
  const minimum = numberField(item, "MINIMUM")
  const maximum = numberField(item, "MAXIMUM")
  const center = numberField(item, "CENTER")
  return Effect.succeed({
    category,
    name,
    displayName: stringField(item, "NAME") ?? name,
    value,
    hashValue,
    kind: settingKind(field(item, "TYPE")),
    options: optionNames(item),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(center === undefined ? {} : { center }),
  })
}

const validateSettingValue = (
  setting: SettingInfo,
  value: SettingValue,
): Effect.Effect<void, VizioInvalidParameterError> => {
  if (setting.minimum !== undefined && typeof value === "number" && value < setting.minimum) {
    return Effect.fail(new VizioInvalidParameterError({
      path: `${ROOT}/${setting.category}/${setting.name}`,
      result: "VALUE_OUT_OF_RANGE",
      message: `${setting.name} must be at least ${setting.minimum}`,
    }))
  }
  if (setting.maximum !== undefined && typeof value === "number" && value > setting.maximum) {
    return Effect.fail(new VizioInvalidParameterError({
      path: `${ROOT}/${setting.category}/${setting.name}`,
      result: "VALUE_OUT_OF_RANGE",
      message: `${setting.name} must be at most ${setting.maximum}`,
    }))
  }
  if (setting.options.length > 0 && typeof value === "string" &&
      !setting.options.some((option) => option.toLowerCase() === value.toLowerCase())) {
    return Effect.fail(new VizioInvalidParameterError({
      path: `${ROOT}/${setting.category}/${setting.name}`,
      result: "INVALID_PARAMETER",
      message: `${value} is not a supported value for ${setting.name}`,
    }))
  }
  return Effect.void
}

export const makeVizioClient = Effect.fn("VizioClient.make")(function* (
  config: TvConfig,
  options: VizioClientOptions = {},
) {
  const host = config.host.trim()
  if (host.length === 0) {
    return yield* new VizioInvalidConfigError({ field: "host", message: "TV host is required" })
  }
  const transport = options.transport ?? FunctionHttpTransport.global()
  const timeoutMillis = config.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS
  const protocolFor = (authToken?: string) => makeProtocolClient({
    host, timeoutMillis, transport,
    ...(authToken === undefined ? {} : { authToken }),
  })
  const protocol = yield* Ref.make(protocolFor(config.authToken))
  const mutex = yield* Effect.makeSemaphore(1)
  const cache = Option.map(Option.fromNullable(options.cache), (store) => ({
    store,
    client: new EffectCache(APP_CACHE_NAMESPACE),
  }))
  const appCatalog = yield* Ref.make<ReadonlyArray<AppRecord>>(options.appCatalog ?? BUILTIN_APPS)

  if (options.appCatalog === undefined && Option.isSome(cache)) {
    const cached = yield* cache.value.client.get("catalog").pipe(
      Effect.provideService(CacheStoreService, cache.value.store),
      Effect.option,
    )
    if (Option.isSome(cached) && cached.value !== undefined) {
      const cachedValue = cached.value
      const parsed = yield* Effect.try({
        try: () => JSON.parse(cachedValue) as unknown,
        catch: () => new VizioInvalidResponseError({ path: "app catalog cache", message: "Cached catalog is invalid JSON" }),
      }).pipe(Effect.option)
      if (Option.isSome(parsed) && Array.isArray(parsed.value)) {
        const apps = parsed.value.filter((entry): entry is AppRecord => {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false
          const candidate = entry as Partial<AppRecord>
          return typeof candidate.name === "string" && Array.isArray(candidate.countries) && Array.isArray(candidate.configs)
        })
        if (apps.length > 0) yield* Ref.set(appCatalog, apps)
      }
    }
  }

  const requestUnlocked = Effect.fn("VizioClient.requestUnlocked")(function* (input: RawVizioRequest) {
    return yield* (yield* Ref.get(protocol)).request(input)
  })

  const request = Effect.fn("VizioClient.request")(function* (input: RawVizioRequest) {
    return yield* requestUnlocked(input).pipe(mutex.withPermits(1))
  })

  const requireItem = Effect.fn("VizioClient.requireItem")(function* (
    response: ProtocolResponse,
    itemName: string,
  ) {
    const direct = responseItem(response)
    const items = direct === undefined ? responseItems(response) : [direct]
    const item = items.find((candidate) =>
      (stringField(candidate, "CNAME") ?? "").toLowerCase() === itemName.toLowerCase()) ?? items[0]
    if (item === undefined) {
      return yield* new VizioItemNotFoundError({
        path: stringField(response.raw, "URI") ?? "unknown",
        item: itemName,
        message: `TV response did not include ${itemName}`,
      })
    }
    return item
  })

  const getItemValue = Effect.fn("VizioClient.getItemValue")(function* (
    path: string,
    itemName: string,
  ) {
    const response = yield* request({ method: "GET", path })
    const item = yield* requireItem(response, itemName)
    return field(item, "VALUE")
  })

  const sendRemoteEvents = Effect.fn("VizioClient.sendRemoteEvents")(function* (
    events: ReadonlyArray<RemoteEvent>,
  ) {
    if (events.length === 0) return
    yield* request({
      method: "PUT",
      path: "/key_command/",
      body: {
        KEYLIST: events.map((event) => ({
          CODESET: event.codeSet,
          CODE: event.code,
          ACTION: event.action,
        })),
      },
    })
  })

  const sendKey = Effect.fn("VizioClient.sendKey")(function* (key: RemoteKey) {
    yield* sendRemoteEvents([remoteEvent(key)])
  })

  const sendKeys = Effect.fn("VizioClient.sendKeys")(function* (
    keys: ReadonlyArray<RemoteKey>,
  ) {
    yield* sendRemoteEvents(keys.map(remoteEvent))
  })

  const sendText = Effect.fn("VizioClient.sendText")(function* (text: string) {
    if (Array.from(text).some((character) => (character.codePointAt(0) ?? 0) > 127)) {
      return yield* new VizioInvalidParameterError({
        path: "/key_command/",
        result: "INVALID_PARAMETER",
        message: "SmartCast text entry supports ASCII characters only",
      })
    }
    yield* sendRemoteEvents(textEvents(text))
  })

  const beginPair = Effect.fn("VizioClient.beginPair")(function* (
    deviceId = config.deviceId ?? "get-air-vizio",
    deviceName = config.name ?? "Air",
  ): Effect.fn.Return<PairingChallenge, VizioError> {
    const response = yield* request({
      method: "PUT",
      path: "/pairing/start",
      auth: "none",
      body: { DEVICE_ID: deviceId, DEVICE_NAME: deviceName },
    })
    const item = yield* requireItem(response, "pairing")
    const challengeType = numberField(item, "CHALLENGE_TYPE")
    const token = numberField(item, "PAIRING_REQ_TOKEN")
    if (challengeType === undefined || token === undefined) {
      return yield* new VizioInvalidResponseError({
        path: "/pairing/start",
        message: "Pairing response is missing challenge data",
      })
    }
    return { challengeType, token }
  })

  const finishPair = Effect.fn("VizioClient.finishPair")(function* (
    challenge: PairingChallenge,
    pin: string,
    deviceId = config.deviceId ?? "get-air-vizio",
  ) {
    const response = yield* request({
      method: "PUT",
      path: "/pairing/pair",
      auth: "none",
      body: {
        DEVICE_ID: deviceId,
        CHALLENGE_TYPE: challenge.challengeType,
        RESPONSE_VALUE: pin,
        PAIRING_REQ_TOKEN: challenge.token,
      },
    })
    const item = yield* requireItem(response, "auth token")
    const token = stringField(item, "AUTH_TOKEN")
    if (token === undefined || token.length === 0) {
      return yield* new VizioInvalidResponseError({
        path: "/pairing/pair",
        message: "Pairing response is missing AUTH_TOKEN",
      })
    }
    yield* Ref.set(protocol, protocolFor(token))
    return token
  })

  const cancelPair = Effect.fn("VizioClient.cancelPair")(function* (
    deviceId = config.deviceId ?? "get-air-vizio",
    deviceName = config.name ?? "Air",
  ) {
    yield* request({
      method: "PUT",
      path: "/pairing/cancel",
      auth: "none",
      body: {
        DEVICE_ID: deviceId,
        DEVICE_NAME: deviceName,
        CHALLENGE_TYPE: 1,
        RESPONSE_VALUE: "1111",
        PAIRING_REQ_TOKEN: 0,
      },
    })
  })

  const ping = Effect.fn("VizioClient.ping")(function* () {
    yield* request({ method: "GET", path: "/state/device/deviceinfo", auth: "none" })
  })

  const pingAuth = Effect.fn("VizioClient.pingAuth")(function* () {
    yield* request({ method: "GET", path: "/state/device/power_mode" })
  })

  const getPowerState = Effect.fn("VizioClient.getPowerState")(function* () {
    const value = yield* getItemValue("/state/device/power_mode", "power_mode")
    return value === 1 || value === true || value === "On" || value === "on"
  })

  const powerOn = Effect.fn("VizioClient.powerOn")(function* () { yield* sendKey("POW_ON") })
  const powerOff = Effect.fn("VizioClient.powerOff")(function* () { yield* sendKey("POW_OFF") })
  const powerToggle = Effect.fn("VizioClient.powerToggle")(function* () { yield* sendKey("POW_TOGGLE") })

  const getSettings = Effect.fn("VizioClient.getSettings")(function* (category: string) {
    const response = yield* request({ method: "GET", path: `${ROOT}/${category}` })
    return yield* Effect.forEach(responseItems(response), (item) => parseSetting(category, item))
  })

  const getSetting = Effect.fn("VizioClient.getSetting")(function* (category: string, name: string) {
    const response = yield* request({ method: "GET", path: `${ROOT}/${category}/${name}` })
    const item = yield* requireItem(response, name)
    return yield* parseSetting(category, item)
  })

  const getSettingTypes = Effect.fn("VizioClient.getSettingTypes")(function* () {
    const response = yield* request({ method: "GET", path: ROOT })
    return responseItems(response).flatMap((item) => {
      const name = stringField(item, "CNAME")
      return name === undefined ? [] : [name]
    })
  })

  const getSettingOptions = Effect.fn("VizioClient.getSettingOptions")(function* (
    category: string,
    name: string,
  ) {
    const response = yield* request({ method: "GET", path: `${STATIC_ROOT}/${category}` })
    const item = responseItems(response).find((candidate) =>
      (stringField(candidate, "CNAME") ?? "").toLowerCase() === name.toLowerCase())
    return item === undefined ? [] : optionNames(item)
  })

  const putSetting = Effect.fn("VizioClient.putSetting")(function* (
    category: string,
    name: string,
    value: SettingValue,
    hashValue: number,
  ) {
    yield* request({
      method: "PUT",
      path: `${ROOT}/${category}/${name}`,
      body: { REQUEST: "MODIFY", VALUE: value, HASHVAL: hashValue },
    })
  })

  const setSetting = Effect.fn("VizioClient.setSetting")(function* (
    category: string,
    name: string,
    value: SettingValue,
  ) {
    const current = yield* getSetting(category, name)
    yield* validateSettingValue(current, value)
    yield* putSetting(category, name, value, current.hashValue).pipe(
      Effect.catchTag("VizioInvalidParameterError", () =>
        getSetting(category, name).pipe(
          Effect.flatMap((fresh) => putSetting(category, name, value, fresh.hashValue)),
        )),
    )
  })

  const triggerSettingAction = Effect.fn("VizioClient.triggerSettingAction")(function* (
    category: string,
    name: string,
  ) {
    const setting = yield* getSetting(category, name)
    yield* request({
      method: "PUT",
      path: `${ROOT}/${category}/${name}`,
      body: { REQUEST: "ACTION", HASHVAL: setting.hashValue },
    })
  })

  const blankScreen = Effect.fn("VizioClient.blankScreen")(function* () {
    yield* triggerSettingAction("system/timers", "blank_screen")
  })

  const getVolume = Effect.fn("VizioClient.getVolume")(function* () {
    const setting = yield* getSetting("audio", "volume")
    return typeof setting.value === "number" ? setting.value : Number(setting.value)
  })

  const setVolume = Effect.fn("VizioClient.setVolume")(function* (level: number) {
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return yield* new VizioInvalidParameterError({
        path: "/audio/volume/level",
        result: "VALUE_OUT_OF_RANGE",
        message: "TV volume must be an integer between 0 and 100",
      })
    }
    yield* request({ method: "PUT", path: "/audio/volume/level", body: { VALUE: level } })
  })

  const volumeUp = Effect.fn("VizioClient.volumeUp")(function* (steps = 1) {
    yield* sendKeys(Array.from({ length: Math.max(1, steps) }, () => "VOL_UP" as const))
  })
  const volumeDown = Effect.fn("VizioClient.volumeDown")(function* (steps = 1) {
    yield* sendKeys(Array.from({ length: Math.max(1, steps) }, () => "VOL_DOWN" as const))
  })

  const isMuted = Effect.fn("VizioClient.isMuted")(function* () {
    const setting = yield* getSetting("audio", "mute")
    return setting.value === true || setting.value === 1 ||
      (typeof setting.value === "string" && setting.value.toLowerCase() === "on")
  })
  const mute = Effect.fn("VizioClient.mute")(function* () { if (!(yield* isMuted())) yield* sendKey("MUTE_TOGGLE") })
  const unmute = Effect.fn("VizioClient.unmute")(function* () { if (yield* isMuted()) yield* sendKey("MUTE_TOGGLE") })
  const muteToggle = Effect.fn("VizioClient.muteToggle")(function* () { yield* sendKey("MUTE_TOGGLE") })

  const getCurrentInputState = Effect.fn("VizioClient.getCurrentInputState")(function* () {
    const response = yield* request({ method: "GET", path: `${ROOT}/devices/current_input` })
    const item = yield* requireItem(response, "current_input")
    const value = stringField(item, "VALUE")
    const hashValue = numberField(item, "HASHVAL")
    if (value === undefined || hashValue === undefined) {
      return yield* new VizioInvalidResponseError({
        path: `${ROOT}/devices/current_input`,
        message: "Current input response is missing VALUE or HASHVAL",
      })
    }
    return { value, hashValue }
  })

  const getCurrentInput = Effect.fn("VizioClient.getCurrentInput")(function* () {
    return (yield* getCurrentInputState()).value
  })

  const getInputs = Effect.fn("VizioClient.getInputs")(function* () {
    const current = yield* getCurrentInput()
    const response = yield* request({ method: "GET", path: `${ROOT}/devices/name_input` })
    return responseItems(response).flatMap((item): ReadonlyArray<InputInfo> => {
      const cname = stringField(item, "CNAME")
      const name = stringField(item, "NAME")
      if (cname === undefined || name === undefined) return []
      const value = recordField(item, "VALUE")
      const metaName = value === undefined
        ? ""
        : stringField(value, "NAME") ?? stringField(value, "METADATA") ?? ""
      const hashValue = numberField(item, "HASHVAL")
      const names = [cname, name, metaName].map((candidate) => candidate.toLowerCase())
      return [{
        cname,
        name,
        metaName,
        current: names.includes(current.toLowerCase()),
        ...(hashValue === undefined ? {} : { hashValue }),
      }]
    })
  })

  const setInput = Effect.fn("VizioClient.setInput")(function* (input: string) {
    const inputs = yield* getInputs()
    const normalized = input.trim().toLowerCase()
    const matches = inputs.filter((candidate) =>
      [candidate.cname, candidate.name, candidate.metaName]
        .some((value) => value.length > 0 && value.toLowerCase() === normalized))
    if (matches.length !== 1) {
      return yield* new VizioInvalidInputError({
        input,
        candidates: inputs.flatMap((candidate) => [candidate.cname, candidate.name, candidate.metaName].filter(Boolean)),
        message: matches.length === 0 ? `Unknown TV input ${input}` : `TV input ${input} is ambiguous`,
      })
    }
    const target = matches[0]
    if (target === undefined || target.current) return
    const current = yield* getCurrentInputState()
    yield* request({
      method: "PUT",
      path: `${ROOT}/devices/current_input`,
      body: { REQUEST: "MODIFY", VALUE: target.cname, HASHVAL: current.hashValue },
    })
  })

  const nextInput = Effect.fn("VizioClient.nextInput")(function* () { yield* sendKey("INPUT_NEXT") })
  const channelUp = Effect.fn("VizioClient.channelUp")(function* () { yield* sendKey("CH_UP") })
  const channelDown = Effect.fn("VizioClient.channelDown")(function* () { yield* sendKey("CH_DOWN") })
  const previousChannel = Effect.fn("VizioClient.previousChannel")(function* () { yield* sendKey("CH_PREV") })

  const launchAppConfig = Effect.fn("VizioClient.launchAppConfig")(function* (app: AppConfig) {
    yield* request({
      method: "PUT",
      path: "/app/launch",
      body: {
        VALUE: {
          APP_ID: app.appId,
          NAME_SPACE: app.nameSpace,
          ...(app.message === undefined ? {} : { MESSAGE: app.message }),
        },
      },
    })
  })

  const getApps = Effect.fn("VizioClient.getApps")(function* () {
    return yield* Ref.get(appCatalog)
  })

  const setAppCatalog = Effect.fn("VizioClient.setAppCatalog")(function* (apps: ReadonlyArray<AppRecord>) {
    yield* Ref.set(appCatalog, apps)
    if (Option.isSome(cache)) {
      yield* cache.value.client.set("catalog", JSON.stringify(apps), {
        ttlMillis: 24 * 60 * 60 * 1_000,
      }).pipe(
        Effect.provideService(CacheStoreService, cache.value.store),
        Effect.ignore,
      )
    }
  })

  const fetchCloudJson = Effect.fn("VizioClient.fetchCloudJson")(function* (url: string) {
    const response = yield* Effect.tryPromise({
      try: (signal) => transport.fetch(new Request(url, { headers: { accept: "application/json" }, signal })),
      catch: (cause) => new VizioTransportError({
        method: "GET",
        url,
        message: unknownMessage(cause),
        retryable: true,
      }),
    })
    if (!response.ok) {
      return yield* new VizioHttpStatusError({
        method: "GET",
        url,
        status: response.status,
        message: `Vizio app catalog request failed with HTTP ${response.status}`,
      })
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new VizioInvalidResponseError({ path: url, message: unknownMessage(cause) }),
    })
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) => new VizioInvalidResponseError({ path: url, message: unknownMessage(cause) }),
    })
  })

  const refreshAppCatalog = Effect.fn("VizioClient.refreshAppCatalog")(function* () {
    const [catalogDocument, availabilityDocument] = yield* Effect.all([
      fetchCloudJson(VIZIO_APP_CATALOG_URL),
      fetchCloudJson(VIZIO_APP_AVAILABILITY_URL),
    ], { concurrency: 2 })
    const apps = parseRemoteAppCatalog(catalogDocument, availabilityDocument)
    if (apps.length === 0) {
      return yield* new VizioInvalidResponseError({
        path: VIZIO_APP_CATALOG_URL,
        message: "Vizio app catalog did not contain any recognizable apps",
      })
    }
    yield* setAppCatalog(apps)
    return apps
  })

  const launchApp = Effect.fn("VizioClient.launchApp")(function* (name: string) {
    const apps = yield* getApps()
    const app = apps.find((candidate) => candidate.name.toLowerCase() === name.trim().toLowerCase())
    const appConfig = app?.configs[0]
    if (appConfig === undefined) {
      return yield* new VizioInvalidParameterError({
        path: "/app/launch",
        result: "INVALID_PARAMETER",
        message: `Unknown app ${name}; use launchAppConfig for an explicit Vizio app id`,
      })
    }
    yield* launchAppConfig(appConfig)
  })

  const launchConjureUrl = Effect.fn("VizioClient.launchConjureUrl")(function* (
    url: string | URL,
    options: { readonly debug?: boolean } = {},
  ) {
    const parsed = yield* Effect.try({
      try: () => new URL(String(url)),
      catch: (cause) => new VizioInvalidParameterError({
        path: "/app/launch",
        result: "INVALID_PARAMETER",
        message: `Invalid Conjure URL: ${unknownMessage(cause)}`,
      }),
    })
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return yield* new VizioInvalidParameterError({
        path: "/app/launch",
        result: "INVALID_PARAMETER",
        message: "Conjure apps must use an HTTP or HTTPS URL reachable by the TV",
      })
    }
    yield* request({
      method: "PUT",
      path: "/app/launch",
      body: {
        VALUE: {
          APP_ID: "17",
          NAME_SPACE: 4,
          MESSAGE: parsed.toString(),
          ...(options.debug === true ? { DEBUG: 1 } : {}),
        },
      },
    })
  })

  const getCurrentAppConfig = Effect.fn("VizioClient.getCurrentAppConfig")(function* () {
    const response = yield* request({ method: "GET", path: "/app/current" })
    const item = responseItem(response)
    const value = item === undefined ? undefined : recordField(item, "VALUE")
    if (value === undefined) return Option.none<AppConfig>()
    const appId = stringField(value, "APP_ID")
    const nameSpace = numberField(value, "NAME_SPACE")
    if (appId === undefined || nameSpace === undefined) {
      return yield* new VizioInvalidResponseError({
        path: "/app/current",
        message: "Current app response is missing APP_ID or NAME_SPACE",
      })
    }
    const message = stringField(value, "MESSAGE")
    return Option.some({ appId, nameSpace, ...(message === undefined ? {} : { message }) })
  })

  const getCurrentApp = Effect.fn("VizioClient.getCurrentApp")(function* () {
    const current = yield* getCurrentAppConfig()
    if (Option.isNone(current)) return Option.none<string>()
    const apps = yield* getApps()
    return Option.fromNullable(apps.find((app) => app.configs.some((candidate) =>
      candidate.appId === current.value.appId && candidate.nameSpace === current.value.nameSpace))?.name)
  })

  const getDeviceInfo = Effect.fn("VizioClient.getDeviceInfo")(function* (): Effect.fn.Return<DeviceInfo, VizioError> {
    const response = yield* request({ method: "GET", path: "/state/device/deviceinfo", auth: "none" })
    const item = responseItems(response)[0] ?? responseItem(response)
    const value = item === undefined ? undefined : recordField(item, "VALUE")
    if (value === undefined) {
      return yield* new VizioInvalidResponseError({
        path: "/state/device/deviceinfo",
        message: "Device info response is missing VALUE",
      })
    }
    return {
      name: stringField(value, "CAST_NAME") ?? stringField(value, "NAME") ?? "Vizio TV",
      model: stringField(value, "MODEL_NAME") ?? "",
      serialNumber: stringField(value, "SERIAL_NUMBER") ?? "",
      esn: stringField(value, "ESN") ?? "",
      version: stringField(value, "VERSION") ?? stringField(value, "FIRMWARE_VERSION") ?? "",
      chipset: stringField(value, "CHIPSET") ?? "",
      raw: value,
    }
  })

  const getIdentityValue = Effect.fn("VizioClient.getIdentityValue")(function* (
    item: string,
    paths: ReadonlyArray<string>,
  ) {
    let lastPath = paths[0] ?? ROOT
    for (const path of paths) {
      lastPath = path
      const attempt = yield* Effect.either(getItemValue(path, item))
      if (attempt._tag === "Right") {
        const value = attempt.right
        if (typeof value === "string") return value
      }
    }
    return yield* new VizioItemNotFoundError({
      path: lastPath,
      item,
      message: `TV did not expose ${item} on any known firmware path`,
    })
  })

  const identity = (method: string, item: string, section: string) =>
    Effect.fn(`VizioClient.${method}`)(function* () {
      return yield* getIdentityValue(item, [
        `${ROOT}/admin_and_privacy/system_information/${section}/${item}`,
        `${ROOT}/system/system_information/${section}/${item}`,
      ])
    })
  const getSerialNumber = identity("getSerialNumber", "serial_number", "tv_information")
  const getEsn = identity("getEsn", "esn", "uli_information")
  const getVersion = identity("getVersion", "version", "tv_information")

  const getSystemVersions = Effect.fn("VizioClient.getSystemVersions")(function* () {
    return (yield* request({ method: "GET", path: "/system/versions" })).raw
  })

  const isPinDefault = Effect.fn("VizioClient.isPinDefault")(function* () {
    const response = yield* request({ method: "GET", path: "/pin/is_pin_default" })
    const item = responseItem(response) ?? responseItems(response)[0]
    return item === undefined ? false : booleanField(item, "VALUE") ?? false
  })

  const getStateExtended = Effect.fn("VizioClient.getStateExtended")(function* (): Effect.fn.Return<StateSnapshot, VizioError> {
    const response = yield* request({ method: "GET", path: "/state_extended", allowStatusless: true })
    const raw = response.raw
    const power = recordField(raw, "POWER_STATUS")
    const input = recordField(raw, "CURRENT_INPUT")
    const app = recordField(raw, "CURRENT_APP")
    const appValue = app === undefined ? undefined : recordField(app, "VALUE") ?? app
    const appId = appValue === undefined ? undefined : stringField(appValue, "APP_ID")
    const nameSpace = appValue === undefined ? undefined : numberField(appValue, "NAME_SPACE")
    const message = appValue === undefined ? undefined : stringField(appValue, "MESSAGE")
    const currentApp = appId === undefined || nameSpace === undefined
      ? undefined
      : { appId, nameSpace, ...(message === undefined ? {} : { message }) }
    const powerValue = power === undefined ? undefined : field(power, "VALUE")
    const powerOn = powerValue === undefined ? undefined : powerValue === 1 || powerValue === true
    const currentInput = input === undefined
      ? undefined
      : stringField(input, "VALUE") ?? stringField(input, "NAME")
    const powerMode = power === undefined ? undefined : stringField(power, "NAME")
    const screenMode = stringField(raw, "SCREEN_MODE")
    const mediaState = stringField(raw, "MEDIA_STATE")
    return {
      raw,
      ...(powerOn === undefined ? {} : { powerOn }),
      ...(powerMode === undefined ? {} : { powerMode }),
      ...(currentInput === undefined ? {} : { currentInput }),
      ...(currentApp === undefined ? {} : { currentApp }),
      ...(screenMode === undefined ? {} : { screenMode }),
      ...(mediaState === undefined ? {} : { mediaState }),
    }
  })

  const getState = Effect.fn("VizioClient.getState")(function* () {
    return yield* getStateExtended().pipe(
      Effect.catchTag("VizioEndpointNotFoundError", () =>
        Effect.all({
          powerOn: getPowerState(),
          currentInput: getCurrentInput(),
          currentApp: getCurrentAppConfig(),
        }).pipe(
          Effect.map(({ currentApp, ...state }) => ({
            ...state,
            ...(Option.isSome(currentApp) ? { currentApp: currentApp.value } : {}),
            raw: {},
          })),
        )),
    )
  })

  return {
    host,
    availableKeys: Object.keys(REMOTE_KEYS) as ReadonlyArray<RemoteKey>,
    request,
    beginPair,
    finishPair,
    cancelPair,
    ping,
    pingAuth,
    getPowerState,
    powerOn,
    powerOff,
    powerToggle,
    getVolume,
    setVolume,
    volumeUp,
    volumeDown,
    isMuted,
    mute,
    unmute,
    muteToggle,
    getInputs,
    getCurrentInput,
    setInput,
    nextInput,
    channelUp,
    channelDown,
    previousChannel,
    sendKey,
    sendKeys,
    sendRemoteEvents,
    sendText,
    getSettingTypes,
    getSettings,
    getSetting,
    getSettingOptions,
    setSetting,
    triggerSettingAction,
    blankScreen,
    getApps,
    setAppCatalog,
    refreshAppCatalog,
    launchApp,
    launchAppConfig,
    launchConjureUrl,
    getCurrentApp,
    getCurrentAppConfig,
    getDeviceInfo,
    getSerialNumber,
    getEsn,
    getVersion,
    getSystemVersions,
    isPinDefault,
    getState,
    getStateExtended,
  }
})

export type VizioClientShape = Effect.Effect.Success<ReturnType<typeof makeVizioClient>>
export type VizioClientError = VizioError

export class VizioClient extends Effect.Service<VizioClient>()("@get-air/vizio/VizioClient", {
  accessors: true,
  effect: makeVizioClient,
}) {
  static readonly layer = (
    config: TvConfig,
    options: VizioClientOptions = {},
  ): Layer.Layer<VizioClient, VizioInvalidConfigError> =>
    VizioClient.Default(config, options)
}

export const isEndpointUnavailable = (error: VizioError): error is VizioEndpointNotFoundError =>
  error._tag === "VizioEndpointNotFoundError"
