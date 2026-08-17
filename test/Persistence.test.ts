import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeVizioProfileStore, MemoryVizioPersistence } from "../src/Persistence.js"
import { TvProfileId } from "../src/Schemas.js"

describe("Vizio profile persistence", () => {
  it("sets, gets, selects, and removes profiles", async () => {
    const persistence = new MemoryVizioPersistence()
    const store = makeVizioProfileStore(persistence)
    const id = TvProfileId.make("living-room-id")
    const profile = {
      id,
      alias: "living-room",
      host: "192.168.1.10:7345",
      authToken: "token",
      deviceId: "air-device",
      deviceName: "Air",
    }

    await Effect.runPromise(store.set(profile))
    expect(await Effect.runPromise(store.get("LIVING-ROOM"))).toEqual(profile)
    await Effect.runPromise(store.setDefault(id))
    expect(await Effect.runPromise(store.getDefault())).toEqual(profile)
    await Effect.runPromise(store.remove(id))
    expect(await Effect.runPromise(store.list())).toEqual([])
    expect(await Effect.runPromise(store.getDefault())).toBeUndefined()
  })
})
