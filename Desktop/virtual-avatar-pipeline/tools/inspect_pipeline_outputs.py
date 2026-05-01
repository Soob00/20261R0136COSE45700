"""
Inspect pipeline output directories and write a summary CSV.
"""

import argparse
import csv
import json
from pathlib import Path
from typing import Any


PARAMETER_KEYS = [
    "Eye_WidthV",
    "Eye_Dist",
    "Nose_Height",
    "Nose_Width",
    "Mouth_Width",
    "Face_JawLine",
    "Face_Roundness",
    "Face_ChinWidth",
]

FEATURE_KEYS = [
    "eye_aspect_ratio",
    "eye_distance_ratio",
    "face_width_height_ratio",
    "nose_height_ratio",
    "nose_width_ratio",
    "mouth_width_ratio",
    "jaw_width_ratio",
    "forehead_ratio",
    "chin_ratio",
]

COLUMNS = [
    "sample",
    "status",
    "error",
    "has_pipeline_result",
    "has_render_quality",
    "feature_source",
    "selected_template",
    "confidence",
    "front_feature_success",
    "original_feature_success",
    "front_attempts",
    "original_attempts",
    "front_quality_score",
    "front_bbox_area_ratio",
    "front_center_offset",
    *(f"feature_{key}" for key in FEATURE_KEYS),
    *PARAMETER_KEYS,
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a CSV summary from pipeline output directories."
    )
    parser.add_argument("--root", default="output", help="output root directory")
    parser.add_argument(
        "--save-csv",
        default="output/summary.csv",
        help="summary CSV path",
    )
    args = parser.parse_args()

    root = Path(args.root)
    save_csv = Path(args.save_csv)
    rows = [_inspect_sample_dir(sample_dir) for sample_dir in _iter_sample_dirs(root)]

    save_csv.parent.mkdir(parents=True, exist_ok=True)
    with save_csv.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"[Inspect] processed {len(rows)} samples")
    print(f"[Inspect] CSV saved: {save_csv}")


def _iter_sample_dirs(root: Path) -> list[Path]:
    sample_dirs: list[Path] = []

    if _has_known_output_file(root):
        sample_dirs.append(root)

    if root.is_dir():
        sample_dirs.extend(sorted(child for child in root.iterdir() if child.is_dir()))

    return sample_dirs


def _has_known_output_file(sample_dir: Path) -> bool:
    return (
        (sample_dir / "pipeline_result.json").is_file()
        or (sample_dir / "renders" / "render_quality.json").is_file()
    )


def _inspect_sample_dir(sample_dir: Path) -> dict[str, str]:
    pipeline_path = sample_dir / "pipeline_result.json"
    render_quality_path = sample_dir / "renders" / "render_quality.json"

    row = {column: "" for column in COLUMNS}
    row["sample"] = sample_dir.name
    row["has_pipeline_result"] = _bool_string(pipeline_path.is_file())
    row["has_render_quality"] = _bool_string(render_quality_path.is_file())

    pipeline_result: dict[str, Any] | None = None
    render_quality: dict[str, Any] | None = None
    errors: list[str] = []

    if pipeline_path.is_file():
        try:
            pipeline_result = _read_json(pipeline_path)
        except Exception as exc:
            errors.append(f"pipeline_result.json: {exc}")
    elif render_quality_path.is_file():
        row["status"] = "missing_pipeline_result"
        row["error"] = "pipeline_result.json missing"

    if render_quality_path.is_file():
        try:
            render_quality = _read_json(render_quality_path)
        except Exception as exc:
            errors.append(f"render_quality.json: {exc}")

    if errors:
        row["status"] = "failed"
        row["error"] = "; ".join(errors)
        return row

    if pipeline_result is not None:
        status_value = pipeline_result.get("status")
        error_value = pipeline_result.get("error")
        row["status"] = _to_cell(status_value) if status_value is not None else "ok"
        row["error"] = _to_cell(error_value) if error_value is not None else ""
        _fill_pipeline_fields(row, pipeline_result)
    elif not row["status"]:
        row["status"] = "missing_pipeline_result"
        row["error"] = "pipeline_result.json missing"

    if render_quality is not None:
        _fill_render_quality_fields(row, render_quality)

    return row


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as json_file:
        data = json.load(json_file)
    if not isinstance(data, dict):
        raise ValueError("top-level JSON is not an object")
    return data


def _fill_pipeline_fields(row: dict[str, str], pipeline_result: dict[str, Any]) -> None:
    row["feature_source"] = _to_cell(pipeline_result.get("feature_source"))
    row["selected_template"] = _to_cell(pipeline_result.get("template"))
    row["confidence"] = _to_cell(pipeline_result.get("confidence"))

    feature_debug = _as_dict(pipeline_result.get("feature_debug"))
    row["front_feature_success"] = _bool_string(feature_debug.get("front_render") is not None)
    row["original_feature_success"] = _bool_string(feature_debug.get("original") is not None)

    attempts = _as_dict(feature_debug.get("attempts"))
    row["front_attempts"] = _json_cell(attempts.get("front_render"))
    row["original_attempts"] = _json_cell(attempts.get("original"))

    feature_vector = _as_dict(pipeline_result.get("feature_vector"))
    for key in FEATURE_KEYS:
        row[f"feature_{key}"] = _to_cell(feature_vector.get(key))

    avatar_parameters = _as_dict(pipeline_result.get("avatar_parameters"))
    for key in PARAMETER_KEYS:
        row[key] = _to_cell(avatar_parameters.get(key))


def _fill_render_quality_fields(row: dict[str, str], render_quality: dict[str, Any]) -> None:
    front_quality = _as_dict(render_quality.get("front"))
    row["front_quality_score"] = _to_cell(front_quality.get("quality_score"))
    row["front_bbox_area_ratio"] = _to_cell(front_quality.get("bbox_area_ratio"))
    row["front_center_offset"] = _to_cell(front_quality.get("center_offset"))


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _bool_string(value: bool) -> str:
    return "true" if value else "false"


def _json_cell(value: Any) -> str:
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False)


def _to_cell(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


if __name__ == "__main__":
    main()
