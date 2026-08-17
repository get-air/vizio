import type { RemoteEvent } from "./Schemas.js"

export const REMOTE_KEYS = {
  SEEK_FWD: [2, 0],
  SEEK_BACK: [2, 1],
  PAUSE: [2, 2],
  PLAY: [2, 3],
  DOWN: [3, 0],
  LEFT: [3, 1],
  OK: [3, 2],
  RIGHT: [3, 7],
  UP: [3, 8],
  BACK: [4, 0],
  SMARTCAST: [4, 3],
  CC_TOGGLE: [4, 4],
  INFO: [4, 6],
  MENU: [4, 8],
  HOME: [4, 15],
  VOL_DOWN: [5, 0],
  VOL_UP: [5, 1],
  MUTE_OFF: [5, 2],
  MUTE_ON: [5, 3],
  MUTE_TOGGLE: [5, 4],
  PIC_MODE: [6, 0],
  PIC_SIZE: [6, 2],
  INPUT_NEXT: [7, 1],
  CH_DOWN: [8, 0],
  CH_UP: [8, 1],
  CH_PREV: [8, 2],
  EXIT: [9, 0],
  POW_OFF: [11, 0],
  POW_ON: [11, 1],
  POW_TOGGLE: [11, 2],
} as const satisfies Readonly<Record<string, readonly [number, number]>>

export type RemoteKey = keyof typeof REMOTE_KEYS

export const remoteEvent = (key: RemoteKey): RemoteEvent => {
  const [codeSet, code] = REMOTE_KEYS[key]
  return { codeSet, code, action: "KEYPRESS" }
}

export const textEvents = (text: string): ReadonlyArray<RemoteEvent> =>
  Array.from(text, (character) => ({
    codeSet: 0,
    code: character.codePointAt(0) ?? 0,
    action: "KEYPRESS" as const,
  }))
