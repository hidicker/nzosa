/**
 * A small, stable, non-cryptographic hash.
 *
 * Used to turn dedupe keys into short ids. It must stay byte-identical across
 * Node and the browser and across releases -- ids are persisted in the user's
 * store and compared against future imports -- so this is implemented here
 * rather than pulled from a runtime API that could differ between the two.
 *
 * FNV-1a, 64-bit, over UTF-8 bytes.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** Hash a string to 16 lowercase hex characters. */
export function hash(input: string): string {
  let value = FNV_OFFSET;
  for (const byte of utf8Bytes(input)) {
    value = ((value ^ BigInt(byte)) * FNV_PRIME) & MASK;
  }
  return value.toString(16).padStart(16, "0");
}

/**
 * Encode a string as UTF-8 bytes.
 *
 * Written out rather than using `TextEncoder` so that core stays free of any
 * ambient DOM or Node type dependency, and so a payee name with an accent or
 * an emoji hashes identically in every runtime.
 */
function* utf8Bytes(input: string): Generator<number> {
  for (const character of input) {
    // Iterating the string yields whole code points, so surrogate pairs are
    // already combined and `codePointAt(0)` is always defined here.
    const code = character.codePointAt(0) as number;

    if (code < 0x80) {
      yield code;
    } else if (code < 0x800) {
      yield 0xc0 | (code >> 6);
      yield 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      yield 0xe0 | (code >> 12);
      yield 0x80 | ((code >> 6) & 0x3f);
      yield 0x80 | (code & 0x3f);
    } else {
      yield 0xf0 | (code >> 18);
      yield 0x80 | ((code >> 12) & 0x3f);
      yield 0x80 | ((code >> 6) & 0x3f);
      yield 0x80 | (code & 0x3f);
    }
  }
}
