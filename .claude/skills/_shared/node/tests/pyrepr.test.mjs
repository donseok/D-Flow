import test from 'node:test';
import assert from 'node:assert/strict';
import { pyReprStr, pyReprStrList } from '../pyrepr.mjs';
import { findPython, runCommand } from '../proc.mjs';

const CASES = [
  'abc',
  '',
  "it's",
  'say "hi"',
  'it\'s "both"',
  'a\tb\nc\rd',
  'back\\slash',
  '한글 제목',
  '✅ ACCEPTED',
  '😀 emoji',
  'nul\x00 del\x7f',
  '\x85 next-line',
  '  nbsp',
  '​ zero width',
  '  line sep',
  'é ü',
];

test('pyReprStr: 기대값(python 3.9 로 생성)', () => {
  assert.equal(pyReprStr('abc'), "'abc'");
  assert.equal(pyReprStr("it's"), '"it\'s"');
  assert.equal(pyReprStr('it\'s "both"'), "'it\\'s \"both\"'");
  assert.equal(pyReprStr('a\tb\nc\rd'), "'a\\tb\\nc\\rd'");
  assert.equal(pyReprStr('back\\slash'), "'back\\\\slash'");
  assert.equal(pyReprStr('한글 제목'), "'한글 제목'");
  assert.equal(pyReprStr('✅ ACCEPTED'), "'✅ ACCEPTED'");
  assert.equal(pyReprStr('nul\x00 del\x7f'), "'nul\\x00 del\\x7f'");
  assert.equal(pyReprStr(' '), "'\\xa0'");
  assert.equal(pyReprStr('​'), "'\\u200b'");
  assert.equal(pyReprStr(' '), "'\\u2028'");
});

test('pyReprStrList: 목록 모양', () => {
  assert.equal(pyReprStrList([]), '[]');
  assert.equal(pyReprStrList(['V1', 'V2']), "['V1', 'V2']");
  assert.equal(pyReprStrList(new Map([['a', 1]]).keys()), "['a']");
});

test('pyReprStr: python repr 과 같다(python 이 있을 때)', (t) => {
  const py = findPython();
  if (!py || process.env.DMES_NO_PYTHON === '1') {
    t.skip('python3 를 찾지 못해 건너뜀');
    return;
  }
  const code = 'import sys, json\nfor s in json.load(sys.stdin):\n    print(repr(s))\n';
  const r = runCommand(py, ['-c', code], { input: JSON.stringify(CASES), env: { PYTHONUTF8: '1' } });
  assert.equal(r.status, 0, r.stderr);
  const expected = r.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  // 줄바꿈 문자가 repr 에서 이스케이프되므로 한 줄에 하나씩 나온다.
  assert.deepEqual(CASES.map(pyReprStr), expected);
});
