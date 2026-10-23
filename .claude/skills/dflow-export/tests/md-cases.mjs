// md-cases.mjs — _wbs_md 골든·기대값 시험이 함께 쓰는 문서 모음과 python 쪽 드라이버, node 쪽 계산 함수.
// 문서에는 비 BMP 문자(이모지)를 넣지 않는다 — 오프셋 단위(python 코드포인트 / JS UTF-16)가 달라지기 때문이다.

import { FENCE_RE, _fenced_ranges, _in_ranges, line_start_offsets } from '../scripts/_wbs_md.mjs';
import { FILES } from './validate-cases.mjs';

export const DOCS = {
  empty: '',
  newline: '\n',
  'no-fence': '# a\n## b\ntext\n',
  simple: '# t\n```\n## x\n```\n## y\n',
  tilde: '~~~\n# c\n~~~\n',
  mixed: '```\n# a\n~~~\n# b\n```\n~~~\n',
  'four-backtick': '````md\n```\n# in\n```\n````\n',
  indent3: '   ```\n# a\n   ```\n',
  indent4: '    ```\n# a\n    ```\n',
  'info-string': '```bash title="x"\n# a\n```\n',
  unclosed: '# t\n```\n# a\n',
  odd: '```\na\n```\nb\n```\nc\n',
  'eof-fence': 'x\n```',
  'crlf-raw': 'a\r\n```\r\n# x\r\n```\r\n',
  'cr-only': 'a\r```\r# x\r```\r',
  'unicode-breaks': 'a ```\nb ```\nc\f```\nd\v```\ne\u0085```\n```\nz\n```\n',
  'fs-gs': 'a\u001c```\nb\u001d```\n```\nz\n```\n',
  list: '- 참고:\n  ```bash\n  # c\n  ```\n- 다음\n',
  korean: '# 제목\n```\n한글 # 주석\n```\n본문\n',
  ...Object.fromEntries(Object.entries(FILES).filter(([n, t]) => !n.includes('/') && n.endsWith('.md') && !/[\u{10000}-\u{10FFFF}]/u.test(t)).map(([n, t]) => [`file ${n}`, t])),
};

export const PY_MD_DRIVER = `
import json, sys
sys.path.insert(0, sys.argv[1])
import _wbs_md as M
docs = json.load(sys.stdin)
out = {}
for k, d in docs.items():
    ranges = M._fenced_ranges(d)
    offs = M.line_start_offsets(d)
    out[k] = {
        "matches": [m.start() for m in M.FENCE_RE.finditer(d)],
        "ranges": [list(r) for r in ranges],
        "offsets": offs,
        "inside": [M._in_ranges(o, ranges) for o in offs],
    }
print(json.dumps(out))
`;

export function nodeMd() {
  const out = {};
  for (const [k, d] of Object.entries(DOCS)) {
    const ranges = _fenced_ranges(d);
    const offs = line_start_offsets(d);
    out[k] = {
      matches: [...d.matchAll(FENCE_RE)].map((m) => m.index),
      ranges: ranges.map((r) => [...r]),
      offsets: offs,
      inside: offs.map((o) => _in_ranges(o, ranges)),
    };
  }
  return out;
}

