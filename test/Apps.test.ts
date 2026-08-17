import { describe, expect, it } from "vitest"
import { parseRemoteAppCatalog } from "../src/Apps.js"

describe("Vizio app catalog", () => {
  it("joins current catalog metadata to chipset launch payloads", () => {
    const apps = parseRemoteAppCatalog(
      [{ id: "44", name: "YouTube", country: ["*"] }],
      [{
        id: "44",
        chipsets: {
          "*": [{ app_type_payload: '{"NAME_SPACE":5,"APP_ID":"1","MESSAGE":null}' }],
        },
      }],
    )
    expect(apps).toEqual([{
      name: "YouTube",
      countries: ["*"],
      configs: [{ appId: "1", nameSpace: 5 }],
    }])
  })
})
