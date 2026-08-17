import type { HttpTransport } from "@get-air/http"
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { probeVizioHost } from "../src/Discovery.js"

describe("Vizio discovery", () => {
  it("probes the modern and legacy SmartCast ports", async () => {
    const urls: Array<string> = []
    const transport: HttpTransport = {
      fetch: async (request) => {
        urls.push(request.url)
        if (request.url.includes(":7345/")) return new Response("unreachable", { status: 503 })
        return new Response(JSON.stringify({
          STATUS: { RESULT: "SUCCESS", DETAIL: "Success" },
          ITEMS: [{
            VALUE: { CAST_NAME: "Living Room", MODEL_NAME: "V505-H9" },
          }],
        }), { status: 200 })
      },
    }
    const result = await Effect.runPromise(probeVizioHost("192.168.1.50", { transport }))
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.host).toBe("192.168.1.50:9000")
      expect(result.value.info.name).toBe("Living Room")
    }
    expect(urls).toEqual([
      "https://192.168.1.50:7345/state/device/deviceinfo",
      "https://192.168.1.50:9000/state/device/deviceinfo",
    ])
  })
})
