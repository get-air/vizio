import { Schema } from "effect"

export const TvProfileId = Schema.String.pipe(Schema.brand("@get-air/vizio/TvProfileId"))
export type TvProfileId = Schema.Schema.Type<typeof TvProfileId>

export const SettingValue = Schema.Union(Schema.String, Schema.Number, Schema.Boolean)
export type SettingValue = Schema.Schema.Type<typeof SettingValue>

export const TvConfig = Schema.Struct({
  host: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.optional(Schema.String),
  authToken: Schema.optional(Schema.String),
  deviceId: Schema.optional(Schema.String),
  timeoutMillis: Schema.optional(Schema.Number.pipe(Schema.positive())),
})
export type TvConfig = Schema.Schema.Type<typeof TvConfig>

export const PairingChallenge = Schema.Struct({
  challengeType: Schema.Number,
  token: Schema.Number,
})
export type PairingChallenge = Schema.Schema.Type<typeof PairingChallenge>

export const AppConfig = Schema.Struct({
  appId: Schema.String,
  nameSpace: Schema.Number,
  message: Schema.optional(Schema.String),
})
export type AppConfig = Schema.Schema.Type<typeof AppConfig>

export const AppRecord = Schema.Struct({
  name: Schema.String,
  countries: Schema.Array(Schema.String),
  configs: Schema.Array(AppConfig),
})
export type AppRecord = Schema.Schema.Type<typeof AppRecord>

export const InputInfo = Schema.Struct({
  cname: Schema.String,
  name: Schema.String,
  metaName: Schema.String,
  current: Schema.Boolean,
  hashValue: Schema.optional(Schema.Number),
})
export type InputInfo = Schema.Schema.Type<typeof InputInfo>

export const SettingKind = Schema.Literal(
  "T_VALUE_V1",
  "T_LIST_V1",
  "T_LIST_X_V1",
  "T_VALUE_ABS_V1",
  "T_MENU_V1",
  "T_ACTION_V1",
  "UNKNOWN",
)
export type SettingKind = Schema.Schema.Type<typeof SettingKind>

export const SettingInfo = Schema.Struct({
  category: Schema.String,
  name: Schema.String,
  displayName: Schema.String,
  value: SettingValue,
  hashValue: Schema.Number,
  kind: SettingKind,
  minimum: Schema.optional(Schema.Number),
  maximum: Schema.optional(Schema.Number),
  center: Schema.optional(Schema.Number),
  options: Schema.Array(Schema.String),
})
export type SettingInfo = Schema.Schema.Type<typeof SettingInfo>

export const DeviceInfo = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  serialNumber: Schema.String,
  esn: Schema.String,
  version: Schema.String,
  chipset: Schema.String,
  raw: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type DeviceInfo = Schema.Schema.Type<typeof DeviceInfo>

export const StateSnapshot = Schema.Struct({
  powerOn: Schema.optional(Schema.Boolean),
  powerMode: Schema.optional(Schema.String),
  currentInput: Schema.optional(Schema.String),
  currentApp: Schema.optional(AppConfig),
  screenMode: Schema.optional(Schema.String),
  mediaState: Schema.optional(Schema.String),
  raw: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})
export type StateSnapshot = Schema.Schema.Type<typeof StateSnapshot>

export const StoredTvProfile = Schema.Struct({
  id: TvProfileId,
  alias: Schema.String.pipe(Schema.minLength(1)),
  host: Schema.String.pipe(Schema.minLength(1)),
  authToken: Schema.optional(Schema.String),
  deviceId: Schema.String,
  deviceName: Schema.String,
  model: Schema.optional(Schema.String),
  macAddress: Schema.optional(Schema.String),
  lastSeenMillis: Schema.optional(Schema.Number),
})
export type StoredTvProfile = Schema.Schema.Type<typeof StoredTvProfile>

export const RemoteAction = Schema.Literal("KEYPRESS", "KEYDOWN", "KEYUP")
export type RemoteAction = Schema.Schema.Type<typeof RemoteAction>

export const RemoteEvent = Schema.Struct({
  codeSet: Schema.Number,
  code: Schema.Number,
  action: RemoteAction,
})
export type RemoteEvent = Schema.Schema.Type<typeof RemoteEvent>
