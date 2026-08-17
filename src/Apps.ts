import type { AppRecord } from "./Schemas.js"

export const VIZIO_APP_CATALOG_URL = "https://scfs.vizio.com/appservice/vizio_apps_prod.json"
export const VIZIO_APP_AVAILABILITY_URL = "https://scfs.vizio.com/appservice/app_availability_prod.json"

/** Verified fallback launch configurations used when Vizio's catalog is unavailable. */
export const BUILTIN_APPS: ReadonlyArray<AppRecord> = [
  { name: "Apple TV+", countries: ["usa"], configs: [{ appId: "4", nameSpace: 3 }] },
  { name: "Disney+", countries: ["usa", "can", "mex"], configs: [{ appId: "75", nameSpace: 2 }] },
  { name: "Hulu", countries: ["usa"], configs: [{ appId: "3", nameSpace: 2 }] },
  { name: "Netflix", countries: ["*"], configs: [{ appId: "1", nameSpace: 3 }] },
  { name: "Paramount+", countries: ["usa"], configs: [{ appId: "37", nameSpace: 2 }] },
  { name: "Plex", countries: ["usa", "can"], configs: [{ appId: "9", nameSpace: 2 }] },
  { name: "Prime Video", countries: ["*"], configs: [{ appId: "4", nameSpace: 2 }] },
  { name: "Tubi", countries: ["usa", "can"], configs: [{ appId: "61", nameSpace: 2 }] },
  { name: "YouTube", countries: ["*"], configs: [{ appId: "1", nameSpace: 5 }] },
]

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined

const parseConfig = (value: unknown) => {
  const parsed = typeof value === "string"
    ? (() => {
        try { return JSON.parse(value) as unknown } catch { return undefined }
      })()
    : value
  const config = record(parsed)
  if (config === undefined) return undefined
  const appId = config.APP_ID
  const nameSpace = config.NAME_SPACE
  const message = config.MESSAGE
  if ((typeof appId !== "string" && typeof appId !== "number") || typeof nameSpace !== "number") {
    return undefined
  }
  return {
    appId: String(appId),
    nameSpace,
    ...(typeof message === "string" ? { message } : {}),
  }
}

/** Parses Vizio's current catalog + availability documents into launchable records. */
export const parseRemoteAppCatalog = (
  catalogDocument: unknown,
  availabilityDocument: unknown,
): ReadonlyArray<AppRecord> => {
  if (!Array.isArray(catalogDocument) || !Array.isArray(availabilityDocument)) return []
  const availability = new Map<string, UnknownRecord>()
  for (const entry of availabilityDocument) {
    const candidate = record(entry)
    if (candidate !== undefined && (typeof candidate.id === "string" || typeof candidate.id === "number")) {
      availability.set(String(candidate.id), candidate)
    }
  }

  return catalogDocument.flatMap((entry): ReadonlyArray<AppRecord> => {
    const candidate = record(entry)
    if (candidate === undefined || typeof candidate.name !== "string") return []
    const id = typeof candidate.id === "string" || typeof candidate.id === "number"
      ? String(candidate.id)
      : ""
    const countries = Array.isArray(candidate.country)
      ? candidate.country.filter((country): country is string => typeof country === "string")
      : ["*"]
    const appAvailability = availability.get(id)
    const chipsets = appAvailability === undefined ? undefined : record(appAvailability.chipsets)
    const preferred = chipsets?.["*"]
    const variants = Array.isArray(preferred)
      ? preferred
      : chipsets === undefined
        ? []
        : Object.values(chipsets).find(Array.isArray) ?? []
    const configs = variants.flatMap((variant) => {
      const variantRecord = record(variant)
      const config = parseConfig(variantRecord?.app_type_payload)
      return config === undefined ? [] : [config]
    })
    return [{ name: candidate.name, countries, configs }]
  })
}
