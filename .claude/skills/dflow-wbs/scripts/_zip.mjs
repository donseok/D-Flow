// _zip.mjs — xlsx-read.mjs·xlsx-write.mjs 가 함께 쓰는 zip 읽기·쓰기 도우미 (외부 의존성 0, node 18.17 이상).
//
// 읽기: 끝 레코드(EOCD)에서 중앙 디렉터리를 파싱해 `{name → 항목}` 을 만든다. 압축 방식은 stored(0)·deflate(8)만 지원하고
//   ZIP64(끝 레코드 값이 0xFFFF·0xFFFFFFFF 인 경우)·암호화는 명확한 오류로 끝낸다. CRC32·크기는 python zipfile 처럼 읽을 때 검증한다.
// 쓰기: 항목마다 deflate(zlib.deflateRawSync)로 압축해 로컬 헤더·중앙 디렉터리·끝 레코드를 직접 쓴다.
//   파일 시각은 1980-01-01 00:00:00 으로 고정해 같은 입력이면 같은 바이트가 나온다(결정적 출력).
//   CRC32 는 표를 직접 구현한다(zlib.crc32 는 node 22.2 이상이라 18.17 에서 쓸 수 없다).
// python zipfile 과 다른 점: 파일 시각이 고정값이고(python writestr 는 현재 시각), 외부 속성(유닉스 권한)을 쓰지 않는다. 그래서 zip 컨테이너 바이트는 다르지만
//   각 파트의 압축 해제 결과는 같다.

import zlib from 'node:zlib';

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

// ---- CRC32 (IEEE 802.3, 다항식 0xEDB88320) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- 읽기 ----
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

/**
 * zip 바이트를 파싱해 항목 표를 돌려준다.
 * @param {Buffer} buf
 * @returns {{names: string[], has(name): boolean, read(name): Buffer}}
 *   names 는 중앙 디렉터리 순서(python `namelist()` 와 같음, 같은 이름이 둘이면 둘 다 나오고 `read` 는 마지막 것).
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 22) throw new ZipError('zip 파일이 아니거나 깨졌습니다(끝 레코드 없음)');
  // 끝 레코드: 파일 끝에서 뒤로 최대 22 + 65535(주석) 바이트 안에서 찾는다.
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('zip 파일이 아니거나 깨졌습니다(끝 레코드 없음)');
  const total = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  // 끝 레코드 값이 0xFFFF·0xFFFFFFFF 일 때만 ZIP64 를 따라가야 한다. ZIP64 끝 위치 표지(locator)가 있어도 값이 정상 범위면
  // 일반 끝 레코드 값이 맞다(ZIP 명세는 필드가 가득 찰 때만 ZIP64 레코드를 쓰게 한다).
  if (total === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff) {
    if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOC) throw new ZipError('ZIP64 는 지원하지 않습니다');
    throw new ZipError('zip 파일이 깨졌습니다(끝 레코드 값이 ZIP64 표시인데 ZIP64 끝 레코드가 없음)');
  }
  if (cenOffset + cenSize > eocd) throw new ZipError('zip 파일이 깨졌습니다(중앙 디렉터리 범위)');

  const entries = [];
  const byName = new Map();
  let p = cenOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) throw new ZipError('zip 파일이 깨졌습니다(중앙 디렉터리 항목)');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new ZipError('zip 파일이 깨졌습니다(이름 길이)');
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('ZIP64 는 지원하지 않습니다');
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    // 비 UTF-8 이름은 python 이 cp437 로 읽는다. 이 도구가 찾는 이름은 모두 ASCII 라 latin1 로 근사한다.
    const name = flags & 0x800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1');
    const entry = { name, flags, method, crc, csize, usize, localOffset };
    entries.push(entry);
    byName.set(name, entry);
    p += 46 + nameLen + extraLen + commentLen;
  }

  const read = (name) => {
    const e = byName.get(name);
    if (!e) throw new ZipError(`zip 안에 ${name} 항목이 없습니다`);
    if (e.flags & 0x1) throw new ZipError(`암호화된 항목은 지원하지 않습니다: ${name}`);
    if (e.method !== 0 && e.method !== 8) throw new ZipError(`지원하지 않는 압축 방식(${e.method}): ${name}`);
    const lo = e.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOC) throw new ZipError(`zip 파일이 깨졌습니다(로컬 헤더): ${name}`);
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    if (start + e.csize > buf.length) throw new ZipError(`zip 파일이 깨졌습니다(데이터 범위): ${name}`);
    const raw = buf.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        data = zlib.inflateRawSync(raw);
      } catch (err) {
        throw new ZipError(`압축을 풀 수 없습니다(${name}): ${err.message}`);
      }
    }
    if (data.length !== e.usize) throw new ZipError(`크기가 맞지 않습니다: ${name}`);
    if (crc32(data) !== e.crc) throw new ZipError(`CRC 가 맞지 않습니다: ${name}`);
    return data;
  };

  return {
    names: entries.map((e) => e.name),
    has: (name) => byName.has(name),
    read,
  };
}

// ---- 쓰기 ----
// DOS 시각: 1980-01-01 00:00:00  → 날짜 = ((1980-1980)<<9)|(1<<5)|1 = 0x0021, 시간 = 0
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/**
 * 항목 목록으로 zip 바이트를 만든다.
 * @param {{name: string, data: string|Buffer, store?: boolean}[]} entries 문자열은 UTF-8 로 인코딩한다. store:true 면 압축하지 않고 stored(0)로 쓴다.
 * @returns {Buffer}
 */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store = false } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const flags = nameBuf.some((b) => b > 0x7f) ? 0x800 : 0;
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const method = store ? 0 : 8;
    const comp = store ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    if (raw.length > 0xfffffffe || comp.length > 0xfffffffe || offset > 0xfffffffe) throw new ZipError('ZIP64 가 필요한 크기는 지원하지 않습니다');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOC, 0);
    lh.writeUInt16LE(store ? 10 : 20, 4); // 필요한 버전 1.0(stored) / 2.0(deflate)
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8); // 8 = deflate, 0 = stored
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CEN, 0);
    ch.writeUInt16LE(20, 4); // 만든 버전 2.0, 호스트 MS-DOS(0)
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    // extra(30)·comment(32)·disk(34)·내부 속성(36)·외부 속성(38) 은 0
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  if (entries.length > 0xfffe) throw new ZipError('항목이 너무 많습니다(ZIP64 필요)');
  const cen = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cen.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, end]);
}
