import type { HttpTransport } from "@get-air/http"
import { Effect } from "effect"
import {
  VizioAuthError,
  VizioBusyError,
  VizioEndpointNotFoundError,
  VizioHttpStatusError,
  VizioInvalidParameterError,
  VizioInvalidResponseError,
  VizioTimeoutError,
  VizioTransportError,
  type VizioRequestError,
} from "./Errors.js"

export type JsonRecord = Record<string, unknown>
export type RequestAuth = "none" | "required"

export interface ProtocolRequest {
  readonly method: "GET" | "PUT"
  readonly path: string
  readonly body?: unknown
  readonly auth?: RequestAuth
  readonly allowStatusless?: boolean
}

export interface ProtocolResponse {
  readonly status: string
  readonly detail: string
  readonly raw: JsonRecord
}

export interface ProtocolClientOptions {
  readonly host: string
  readonly authToken?: string
  readonly timeoutMillis: number
  readonly transport: HttpTransport
}

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined

export const field = (value: JsonRecord, key: string): unknown => {
  const found = Object.keys(value).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
  return found === undefined ? undefined : value[found]
}

export const stringField = (value: JsonRecord, key: string): string | undefined => {
  const candidate = field(value, key)
  return typeof candidate === "string" ? candidate : undefined
}

export const numberField = (value: JsonRecord, key: string): number | undefined => {
  const candidate = field(value, key)
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined
}

export const booleanField = (value: JsonRecord, key: string): boolean | undefined => {
  const candidate = field(value, key)
  if (typeof candidate === "boolean") return candidate
  if (candidate === "TRUE" || candidate === "true" || candidate === 1) return true
  if (candidate === "FALSE" || candidate === "false" || candidate === 0) return false
  return undefined
}

export const recordField = (value: JsonRecord, key: string): JsonRecord | undefined =>
  record(field(value, key))

export const recordsField = (value: JsonRecord, key: string): ReadonlyArray<JsonRecord> => {
  const candidate = field(value, key)
  if (!Array.isArray(candidate)) return []
  const records: JsonRecord[] = []
  for (const item of candidate) {
    const parsed = record(item)
    if (parsed !== undefined) records.push(parsed)
  }
  return records
}

export const responseItem = (response: ProtocolResponse): JsonRecord | undefined =>
  recordField(response.raw, "ITEM")

export const responseItems = (response: ProtocolResponse): ReadonlyArray<JsonRecord> =>
  recordsField(response.raw, "ITEMS")

const normalizeHost = (host: string): string => {
  const trimmed = host.trim().replace(/^https?:\/\//iu, "").replace(/\/$/u, "")
  return trimmed.includes(":") ? trimmed : `${trimmed}:7345`
}

const parseJson = (text: string, path: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new VizioInvalidResponseError({
      path,
      message: `TV returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    }),
  }).pipe(
    Effect.flatMap((value) => {
      const parsed = record(value)
      return parsed === undefined
        ? Effect.fail(new VizioInvalidResponseError({ path, message: "TV response must be a JSON object" }))
        : Effect.succeed(parsed)
    }),
  )

const checkProtocolStatus = (
  path: string,
  raw: JsonRecord,
): Effect.Effect<ProtocolResponse, VizioRequestError> => {
  const statusRecord = recordField(raw, "STATUS")
  if (statusRecord === undefined) {
    return Effect.fail(new VizioInvalidResponseError({
      path,
      message: "TV response is missing STATUS",
    }))
  }
  const result = (stringField(statusRecord, "RESULT") ?? "UNKNOWN").toUpperCase()
  const detail = stringField(statusRecord, "DETAIL") ?? result
  if (result === "SUCCESS") return Effect.succeed({ status: result, detail, raw })
  if (result === "REQUIRES_PAIRING" || result === "PAIRING_DENIED" || result === "CHALLENGE_INCORRECT") {
    return Effect.fail(new VizioAuthError({ path, message: detail }))
  }
  if (result === "INVALID_PARAMETER" || result === "HASHVAL_ERROR" || result === "VALUE_OUT_OF_RANGE") {
    return Effect.fail(new VizioInvalidParameterError({ path, result, message: detail }))
  }
  if (result === "URI_NOT_FOUND") {
    return Effect.fail(new VizioEndpointNotFoundError({ path, message: detail }))
  }
  if (result === "BLOCKED" || result === "MAX_CHALLENGES_EXCEEDED") {
    return Effect.fail(new VizioBusyError({ path, result, message: detail }))
  }
  return Effect.fail(new VizioInvalidResponseError({
    path,
    message: `TV rejected the request with ${result}: ${detail}`,
  }))
}

export const makeProtocolClient = (options: ProtocolClientOptions) => {
  const baseUrl = `https://${normalizeHost(options.host)}`

  const request = Effect.fn("VizioProtocol.request")(function* (
    input: ProtocolRequest,
  ): Effect.fn.Return<ProtocolResponse, VizioRequestError> {
    const auth = input.auth ?? "required"
    if (auth === "required" && (options.authToken === undefined || options.authToken.length === 0)) {
      return yield* new VizioAuthError({
        path: input.path,
        message: "This SmartCast endpoint requires a pairing token",
      })
    }

    const url = `${baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}`
    const headers = new Headers({ accept: "application/json", "content-type": "application/json" })
    if (auth === "required" && options.authToken !== undefined) headers.set("AUTH", options.authToken)
    const network = Effect.tryPromise({
      try: (signal) => options.transport.fetch(new Request(url, {
        method: input.method,
        headers,
        signal,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      })),
      catch: (cause) => new VizioTransportError({
        method: input.method,
        url,
        message: cause instanceof Error ? cause.message : String(cause),
        retryable: true,
      }),
    }).pipe(
      Effect.timeoutFail({
        duration: options.timeoutMillis,
        onTimeout: () => new VizioTimeoutError({
          method: input.method,
          url,
          timeoutMillis: options.timeoutMillis,
          message: `Vizio request timed out after ${options.timeoutMillis}ms`,
        }),
      }),
    )

    const response = yield* network
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return yield* new VizioAuthError({
          path: input.path,
          message: `TV rejected the pairing token with HTTP ${response.status}`,
        })
      }
      return yield* new VizioHttpStatusError({
        method: input.method,
        url,
        status: response.status,
        message: `Vizio request failed with HTTP ${response.status}`,
      })
    }
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => new VizioInvalidResponseError({
        path: input.path,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    })
    const raw = yield* parseJson(text, input.path)
    if (input.allowStatusless === true && recordField(raw, "STATUS") === undefined) {
      return { status: "SUCCESS", detail: "Success", raw }
    }
    return yield* checkProtocolStatus(input.path, raw)
  })

  return { baseUrl, request }
}
