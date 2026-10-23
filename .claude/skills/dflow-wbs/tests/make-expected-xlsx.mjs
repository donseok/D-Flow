// golden/expected/xlsx.json 을 python 블록(SKILL.md 에 있던 원문의 동결 사본)으로 다시 계산한다(python3 필요).
// 사용: node .claude/skills/dflow-wbs/tests/make-expected-xlsx.mjs --write
// (--write 없이 실행하면 아무것도 하지 않는다: `node --test tests/` 가 폴더의 모든 .mjs 를 실행해도 덮어쓰지 않도록)
// 사례를 바꿨거나 python 쪽 동작을 의도적으로 바꾼 뒤에만 실행하고, 결과 diff 를 눈으로 확인한다.
//
// 내용: write.<사례> = python write_xlsx 가 만든 zip 의 파트 이름 순서와 파트 내용(zip 컨테이너 바이트는 시각이 들어 있어 비교하지 않음),
//       read.<사례>  = python 읽기 블록의 {status, stdout}(오류 사례는 stdout 이 비고 status 1), badzip.<사례> = {status}.
//       2만 자를 넘는 값은 {sha256, length} 로 줄인다.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../../_shared/node/io.mjs';
import { findPython, makeTempDir, runCommand } from '../../_shared/node/proc.mjs';
import { BAD_ZIP_CASES, READ_CASES, WRITE_CASES, buildFixtureZip } from './xlsx-cases.mjs';
import { pyTools } from './xlsx-pyrun.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 큰 문자열은 해시로 줄인다 (기대값 파일 크기 제한) */
export function digest(text) {
  if (text.length <= 20000) return text;
  return { sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), length: text.length };
}

if (!process.argv.includes('--write')) {
  console.log('xlsx.json 은 --write 를 줄 때만 다시 만든다');
} else {
  const py = findPython();
  if (!py) {
    console.error('python3 를 찾지 못했다');
    process.exitCode = 1;
  } else {
    const tmp = makeTempDir('xlsx-expected-');
    try {
      const tools = pyTools(py, tmp);
      const version = runCommand(py, ['--version']);
      const out = { generatedWith: (version.stdout + version.stderr).trim(), write: {}, read: {}, badzip: {} };
      for (const c of WRITE_CASES) {
        const rowsFile = path.join(tmp, `${c.name}.json`);
        fs.writeFileSync(rowsFile, c.json);
        const xlsx = path.join(tmp, `${c.name}.py.xlsx`);
        const r = tools.write(xlsx, rowsFile);
        if (r.status !== 0) throw new Error(`python 쓰기 실패(${c.name}): ${r.stderr}`);
        const d = tools.dump(xlsx);
        if (d.testzip !== null) throw new Error(`testzip 실패(${c.name})`);
        out.write[c.name] = { names: d.names, parts: Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, digest(v)])) };
      }
      for (const c of READ_CASES) {
        const file = path.join(tmp, `${c.name}.xlsx`);
        fs.writeFileSync(file, buildFixtureZip(c));
        const r = tools.read(file);
        if (!!c.error !== (r.status !== 0)) throw new Error(`사례 ${c.name}: error=${!!c.error} 인데 python status=${r.status}\n${r.stderr}`);
        out.read[c.name] = { status: r.status, stdout: digest(r.stdout) };
      }
      for (const c of BAD_ZIP_CASES) {
        const file = path.join(tmp, `${c.name}.xlsx`);
        fs.writeFileSync(file, c.bytes());
        const r = tools.read(file);
        if (r.status !== 1) throw new Error(`깨진 zip ${c.name}: python status=${r.status}`);
        out.badzip[c.name] = { status: r.status };
      }
      writeJson(path.join(HERE, 'golden', 'expected', 'xlsx.json'), out, { indent: 1, mkdirp: true });
      console.log(`쓰기 사례 ${WRITE_CASES.length}, 읽기 사례 ${READ_CASES.length}, 깨진 zip ${BAD_ZIP_CASES.length}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
