import type { HttpTransport } from "@get-air/http"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { makeVizioClient } from "../src/Client.js"

interface CapturedRequest {
  readonly url: string
  readonly method: string
  readonly auth?: string
  readonly body: unknown
}

const success = (extra: Record<string, unknown> = {}) => ({
  STATUS: { RESULT: "SUCCESS", DETAIL: "Success" },
  ...extra,
})

const item = (cname: string, value: unknown, hashValue = 1, extra: Record<string, unknown> = {}) => ({
  CNAME: cname,
  NAME: cname,
  TYPE: "T_VALUE_V1",
  VALUE: value,
  HASHVAL: hashValue,
  ...extra,
})

const mockTransport = (payloads: ReadonlyArray<unknown>) => {
  const requests: Array<CapturedRequest> = []
  let index = 0
  const transport: HttpTransport = {
    fetch: async (request) => {
      const bodyText = request.method === "GET" ? "" : await request.text()
      const auth = request.headers.get("AUTH")
      requests.push({
        url: request.url,
        method: request.method,
        body: bodyText.length === 0 ? undefined : JSON.parse(bodyText) as unknown,
        ...(auth === null ? {} : { auth }),
      })
      const payload = payloads[index]
      index += 1
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  }
  return { transport, requests }
}

describe("Vizio Effect client", () => {
  it("pairs and immediately uses the returned token", async () => {
    const mock = mockTransport([
      success({ ITEM: { CHALLENGE_TYPE: 1, PAIRING_REQ_TOKEN: 42 } }),
      success({ ITEM: { AUTH_TOKEN: "secret-token" } }),
      success(),
    ])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient({ host: "192.168.1.10" }, { transport: mock.transport })
      const challenge = yield* client.beginPair("air-device", "Air")
      expect(challenge).toEqual({ challengeType: 1, token: 42 })
      expect(yield* client.finishPair(challenge, "1234", "air-device")).toBe("secret-token")
      yield* client.powerOff()
    })
    await Effect.runPromise(program)
    expect(mock.requests[0]?.url).toBe("https://192.168.1.10:7345/pairing/start")
    expect(mock.requests[0]?.auth).toBeUndefined()
    expect(mock.requests[2]?.auth).toBe("secret-token")
  })

  it("writes a fresh current-input hash and the target CNAME", async () => {
    const mock = mockTransport([
      success({ ITEMS: [item("current_input", "HDMI-1", 10)] }),
      success({ ITEMS: [
        item("hdmi1", { NAME: "Console", METADATA: "" }, 100, { NAME: "HDMI-1" }),
        item("hdmi2", { NAME: "Streamer", METADATA: "" }, 200, { NAME: "HDMI-2" }),
      ] }),
      success({ ITEMS: [item("current_input", "HDMI-1", 99)] }),
      success(),
    ])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local:7345", authToken: "token" },
        { transport: mock.transport },
      )
      yield* client.setInput("Streamer")
    })
    await Effect.runPromise(program)
    expect(mock.requests[3]?.body).toEqual({ REQUEST: "MODIFY", VALUE: "hdmi2", HASHVAL: 99 })
  })

  it("refetches a setting once after a stale hash", async () => {
    const mock = mockTransport([
      success({ ITEMS: [item("game_low_latency", "Off", 10, { TYPE: "T_LIST_V1", ELEMENTS: ["Off", "On"] })] }),
      { STATUS: { RESULT: "HASHVAL_ERROR", DETAIL: "Hash changed" } },
      success({ ITEMS: [item("game_low_latency", "Off", 11, { TYPE: "T_LIST_V1", ELEMENTS: ["Off", "On"] })] }),
      success(),
    ])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "token" },
        { transport: mock.transport },
      )
      yield* client.setSetting("picture", "game_low_latency", "On")
    })
    await Effect.runPromise(program)
    expect(mock.requests[1]?.body).toEqual({ REQUEST: "MODIFY", VALUE: "On", HASHVAL: 10 })
    expect(mock.requests[3]?.body).toEqual({ REQUEST: "MODIFY", VALUE: "On", HASHVAL: 11 })
  })

  it("launches hosted Conjure apps with Vizio's URL payload", async () => {
    const mock = mockTransport([success()])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "token" },
        { transport: mock.transport },
      )
      yield* client.launchConjureUrl("http://192.168.1.2:4173/tv/", { debug: true })
    })
    await Effect.runPromise(program)
    expect(mock.requests[0]?.body).toEqual({
      VALUE: {
        APP_ID: "17",
        NAME_SPACE: 4,
        MESSAGE: "http://192.168.1.2:4173/tv/",
        DEBUG: 1,
      },
    })
  })

  it("batches ASCII text as codeset zero key presses", async () => {
    const mock = mockTransport([success()])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "token" },
        { transport: mock.transport },
      )
      yield* client.sendText("A1")
    })
    await Effect.runPromise(program)
    expect(mock.requests[0]?.body).toEqual({
      KEYLIST: [
        { CODESET: 0, CODE: 65, ACTION: "KEYPRESS" },
        { CODESET: 0, CODE: 49, ACTION: "KEYPRESS" },
      ],
    })
  })

  it("maps SmartCast auth failures to a tagged auth error", async () => {
    const mock = mockTransport([{ STATUS: { RESULT: "REQUIRES_PAIRING", DETAIL: "Pair first" } }])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "expired" },
        { transport: mock.transport },
      )
      return yield* Effect.exit(client.getPowerState())
    })
    const exit = await Effect.runPromise(program)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("VizioAuthError")
  })

  it("accepts the status-less aggregate state endpoint", async () => {
    const mock = mockTransport([{
      POWER_STATUS: { VALUE: 1, NAME: "Quick Start" },
      CURRENT_INPUT: { VALUE: "SMARTCAST" },
      CURRENT_APP: { APP_ID: "1", NAME_SPACE: 3 },
      SCREEN_MODE: "Full screen",
      MEDIA_STATE: "MediaState::Stopped",
    }])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "token" },
        { transport: mock.transport },
      )
      return yield* client.getStateExtended()
    })
    const state = await Effect.runPromise(program)
    expect(state).toMatchObject({
      powerOn: true,
      powerMode: "Quick Start",
      currentInput: "SMARTCAST",
      currentApp: { appId: "1", nameSpace: 3 },
      screenMode: "Full screen",
      mediaState: "MediaState::Stopped",
    })
  })

  it("validates setting ranges before sending a write", async () => {
    const mock = mockTransport([
      success({ ITEMS: [item("backlight", 50, 10, {
        TYPE: "T_VALUE_ABS_V1",
        MINIMUM: 0,
        MAXIMUM: 100,
      })] }),
    ])
    const program = Effect.gen(function* () {
      const client = yield* makeVizioClient(
        { host: "tv.local", authToken: "token" },
        { transport: mock.transport },
      )
      return yield* Effect.exit(client.setSetting("picture", "backlight", 101))
    })
    const exit = await Effect.runPromise(program)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(mock.requests).toHaveLength(1)
  })
})
