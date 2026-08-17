import { FunctionHttpTransport, type HttpTransport } from "@get-air/http"
import { Effect, Option } from "effect"
import { makeVizioClient } from "./Client.js"
import { VizioInvalidConfigError } from "./Errors.js"
import type { DeviceInfo } from "./Schemas.js"

export interface DiscoveredVizioTv {
  readonly ip: string
  readonly port: number
  readonly host: string
  readonly info: DeviceInfo
}

export interface VizioDiscoveryOptions {
  readonly transport?: HttpTransport
  readonly ports?: ReadonlyArray<number>
  readonly timeoutMillis?: number
  readonly concurrency?: number
}

const subnetPrefix = (input: string): Effect.Effect<string, VizioInvalidConfigError> => {
  const normalized = input.trim().replace(/\.$/u, "")
  const octets = normalized.split(".").map(Number)
  if (octets.length !== 3 || octets.some((octet) =>
    !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return Effect.fail(new VizioInvalidConfigError({
      field: "subnet",
      message: "Subnet must be an IPv4 /24 prefix such as 192.168.1",
    }))
  }
  return Effect.succeed(octets.join("."))
}

export const probeVizioHost = Effect.fn("VizioDiscovery.probeHost")(function* (
  ip: string,
  options: VizioDiscoveryOptions = {},
) {
  const transport = options.transport ?? FunctionHttpTransport.global()
  const ports = options.ports ?? [7345, 9000]
  for (const port of ports) {
    const client = yield* makeVizioClient(
      { host: `${ip}:${port}`, timeoutMillis: options.timeoutMillis ?? 1_200 },
      { transport },
    )
    const info = yield* client.getDeviceInfo().pipe(Effect.option)
    if (Option.isSome(info)) {
      return Option.some({ ip, port, host: `${ip}:${port}`, info: info.value })
    }
  }
  return Option.none<DiscoveredVizioTv>()
})

/** Scans a caller-supplied IPv4 /24 through the injected @get-air/http transport. */
export const scanVizioSubnet = Effect.fn("VizioDiscovery.scanSubnet")(function* (
  subnet: string,
  options: VizioDiscoveryOptions = {},
) {
  const prefix = yield* subnetPrefix(subnet)
  const results = yield* Effect.forEach(
    Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`),
    (ip) => probeVizioHost(ip, options),
    { concurrency: options.concurrency ?? 32 },
  )
  return results.flatMap((result) => Option.isSome(result) ? [result.value] : [])
})
