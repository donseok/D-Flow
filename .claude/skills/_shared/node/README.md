# 공용 node 헬퍼 (L0)

python 스크립트를 node 로 이식하는 레인들이 함께 쓰는 헬퍼다. 이식 계획(스킬 윈도우 호환 §4.2·§7 L0)은
dmes-standard 리포에서 세웠고 이 폴더는 그 결과물 사본이다 — D-Flow 에는 dflow-wbs·dflow-wbs-nlevel·dflow-export 가 쓴다(2026-10-19).

- 코드는 ESM `.mjs`, 외부 npm 의존성 0, **node 18.17 이상**(`node:test`, `util.parseArgs`, `fs.cpSync` 만 사용. 20+ 전용 API 금지).
- 경로는 `node:path` 로 다루고 임시 폴더는 `os.tmpdir()` 만 쓴다(`/tmp` 하드코딩 금지).
- 레인 스킬에서는 상대 경로로 import 한다. 스킬 폴더 `.claude/skills/<스킬>/scripts/x.mjs` 기준:

```js
import { readText, writeText } from '../../_shared/node/io.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { parseCli, exitUsage, finish, OK, VIOLATION, USAGE } from '../../_shared/node/args.mjs';
```

시험 파일(`<스킬>/tests/x.test.mjs`)에서는 `../../_shared/node/…` 가 된다. 깊이가 다르면 `..` 개수만 맞춘다.

## 모듈

**io.mjs** — `readText(path)` 는 UTF-8 로 읽고 앞의 BOM 을 지우며 `\r\n`·`\r` 을 `\n` 으로 바꾼다(python universal newlines 와 같음).
`writeText(path, text, {mkdirp})` 는 줄끝 변환 없이 LF 그대로 쓴다. `readJson`, `writeJson(path, value, {indent=2, ensureAscii=false, trailingNewline=true, sortKeys, mkdirp})`
(내부에서 `pyJsonDumps` 를 쓰므로 python `json.dump` 와 같은 모양). `readStdinText({normalizeEol=true})` 는 비동기(`await`),
`readStdinTextSync` 는 동기 판이며 둘 다 BOM 을 지운다. `normalizeText(text, {eol})` 도 노출한다.

**pyjson.mjs** — `pyJsonDumps(value, {indent=null, ensureAscii=true, sortKeys=false})` 는 python `json.dumps` 와 바이트까지 같다.
indent 가 없으면 구분자 `", "`·`": "`, 숫자·문자열이면 `","`+줄바꿈과 `": "`(0 도 줄바꿈), 빈 컨테이너는 `[]`·`{}`,
ensure_ascii 는 비 ASCII·DEL 을 소문자 `\uxxxx`(서로게이트 쌍 포함)로 쓴다. float 은 `pyFloat(1)` 로 감싸면 `1.0`, 지수 표기도 python repr 과 같다.
`Map` 입력은 삽입순을 유지한다. 한계: ① JS 에는 int/float 구분이 없어 정수형 값은 정수로 출력(float 이어야 하면 `pyFloat`), `-0` 은 `0`,
② 일반 객체의 정수형 문자열 키(`"10"`, `"2"`)는 JS 가 오름차순으로 재배치하므로 삽입순이 필요하면 `Map` 을 쓴다,
③ `undefined`·`Set`·`Date`·순환 참조는 TypeError. 골든 비교의 바탕이다.

**args.mjs** — `parseCli(argv, spec)` 는 `util.parseArgs` 위의 얇은 argparse 대응 래퍼다. spec 은
`{prog, description, options:{이름:{type:'string'|'boolean'|'int'|'number', short, multiple, required, choices, default}}, positionals:[{name, required, variadic, choices}], commands:{명령:{options, positionals}}}`.
결과는 `{command, values, positionals}`. 알 수 없는 옵션·필수 누락·잘못된 choices·초과 인자는 stderr 에 `사용: …` 와 `<prog>: 오류: …` 를 쓰고
종료 코드 2 를 지정한 뒤 `null` 을 돌려준다(`-h/--help` 는 0). 호출 쪽은 `const cli = parseCli(process.argv.slice(2), spec); if (!cli) return;`.
`exitUsage(msg, {usage, prog})` 도 직접 쓸 수 있다. 전역 옵션은 서브커맨드 앞에 둔다(argparse 와 같음). 한계: 긴 옵션 접두 축약 없음, 결과 키는 옵션 이름 그대로(`dry-run` ≠ `dry_run`).
종료 코드 상수 `OK=0, VIOLATION=1, USAGE=2` 와 `finish(code)` 는 `exit.mjs` 에 있고 args.mjs 가 다시 내보낸다.
`finish(code)` 는 `process.exitCode` 만 지정하고 반환한다. `process.exit()` 를 직접 부르면 큰 stdout(파이프)이 잘릴 수 있으므로 쓰지 않는다: `return finish(VIOLATION);`

