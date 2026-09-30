// MIL-STD-2525 standard identities: how the contract names them, the character a 2525C
// letter code carries for each, and the name a reader sees. Presentation tables only --
// nothing here chooses an identity (VIDENS_SPEC.md rule 5).

import type { StandardIdentity } from "./generated/picture.ts";

export const IDENTITIES: readonly StandardIdentity[] = [
  "pending",
  "unknown",
  "assumed_friend",
  "friend",
  "neutral",
  "suspect",
  "hostile",
];

/** The 2525C identity character, position 2 of a letter symbol code. */
export const IDENTITY_SIDC_CHAR: Readonly<Record<StandardIdentity, string>> = {
  pending: "P",
  unknown: "U",
  assumed_friend: "A",
  friend: "F",
  neutral: "N",
  suspect: "S",
  hostile: "H",
};

/** The standard's own names. Not synonyms: "Hostile", never anything stronger. */
export const IDENTITY_LABEL: Readonly<Record<StandardIdentity, string>> = {
  pending: "Pending",
  unknown: "Unknown",
  assumed_friend: "Assumed friend",
  friend: "Friend",
  neutral: "Neutral",
  suspect: "Suspect",
  hostile: "Hostile",
};

export const BASIS_LABEL = {
  default: "Nobody has said (default)",
  library: "Declared by a library",
  operator: "Declared by an operator",
} as const;

/** The identity a 2525C letter code encodes, or undefined for exercise and joker codes. */
export function sidcIdentity(sidc: string): StandardIdentity | undefined {
  const char = sidc.charAt(1);
  return IDENTITIES.find((identity) => IDENTITY_SIDC_CHAR[identity] === char);
}
