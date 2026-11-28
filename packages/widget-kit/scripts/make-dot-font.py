import math
import re
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[1]
glyph_source = (root / "Sources/LifeOSWidgetKit/Glyphs.swift").read_text()
grids = {
    char: re.findall(r'"([.#]+)"', rows)
    for char, rows in re.findall(r'"(.)": \[([^\]]+)\]', glyph_source)
}

PITCH = 100
RADIUS = PITCH * 0.37
NAMES = {str(d): name for d, name in zip(range(10), ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"])}
NAMES[":"] = "colon"


def circle(pen, cx, cy):
    reach = RADIUS / math.cos(math.pi / 8)
    points = [(cx + reach * math.cos(math.pi / 8 + k * math.pi / 4), cy + reach * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    pen.qCurveTo(*[(round(x), round(y)) for x, y in reversed(points)], None)
    pen.closePath()


glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
metrics = {".notdef": (600, 0), "space": (600, 0)}
cmap = {32: "space"}
for char, rows in grids.items():
    pen = TTGlyphPen(None)
    for y, row in enumerate(rows):
        for x, cell in enumerate(row):
            if cell == "#":
                circle(pen, x * PITCH + RADIUS, (len(rows) - 1 - y) * PITCH + RADIUS)
    name = NAMES[char]
    glyphs[name] = pen.glyph()
    metrics[name] = ((len(rows[0]) + 1) * PITCH, 0)
    cmap[ord(char)] = name

builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder(list(glyphs))
builder.setupCharacterMap(cmap)
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics(metrics)
builder.setupHorizontalHeader(ascent=700, descent=-100)
builder.setupNameTable({"familyName": "LifeOS Dots", "styleName": "Regular", "psName": "LifeOSDots-Regular"})
builder.setupOS2(sTypoAscender=700, sTypoDescender=-100, usWinAscent=700, usWinDescent=100)
builder.setupPost()
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "Fonts/LifeOSDots-Regular.ttf"
builder.save(str(out))
print(out)
