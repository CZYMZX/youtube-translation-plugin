# -*- coding: utf-8 -*-
"""断句金标集标注任务包 生成脚本（openpyxl 直写）"""
import json

try:
    import openpyxl
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "openpyxl>=3.1.0"])
    import openpyxl

from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

# ── 颜色常量（CSS → ARGB 一次性转换） ──
def xl_color(css_hex: str) -> str:
    value = css_hex.removeprefix("#").upper()
    if len(value) != 6:
        raise ValueError(f"Expected #RRGGBB, got: {css_hex}")
    return "FF" + value

XL_HEADER_BG = xl_color("#4472C4")   # 商务蓝表头
XL_HEADER_FG = xl_color("#FFFFFF")
XL_INPUT_BG = xl_color("#D9E2F3")    # 输入区浅底
XL_NOTE_BG = xl_color("#FAFAFA")
XL_KEEP_YES_BG = xl_color("#C6EFCE") # 标注"是"绿底
XL_KEEP_YES_FG = xl_color("#006100")
XL_REF_BG = xl_color("#FFF2CC")      # 模型参考区浅黄

DATA_PATH = "E:/Antigravity/油管翻译插件_v0.2.6/docs/.断句金标集标注任务包.ref/data.json"
OUTPUT = "E:/Antigravity/油管翻译插件_v0.2.6/docs/断句金标集标注任务包.xlsx"

with open(DATA_PATH, encoding="utf-8") as f:
    data = json.load(f)

wb = openpyxl.Workbook()
wb.properties.title = "断句金标集标注任务包"

thin_side = Side(style="thin", color=xl_color("#BFBFBF"))
header_border = Border(bottom=thin_side)

header_font = Font(bold=True, color=XL_HEADER_FG)
header_fill = PatternFill("solid", start_color=XL_HEADER_BG, end_color=XL_HEADER_BG)
input_fill = PatternFill("solid", start_color=XL_INPUT_BG, end_color=XL_INPUT_BG)
note_fill = PatternFill("solid", start_color=XL_NOTE_BG, end_color=XL_NOTE_BG)
ref_fill = PatternFill("solid", start_color=XL_REF_BG, end_color=XL_REF_BG)

center = Alignment(horizontal="center", vertical="center")
left = Alignment(horizontal="left", vertical="center")
left_wrap = Alignment(horizontal="left", vertical="center", wrap_text=True)
right = Alignment(horizontal="right", vertical="center")

# ════════════════ Sheet 1: 标注说明 ════════════════
ws = wb.active
ws.title = "标注说明"
ws.column_dimensions["A"].width = 14
ws.column_dimensions["B"].width = 96

ws["A1"] = "断句金标集标注任务包"
ws["A1"].font = Font(bold=True, size=16)
ws.merge_cells("A1:B1")
ws["A1"].alignment = center

instructions = [
    ("任务目标", "为字幕断句引擎（v0.2.6）构建人工金标集，用于量化评测断句准确率：边界精确率 P / 召回率 R / F1（容差 ±300ms），以及错误断句、漏断句分类统计。"),
    ("标注对象", "每个 token 行（token = 字幕轨的一个词/片段，带词级时间戳）。只需判断一件事：这个 token 之后是否应该断句（结束当前句、开启新句）。"),
    ("判定标准", "以『语义完整 + 说话人换气/换话题』为准：句子意思说完整了、话题切换了、明显换气停顿了，就断；仅凭停顿大小不断（短停顿接续语流不断句）；被从句/助词挂着的半句不断（如日语句末「けど」「が」）。"),
    ("语言策略提示", "日语（优先）：注意句末助词（ですね/ました/だよ/ね）后通常可断；接续助词（けど/から/ので）后视语义。中文：注意标点提示。英文：注意从句连词。拿不准的行在备注列写『存疑』即可，统计时单独归类。"),
    ("操作方式", "在『断句标注』列填 是 / 否（已设下拉可直接选）。标注列以外的列请勿修改。备注列可选填存疑原因。"),
    ("优先级", "请优先标注【日语tokens】表（VTuber 直播 ASR 轨，无标点，是引擎的主要目标场景）；中文、英文随后。"),
    ("数据来源", "日语：YouTube VTuber 直播回放 ASR 轨（视频 XMJi8I_9pp4，切片 600s~704s，220 token）；中文：TED 演讲翻译轨（切片 5s~322s，150 token）；英文：TED 演讲轨（切片 13s~285s，150 token）。"),
    ("模型参考", "『模型参考输出』表是 v0.2.6 引擎（自动语言策略）对同一段落的自动断句结果。为避免标注偏差，建议标注完成后再查看对比。"),
    ("交付方式", "标注完成后把本文件发回，助手将解析『断句标注』列，与模型输出对齐计算 P/R/F1 与错分类型分布，产出评测报告并指导规则调优。"),
]
row = 3
for label, text in instructions:
    ws.cell(row=row, column=1, value=label).font = Font(bold=True)
    ws.cell(row=row, column=1).alignment = Alignment(horizontal="left", vertical="top")
    c = ws.cell(row=row, column=2, value=text)
    c.alignment = left_wrap
    c.fill = note_fill
    ws.row_dimensions[row].height = 34
    row += 1

