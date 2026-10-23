#!/usr/bin/env python3
# python zipfile 이 실제로 만드는 형태의 작은 xlsx 픽스처 3개를 만든다(일회성 생성 도구: 시험은 이 스크립트를 돌리지 않고 커밋된 바이너리를 읽는다).
#
# 사용(리포 루트에서):  python3 .claude/skills/dflow-wbs/tests/golden/py-zips/make-py-zips.legacy.py
# 같은 폴더에 아래 파일을 덮어쓴다. 생성 환경은 README.md 에 적는다. 표준 라이브러리만 쓴다(openpyxl 불필요).
#
#  py-datadesc-mixed.xlsx : 쓸 수 없는(seek 불가) 스트림에 써서 데이터 디스크립터(플래그 0x08)가 생기고, 로컬 헤더의 crc·크기는 0 이다.
#                           stored 와 deflate 가 섞여 있다. (스트리밍 쓰기 · openpyxl/엑셀이 아닌 도구가 만드는 흔한 모양)
#  py-extra-fields.xlsx   : 로컬·중앙 헤더에 확장 필드(0x5455 확장 시각, 0x7875 유닉스 uid/gid)와 파일 주석, 전체 zip 주석이 있고 한글 이름 항목을 담는다.
#  py-multi-sheet.xlsx    : 시트가 sheet1·sheet2·sheet10 세 장이다(파트 이름 정렬 순으로는 sheet1 < sheet10 < sheet2). 첫 시트 판정 시험용.
#
# 내용(세 파일 모두 같은 표): 헤더 [번호, 이름, 수량, 비고] / 행 [1, 한글 & <b>, 12, 비고] / 행 [2, ascii, 1.5E-3, "줄1\n줄2"]
#   (multi-sheet 는 번호 칸에 시트 표지가 붙어 sheet1 은 11·21, sheet2 는 12·22, sheet10 은 110·210)

import io
import struct
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
FIXED = (2026, 10, 7, 9, 30, 0)  # 파일 시각 고정(같은 입력이면 같은 바이트)

CONTENT_TYPES = DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'
RELS = DECL + f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>'


def workbook(n_sheets):
    sheets = ''.join(f'<sheet name="S{i}" sheetId="{i}" r:id="rId{i}"/>' for i in range(1, n_sheets + 1))
    return DECL + f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>{sheets}</sheets></workbook>'


SHARED = ['번호', '이름', '수량', '비고', '한글 &amp; &lt;b&gt;', 'ascii', '줄1\n줄2']
SST = DECL + f'<sst xmlns="{MAIN}" count="{len(SHARED)}" uniqueCount="{len(SHARED)}">' + ''.join(f'<si><t>{t}</t></si>' for t in SHARED) + '</sst>'


def sheet(tag=''):
    # tag: 시트 구분용 보조 값(multi-sheet 에서 시트마다 다른 데이터를 둔다)
    rows = (
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
        f'<row r="2"><c r="A2"><v>1{tag}</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>12</v></c><c r="D2" t="s"><v>3</v></c></row>'
        f'<row r="3"><c r="A3"><v>2{tag}</v></c><c r="B3" t="s"><v>5</v></c><c r="C3"><v>1.5E-3</v></c><c r="D3" t="s"><v>6</v></c></row>'
    )
    return DECL + f'<worksheet xmlns="{MAIN}"><dimension ref="A1:D3"/><sheetData>{rows}</sheetData></worksheet>'


class NonSeekable(io.RawIOBase):
    """seek·tell 이 안 되는 쓰기 전용 스트림(파이프·소켓처럼). zipfile 이 데이터 디스크립터 방식으로 쓰게 만든다."""

    def __init__(self, path):
        self._f = open(path, 'wb')

    def writable(self):
        return True

    def seekable(self):
        return False

    def write(self, b):
        return self._f.write(b)

    def close(self):
        self._f.close()
        super().close()


def info(name, method, extra=b'', comment=b''):
    zi = zipfile.ZipInfo(name, FIXED)
    zi.compress_type = method
    zi.extra = extra
    zi.comment = comment
    zi.create_system = 3  # 유닉스
    zi.external_attr = 0o644 << 16
    return zi


def tlv(tag, payload):
    return struct.pack('<HH', tag, len(payload)) + payload


def make_datadesc(path):
    stream = NonSeekable(path)
    with zipfile.ZipFile(stream, 'w') as z:
        z.writestr(info('[Content_Types].xml', zipfile.ZIP_DEFLATED), CONTENT_TYPES)
        z.writestr(info('_rels/.rels', zipfile.ZIP_STORED), RELS)
        z.writestr(info('xl/workbook.xml', zipfile.ZIP_DEFLATED), workbook(1))
        z.writestr(info('xl/sharedStrings.xml', zipfile.ZIP_STORED), SST)
        z.writestr(info('xl/worksheets/sheet1.xml', zipfile.ZIP_DEFLATED), sheet())
    stream.close()


def make_extra(path):
    ut = tlv(0x5455, b'\x03' + struct.pack('<II', 1790000000, 1790000000))  # 확장 시각(mtime·atime)
    ux = tlv(0x7875, b'\x01\x04' + struct.pack('<I', 501) + b'\x04' + struct.pack('<I', 20))  # 유닉스 uid/gid
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(info('[Content_Types].xml', zipfile.ZIP_DEFLATED, ut + ux, '항목 주석'.encode('utf-8')), CONTENT_TYPES)
        z.writestr(info('_rels/.rels', zipfile.ZIP_DEFLATED, ut), RELS)
        z.writestr(info('xl/workbook.xml', zipfile.ZIP_STORED, ux), workbook(1))
        z.writestr(info('xl/sharedStrings.xml', zipfile.ZIP_DEFLATED, ut + ux), SST)
        z.writestr(info('xl/worksheets/sheet1.xml', zipfile.ZIP_DEFLATED, ut), sheet())
        z.writestr(info('docProps/한글설명.txt', zipfile.ZIP_STORED), '메모')  # 비 ASCII 이름(플래그 0x800)
        z.comment = 'zip 전체 주석 / archive comment'.encode('utf-8')


def make_multi(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(info('[Content_Types].xml', zipfile.ZIP_DEFLATED), CONTENT_TYPES)
        z.writestr(info('_rels/.rels', zipfile.ZIP_DEFLATED), RELS)
        z.writestr(info('xl/workbook.xml', zipfile.ZIP_DEFLATED), workbook(3))
        z.writestr(info('xl/sharedStrings.xml', zipfile.ZIP_DEFLATED), SST)
        # 저장 순서를 일부러 섞는다. 읽기는 이름 정렬 순이므로 sheet1 < sheet10 < sheet2 → 첫 시트는 sheet1.
        z.writestr(info('xl/worksheets/sheet2.xml', zipfile.ZIP_DEFLATED), sheet('2'))
        z.writestr(info('xl/worksheets/sheet10.xml', zipfile.ZIP_DEFLATED), sheet('10'))
        z.writestr(info('xl/worksheets/sheet1.xml', zipfile.ZIP_DEFLATED), sheet('1'))


def main():
    make_datadesc(HERE / 'py-datadesc-mixed.xlsx')
    make_extra(HERE / 'py-extra-fields.xlsx')
    make_multi(HERE / 'py-multi-sheet.xlsx')
    print('만든 파일:', 'py-datadesc-mixed.xlsx py-extra-fields.xlsx py-multi-sheet.xlsx', f'(python {sys.version.split()[0]})')


if __name__ == '__main__':
    main()
