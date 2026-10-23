# python zipfile 이 만든 xlsx 픽스처

`xlsx.test.mjs` 의 「python 이 만든 zip 픽스처」 시험이 읽는 **커밋된 바이너리**다. 시험은 python 을 돌리지 않으므로 python 이 없는 PC(윈도우)에서도 돈다.
node `writeZip` 이 만든 입력만으로는 python `zipfile` 이 실제로 쓰는 형태(데이터 디스크립터·확장 필드·주석·섞인 압축 방식)를 확인할 수 없어 따로 둔다.

| 파일 | 형태 |
|---|---|
| `py-datadesc-mixed.xlsx` | seek 불가 스트림에 써서 모든 항목이 데이터 디스크립터(플래그 0x08, 로컬 헤더의 crc·크기 0)를 쓴다. stored 와 deflate 가 섞여 있다 |
| `py-extra-fields.xlsx` | 로컬·중앙 헤더에 확장 필드(0x5455·0x7875), 항목 주석, 전체 zip 주석, 비 ASCII 항목 이름(플래그 0x800) |
| `py-multi-sheet.xlsx` | 시트 `sheet2`·`sheet10`·`sheet1` 순으로 저장. 이름 정렬이면 `sheet1 < sheet10 < sheet2` 라 첫 시트는 `sheet1` |

## 다시 만들기

python 3(표준 라이브러리만 필요, 3.9.6 에서 만듦)이 있는 PC 에서 리포 루트에서:

```bash
python3 -I .claude/skills/dflow-wbs/tests/golden/py-zips/make-py-zips.legacy.py
```

파일 시각을 고정해 두어 같은 python 이면 같은 바이트가 나온다. 바꾼 뒤에는 `node --test .claude/skills/dflow-wbs/tests/` 의 기대값(`xlsx.test.mjs`)을 함께 확인한다.

## 줄끝 변환 금지

리포 `.gitattributes` 의 `.claude/skills/** text eol=lf` 는 바이너리의 CR 을 지우므로, 이 폴더의 `*.xlsx` 는 `binary` 로 예외 처리해 두었다.
`git check-attr text .claude/skills/dflow-wbs/tests/golden/py-zips/py-multi-sheet.xlsx` 가 `unset` 이어야 한다.
