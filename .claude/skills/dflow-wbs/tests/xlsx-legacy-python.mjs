// xlsx 시험용: SKILL.md 에 있던 인라인 python 블록 두 개의 원문 동결 사본 (골든 비교 기준).
// 읽기 블록은 인자로 .xlsx 경로를 받아 JSON 을 stdout 으로 낸다. 쓰기 블록은 아래 WRITE_DRIVER 와 이어 붙여
// `python3 <파일> <출력.xlsx> <rows.json>` 로 돌린다(rows.json 은 json.load 로 읽어 python int/float/str/None 값이 된다).
// 손으로 고치지 않는다: SKILL.md 에서 python 블록을 지운 뒤 이 파일이 유일한 원문이다.

export const READ_PY = String.raw`import sys, zipfile, re, json, xml.etree.ElementTree as ET
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
ss = []
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
        ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
rows = []
for row in ET.fromstring(z.read(sheet)).iter(NS + 'row'):
    vals = {}
    for c in row.iter(NS + 'c'):
        col = re.match(r'[A-Z]+', c.get('r')).group(0)
        v = c.find(NS + 'v')
        txt = '' if v is None else v.text
        if c.get('t') == 's':
            txt = ss[int(txt)]
        elif c.get('t') == 'inlineStr':
            txt = ''.join(t.text or '' for t in c.iter(NS + 't'))
        vals[col] = txt
    rows.append(vals)
hdr = rows[0]
cols = sorted(hdr, key=lambda k: (len(k), k))
print(json.dumps([{hdr[c]: r.get(c, '') for c in cols} for r in rows[1:]], ensure_ascii=False))
`;

export const WRITE_PY = String.raw`import zipfile, html

def write_xlsx(path, rows):           # rows[0] = 헤더, 셀 값은 str 또는 int/float
    ss, idx, body = [], {}, []
    def sid(v):
        if v not in idx:
            idx[v] = len(ss); ss.append(v)
        return idx[v]
    for r, row in enumerate(rows, 1):
        cs = []
        for c, v in enumerate(row):
            ref = f"{chr(ord('A') + c)}{r}"
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                cs.append(f'<c r="{ref}"><v>{v}</v></c>')
            else:
                cs.append(f'<c r="{ref}" t="s"><v>{sid(str(v))}</v></c>')
        body.append(f'<row r="{r}">{"".join(cs)}</row>')
    M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    z.writestr("_rels/.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    z.writestr("xl/workbook.xml", f'<?xml version="1.0"?><workbook xmlns="{M}" xmlns:r="{R}"><sheets><sheet name="WBS" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet xmlns="{M}"><sheetData>{"".join(body)}</sheetData></worksheet>')
    z.writestr("xl/sharedStrings.xml", '<?xml version="1.0"?><sst xmlns="%s" count="%d" uniqueCount="%d">%s</sst>' % (M, len(ss), len(ss), "".join("<si><t>%s</t></si>" % html.escape(s) for s in ss)))
    z.close()
`;

export const WRITE_DRIVER = String.raw`
import sys, json
with open(sys.argv[2], encoding='utf-8') as fh:
    _rows = json.load(fh)
write_xlsx(sys.argv[1], _rows)
`;