# ════════════════ Sheet 2~4: 三语 token 标注表 ════════════════
LANG_SHEETS = [
    ("ja", "日语tokens", "日语（VTuber 直播 ASR，无标点）"),
    ("zh", "中文tokens", "中文（TED 演讲轨）"),
    ("en", "英文tokens", "英文（TED 演讲轨）"),
]

TOKEN_HEADERS = ["序号", "token文本", "开始(ms)", "结束(ms)", "与下一词停顿(ms)", "断句标注", "备注"]

for lang_key, sheet_name, subtitle in LANG_SHEETS:
    ws = wb.create_sheet(sheet_name)
    tokens = data[lang_key]["tokens"]

    # 表头（第 1 行，锚点：数据自第 2 行起）
    for col, name in enumerate(TOKEN_HEADERS, start=1):
        c = ws.cell(row=1, column=col, value=name)
        c.font = header_font
        c.fill = header_fill
        c.alignment = center
        c.border = header_border

    last_row = 1 + len(tokens)
    for i, t in enumerate(tokens):
        r = 2 + i
        ws.cell(row=r, column=1, value=t["idx"]).alignment = center
        ws.cell(row=r, column=2, value=t["text"]).alignment = left
        ws.cell(row=r, column=3, value=t["start"]).alignment = right
        ws.cell(row=r, column=4, value=t["end"]).alignment = right
        gap_cell = ws.cell(row=r, column=5, value=t["gap"] if t["gap"] is not None else "末尾")
        gap_cell.alignment = right
        # 标注列 + 备注列 = 输入区浅底
        for col in (6, 7):
            c = ws.cell(row=r, column=col)
            c.fill = input_fill
            c.alignment = center if col == 6 else left

    # 列宽
    widths = {"A": 6, "B": 26, "C": 10, "D": 10, "E": 16, "F": 10, "G": 18}
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

    # 冻结表头 + 筛选
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:G{last_row}"

    # 断句标注下拉（是/否）
    dv = DataValidation(type="list", formula1='"是,否"', allow_blank=True, showDropDown=False)
    dv.error = "请选择 是 或 否"
    dv.errorTitle = "无效输入"
    ws.add_data_validation(dv)
    dv.add(f"F2:F{last_row}")

    # 条件格式：标注"是" → 绿底
    from openpyxl.formatting.rule import CellIsRule
    yes_fill = PatternFill("solid", start_color=XL_KEEP_YES_BG, end_color=XL_KEEP_YES_BG)
    yes_font = Font(color=XL_KEEP_YES_FG, bold=True)
    ws.conditional_formatting.add(
        f"F2:F{last_row}",
        CellIsRule(operator="equal", formula=['"是"'], fill=yes_fill, font=yes_font)
    )

    # 停顿列提示条：>800ms 长停顿黄字（辅助信息，不是断句指令）
    from openpyxl.styles import Font as _Font
    # 静态做法不可行（逐格值未知前由数据判断），改用条件格式
    from openpyxl.formatting.rule import FormulaRule
    ws.conditional_formatting.add(
        f"E2:E{last_row}",
        FormulaRule(formula=[f'AND(ISNUMBER($E2),$E2>800)'], font=_Font(color=xl_color("#9C6500"), bold=True))
    )

# ════════════════ Sheet 5: 模型参考输出 ════════════════
ws = wb.create_sheet("模型参考输出")
REF_HEADERS = ["语言", "句序号", "模型断句文本", "开始(ms)", "结束(ms)"]
for col, name in enumerate(REF_HEADERS, start=1):
    c = ws.cell(row=1, column=col, value=name)
    c.font = header_font
    c.fill = header_fill
    c.alignment = center
    c.border = header_border

row = 2
lang_names = {"ja": "日语", "zh": "中文", "en": "英文"}
for lang_key, sheet_name, _ in LANG_SHEETS:
    for s in data[lang_key]["model"]:
        ws.cell(row=row, column=1, value=lang_names[lang_key]).alignment = center
        ws.cell(row=row, column=2, value=s["idx"]).alignment = center
        c = ws.cell(row=row, column=3, value=s["text"])
        c.alignment = left_wrap
        c.fill = ref_fill
        ws.cell(row=row, column=4, value=s["start"]).alignment = right
        ws.cell(row=row, column=5, value=s["end"]).alignment = right
        row += 1

for col, w in {"A": 8, "B": 8, "C": 72, "D": 10, "E": 10}.items():
    ws.column_dimensions[col].width = w
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:E{row - 1}"

# 提示行
warn = ws.cell(row=row + 1, column=1, value="⚠ 建议标注完成后再查看本表，避免参考偏差。黄色底为模型断句文本。")
warn.font = Font(bold=True, color=xl_color("#9C6500"))

wb.save(OUTPUT)
print("saved:", OUTPUT)
print("sheets:", wb.sheetnames)
