// A small streaming ZIP writer and reader (no extra packages). Writes ZIP64 when the file grows past
// 4 GB, so a backup with years of driver photos still opens in Windows, macOS and `unzip`.
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { createDeflateRaw, createInflateRaw, crc32, inflateRawSync } from "node:zlib";

const MAX32 = 0xffffffff;

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Streams a ZIP into `out` (an HTTP response or file stream).
 *   const zip = new ZipWriter(out);
 *   await zip.add("data/rides.jsonl", asyncIterableOfBuffers, { compress: true });
 *   await zip.finish();
 */
export class ZipWriter {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
  }

  async write(buf) {
    this.offset += buf.length;
    if (!this.out.write(buf)) {
      await new Promise((ok, fail) => {
        const done = (err) => { this.out.off("drain", done); this.out.off("error", done); this.out.off("close", closed); err ? fail(err) : ok(); };
        const closed = () => done(new Error("The download was closed before it finished."));
        this.out.on("drain", done); this.out.on("error", done); this.out.on("close", closed);
      });
    }
  }

  /** Adds one file. `source`: a Buffer, a string, or an async iterable of Buffers/strings. */
  async add(name, source, { compress = true, date = new Date() } = {}) {
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date: day } = dosTime(date);
    const method = compress ? 8 : 0;
    const localOffset = this.offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4); // version needed (ZIP64-capable)
    local.writeUInt16LE(0x0808, 6); // sizes in the data descriptor; UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt16LE(nameBuf.length, 26);
    await this.write(Buffer.concat([local, nameBuf]));

    let crc = 0;
    let size = 0;
    let csize = 0;
    const chunks = typeof source === "string" || Buffer.isBuffer(source) ? [source] : source;
    if (compress) {
      const deflate = createDeflateRaw({ level: 6 });
      const pump = (async () => { for await (const c of deflate) { csize += c.length; await this.write(c); } })();
      for await (const c of chunks) {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8");
        crc = crc32(b, crc);
        size += b.length;
        if (!deflate.write(b)) await new Promise((ok) => deflate.once("drain", ok));
      }
      deflate.end();
      await pump;
    } else {
      for await (const c of chunks) {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8");
        crc = crc32(b, crc);
        size += b.length;
        csize += b.length;
        await this.write(b);
      }
    }

    // Data descriptor (ZIP64 form when the entry itself is huge).
    const big = size >= MAX32 || csize >= MAX32;
    const desc = Buffer.alloc(big ? 24 : 16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    if (big) { desc.writeBigUInt64LE(BigInt(csize), 8); desc.writeBigUInt64LE(BigInt(size), 16); }
    else { desc.writeUInt32LE(csize, 8); desc.writeUInt32LE(size, 12); }
    await this.write(desc);
    this.entries.push({ nameBuf, method, time, day, crc: crc >>> 0, size, csize, offset: localOffset });
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const extras = [];
      if (e.size >= MAX32) extras.push(BigInt(e.size));
      if (e.csize >= MAX32) extras.push(BigInt(e.csize));
      if (e.offset >= MAX32) extras.push(BigInt(e.offset));
      const extra = extras.length ? Buffer.alloc(4 + 8 * extras.length) : Buffer.alloc(0);
      if (extras.length) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8 * extras.length, 2);
        extras.forEach((v, i) => extra.writeBigUInt64LE(v, 4 + 8 * i));
      }
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
      c.writeUInt16LE(45, 6);
      c.writeUInt16LE(0x0808, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.day, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(Math.min(e.csize, MAX32), 20);
      c.writeUInt32LE(Math.min(e.size, MAX32), 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt16LE(extra.length, 30);
      c.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
      c.writeUInt32LE(Math.min(e.offset, MAX32), 42);
      await this.write(Buffer.concat([c, e.nameBuf, extra]));
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    if (count >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32) {
      const z64At = this.offset;
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(count), 24);
      z.writeBigUInt64LE(BigInt(count), 32);
      z.writeBigUInt64LE(BigInt(cdSize), 40);
      z.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(z64At), 8);
      loc.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([z, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(count, 0xffff), 8);
    end.writeUInt16LE(Math.min(count, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
    end.writeUInt32LE(Math.min(cdStart, MAX32), 16);
    await this.write(end);
  }
}

/** Reads a ZIP file from disk: lists entries and reads them one at a time (used to restore backups). */
export class ZipReader {
  static async open(path) {
    const r = new ZipReader();
    r.path = path;
    r.fh = await open(path, "r");
    const { size } = await r.fh.stat();
    const tailLen = Math.min(size, 65_557);
    const tail = await r.read(size - tailLen, tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error("This isn't a ZIP file (or it's incomplete).");
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdStart = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === MAX32 || cdStart === MAX32) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error("Broken ZIP64 file.");
      const z = await r.read(Number(tail.readBigUInt64LE(loc + 8)), 56);
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdStart = Number(z.readBigUInt64LE(48));
    }
    const cd = await r.read(cdStart, cdSize);
    r.entries = [];
    for (let p = 0, i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken ZIP directory.");
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      for (let q = 0; q + 4 <= extra.length;) {
        const id = extra.readUInt16LE(q);
        const len = extra.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let k = q + 4;
          if (size === MAX32) { size = Number(extra.readBigUInt64LE(k)); k += 8; }
          if (csize === MAX32) { csize = Number(extra.readBigUInt64LE(k)); k += 8; }
          if (offset === MAX32) { offset = Number(extra.readBigUInt64LE(k)); k += 8; }
        }
        q += 4 + len;
      }
      r.entries.push({ name, method, size, csize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return r;
  }

  async read(position, length) {
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await this.fh.read(buf, done, length - done, position + done);
      if (!bytesRead) throw new Error("The ZIP file ended early.");
      done += bytesRead;
    }
    return buf;
  }

  /** The whole contents of one entry as a Buffer. */
  async data(entry) {
    const head = await this.read(entry.offset, 30);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${entry.name}`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = await this.read(start, entry.csize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRawSync(raw);
    throw new Error(`Unsupported compression in ${entry.name}`);
  }

  /** One entry as a stream (for big files: read line by line without loading it all). */
  async stream(entry) {
    const head = await this.read(entry.offset, 30);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${entry.name}`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = entry.csize ? createReadStream(this.path, { start, end: start + entry.csize - 1 }) : Readable.from([]);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return raw.pipe(createInflateRaw());
    throw new Error(`Unsupported compression in ${entry.name}`);
  }

  find(name) { return this.entries.find((e) => e.name === name); }
  async close() { await this.fh?.close(); }
}
