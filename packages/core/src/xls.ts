import type { SheetRows, Workbook } from "./xlsx.js";

/**
 * The old Excel format, `.xls`: the one QuickBooks Online still exports its
 * lists in -- customers, vendors, products and services.
 *
 * Read just far enough to get the first sheet's cells out, as `xlsx.ts` does
 * for the newer format: the compound file that holds the workbook stream,
 * the shared strings, and the cell records (text, numbers, and the cached
 * value of a formula). Styles and dates are not interpreted; a number comes
 * out as written.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Whether bytes are a compound file, as an `.xls` is. */
export function isXls(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

const u16 = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number): number => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;
const f64 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset + at, 8).getFloat64(0, true);

const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

/** The stream called `Workbook` (or `Book`) from the compound file. */
function workbookStream(bytes: Uint8Array): Uint8Array | null {
  const sectorSize = 1 << u16(bytes, 30);
  const miniSectorSize = 1 << u16(bytes, 32);
  const directoryStart = u32(bytes, 48);
  const miniCutoff = u32(bytes, 56);
  const miniFatStart = u32(bytes, 60);
  const sector = (n: number): number => 512 + n * sectorSize;

  // The sectors holding the allocation table: 109 in the header, the rest chained.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i += 1) {
    const s = u32(bytes, 76 + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let difat = u32(bytes, 68);
  let guard = 0;
  while (difat !== END_OF_CHAIN && difat !== FREE && guard++ < 10000) {
    const at = sector(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) {
      const s = u32(bytes, at + i * 4);
      if (s !== FREE) fatSectors.push(s);
    }
    difat = u32(bytes, at + sectorSize - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) for (let i = 0; i < sectorSize / 4; i += 1) fat.push(u32(bytes, sector(s) + i * 4));

  const chain = (start: number, table: readonly number[]): number[] => {
    const out: number[] = [];
    let at = start;
    while (at !== END_OF_CHAIN && at !== FREE && at < table.length && out.length < table.length) {
      out.push(at);
      at = table[at] ?? END_OF_CHAIN;
    }
    return out;
  };
  const read = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let filled = 0;
    for (const s of chain(start, fat)) {
      const take = Math.min(sectorSize, size - filled);
      out.set(bytes.subarray(sector(s), sector(s) + take), filled);
      filled += take;
      if (filled >= size) break;
    }
    return out;
  };

  // The directory: 128-byte entries, each a name and where its stream starts.
  const directory = read(directoryStart, chain(directoryStart, fat).length * sectorSize);
  let root: { start: number; size: number } | null = null;
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameLength = u16(directory, at + 64);
    let name = "";
    for (let i = 0; i + 2 < nameLength; i += 2) name += String.fromCharCode(u16(directory, at + i));
    const type = directory[at + 66];
    const start = u32(directory, at + 116);
    const size = u32(directory, at + 120);
    if (type === 5) root = { start, size };
    if (type === 2 && (name === "Workbook" || name === "Book")) {
      if (size >= miniCutoff || root === null) return read(start, size);
      // A small stream lives in the mini stream, inside the root's.
      const mini = read(root.start, root.size);
      const miniFat: number[] = [];
      for (const s of chain(miniFatStart, fat)) for (let i = 0; i < sectorSize / 4; i += 1) miniFat.push(u32(bytes, sector(s) + i * 4));
      const out = new Uint8Array(size);
      let filled = 0;
      for (const s of chain(start, miniFat)) {
        const take = Math.min(miniSectorSize, size - filled);
        out.set(mini.subarray(s * miniSectorSize, s * miniSectorSize + take), filled);
        filled += take;
      }
      return out;
    }
  }
  return null;
}

/** An RK number: a packed integer or the top of a double, maybe over a hundred. */
function rk(value: number): number {
  const hundredths = (value & 1) !== 0;
  let n: number;
  if ((value & 2) !== 0) n = value >> 2;
  else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, value & 0xfffffffc, true);
    n = buffer.getFloat64(0, true);
  }
  return hundredths ? n / 100 : n;
}

const numberText = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10));

/**
 * The shared strings, which may run across CONTINUE records: a string carried
 * over starts its remainder with a fresh flags byte saying how wide its
 * characters are.
 */
function sharedStrings(chunks: readonly Uint8Array[]): string[] {
  const out: string[] = [];
  let c = 0;
  let at = 8;
  const total = u32(chunks[0] ?? new Uint8Array(8), 4);
  const byte = (): number => {
    while (c < chunks.length && at >= (chunks[c]?.length ?? 0)) {
      c += 1;
      at = 0;
    }
    return chunks[c]?.[at++] ?? 0;
  };
  const skip = (n: number): void => {
    for (let i = 0; i < n; i += 1) byte();
  };
  for (let s = 0; s < total && c < chunks.length; s += 1) {
    const count = byte() | (byte() << 8);
    let flags = byte();
    const runs = (flags & 0x08) !== 0 ? byte() | (byte() << 8) : 0;
    const ext = (flags & 0x04) !== 0 ? byte() | (byte() << 8) | (byte() << 16) | (byte() << 24) : 0;
    let text = "";
    for (let i = 0; i < count; i += 1) {
      // A boundary in the characters: the next record restates the width.
      if (c < chunks.length && at >= (chunks[c]?.length ?? 0) && i > 0) {
        c += 1;
        at = 0;
        flags = byte();
      }
      text += String.fromCharCode((flags & 0x01) !== 0 ? byte() | (byte() << 8) : byte());
    }
    skip(runs * 4 + ext);
    out.push(text);
  }
  return out;
}

