// Will a sensor hear an emitter? The prototype's propagation model
// (Vigilans-prototype src/vigilans/sim/propagation.py): free-space loss at 1 m, then a
// log-distance term, compared with the sensor's noise floor and threshold. Median values:
// the simulator adds log-normal shadowing on top, which the editor states alongside.

const SPEED_OF_LIGHT_MPS = 299_792_458;
const REFERENCE_M = 1;

export function freeSpaceLossDb(distanceM: number, freqHz: number): number {
  const d = Math.max(distanceM, 1e-3);
  return 20 * Math.log10((4 * Math.PI * d * freqHz) / SPEED_OF_LIGHT_MPS);
}

export function pathLossDb(distanceM: number, freqHz: number, exponent: number): number {
  const d = Math.max(distanceM, REFERENCE_M);
  return freeSpaceLossDb(REFERENCE_M, freqHz) + 10 * exponent * Math.log10(d / REFERENCE_M);
}

export interface Link {
  eirpDbm: number;
  freqHz: number;
  exponent: number;
  noiseFloorDbm: number;
  thresholdDb: number;
}

/** Median SNR above the detection threshold at a range, dB. Positive means heard. */
export function marginDb(link: Link, distanceM: number): number {
  const rx = link.eirpDbm - pathLossDb(distanceM, link.freqHz, link.exponent);
  return rx - link.noiseFloorDbm - link.thresholdDb;
}

/** The range at which the median margin reaches zero, metres. */
export function maxRangeM(link: Link): number {
  const budget = link.eirpDbm - freeSpaceLossDb(REFERENCE_M, link.freqHz) - link.noiseFloorDbm - link.thresholdDb;
  return REFERENCE_M * 10 ** (budget / (10 * link.exponent));
}
