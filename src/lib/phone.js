/** Nigerian mobile numbers in +234 format, e.g. "0803 214 5567" → "+2348032145567". Same rule as the app. */
export function normalizeNgPhone(input) {
  if (typeof input !== "string") return null;
  let d = input.replace(/\D/g, "");
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 || !/^[789]/.test(d)) return null;
  return `+234${d}`;
}
