/**
 * A zip archive, written without compression: for a bundle of files saved as
 * one, such as an Excel workbook or the accountant's package. Stored rather
 * than deflated, which every unzip program reads and keeps this short.
 */

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
export function encodeUtf8(str: string): Uint8Array {
  return encoder.encode(str);
}

function writeU16(arr: Uint8Array, offset: number, val: number): void {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
}

function writeU32(arr: Uint8Array, offset: number, val: number): void {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
  arr[offset + 2] = (val >> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const d =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: d };
}

/** The files, in the order given; `at` is the time written on each, now unless said. */
export function createZip(files: readonly { name: string; data: Uint8Array }[], at: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(at);
  const localHeaders: Uint8Array[] = [];
  const cdHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encodeUtf8(file.name);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0x0800); // UTF-8
    writeU16(local, 8, 0); // Stored (0)
    writeU16(local, 10, time);
    writeU16(local, 12, date);
    writeU32(local, 14, crc);
    writeU32(local, 18, size);
    writeU32(local, 22, size);
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);

    const cd = new Uint8Array(46 + nameBytes.length);
    writeU32(cd, 0, 0x02014b50);
    writeU16(cd, 4, 20);
    writeU16(cd, 6, 20);
    writeU16(cd, 8, 0x0800); // UTF-8
    writeU16(cd, 10, 0);
    writeU16(cd, 12, time);
    writeU16(cd, 14, date);
    writeU32(cd, 16, crc);
    writeU32(cd, 20, size);
    writeU32(cd, 24, size);
    writeU16(cd, 28, nameBytes.length);
    writeU16(cd, 30, 0);
    writeU16(cd, 32, 0);
    writeU16(cd, 34, 0);
    writeU16(cd, 36, 0);
    writeU32(cd, 38, 0);
    writeU32(cd, 42, offset);
    cd.set(nameBytes, 46);

    offset += local.length;
    localHeaders.push(local);
    cdHeaders.push(cd);
  }

  const cdTotalSize = cdHeaders.reduce((s, h) => s + h.length, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, files.length);
  writeU16(eocd, 10, files.length);
  writeU32(eocd, 12, cdTotalSize);
  writeU32(eocd, 16, cdOffset);
  writeU16(eocd, 20, 0);

  const totalLength = offset + cdTotalSize + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of localHeaders) {
    result.set(part, pos);
    pos += part.length;
  }
  for (const part of cdHeaders) {
    result.set(part, pos);
    pos += part.length;
  }
  result.set(eocd, pos);
  return result;
}
