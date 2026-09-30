// Display formatting. Times are always UTC with a Z; the viewer never shows local time.

export function clock(iso: string | undefined): string {
  return iso ? `${iso.slice(11, 19)}Z` : "—";
}

export function dateTime(iso: string | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z` : "—";
}

export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function latLon(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

export function frequency(hz: number): string {
  return hz >= 1e9 ? `${(hz / 1e9).toFixed(6)} GHz` : hz >= 1e6 ? `${(hz / 1e6).toFixed(4)} MHz` : `${(hz / 1e3).toFixed(3)} kHz`;
}

export function bandwidth(hz: number): string {
  return hz >= 1e6 ? `${(hz / 1e6).toFixed(3)} MHz` : `${(hz / 1e3).toFixed(1)} kHz`;
}

export function metres(m: number): string {
  return m >= 10_000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`;
}

export function percent(p: number): string {
  return `${(p * 100).toFixed(p < 0.5 ? 1 : 0)} %`;
}

export function confidenceLabel(p: number): string {
  if (Math.abs(p - 0.3935) < 0.001) return "1-sigma (39.3 %)";
  return percent(p);
}
