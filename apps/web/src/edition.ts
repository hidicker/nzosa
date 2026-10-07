/**
 * Which edition of the app this is, fixed when it is built (build.js):
 * "nz" is NZOSA as it ships, "international" lets books be kept in another
 * country.
 */
declare const __NZOSA_EDITION__: string;

export function edition(): string {
  return typeof __NZOSA_EDITION__ === "string" ? __NZOSA_EDITION__ : "nz";
}
