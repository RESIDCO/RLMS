from pathlib import Path

p = Path(__file__).with_name("jss_source.xls")
print("size", p.stat().st_size)
try:
    import xlrd
    book = xlrd.open_workbook(p)
    print("xlrd sheets", book.sheet_names())
    for name in book.sheet_names():
        sh = book.sheet_by_name(name)
        print("SHEET", name, sh.nrows, sh.ncols)
        for r in range(min(sh.nrows, 80)):
            vals = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                vals.append(repr(cell.value))
            print(r, "\t".join(vals))
except Exception as e:
    print("xlrd fail", type(e), e)

try:
    import pandas as pd
    xl = pd.ExcelFile(p)
    print("pandas sheets", xl.sheet_names)
    for name in xl.sheet_names:
        df = pd.read_excel(p, sheet_name=name, header=None)
        print("DF", name, df.shape)
        print(df.head(40).to_csv(index=False))
except Exception as e:
    print("pandas fail", type(e), e)
