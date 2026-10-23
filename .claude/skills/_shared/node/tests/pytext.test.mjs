import test from 'node:test';
import assert from 'node:assert/strict';
import { splitlinesPy, pyMatch, pyFullMatch, pyRe, compareCodePoint } from '../pytext.mjs';
import { findPython, runCommand } from '../proc.mjs';

// <<GEN:START>> (scratch generator 가 이 PC 의 python3 로 만든 기대값. 손으로 고치지 말 것)
const DATA = {
 "samples": [
  "\"\"",
  "\"a\"",
  "\"a\\n\"",
  "\"a\\n\\n\"",
  "\"a\\r\\nb\\rc\\nd\"",
  "\"a\\u000bb\\u000cc\\u001cd\\u001de\\u001ef\\u0085g\\u2028h\\u2029i\"",
  "\"\\r\\n\\r\\n\"",
  "\"\\n\"",
  "\"\ud55c\uae00\\r\\n\ub458\uc9f8 \uc904\\r\"",
  "\"x\\r\\r\\ny\"",
  "\"  \\u2028\"",
  "\"end\\u0085\""
 ],
 "expected": [
  [
   [],
   []
  ],
  [
   [
    "a"
   ],
   [
    "a"
   ]
  ],
  [
   [
    "a"
   ],
   [
    "a\n"
   ]
  ],
  [
   [
    "a",
    ""
   ],
   [
    "a\n",
    "\n"
   ]
  ],
  [
   [
    "a",
    "b",
    "c",
    "d"
   ],
   [
    "a\r\n",
    "b\r",
    "c\n",
    "d"
   ]
  ],
  [
   [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i"
   ],
   [
    "a\u000b",
    "b\f",
    "c\u001c",
    "d\u001d",
    "e\u001e",
    "f\u0085",
    "g\u2028",
    "h\u2029",
    "i"
   ]
  ],
  [
   [
    "",
    ""
   ],
   [
    "\r\n",
    "\r\n"
   ]
  ],
  [
   [
    ""
   ],
   [
    "\n"
   ]
  ],
  [
   [
    "\ud55c\uae00",
    "\ub458\uc9f8 \uc904"
   ],
   [
    "\ud55c\uae00\r\n",
    "\ub458\uc9f8 \uc904\r"
   ]
  ],
  [
   [
    "x",
    "",
    "y"
   ],
   [
    "x\r",
    "\r\n",
    "y"
   ]
  ],
  [
   [
    "  "
   ],
   [
    "  \u2028"
   ]
  ],
  [
   [
    "end"
   ],
   [
    "end\u0085"
   ]
  ]
 ]
};
// <<GEN:END>>

test('splitlinesPy: python str.splitlines 를 미리 계산한 값과 비교', () => {
  DATA.samples.forEach((text, i) => {
    const s = JSON.parse(text);
    assert.deepEqual(splitlinesPy(s), DATA.expected[i][0], `keepends=false #${i}`);
    assert.deepEqual(splitlinesPy(s, true), DATA.expected[i][1], `keepends=true #${i}`);
  });
});

