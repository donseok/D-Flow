// xlsx 시험용 python 실행 도우미 — 동결한 python 블록(xlsx-legacy-python.mjs)을 임시 폴더에 원래 모양으로 풀어 돌린다.
// xlsx.test.mjs 와 make-expected-xlsx.mjs 가 함께 쓴다. python 이 없으면 호출하지 않는다(findPython() 이 null).

import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../_shared/node/proc.mjs';
import { READ_PY, WRITE_PY, WRITE_DRIVER } from './xlsx-legacy-python.mjs';

const DUMP_PY = `import sys, json, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"testzip": bad, "names": z.namelist(), "parts": {n: z.read(n).decode("utf-8") for n in z.namelist()}}, ensure_ascii=False))
`;

const OPENPYXL_PY = `import sys, json
import openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.worksheets[0]
print(json.dumps([[c.value for c in r] for r in ws.iter_rows()], ensure_ascii=False))
`;

const ENV = { PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

/** dir 에 python 스크립트 4개를 만들고 실행 함수들을 돌려준다. */
export function pyTools(py, dir) {
  const p = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };
  const readPy = p('xlsx_read_block.py', READ_PY);
  const writePy = p('xlsx_write_block.py', WRITE_PY + WRITE_DRIVER);
  const dumpPy = p('xlsx_dump.py', DUMP_PY);
  const opxPy = p('xlsx_openpyxl.py', OPENPYXL_PY);
  const run = (script, args) => runCommand(py, [script, ...args], { env: ENV });
  return {
    /** python 읽기 블록 → {status, stdout, stderr} */
    read: (xlsx) => run(readPy, [xlsx]),
    /** python write_xlsx 로 rows.json(json.load)을 xlsx 로 씀 */
    write: (out, rowsJsonFile) => run(writePy, [out, rowsJsonFile]),
    /** zip 안의 파트를 JSON 으로: {testzip, names, parts} */
    dump: (xlsx) => {
      const r = run(dumpPy, [xlsx]);
      if (r.status !== 0) throw new Error(`dump 실패: ${r.stderr}`);
      return JSON.parse(r.stdout);
    },
    /** openpyxl 이 있으면 첫 시트 값을 2차원 배열로, 없으면 null */
    openpyxl: (xlsx) => {
      const r = run(opxPy, [xlsx]);
      return r.status === 0 ? JSON.parse(r.stdout) : null;
    },
  };
}
