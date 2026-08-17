import type { HttpTransport } from "@get-air/http"
import { Effect, Either, Option } from "effect"
import {
  makeVizioClient,
  type RawVizioRequest,
  type VizioClientOptions,
  type VizioClientShape,
} from "./Client.js"
import type { VizioError } from "./Errors.js"
import { makeVizioProfileStore, type VizioPersistence } from "./Persistence.js"
import type { RemoteKey } from "./Remote.js"
import type {
  AppConfig,
  AppRecord,
  DeviceInfo,
  InputInfo,
  PairingChallenge,
  RemoteEvent,
  SettingInfo,
  SettingValue,
  StateSnapshot,
  StoredTvProfile,
  TvConfig,
} from "./Schemas.js"

export interface PublicVizioError extends Error {
  readonly _tag: VizioError["_tag"]
  readonly path?: string
  readonly url?: string
  readonly status?: number
  readonly retryable?: boolean
  readonly result?: string
  readonly input?: string
  readonly candidates?: ReadonlyArray<string>
}

export const isVizioError = (value: unknown): value is PublicVizioError =>
  value instanceof Error && "_tag" in value && typeof value._tag === "string"

const publicError = (failure: VizioError): PublicVizioError => {
  const error = new Error(failure.message) as PublicVizioError
  error.name = failure._tag
  Object.assign(error, failure)
  return error
}

const run = async <A>(effect: Effect.Effect<A, VizioError>): Promise<A> => {
  const result = await Effect.runPromise(Effect.either(effect))
  if (Either.isLeft(result)) throw publicError(result.left)
  return result.right
}

/** Promise facade over the single Effect SmartCast implementation. */
export class Vizio {
  private constructor(private readonly client: VizioClientShape) {}

  static async connect(config: TvConfig, options: VizioClientOptions = {}): Promise<Vizio> {
    return new Vizio(await run(makeVizioClient(config, options)))
  }

  get host(): string { return this.client.host }
  get availableKeys(): ReadonlyArray<RemoteKey> { return this.client.availableKeys }

  request(input: RawVizioRequest) { return run(this.client.request(input)) }
  beginPair(deviceId?: string, deviceName?: string) { return run(this.client.beginPair(deviceId, deviceName)) }
  finishPair(challenge: PairingChallenge, pin: string, deviceId?: string) {
    return run(this.client.finishPair(challenge, pin, deviceId))
  }
  cancelPair(deviceId?: string, deviceName?: string) { return run(this.client.cancelPair(deviceId, deviceName)) }
  ping() { return run(this.client.ping()) }
  pingAuth() { return run(this.client.pingAuth()) }
  getPowerState() { return run(this.client.getPowerState()) }
  powerOn() { return run(this.client.powerOn()) }
  powerOff() { return run(this.client.powerOff()) }
  powerToggle() { return run(this.client.powerToggle()) }
  getVolume() { return run(this.client.getVolume()) }
  setVolume(level: number) { return run(this.client.setVolume(level)) }
  volumeUp(steps?: number) { return run(this.client.volumeUp(steps)) }
  volumeDown(steps?: number) { return run(this.client.volumeDown(steps)) }
  isMuted() { return run(this.client.isMuted()) }
  mute() { return run(this.client.mute()) }
  unmute() { return run(this.client.unmute()) }
  muteToggle() { return run(this.client.muteToggle()) }
  getInputs(): Promise<ReadonlyArray<InputInfo>> { return run(this.client.getInputs()) }
  getCurrentInput() { return run(this.client.getCurrentInput()) }
  setInput(input: string) { return run(this.client.setInput(input)) }
  nextInput() { return run(this.client.nextInput()) }
  channelUp() { return run(this.client.channelUp()) }
  channelDown() { return run(this.client.channelDown()) }
  previousChannel() { return run(this.client.previousChannel()) }
  sendKey(key: RemoteKey) { return run(this.client.sendKey(key)) }
  sendKeys(keys: ReadonlyArray<RemoteKey>) { return run(this.client.sendKeys(keys)) }
  sendRemoteEvents(events: ReadonlyArray<RemoteEvent>) { return run(this.client.sendRemoteEvents(events)) }
  sendText(text: string) { return run(this.client.sendText(text)) }
  getSettingTypes() { return run(this.client.getSettingTypes()) }
  getSettings(category: string): Promise<ReadonlyArray<SettingInfo>> { return run(this.client.getSettings(category)) }
  getSetting(category: string, name: string) { return run(this.client.getSetting(category, name)) }
  getSettingOptions(category: string, name: string) { return run(this.client.getSettingOptions(category, name)) }
  setSetting(category: string, name: string, value: SettingValue) {
    return run(this.client.setSetting(category, name, value))
  }
  triggerSettingAction(category: string, name: string) {
    return run(this.client.triggerSettingAction(category, name))
  }
  blankScreen() { return run(this.client.blankScreen()) }
  getApps(): Promise<ReadonlyArray<AppRecord>> { return run(this.client.getApps()) }
  setAppCatalog(apps: ReadonlyArray<AppRecord>) { return run(this.client.setAppCatalog(apps)) }
  refreshAppCatalog(): Promise<ReadonlyArray<AppRecord>> { return run(this.client.refreshAppCatalog()) }
  launchApp(name: string) { return run(this.client.launchApp(name)) }
  launchAppConfig(app: AppConfig) { return run(this.client.launchAppConfig(app)) }
  launchConjureUrl(url: string | URL, options?: { readonly debug?: boolean }) {
    return run(this.client.launchConjureUrl(url, options))
  }
  async getCurrentApp(): Promise<string | undefined> {
    return Option.getOrUndefined(await run(this.client.getCurrentApp()))
  }
  async getCurrentAppConfig(): Promise<AppConfig | undefined> {
    return Option.getOrUndefined(await run(this.client.getCurrentAppConfig()))
  }
  getDeviceInfo(): Promise<DeviceInfo> { return run(this.client.getDeviceInfo()) }
  getSerialNumber() { return run(this.client.getSerialNumber()) }
  getEsn() { return run(this.client.getEsn()) }
  getVersion() { return run(this.client.getVersion()) }
  getSystemVersions() { return run(this.client.getSystemVersions()) }
  isPinDefault() { return run(this.client.isPinDefault()) }
  getState(): Promise<StateSnapshot> { return run(this.client.getState()) }
  getStateExtended(): Promise<StateSnapshot> { return run(this.client.getStateExtended()) }
}

export interface CreateVizioOptions extends VizioClientOptions {
  readonly config: TvConfig
}

export const createVizio = (options: CreateVizioOptions): Promise<Vizio> =>
  Vizio.connect(options.config, options)

export class VizioProfiles {
  private readonly store

  constructor(persistence: VizioPersistence) {
    this.store = makeVizioProfileStore(persistence)
  }

  list(): Promise<ReadonlyArray<StoredTvProfile>> { return run(this.store.list()) }
  get(idOrAlias: string): Promise<StoredTvProfile | undefined> { return run(this.store.get(idOrAlias)) }
  set(profile: StoredTvProfile): Promise<void> { return run(this.store.set(profile)) }
  remove(idOrAlias: string): Promise<void> { return run(this.store.remove(idOrAlias)) }
  getDefault(): Promise<StoredTvProfile | undefined> { return run(this.store.getDefault()) }
  setDefault(profileId: string): Promise<void> { return run(this.store.setDefault(profileId)) }
}

export type { HttpTransport, VizioClientOptions }