/** Read an `.xls` workbook's first sheet. */
export function readXls(bytes: Uint8Array): Workbook {
  if (!isXls(bytes)) return { sheets: [], problems: [{ message: "Not an .xls file." }] };
  const stream = workbookStream(bytes);
  if (stream === null) return { sheets: [], problems: [{ message: "No workbook inside this .xls file." }] };

  const rows = new Map<number, Map<number, string>>();
  const put = (row: number, col: number, value: string): void => {
    const line = rows.get(row + 1) ?? new Map<number, string>();
    line.set(col + 1, value);
    rows.set(row + 1, line);
  };
  let strings: string[] = [];
  let sstChunks: Uint8Array[] | null = null;
  let sheetName = "Sheet1";
  let inSheet = false;
  let sheetsSeen = 0;
  let pendingFormula: { row: number; col: number } | null = null;

  for (let at = 0; at + 4 <= stream.length; ) {
    const type = u16(stream, at);
    const length = u16(stream, at + 2);
    const data = stream.subarray(at + 4, at + 4 + length);
    at += 4 + length;

    if (sstChunks !== null && type !== 0x003c) {
      strings = sharedStrings(sstChunks);
      sstChunks = null;
    }
    switch (type) {
      case 0x0085: {
        // The first sheet's name, as the workbook lists it.
        if (sheetsSeen === 0) {
          const count = data[6] ?? 0;
          const wide = ((data[7] ?? 0) & 1) !== 0;
          let name = "";
          for (let i = 0; i < count; i += 1) name += String.fromCharCode(wide ? u16(data, 8 + i * 2) : (data[8 + i] ?? 0));
          if (name !== "") sheetName = name;
        }
        break;
      }
      case 0x00fc:
        sstChunks = [data];
        break;
      case 0x003c:
        if (sstChunks !== null) sstChunks.push(data);
        break;
      case 0x0809: {
        // The start of a worksheet's records (0x10); only the first is read.
        if (u16(data, 2) === 0x0010) {
          sheetsSeen += 1;
          inSheet = sheetsSeen === 1;
        }
        break;
      }
      case 0x000a:
        if (inSheet) at = stream.length;
        break;
      case 0x00fd:
        if (inSheet) put(u16(data, 0), u16(data, 2), strings[u32(data, 6)] ?? "");
        break;
      case 0x0204: {
        if (!inSheet) break;
        const count = u16(data, 6);
        const wide = ((data[8] ?? 0) & 1) !== 0;
        let text = "";
        for (let i = 0; i < count; i += 1) text += String.fromCharCode(wide ? u16(data, 9 + i * 2) : (data[9 + i] ?? 0));
        put(u16(data, 0), u16(data, 2), text);
        break;
      }
      case 0x0203:
        if (inSheet) put(u16(data, 0), u16(data, 2), numberText(f64(data, 6)));
        break;
      case 0x027e:
        if (inSheet) put(u16(data, 0), u16(data, 2), numberText(rk(u32(data, 6))));
        break;
      case 0x00bd: {
        if (!inSheet) break;
        const row = u16(data, 0);
        const first = u16(data, 2);
        const cells = (length - 6) / 6;
        for (let i = 0; i < cells; i += 1) put(row, first + i, numberText(rk(u32(data, 4 + i * 6 + 2))));
        break;
      }
      case 0x0006: {
        // A formula: its cached number, or a string in the record after it.
        if (!inSheet) break;
        const row = u16(data, 0);
        const col = u16(data, 2);
        if (u16(data, 12) === 0xffff && data[6] === 0) pendingFormula = { row, col };
        else if (u16(data, 12) !== 0xffff) put(row, col, numberText(f64(data, 6)));
        break;
      }
      case 0x0207: {
        if (pendingFormula === null) break;
        const count = u16(data, 0);
        const wide = ((data[2] ?? 0) & 1) !== 0;
        let text = "";
        for (let i = 0; i < count; i += 1) text += String.fromCharCode(wide ? u16(data, 3 + i * 2) : (data[3 + i] ?? 0));
        put(pendingFormula.row, pendingFormula.col, text);
        pendingFormula = null;
        break;
      }
      default:
        break;
    }
  }
  const sheet: SheetRows = { name: sheetName, rows };
  return { sheets: [sheet], problems: [] };
}
