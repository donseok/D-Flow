// xlsx 시험 사례 정의 — xlsx.test.mjs 와 make-expected-xlsx.mjs 가 함께 쓴다(같은 사례로 기대값을 만들고 같은 사례로 비교한다).
//
//  WRITE_CASES: xlsx-write 에 넣는 행 배열 JSON 텍스트. python write_xlsx(json.load 한 값)와 node 판의 파트 내용을 비교한다.
//  READ_CASES : xlsx-read 에 넣는 파일. 시험이 직접 합성한다(openpyxl·엑셀이 만드는 sharedStrings·inlineStr·여러 시트·접두어 네임스페이스 구조를 흉내 냄).
//               error:true 는 python 이 예외(종료 코드 1)로 끝나는 입력이다.

import { writeZip } from '../scripts/_zip.mjs';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---------------------------------------------------------------- 쓰기 사례
const wbs18Header = ['번호', '레벨', 'ID', 'category', 'domain', 'model', '상태 코드', '상태', '담당', '시작일', '종료일', '영업일', 'depends', 'entry-point', 'prd-ref', 'tags', '진척(파생)', 'note'];
const wbs18Rows = [
  wbs18Header,
  ['1', 'WP', 'WP-01', '', '', '', '[ ]', '대기', '', '2026-10-01', '2026-10-31', 21, '', '', '', '', 0, ''],
  ['2', 'TSK', 'TSK-01', 'dev', 'mdm', 'sonnet', '[ ]', '대기', 'a@b.com', '2026-10-01', '2026-10-05', 3, 'TSK-00', '/mdm/term', 'PRD-3.1', 'agent,fe', 0, "R&D <검토> \"따옴표\" 'x'"],
  ["import 전 검수용이다 — wbs.md 기준이며 D'Flow 실적·배정은 반영되지 않는다."],
];

function bigRows(n) {
  const rows = [wbs18Header];
  for (let i = 1; i <= n; i++) {
    rows.push([
      String(i), i % 7 === 0 ? 'WP' : 'TSK', `TSK-${String(i).padStart(4, '0')}`, ['dev', 'infra', 'design'][i % 3], `d${i % 11}`, '',
      '[ ]', '대기', `u${i % 13}@x.com`, '2026-10-01', '2026-10-31', i % 23, '', `/p/${i}`, `PRD-${i % 40}`, 'a&b,<t>', i % 100, i % 5 === 0 ? '' : `비고 ${i} "q" 'r'`,
    ]);
  }
  return rows;
}

export const WRITE_CASES = [
  { name: 'basic', json: '[["ID","제목","수량"],["A","x",1]]' },
  { name: 'pretty-json', json: '\n[\n  [ "a" , "b" ] ,\r\n\t[ 1 , 2.5 ]\n]\n' },
  { name: 'escape', json: JSON.stringify([['a&b', '<t>', '"q"', "'s'", '&amp;', '&lt;', '&#x27;', '<![CDATA[x]]>'], ['Q&A <b>"x"</b> \'y\'', 'a && b', '>>', '']]) },
  { name: 'unicode', json: JSON.stringify([['한글 제목', '😀 emoji 🎉', 'é é', 'a b', 'tab\there', 'line1\nline2', 'cr\rhere', ' nbsp', '漢字かな']]) },
  { name: 'empty-strings', json: '[["",""],["",""]]' },
  { name: 'spaces', json: JSON.stringify([[' lead', 'trail ', ' ', 'a  b', '\t']]) },
  { name: 'dedupe', json: '[["a","b","a"],["b","a","c"],["c","c","c"]]' },
  {
    name: 'numbers-int',
    json: '[[0,-1,12,17,12345678901234567890123,-0,-98765432109876543210,9007199254740993]]',
  },
  {
    name: 'numbers-float',
    json: '[[1.0,0.5,1e-5,1E5,1e16,1.5e300,0.1,123456789.123456789,-2.5e-7,1e22,5e-324,-0.0,0.0001,0.00001,123456789012345.6,1234567890123456.7,2.5E+3,100.0,1e15,1e-4]]',
  },
  { name: 'numbers-nonfinite', json: '[[1e400,-1e400,NaN,Infinity,-Infinity]]' },
  {
    name: 'non-string',
    json: '[[true,false,null,[1,"a",null,true,1.5],{"k":"v","n":[1.0,2]},["it\'s","say \\"hi\\"","both \' and \\""],"x"]]',
  },
  { name: 'empty-list', json: '[]' },
  { name: 'empty-rows', json: '[[],["a"],[],[]]' },
  { name: 'ragged', json: '[["a","b","c"],["1"],[1,2,3,4,5]]' },
  { name: 'cols-26', json: JSON.stringify([Array.from({ length: 26 }, (_, i) => `c${i}`), Array.from({ length: 26 }, (_, i) => i)]) },
  { name: 'wbs-18-cols', json: JSON.stringify(wbs18Rows) },
  { name: 'big-3000', json: JSON.stringify(bigRows(3000)), big: true },
];

