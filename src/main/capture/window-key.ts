import { z } from "zod";

import type { CapturePlatform } from "../../shared/dto";

/** Canonical live identity "<platform>:<uint32>". Valid only while the window lives. */
export const WindowKeySchema = z
  .string()
  .regex(/^(?:macos|windows):[1-9]\d*$/u)
  .brand<"WindowKey">();

export type WindowKey = z.infer<typeof WindowKeySchema>;

const UINT32_MAX = 0xff_ff_ff_ffn;
const TWO_32 = 0x1_00_00_00_00n;
const INT32_MIN = -0x80_00_00_00n;
const TWO_64 = 0x1_00_00_00_00_00_00_00_00n;
const SIGN_EXTENDED_MIN = TWO_64 + INT32_MIN;

const keyFor = (platform: CapturePlatform, value: bigint): WindowKey =>
  WindowKeySchema.parse(`${platform}:${value}`);

/**
 * macOS CGWindowID is a nonzero uint32 and is never signed.
 * Windows HWNDs carry 32 significant bits. get-windows casts them to a signed LONG,
 * so a negative value is the same handle plus 2^32.
 */
const canonical = (
  platform: CapturePlatform,
  value: bigint,
  allowSignExtended: boolean
) => {
  if (value === 0n) {
    return null;
  }

  if (value > 0n && value <= UINT32_MAX) {
    return value;
  }

  if (platform === "macos") {
    return null;
  }

  if (value < 0n && value >= INT32_MIN) {
    return value + TWO_32;
  }

  if (allowSignExtended && value >= SIGN_EXTENDED_MIN && value < TWO_64) {
    return value - TWO_64 + TWO_32;
  }

  return null;
};

export const nativeWindowKey = (
  platform: CapturePlatform,
  raw: number
): WindowKey | null => {
  if (!Number.isSafeInteger(raw)) {
    return null;
  }

  const value = canonical(platform, BigInt(raw), false);

  return value === null ? null : keyFor(platform, value);
};

/**
 * Parses Electron's "window:<id>:<n>" with any <n>. Accepts the 64-bit sign extension
 * of a signed 32-bit handle on Windows, and rejects every other high-bit pattern
 * instead of truncating it.
 */
export const parseWindowSourceId = (
  platform: CapturePlatform,
  sourceId: string
): WindowKey | null => {
  const id = /^window:(?<id>-?\d+):\d+$/u.exec(sourceId)?.groups?.["id"];

  if (id === undefined) {
    return null;
  }

  const value = canonical(platform, BigInt(id), true);

  return value === null ? null : keyFor(platform, value);
};

export type SourceMatch =
  | { kind: "exact"; sourceId: string }
  | { kind: "none" }
  | { kind: "ambiguous"; sourceIds: readonly string[] };

/** Exact canonical equality, counting every candidate. Titles are never consulted. */
export const matchWindowSource = (
  platform: CapturePlatform,
  key: WindowKey,
  sourceIds: readonly string[]
): SourceMatch => {
  const matches = sourceIds.filter(
    (id) => parseWindowSourceId(platform, id) === key
  );

  const [only] = matches;

  if (only === undefined) {
    return { kind: "none" };
  }

  return matches.length === 1
    ? { kind: "exact", sourceId: only }
    : { kind: "ambiguous", sourceIds: matches };
};