test('splitlinesPy: python 이 있으면 실제 splitlines 와 비교', (t) => {
  const py = findPython();
  if (!py) return t.skip('python3 없음');
  const script = 'import sys, json\nreq = json.load(sys.stdin)\nprint(json.dumps([[json.loads(x).splitlines(), json.loads(x).splitlines(True)] for x in req]))';
  const r = runCommand(py, ['-c', script], { input: JSON.stringify(DATA.samples), env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  DATA.samples.forEach((text, i) => {
    const s = JSON.parse(text);
    assert.deepEqual(splitlinesPy(s), out[i][0]);
    assert.deepEqual(splitlinesPy(s, true), out[i][1]);
  });
});

test('pyMatch / pyFullMatch: 시작·전체 일치 (m 플래그에서도 시작에서만)', () => {
  assert.ok(pyMatch(/ab/, 'abc'));
  assert.equal(pyMatch(/b/, 'abc'), null);
  assert.equal(pyMatch(/b/m, 'a\nb'), null); // ^(?:…) 로 감싸면 여기서 잘못 일치한다
  assert.equal(pyMatch(/(?<n>\d+)/, '12x').groups.n, '12');
  assert.ok(pyMatch(/a|ab/, 'abc'));
  assert.equal(pyFullMatch(/a|ab/, 'abc'), null);
  assert.ok(pyFullMatch(/a|ab/, 'ab')); // 역추적으로 전체 일치를 찾는다
  assert.equal(pyFullMatch(/\d+/, '12a'), null);
  assert.ok(pyFullMatch(/\d+/g, '123')); // g 플래그 상태에 영향받지 않는다
  assert.ok(pyFullMatch(/\d+/g, '123'));
  assert.ok(pyMatch('[a-z]+', 'abc')); // 문자열은 pyRe 로 변환
});

test('pyRe: 이름 그룹·역참조·인라인 플래그·\\A \\Z', () => {
  const r = pyRe('(?P<q>["\'])(?P<body>.*?)(?P=q)');
  assert.equal(r.exec('say "hi" now').groups.body, 'hi');
  assert.equal(pyRe('(?i)abc').flags, 'i');
  assert.ok(pyRe('(?i)ABC').test('xabcx'));
  assert.ok(pyRe('(?s)a.b').test('a\nb'));
  assert.ok(!pyRe('a.b').test('a\nb'));
  assert.ok(pyRe('a.b').test('a\rb')); // python 의 . 은 \n 만 제외
  assert.ok(pyRe('(?im)^b$').test('A\nB\nC'));
  assert.ok(pyRe('(?is)x').flags.includes('i') && pyRe('(?is)x').flags.includes('s'));
  assert.ok(pyRe('\\Aab\\Z').test('ab'));
  assert.ok(!pyRe('\\Aab\\Z').test('ab\n')); // \Z 는 진짜 끝만
  assert.ok(pyRe('^ab$').test('ab\n')); // python $ 는 끝 개행 앞에서도 일치
  assert.ok(!pyRe('^ab$').test('ab\n\n'));
  assert.ok(!pyRe('\\Ab', 'm').test('a\nb')); // m 에서도 \A 는 문자열 시작만
  assert.ok(pyRe('[]a]+').test(']a')); // 클래스 첫머리 ]
  assert.ok(pyRe('a(?#주석)b').test('ab'));
  assert.ok(pyRe('(?<=a)b(?!c)').test('ab'));
  assert.ok(pyRe('x', 'g').global);
});

test('pyRe: unicode 옵션의 \\w \\d, 지원하지 못하는 구문은 Error', () => {
  assert.equal('가나_다1 x'.match(pyRe('\\w+', '', { unicode: true }))[0], '가나_다1');
  assert.equal('가나'.match(/\w+/), null); // 기본 JS \w 는 ASCII 만
  assert.equal('x가-'.match(pyRe('[\\w]+', '', { unicode: true }))[0], 'x가');
  assert.equal('٣'.match(pyRe('\\d', '', { unicode: true }))[0], '٣');
  assert.throws(() => pyRe('(?x) a b'), /지원하지 않는/);
  assert.throws(() => pyRe('(a)(?(1)b|c)'), /지원하지 않는/);
  assert.throws(() => pyRe('a(?i:b)'), /지원하지 않는/);
  assert.throws(() => pyRe('\\N{DASH}'), /지원하지 않는/);
  assert.throws(() => pyRe('[\\Z]'), /잘못된/);
  assert.throws(() => pyRe('(?P>x)'), /지원하지 않는/);
});

test('compareCodePoint: 코드포인트 순 (U+E000 < 비 BMP)', () => {
  const emoji = String.fromCodePoint(0x1f600);
  const pua = String.fromCodePoint(0xe000);
  assert.ok(compareCodePoint(pua, emoji) < 0); // JS 기본 비교는 반대
  assert.ok(pua > emoji);
  assert.deepEqual(['b', 'B', 'a', '가', 'A'].sort(compareCodePoint), ['A', 'B', 'a', 'b', '가']);
  assert.equal(compareCodePoint('ab', 'ab'), 0);
  assert.ok(compareCodePoint('a', 'ab') < 0);
});