/** 쓰기 오류 사례(node 판 전용): 종료 코드 1, stderr 한 줄 이상 */
export const WRITE_ERROR_CASES = [
  { name: 'cols-27', json: JSON.stringify([Array.from({ length: 27 }, (_, i) => `c${i}`)]), stderr: /열이 26개/ },
  { name: 'not-array', json: '{"a":1}', stderr: /행 배열/ },
  { name: 'row-not-array', json: '[["a"],"bc"]', stderr: /배열이 아닙니다/ },
  { name: 'invalid-json', json: '[["a",]]', stderr: /JSON 해석 오류/ },
  { name: 'empty-input', json: '', stderr: /JSON 해석 오류/ },
  { name: 'trailing-garbage', json: '[["a"]] x', stderr: /JSON 해석 오류/ },
  { name: 'single-quotes', json: "[['a']]", stderr: /JSON 해석 오류/ },
  { name: 'raw-newline-in-string', json: '[["a\nb"]]', stderr: /JSON 해석 오류/ },
];

// ---------------------------------------------------------------- 읽기 사례
const sst = (items, { ns = MAIN, p = '' } = {}) =>
  `${DECL}<${p}sst xmlns${p ? ':' + p.slice(0, -1) : ''}="${ns}" count="${items.length}" uniqueCount="${items.length}">${items.map((t) => `<${p}si><${p}t>${t}</${p}t></${p}si>`).join('')}</${p}sst>`;
const sst0 = (inner, n = 1) => `${DECL}<sst xmlns="${MAIN}" count="${n}" uniqueCount="${n}">${inner}</sst>`;
const sheet = (rows) => `${DECL}<worksheet xmlns="${MAIN}"><dimension ref="A1:B3"/><sheetData>${rows}</sheetData></worksheet>`;
const row = (r, cells) => `<row r="${r}" spans="1:2">${cells}</row>`;
const cs = (ref, idx) => `<c r="${ref}" t="s"><v>${idx}</v></c>`;
const cn = (ref, v) => `<c r="${ref}"><v>${v}</v></c>`;
const ci = (ref, t) => `<c r="${ref}" t="inlineStr"><is><t>${t}</t></is></c>`;

const REL = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const WB = `${DECL}<workbook xmlns="${MAIN}"><sheets><sheet name="S" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`;

/** 표준 골격(Content_Types·rels·workbook)에 시트·공유 문자열 파트를 얹는다 */
const book = (parts, { store = false } = {}) => [
  { name: '[Content_Types].xml', data: CT },
  { name: '_rels/.rels', data: REL },
  { name: 'xl/workbook.xml', data: WB },
  ...Object.entries(parts).map(([name, data]) => ({ name, data })),
].map((e) => ({ ...e, store }));

const basicParts = () => ({
  'xl/sharedStrings.xml': sst(['id', '제목', 'a1', '한글']),
  'xl/worksheets/sheet1.xml': sheet(
    row(1, cs('A1', 0) + cs('B1', 1)) + row(2, cs('A2', 2) + cs('B2', 3)) + row(3, cn('A3', 12)),
  ),
});

