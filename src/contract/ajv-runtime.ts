// Local, ES-module stand-ins for the two Ajv runtime helpers the standalone validators use.
//
// Ajv emits require() calls to CommonJS modules that set __esModule, and Node and Vite
// disagree about what a default import of such a module is -- so the same validators
// worked in one and threw "not a function" in the other. scripts/gen-contract.ts rewrites
// each known require() to one of these objects, shaped like the module it replaces, and
// fails the build on any require() it does not know.

/** Length in Unicode code points, as JSON Schema's minLength/maxLength require. */
function ucs2length(text: string): number {
  let length = 0;
  let pos = 0;
  while (pos < text.length) {
    length++;
    const value = text.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < text.length && (text.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++;
  }
  return length;
}

/** Stands in for ajv/dist/runtime/ucs2length. */
export const ucs2lengthModule = { default: ucs2length };

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))$/;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** RFC 3339 date-time, as ajv-formats' full mode checks it: a real date and a real time. */
function dateTime(text: string): boolean {
  const m = DATE_TIME.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && leap ? 29 : DAYS[month - 1]!;
  if (day < 1 || day > maxDay) return false;
  if (hour > 23 || minute > 59) return false;
  if (second > 60 || (second === 60 && !(hour === 23 && minute === 59))) return false;
  if (m[7] && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return true;
}

/** Stands in for ajv-formats/dist/formats, for the formats this contract uses. */
export const formatsModule = { fullFormats: { "date-time": { validate: dateTime } } };
