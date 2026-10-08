# UI-6 — 옛 색 토큰 별칭 삭제(2026-10-09)

개정 스펙 §5.5.5(이행표)·§5.5.7(`no-legacy-tokens`)·§5.12.5 SP9 ③. `globals.css` 의 `@theme inline` 호환 별칭 25개를 의미 토큰 이름으로
일괄 개명하고 별칭 블록을 지웠다. **이름만 바꿨다** — 색 값·토큰 값·마크업 구조는 그대로다. 기준 커밋 `488d7b33`(spu/issue-board).

## 대응표와 치환 건수(src)

별칭은 전부 `--color-<옛>: var(--color-<새>)` 한 줄(의미 토큰 하나를 가리키는 1:1 다른 이름)이었고, `.dark`·`@media print` 어디에서도
다시 정의되지 않았다(다크는 의미 토큰만 재정의한다). 1:1 이 아니어서 남긴 별칭은 **없다**.

| 옛 이름 | 새 이름 | 건수 | | 옛 이름 | 새 이름 | 건수 |
|---|---|---:|---|---|---|---:|
| `surface-2` | `surface-subtle` | 202 | | `accent-warning` | `warning` | 75 |
| `line` | `border` | 308 | | `done` | `success` | 105 |
| `line-strong` | `border-input` | 34 | | `done-weak` | `success-weak` | 36 |
| `ink` | `fg` | 419 | | `delayed` | `danger` | 331 |
| `ink-muted` | `fg-secondary` | 567 | | `delayed-weak` | `danger-weak` | 74 |
| `ink-subtle` | `fg-muted` | 526 | | `grid` | `border` | 23 |
| `brand` | `action` | 256 | | `grid-strong` | `border-input` | 5 |
| `brand-hover` | `action-hover` | 10 | | `sheet-head` | `surface-subtle` | 4 |
| `brand-weak` | `action-soft` | 106 | | `zebra` | `surface-zebra` | 2 |
| `brand-fg` | `action-fg` | 5 | | `hero-ink` | `fg` | 2 |
| `brand-ring` | `border-focus` | 47 | | `hero-ink-muted` | `fg-secondary` | 4 |
| `accent-secondary` | `warning` | 8 | | `hero-line` | `border` | 0 |
| `accent-ink` | `action` | 1 | | | | |

합계 **3,150건 · 190파일**(`src/**/*.{ts,tsx,css}` 974파일 중). 유틸의 색 자리(`text-ink-muted` → `text-fg-secondary`)와 변수 참조
(`var(--color-brand)` → `var(--color-action)`) 둘 다 센 수다. `scripts/codemod-legacy-tokens.mjs` 가 했고 멱등이다(`--check` 0건).

`globals.css` 는 별칭 블록(28줄) 삭제 말고도 **이름 치환 38줄**이 들어갔다 — `.minutes-md`·`.seg` 등의 `@apply text-ink …` 와
`var(--color-brand)` 가 별칭을 쓰고 있어, 블록만 지우면 빌드가 깨진다. 값·셀렉터·순서는 그대로이고 반응형 안전망 블록은 건드리지 않았다.

## 코드모드가 건드리지 않은 것

- 보간이 뒤따르는 유틸(`text-ink-${x}`)·모르는 접두 뒤의 별칭 이름은 고치지 않고 출력한다 — 실행 결과 색 유틸은 0건.
  출력된 것은 `hidden-project-ids-brand`(authz.ts 의 식별자 문자열)·`fully-done`(영어 사전 문구) 둘이고 색과 무관하다.
- 유틸 접두가 없는 낱말(`status === 'delayed'`, `tone: 'done'`, 변수 `line`, `grid grid-cols-2`, `line-clamp-2`, `data-done`)은 대상이 아니다.
- 스펙 §5.5.5 가 "용도별로 판정"이라 적은 둘은 판정하지 않고 기계적으로 옮겼다(픽셀 불변이 이 작업의 조건이라):
  `accent-secondary` → `warning`(스펙은 알림 수면 `action`), `line` → `border`(스펙은 입력 경계면 `border-input`).

## 동등성 검사

개명 전 빌드(`488d7b33`)의 `.next/static/css` 를 `/tmp/dflow-css-before/` 에 떠 두고, 개명 후 빌드와 대조했다.

1. **규칙 집합** — `node scripts/verify-legacy-token-equivalence.mjs <전> <후>`. 개명 전 CSS 의 셀렉터·선언에 대응표를 적용하면 개명 후 CSS 와
   같은지 본다(문맥·셀렉터·선언 목록까지). 결과: 세 파일 모두 한쪽에만 있는 규칙 **0**, 서로 다른 규칙 2,107개 일치(큰 파일 1,906 → 1,836 은
   `border-line`·`border-grid` 처럼 같은 새 이름으로 합쳐진 중복 70개). 별칭별 대조(옛 이름을 쓰던 규칙 수 = 개명 후 같은 선언으로 있는 수)도 전부 일치.
   `:root` 의 별칭 선언 12개(`var()` 로 쓰이던 것만 방출됐다)는 대응표와 같은 값이었고 개명 후 사라졌다.