export const READ_CASES = [
  { name: 'shared-basic', entries: () => book(basicParts()) },
  { name: 'stored-method', entries: () => book(basicParts(), { store: true }) },
  {
    name: 'rich-text-and-phonetic',
    entries: () => book({
      'xl/sharedStrings.xml': sst0(
        '<si><t>name</t></si>' +
        '<si><r><rPr><b/></rPr><t>He</t></r><r><rPr/><t xml:space="preserve">llo </t></r><r><t>world</t></r></si>' +
        '<si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh><phoneticPr fontId="1"/></si>',
        3,
      ),
      'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 1)) + row(3, cs('A3', 2))),
    }),
  },
  {
    name: 'inline-strings',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(
        row(1, ci('A1', 'h1') + ci('B1', 'h2')) +
        row(2, ci('A2', 'x &amp; y &lt;z&gt;') + `<c r="B2" t="inlineStr"><is><r><t>ab</t></r><r><t xml:space="preserve"> cd</t></r></is></c>`) +
        row(3, '<c r="A3" t="inlineStr"><is/></c><c r="B3" t="inlineStr"><is><t></t></is></c>'),
      ),
    }),
  },
  {
    name: 'multi-sheet',
    entries: () => book({
      'xl/sharedStrings.xml': sst(['h', 'first-sheet', 'second-sheet']),
      'xl/worksheets/sheet2.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 2))),
      'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 1))),
    }),
  },
  {
    name: 'sheet-name-order',
    entries: () => book({
      'xl/sharedStrings.xml': sst(['h', 'v2', 'v3', 'v10']),
      'xl/worksheets/sheet2.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 1))),
      'xl/worksheets/sheet10.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 3))),
      'xl/worksheets/sheet3.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 2))),
    }),
  },
  {
    name: 'cell-types',
    entries: () => book({
      'xl/sharedStrings.xml': sst(['n', 'type']),
      'xl/worksheets/sheet1.xml': sheet(
        row(1, cs('A1', 0) + cs('B1', 1)) +
        row(2, cn('A2', '1.5E-3') + '<c r="B2" t="str"><f>A1&amp;"x"</f><v>abc</v></c>') +
        row(3, '<c r="A3" t="b"><v>1</v></c><c r="B3" t="e"><v>#DIV/0!</v></c>') +
        row(4, '<c r="A4"/><c r="B4"><f>1+1</f></c>') +
        row(5, '<c r="A5"><v/></c><c r="B5"><v></v></c>') +
        row(6, '<c r="A6" t="n"><v>  7 </v></c><c r="B6" s="3"><v>0.1</v></c>'),
      ),
    }),
  },
  {
    name: 'wide-columns',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(
        row(1, ci('Z1', 'z') + ci('AA1', 'aa') + ci('B1', 'b') + ci('A1', 'a') + ci('AB1', 'ab') + ci('BA1', 'ba')) +
        row(2, ci('AB2', 'v-ab') + ci('A2', 'v-a') + ci('AA2', 'v-aa')) +
        row(3, ci('C3', 'not in header') + ci('Z3', 'v-z')),
      ),
    }),
  },
  {
    name: 'prefixed-namespace',
    entries: () => book({
      'xl/sharedStrings.xml': sst(['h', 'v'], { p: 'x:' }),
      'xl/worksheets/sheet1.xml':
        `${DECL}<x:worksheet xmlns:x="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheetData>` +
        '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c></x:row>' +
        '</x:sheetData></x:worksheet>',
    }),
  },
  {
    name: 'foreign-namespace-ignored',
    entries: () => book({
      'xl/worksheets/sheet1.xml':
        `${DECL}<worksheet xmlns="${MAIN}" xmlns:o="urn:other"><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c></row>` +
        `<o:row r="2"><o:c r="A2" t="inlineStr"><o:is><o:t>no</o:t></o:is></o:c></o:row>` +
        `<row r="3"><c r="A3" t="inlineStr"><is><t>yes</t></is></c></row>` +
        '</sheetData></worksheet>',
    }),
  },
  {
    name: 'entities-cdata-charrefs',
    entries: () => book({
      'xl/sharedStrings.xml': sst0(
        '<si><t>h</t></si><si><t>a &lt;b&gt; &amp; &quot;q&quot; &apos;s&apos; &#65;&#x1F600;&#xAC00;</t></si><si><t>x<![CDATA[<raw & >]]>y</t></si><si><t><!-- c -->k<?pi z?>l</t></si>',
        4,
      ),
      'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 1)) + row(3, cs('A3', 2)) + row(4, cs('A4', 3))),
    }),
  },
  {
    name: 'crlf-and-whitespace-in-text',
    entries: () => book({
      'xl/sharedStrings.xml': sst0('<si><t>h</t></si><si><t xml:space="preserve">  line1\r\nline2\rline3\n  </t></si><si><t>tab\there</t></si>', 3),
      'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 0)) + row(2, cs('A2', 1)) + row(3, cs('A3', 2))),
    }),
  },
  {
    name: 'utf8-bom',
    entries: () => {
      const e = book(basicParts());
      return e.map((x) => (x.name === 'xl/worksheets/sheet1.xml' ? { ...x, data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(x.data, 'utf8')]) } : x));
    },
  },
  {
    name: 'utf16-bom-sheet',
    entries: () => {
      const e = book(basicParts());
      return e.map((x) => {
        if (x.name !== 'xl/worksheets/sheet1.xml') return x;
        const text = x.data.replace('encoding="UTF-8"', 'encoding="UTF-16"');
        return { ...x, data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) };
      });
    },
  },
  {
    name: 'header-only',
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, ci('A1', 'a') + ci('B1', 'b'))) }),
  },
  {
    name: 'duplicate-and-empty-headers',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(
        row(1, ci('A1', 'a') + ci('B1', '') + ci('C1', 'a') + ci('D1', 'null')) + row(2, ci('A2', '1') + ci('B2', '2') + ci('C2', '3') + ci('D2', '4')),
      ),
    }),
  },
  {
    name: 'null-header-cell',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(row(1, '<c r="A1"><v/></c>' + ci('B1', 'b')) + row(2, ci('A2', '1') + ci('B2', '2'))),
    }),
  },
  {
    name: 'empty-first-row',
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet('<row r="1"/>' + row(2, ci('A2', '1')) + row(3, ci('A3', '2'))) }),
  },
  {
    name: 'no-shared-strings-file',
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, ci('A1', 'k')) + row(2, ci('A2', 'v'))) }),
  },
  {
    name: 'extra-parts-and-dirs',
    entries: () => [
      ...book(basicParts()),
      { name: 'xl/worksheets/', data: '' },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: REL },
      { name: 'xl/worksheets/sheet1.xml.rels', data: REL },
      { name: 'docProps/core.xml', data: '<cp/>' },
      { name: 'xl/styles.xml', data: `${DECL}<styleSheet xmlns="${MAIN}"/>` },
    ],
  },
  {
    name: 'quirky-xml-syntax',
    entries: () => book({
      'xl/sharedStrings.xml': `<?xml version='1.0' encoding='utf-8'?>\n<!-- c1 --><sst xmlns = '${MAIN}' >\n<si ><t >h</t ></si ><si><t/></si></sst >\n<!-- c2 -->\n`,
      'xl/worksheets/sheet1.xml':
        `<?xml version="1.0"?><!DOCTYPE worksheet [<!ELEMENT worksheet ANY>]><worksheet xmlns="${MAIN}"><sheetData>\n` +
        `<row r='1'><c  r = 'A1'  t = "s" ><v>0</v></c></row>\n<row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`,
    }),
  },
  {
    name: 'negative-and-spaced-index',
    entries: () => book({
      'xl/sharedStrings.xml': sst(['h', 'first', 'last']),
      'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 0)) + row(2, `<c r="A2" t="s"><v>-1</v></c>`) + row(3, `<c r="A3" t="s"><v> 1 </v></c>`) + row(4, `<c r="A4" t="s"><v>+2</v></c>`)),
    }),
  },
  {
    name: 'rows-out-of-order-and-gaps',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(row(5, ci('A5', 'late')) + row(1, ci('A1', 'h')) + row(3, ci('A3', 'mid'))),
    }),
  },
  {
    name: 'same-column-twice-in-row',
    entries: () => book({
      'xl/worksheets/sheet1.xml': sheet(row(1, ci('A1', 'h')) + row(2, ci('A2', 'first') + ci('A2', 'second'))),
    }),
  },
  {
    name: 'big-9000-cells',
    entries: () => {
      const rows = [];
      for (let r = 1; r <= 500; r++) {
        let cells = '';
        for (let c = 0; c < 18; c++) cells += ci(`${String.fromCharCode(65 + c)}${r}`, r === 1 ? `h${c}` : `r${r}c${c} &amp; é`);
        rows.push(row(r, cells));
      }
      return book({ 'xl/worksheets/sheet1.xml': sheet(rows.join('')) });
    },
  },

  // ---- python 이 예외로 끝나는(종료 코드 1) 입력
  { name: 'error-no-sheet', error: true, entries: () => book({ 'xl/sharedStrings.xml': sst(['a']) }) },
  { name: 'error-no-rows', error: true, entries: () => book({ 'xl/worksheets/sheet1.xml': sheet('') }) },
  {
    name: 'error-broken-xml-unclosed',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1"></row></sheetData></worksheet>` }),
  },
  {
    name: 'error-broken-xml-truncated',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData><row r="1">` }),
  },
  {
    name: 'error-junk-after-root',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData/></worksheet><extra/>` }),
  },
  {
    name: 'error-two-roots-text',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData/></worksheet>trailing` }),
  },
  {
    name: 'error-shared-index-out-of-range',
    error: true,
    entries: () => book({ 'xl/sharedStrings.xml': sst(['a']), 'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 99))) }),
  },
  {
    name: 'error-shared-index-not-int',
    error: true,
    entries: () => book({ 'xl/sharedStrings.xml': sst(['a']), 'xl/worksheets/sheet1.xml': sheet(row(1, cs('A1', 'x'))) }),
  },
  {
    name: 'error-shared-index-empty',
    error: true,
    entries: () => book({ 'xl/sharedStrings.xml': sst(['a']), 'xl/worksheets/sheet1.xml': sheet(row(1, '<c r="A1" t="s"><v/></c>')) }),
  },
  {
    name: 'error-cell-without-r',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, '<c t="inlineStr"><is><t>x</t></is></c>')) }),
  },
  {
    name: 'error-cell-lowercase-r',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, '<c r="a1" t="inlineStr"><is><t>x</t></is></c>')) }),
  },
  {
    name: 'error-control-char',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, `<c r="A1" t="inlineStr"><is><t>a${String.fromCharCode(1)}b</t></is></c>`)) }),
  },
  {
    name: 'error-unknown-entity',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, '<c r="A1" t="inlineStr"><is><t>a &nbsp; b</t></is></c>')) }),
  },
  {
    name: 'error-bare-ampersand',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': sheet(row(1, '<c r="A1" t="inlineStr"><is><t>a & b</t></is></c>')) }),
  },
  {
    name: 'error-unbound-prefix',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData><q:row r="1"/></sheetData></worksheet>` }),
  },
  {
    name: 'error-mismatched-tags',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData></worksheet></sheetData>` }),
  },
  {
    name: 'error-attribute-without-quotes',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData><row r=1/></sheetData></worksheet>` }),
  },
  {
    name: 'error-duplicate-attribute',
    error: true,
    entries: () => book({ 'xl/worksheets/sheet1.xml': `${DECL}<worksheet xmlns="${MAIN}"><sheetData><row r="1" r="2"/></sheetData></worksheet>` }),
  },
  {
    name: 'error-shared-strings-broken',
    error: true,
    entries: () => book({ 'xl/sharedStrings.xml': '<sst><si><t>x</si></sst>', 'xl/worksheets/sheet1.xml': sheet(row(1, ci('A1', 'a'))) }),
  },
];

/** 사례 → zip 바이트 */
export function buildFixtureZip(c) {
  return writeZip(c.entries());
}

// ---- zip 자체가 깨진 입력(바이트 단위). python zipfile.BadZipFile → 종료 코드 1
export const BAD_ZIP_CASES = [
  { name: 'not-a-zip', bytes: () => Buffer.from('this is not a zip file at all, just text\n') },
  { name: 'empty-file', bytes: () => Buffer.alloc(0) },
  { name: 'truncated-zip', bytes: () => { const z = buildFixtureZip(READ_CASES[0]); return z.subarray(0, Math.floor(z.length / 2)); } },
  { name: 'only-eocd-garbage', bytes: () => Buffer.concat([Buffer.alloc(30, 1), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]) },
];
