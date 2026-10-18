import json
from pathlib import Path
import xlrd

p = Path(__file__).with_name("jss_source.xls")
book = xlrd.open_workbook(p)
sh = book.sheet_by_index(0)
rows = []
for r in range(sh.nrows):
    row = []
    for c in range(sh.ncols):
        row.append(sh.cell(r, c).value)
    if any(str(x).strip() for x in row):
        rows.append(row)
Path(__file__).with_name("jss_cutup_rows.json").write_text(json.dumps(rows), encoding="utf-8")
print("wrote", len(rows), "rows")