2. **옛 이름 0건** — 개명 후 CSS 에 옛 이름의 유틸 셀렉터·`--color-*` 참조 0.
3. **캐스케이드(규칙 순서)** — Tailwind 는 같은 속성의 유틸을 이름순으로 정렬하고 이 리포는 tailwind-merge 를 쓰지 않으므로, 한 요소에 같은
   속성의 색 유틸 둘이 같이 붙으면 이름이 바뀔 때 승자가 바뀔 수 있다. CSS 수준에서 앞뒤가 달라진 쌍은 2,283개(전부 `@layer utilities` 안 —
   base·components·층 밖 규칙은 0). 이것이 실제 요소에서 만나는지 `node scripts/verify-legacy-token-cascade.mjs <전 css> <후 css> <전 src>` 가
   개명 전 소스의 AST 로 본다: 한 문자열 안, 템플릿의 고정 부분 × `${}` 의 가능한 값, `a + b`, `[…].join(' ')` 인자끼리를 "같이 붙는다"로 보고
   (삼항의 두 가지·맵의 값들은 배타), 식별자는 선언·import·컴포넌트 속성 값으로 푼다. 결과: 개명에 걸린 같이-붙는 쌍 2,604개 중 **승자가 바뀌는 쌍 0**.
   클래스 문맥에서 풀지 못한 식별자 25종·151곳은 손으로 봤다 — CSS 모듈 객체(`css.*`·`s.*`) 111곳, 호출부가 넘기지 않는 `className` 매개변수,
   색 유틸이 고정 부분에 없는 템플릿(`chip ${cls}`), 색이 아닌 인자(`'tabular-nums'`·`'justify-start'`)뿐이라 겹치는 쌍이 없다.

한계: ③ 은 정적 분석이다. 런타임에 조립되는 클래스(`classList` — `dark`·`mblock-flash` 둘뿐)와 외부에서 오는 `className`(react-markdown)은
위 수동 확인 범위다. 화면 눈확인(치환 전후 스크린샷)은 따로 한다.

## 테스트

- 신설 `tests/css/no-legacy-tokens.test.ts` — src 에 옛 이름의 색 유틸·`--color-*` 참조 0건(코드모드와 같은 정규식), `globals.css` 에 별칭 선언·
  `@theme inline` 블록 없음, 판정기 표본.
- `tests/css/token-aliases.test.ts` — `ALIASES` 를 비우고 25개를 `DELETED_TOKENS` 로 옮겼다. 지운 이름 판정에 앞 경계를 더했다
  (`data-goto-done` 의 `to-done` 을 유틸로 읽던 오탐).
- 클래스 문자열 단언을 새 이름으로 옮긴 파일 18개(`tests/components` 8·`tests/ui` 7·`tests/settings/vocab`·`tests/domain/level-badge`·
  `tests/css/contrast-tokens`). 실패하지 않던 부정 단언(`not.toMatch(/text-delayed/)` 류)도 같이 옮겼다 — 그대로 두면 빈 단언이 된다.
  `tests/components/settings-status.test.tsx` 의 `/delayed|rounded-xl/` 는 `/delayed|danger-weak|border-danger|rounded-xl/` 로 넓혔다
  (그 화면의 아이콘이 원래 `text-danger` 라 `danger` 통째로는 금지할 수 없다).
- 결과: typecheck 0, lint 오류 0(경고 4 — 기존), vitest 1,042파일 13,444건 통과, `npm run build` 성공.

## 다시 돌리려면

```bash
node scripts/codemod-legacy-tokens.mjs --check        # src 에 옛 이름이 남았는지(0 이 아니면 exit 1)
node scripts/codemod-legacy-tokens.mjs <파일…>        # 병합으로 옛 이름이 다시 들어온 파일을 옮긴다
```

병렬 브랜치가 옛 이름을 새로 쓰면 `no-legacy-tokens` 와 `token-aliases`(정의되지 않은 토큰 이름) 테스트가 잡는다 — Tailwind 는 없는 유틸을
오류 없이 버리므로 테스트가 유일한 신호다.

> 위 두 검증 스크립트(`verify-legacy-token-equivalence.mjs`·`verify-legacy-token-cascade.mjs`)는 일회성이라 리포에 남기지 않았다. 재현이 필요하면 이 절의 방법으로 다시 쓴다. 코드모드(`scripts/codemod-legacy-tokens.mjs`)는 남겼다.
