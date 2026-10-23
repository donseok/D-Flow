// _pyio.mjs — decision-log.mjs·prd-validate.mjs 가 함께 쓰는 python 호환 작은 도구.
//
//  - py_read_text(file): python `Path.read_text(encoding="utf-8")` 와 같다. 줄끝 `\r\n`·`\r` 을 `\n` 으로 바꾸되
//    **앞의 BOM(U+FEFF)은 지우지 않는다**(일반 utf-8 읽기는 BOM 을 남긴다. 이식 대상 두 스크립트가 BOM 때문에 어떻게
//    달라지는지까지 python 판과 같게 두려는 의도다). 잘못된 UTF-8 은 python 처럼 예외를 던진다.
//  - cp_slice(s, start, end): python `s[a:b]`(코드포인트 단위 슬라이스). JS 의 `slice` 는 UTF-16 단위라 이모지 같은
//    비 BMP 문자가 있으면 길이가 달라진다.
//  - cp_index(s, utf16Index): UTF-16 인덱스를 코드포인트 인덱스로 바꾼다(python `str.find` 결과와 맞추는 용도).
//  - argparse_compat_argv(argv, commands): util.parseArgs 가 받지 못하는, python argparse 는 받는 인자 모양을 고쳐 준다.
//      · 문자열 옵션의 값이 `-` 로 시작해도 공백이 들어 있거나 음수 모양이면(`--rationale "- 항목"`, `--x -1`) argparse 는 값으로 본다.
//        → `--옵션=값` 한 토큰으로 합친다.
//      · 긴 옵션 접두 축약(`--decision-n` → `--decision-needed`): 유일하게 정해질 때만 풀어 준다(모호하면 그대로 두어 사용 오류가 되게 한다).
//    commands = { 명령: { 옵션이름: 'string'|'boolean', ... } }. 서브커맨드 앞 전역 옵션은 없다고 본다(두 스크립트 모두 그렇다).

import fs from 'node:fs';

const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function py_read_text(file) {
  return DECODER.decode(fs.readFileSync(file)).replace(/\r\n?/g, '\n');
}

export function cp_slice(s, start, end) {
  return Array.from(s).slice(start, end).join('');
}

export function cp_index(s, utf16Index) {
  return Array.from(s.slice(0, utf16Index)).length;
}

const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

export function argparse_compat_argv(argv, commands) {
  const idx = argv.findIndex((t) => !t.startsWith('-') || t === '-');
  if (idx < 0) return argv;
  const cmd = commands[argv[idx]];
  if (!cmd) return argv;
  const longs = [...Object.keys(cmd), 'help'];
  const out = argv.slice(0, idx + 1);
  const rest = argv.slice(idx + 1);
  for (let i = 0; i < rest.length; i++) {
    let t = rest[i];
    if (t === '--') {
      out.push(...rest.slice(i));
      break;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
      if (!longs.includes(name)) {
        const hits = longs.filter((n) => n.startsWith(name));
        if (name !== '' && hits.length === 1) t = `--${hits[0]}${eq < 0 ? '' : t.slice(eq)}`;
      }
      const real = eq < 0 ? t.slice(2) : t.slice(2, t.indexOf('='));
      if (eq < 0 && cmd[real] === 'string' && i + 1 < rest.length) {
        const n = rest[i + 1];
        if (n.startsWith('-') && n.length > 1 && isValueLike(n, longs)) {
          out.push(`${t}=${n}`);
          i += 1;
          continue;
        }
      }
    }
    out.push(t);
  }
  return out;
}

// argparse `_parse_optional` 이 "옵션이 아니라 값/위치 인자"로 보는 `-` 시작 문자열인가.
function isValueLike(n, longs) {
  if (n === '--' || (n.startsWith('-h') && !n.startsWith('--'))) return false;
  if (n.startsWith('--')) {
    const eq = n.indexOf('=');
    const name = eq < 0 ? n.slice(2) : n.slice(2, eq);
    if (longs.includes(name)) return false; // 정확히 옵션(또는 옵션=값)
    if (longs.filter((x) => x.startsWith(name)).length >= 1 && name !== '') return false; // 접두 축약으로 옵션이 됨
  }
  if (NEGATIVE_NUMBER.test(n)) return true;
  return n.includes(' ');
}
