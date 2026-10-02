import json
import sys
from pathlib import Path


input_dir = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
output_dir.mkdir(parents=True, exist_ok=True)

records = {}
for metrics_path in input_dir.glob("*/metrics.json"):
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    records[metrics["runner"]] = metrics

required = {"Windows", "macOS"}
if set(records) != required:
    raise RuntimeError(f"Windows/macOSの計測結果が揃っていません: {sorted(records)}")

windows = records["Windows"]
macos = records["macOS"]
fields = [
    ("pageCount", "ページ数"),
    ("pageWidthMm", "用紙幅(mm)"),
    ("pageHeightMm", "用紙高(mm)"),
    ("contentWidthMm", "コンテンツ実幅(mm)"),
    ("leftMarginMm", "左余白(mm)"),
    ("rightMarginMm", "右余白(mm)"),
]

lines = [
    "B5 print comparison",
    "",
    f"Windows browser: {windows['browserVersion']}",
    f"macOS browser: {macos['browserVersion']}",
    f"Windows --print-scale: {windows['postPdfState']['cssScale']}",
    f"macOS --print-scale: {macos['postPdfState']['cssScale']}",
    "",
    "項目 | Windows | macOS | Windows - macOS",
    "--- | ---: | ---: | ---:",
]
for key, label in fields:
    win_value = windows["pdf"][key]
    mac_value = macos["pdf"][key]
    lines.append(f"{label} | {win_value} | {mac_value} | {round(win_value - mac_value, 3)}")

lines.extend([
    "",
    f"連続計算安定（Windows）: {windows['repeatedFitStable']}",
    f"連続計算安定（macOS）: {macos['repeatedFitStable']}",
])

(output_dir / "comparison.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
(output_dir / "comparison.json").write_text(
    json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
