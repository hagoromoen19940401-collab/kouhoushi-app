import json
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageChops


output_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "audit-output")
pdf_path = output_dir / "b5-print.pdf"
generation = json.loads((output_dir / "generation.json").read_text(encoding="utf-8"))

document = fitz.open(pdf_path)
page = document[0]
page_width_mm = page.rect.width * 25.4 / 72
page_height_mm = page.rect.height * 25.4 / 72

# 144dpiで描画し、ほぼ白以外の画素をコンテンツとして境界を取得する。
pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
background = Image.new("RGB", image.size, "white")
difference = ImageChops.difference(image, background).convert("L")
mask = difference.point(lambda value: 255 if value > 7 else 0)
bbox = mask.getbbox()
if bbox is None:
    raise RuntimeError("PDF内のコンテンツ境界を検出できませんでした。")

left_px, top_px, right_px, bottom_px = bbox
px_to_mm_x = page_width_mm / image.width
px_to_mm_y = page_height_mm / image.height
content_width_mm = (right_px - left_px) * px_to_mm_x

metrics = {
    **generation,
    "pdf": {
        "pageCount": document.page_count,
        "pageWidthMm": round(page_width_mm, 3),
        "pageHeightMm": round(page_height_mm, 3),
        "contentWidthMm": round(content_width_mm, 3),
        "leftMarginMm": round(left_px * px_to_mm_x, 3),
        "rightMarginMm": round((image.width - right_px) * px_to_mm_x, 3),
        "contentTopMm": round(top_px * px_to_mm_y, 3),
        "contentBottomMm": round(bottom_px * px_to_mm_y, 3),
        "detection": "144dpi raster bounding box of pixels differing from white by > 7/255",
    },
}

(output_dir / "metrics.json").write_text(
    json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
image.save(output_dir / "b5-print-preview.png")