**paths.mjs** — `toPosix(p)`(역슬래시→슬래시), `repoRootFrom(startDir)`(위로 올라가며 `.git` 폴더 또는 파일(워크트리) 탐색, 없으면 null),
`findUp(startDir, name)`, `expandHome(p)`(`~`·`~/`·`~\`). `walkSorted(root, {skipDirs, extensions, followSymlinks=false, includeDirs=false, order='path'})` 는
재귀 열거 결과를 코드포인트 순으로 항상 같게 돌려준다(`localeCompare` 금지). 기본 `order:'path'` 는 python `sorted(Path.rglob)` 와 같은 **성분별** 비교(`a/b.md` 가 `a-c.md` 앞),
`'string'` 은 상대 경로 문자열 통째 비교(`sorted(str(p))` 대응). 대소문자는 항상 구분한다(윈도우 python Path 는 무시하므로 차이 가능).

**heap.mjs** — `new MinHeap(compare=compareTuples, items=[])` 는 python `heapq` 알고리즘을 그대로 옮긴 최소 힙이다(동률에서도 pop 순서가 같음).
`push`, `pop`(빈 힙이면 undefined), `peek`, `size`(**getter 이므로 `heap.size > 0`**, 함수 호출 아님). `compareTuples(a,b)` 는 python 튜플 비교(요소 순서, 짧은 쪽이 작음, 문자열은 코드포인트 순, 형식 불일치는 TypeError).

**pytext.mjs** — `splitlinesPy(text, keepends=false)` 는 python `str.splitlines` 의 분할 문자(`\n \r \r\n \v \f \x1c \x1d \x1e \x85 \u2028 \u2029`)를 따른다.
`pyMatch(re, s)`(=`re.match`)와 `pyFullMatch` 는 정규식 소스를 바꾸지 않고 sticky(`y`) 플래그로 시작 위치에서만 시도한다(`^(?:…)` 로 감싸면 `m` 플래그에서 줄 시작마다 일치하므로).
`pyRe(source, flags, {unicode})` 는 python 문법을 JS RegExp 로 변환한다: `(?P<n>)`→`(?<n>)`, `(?P=n)`→`\k<n>`, 선행 `(?i)(?s)(?m)` → 플래그, `\A`·`\Z`, `(?#…)` 제거, 클래스 첫머리 `]`,
python `$`(끝 `\n` 앞도 일치)·`.`(`\n` 만 제외). `unicode:true` 면 `\w \d` 를 유니코드로. 지원 못하는 구문(`(?x)`, 조건 `(?(1)…)`, 중간 인라인 플래그 등)은 Error.
`compareCodePoint(a,b)` 는 python 문자열 비교와 같은 정렬 함수(`arr.sort(compareCodePoint)`).

**proc.mjs** — `runNode(script, args, {input, cwd, env, normalizeEol})` 는 `process.execPath` 로 실행해 `{status, stdout, stderr}` 를 돌려준다(신호·실행 실패는 status -1 + `error`/`signal`;
env 는 process.env 위에 덮어씀; CRLF 는 그대로 두고 `normalizeEol:true` 면 LF). `runCommand(cmd, args, opts)`(옵션 `shell`, `timeout` 추가).
`findPython()` 은 `python3`·`python` 을 `--version` 으로 실제 실행해 "Python 3.x" 가 나오는 첫 명령(Microsoft Store 스텁·실패는 건너뜀)을 돌려주고 없으면 null(결과 캐시, `{refresh:true}`;
환경 변수 `DMES_NO_PYTHON=1` 이면 항상 null). `resolveBin(projectRoot, name)` 은 `node_modules/.bin/<name>` 을 찾고 윈도우면 `.cmd` 를 우선한다 — 윈도우의 `.cmd` 는
`runCommand(bin, args, {shell:true})` 로 부르거나 패키지의 bin 스크립트를 `node <패키지 bin>` 으로 직접 실행한다. `makeTempDir(prefix)` 는 `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`.
임시 폴더는 만든 쪽이 `fs.rmSync(dir, {recursive:true, force:true})` 로 지운다.

**golden.mjs** — `compareGolden({python:{cmd, input, cwd, env}, node:{script, args, input, cwd, env}, input, cwd, normalize:{eol:true, trimEnd:false}, compare:['stdout','status','stderr']}, {python})`
는 같은 입력으로 python 판과 node 판을 돌려 `{ok, diffs:[{field, python, node}], python, node}` 를 돌려준다. `python.cmd` 는 **인터프리터를 뺀** `[스크립트, ...인자]` 다(맨 앞이 `python3` 면 자동 제거).
python 은 `PYTHONDONTWRITEBYTECODE=1`·`PYTHONUTF8=1` 로 실행해 `__pycache__` 를 남기지 않는다. python 이 없으면 `{skipped:true, reason, ok:null}`. `formatDiffs(result)` 는 첫 차이 위치를 포함한 문자열.
`goldenTest(name, spec, opts)` 는 `node:test` 용으로, 스킵 시 `t.skip(reason)`, 차이가 있으면 실패한다.

**pyrepr.mjs** — `pyReprStr(s)`(python `repr(str)`: 작은따옴표 기본, `'` 만 있으면 큰따옴표, 제어·비출력 문자는 `\xNN`·`\uNNNN`)와
`pyReprStrList(items)`(`['V1', 'V2']`). 이식한 도구가 `{x!r}`·`{list}` 로 출력하던 자리를 바이트까지 맞출 때 쓴다.

**goldentool.mjs** — 파일을 만드는 도구용 골든 비교. `compareToolGolden({legacy, script, setup(root), args, replacePython, statusOnly})` 는
python 판과 node 판을 **각자 새 임시 저장소**(realpath)에서 같은 인자로 돌려(`--root` 는 자동으로 붙임) stdout·stderr(저장소 경로는 `<ROOT>` 로 치환)·종료 코드와
**저장소에 남은 파일 전체(바이트)** 를 비교한다. `goldenToolTest(name, spec)` 은 `node:test` 용(python 이 없으면 skip).
`statusOnly:true` 는 argparse 사용 오류처럼 문구가 다른 경우에 종료 코드만 본다. 사용 예: `adr-write/tests/golden.test.mjs`.

**squash-branch.mjs** — CLI. 레인·작업 브랜치를 통합 브랜치 위 commit 하나로 합친다(통합 브랜치 모양 = 레인·작업당 commit 1, merge commit 없음, `git merge --ff-only`; 2026-10-10).
`node squash-branch.mjs --onto <통합브랜치|ref> --subject "<제목>" [--rebase] [--body-file f] [--trailer "K: v"] [--drop-trailer K] [--dry-run]`.
출력 `SQUASH_OK <old> → <new> commits=<n> [rebased=<tip>]` · `SQUASH_NOTHING` · `SQUASH_ALREADY_ONE <sha>` · `SQUASH_REBASED <old> → <new> onto=<tip>` · `SQUASH_DIRTY`(2) · `SQUASH_NO_ONTO`(2) · `SQUASH_NEED_SUBJECT`(2) · `SQUASH_TREE_MISMATCH`(1, 원래 HEAD 로 복원) · `SQUASH_REBASE_CONFLICT <파일…>`(3, 원래 HEAD 로 복원).
`--rebase` = 합친 commit 을 통합 브랜치 tip 위로 옮김(통합 브랜치가 앞서 갔을 때). 통합 브랜치를 먼저 합쳐 두면 merge-base 가 tip 으로 옮겨 가서 레인 변경만 한 commit 에 담긴다. 본문 = 합친 commit 제목 목록 + 메시지 trailer(중복 제거). 시험 = `tests/squash-branch.test.mjs`.

## 이식 체크리스트

1. **CRLF 정규화**: 읽기는 `readText`(BOM 제거 + `\r\n?`→`\n`), 쓰기는 `writeText`(LF 그대로). 윈도우 python 의 `write_text` 는 CRLF 로 쓰는 함정이 있었다. CSV 입력은 `utf-8-sig` 이므로 같은 `readText` 를 쓴다.
2. **종료 코드 규약**: 사용 오류 2(argparse 와 동일), 검사 위반 1, 정상 0. `process.exit()` 대신 `return finish(code)`.
3. **JSON 출력**: `indent=2` 는 `JSON.stringify(x,null,2)` 와 같지만 바이트 비교(골든)에는 `pyJsonDumps` 를 쓴다. 정수형 키 재배치·정수형 float 한계는 위 pyjson 항목 참고(`Map`, `pyFloat`).
4. **`re.match`/`re.fullmatch`/`$`/`.`**: JS 에는 암묵 앵커가 없다. `pyMatch`·`pyFullMatch`·`pyRe` 를 쓰거나 앵커를 직접 쓴다. 인라인 `(?i)` 와 `\Z` 는 `pyRe` 가 변환한다.
5. **유니코드 `\w`·`\b`**: JS `\w` 는 ASCII 뿐이다. 한글이 식별자·ID 에 들어가면 `pyRe(src, '', {unicode:true})` 또는 `\p{L}\p{N}_` 를 쓴다. `\b` 는 u 모드에서도 ASCII 기준이다.
6. **파일 열거 정렬**: `glob`/`rglob` 순서는 보장이 없다. `walkSorted` 로 코드포인트 순 고정, 정렬은 `compareCodePoint`(`localeCompare` 금지). python 이 `sorted(Path)` 인지 `sorted(str)` 인지에 맞춰 `order` 를 고른다.
7. **윈도우 `.bin` 호출**: `node_modules/.bin/tsc` 는 윈도우에서 `tsc.cmd` 다. `resolveBin` + `shell:true`, 또는 `node <패키지 bin>`.
8. **node 18.17 하한**: `readdirSync({recursive})`(20.1+), `zlib.crc32`(22.2+), `import.meta.dirname`(20.11+), `Array.prototype.toSorted`(20+) 등은 쓰지 않는다.
9. 그 밖: `str.splitlines()` 는 `splitlinesPy`, `heapq` 는 `MinHeap`, `tempfile` 은 `makeTempDir`, `subprocess`+`sys.executable` 은 `runNode`.

## 골든 비교 규약

- macOS 에는 python 이 있으므로 **같은 입력으로 python 판과 node 판 출력을 diff** 하는 시험을 레인마다 둔다(서버 계약이 걸린 `wbs-parse --export`, `wbs-nlevel-parse export`, `check_oasis_contract --json` 은 필수, byte 동일).
- 픽스처 위치: `<레인 폴더>/tests/golden/` (예: `.claude/skills/dflow-export/tests/golden/`). 입력 파일은 `tests/golden/inputs/`(실제 wbs 와 합성 입력),
  시험 파일은 `tests/golden.test.mjs` 하나에서 `goldenTest()` 로 케이스를 등록한다.
- python 이 없는 PC(윈도우)에서는 `goldenTest` 가 skip 하므로 시험이 실패하지 않는다. node 판 단독 회귀는 레인의 일반 시험이 맡는다.
- 전환 순서(계획 §4.2): ① node 판 추가 + 골든 시험 통과 → ② 호출 문서(SKILL.md, README, RULE.md, FE 가이드, `.dflow-gates`, `.claude/settings.json`)를 node 로 교체 → ③ **python 판 삭제는 별도 커밋**(사용자 승인).

## 시험

```bash
node --test .claude/skills/_shared/node/tests/
```

모든 시험은 `makeTempDir` 로 만든 임시 폴더만 쓰고 끝나면 스스로 지운다. python3 가 있으면 실제 python 과 바이트·순서를 비교하고,
없으면(또는 `DMES_NO_PYTHON=1`) 미리 계산해 시험 파일에 박아 둔 기대값과 비교하며 python 전용 시험은 skip 된다.
`tests/*.test.mjs` 의 `// <<GEN:START>>` 블록은 기대값 상수이며 이 PC 의 python 3.9 로 생성했다(손으로 고치지 않는다).
