"""
Virtual Avatar Pipeline CLI (Stage 2-6)

Examples:
    python main.py run --image face.jpg --api-key YOUR_API_KEY
    python main.py run --image samples/01_input --api-key YOUR_API_KEY
    python main.py extract --image face.jpg
    python main.py run --image face.jpg --skip-3d --glb ./output/avatar.glb
    python main.py debug --image face.jpg
    python main.py batch --images samples --save-json output/batch.json
"""

import argparse
import csv
import json
import sys
from pathlib import Path

from pipeline import (
    FaceFeatureVector,
    extract_features,
    run_pipeline,
    visualize_landmarks,
)


ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def cmd_run(args):
    image_path = _resolve_image_arg(args.image)
    result = run_pipeline(
        image_path=image_path,
        output_dir=args.output,
        provider=args.provider,
        api_key=args.api_key,
        skip_3d=args.skip_3d,
        existing_glb=args.glb,
    )
    status = result.get("status", "ok")
    if status == "ok":
        print("\n[Done] Pipeline result:")
    else:
        print(f"\n[Failed] Pipeline result: status={status}")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if status != "ok":
        sys.exit(1)


def cmd_extract(args):
    image_path = _resolve_image_arg(args.image)
    print(f"[Extract] image: {image_path}")
    feature_vector = extract_features(image_path)
    if feature_vector is None:
        print("[Extract] face not detected")
        sys.exit(1)

    print("[Extract] feature vector:")
    for key, value in feature_vector.to_dict().items():
        print(f"  {key}: {value:.4f}")

    from pipeline import select_template

    result = select_template(feature_vector)
    print(f"\n[Select] {result.template_name} (confidence={result.confidence:.3f})")
    print(f"[Select] all scores: {result.all_scores}")
    print("[Select] slider init:")
    for key, value in result.slider_init.items():
        print(f"  {key}: {value:.3f}")


def cmd_debug(args):
    image_path = _resolve_image_arg(args.image)
    save_path = str(Path(args.output) / "landmarks_debug.png")
    Path(args.output).mkdir(parents=True, exist_ok=True)
    image = visualize_landmarks(image_path, save_path=save_path)
    print(f"[Debug] landmark visualization saved: {save_path}")
    return image


def cmd_batch_run(args):
    images = _resolve_image_args(args.images)
    results = []

    for image_path in images:
        name = Path(image_path).stem
        out_dir = str(Path(args.output) / name)
        print(f"\n[BatchRun] {image_path} -> {out_dir}")
        try:
            result = run_pipeline(
                image_path=image_path,
                output_dir=out_dir,
                provider=args.provider,
                api_key=args.api_key,
            )
            status = result.get("status", "ok")
            batch_row = {"image": image_path, **result}
            results.append(batch_row)

            if status == "ok":
                print(f"[BatchRun] {image_path} -> template={result['template']}")
            else:
                print(
                    f"[BatchRun] {image_path} -> {status}: "
                    f"{result.get('error', '')}"
                )
        except Exception as exc:
            results.append({"image": image_path, "status": "failed", "error": str(exc)})
            print(f"[BatchRun] {image_path} -> {exc}")

    succeeded = len([row for row in results if row["status"] == "ok"])
    print(f"\n[BatchRun] done: {succeeded}/{len(images)} succeeded")


def cmd_batch(args):
    from pipeline import select_template

    images = _resolve_image_args(args.images)
    rows = []

    for image_path in images:
        image_name = Path(image_path).name
        row = {
            "image_path": image_path,
            "image_name": image_name,
            "status": "ok",
            "feature_vector": None,
            "template": None,
            "confidence": None,
            "all_scores": None,
            "slider_init": None,
            "error": None,
        }

        try:
            feature_vector = extract_features(image_path)
            if feature_vector is None:
                row["status"] = "failed"
                row["error"] = "face not detected"
                print(f"[Batch] {image_name} -> face not detected")
                rows.append(row)
                continue

            result = select_template(feature_vector)
            row["feature_vector"] = feature_vector.to_dict()
            row["template"] = result.template_name
            row["confidence"] = result.confidence
            row["all_scores"] = result.all_scores
            row["slider_init"] = result.slider_init
            print(
                f"[Batch] {image_name} -> {result.template_name} "
                f"(confidence={result.confidence:.3f})"
            )
        except Exception as exc:
            row["status"] = "failed"
            row["error"] = str(exc)
            print(f"[Batch] {image_name} -> {exc}")

        rows.append(row)

    _print_batch_table(rows)

    if args.save_json:
        _save_batch_json(rows, args.save_json)

    if args.save_csv:
        _save_batch_csv(rows, args.save_csv)


def _print_batch_table(rows):
    if not rows:
        return

    succeeded = [row for row in rows if row["status"] == "ok" and row["feature_vector"]]
    if not succeeded:
        return

    fields = list(FaceFeatureVector.field_names())
    col_width = 22
    header = (
        f"{'image':<20} {'template':<8} "
        + " ".join(f"{field[:col_width]:<{col_width}}" for field in fields)
    )

    print("\n" + "=" * len(header))
    print(header)
    print("=" * len(header))
    for row in succeeded:
        feature_vector = row["feature_vector"]
        values = " ".join(
            f"{feature_vector[field]:<{col_width}.4f}" for field in fields
        )
        print(f"{row['image_name']:<20} {row['template']:<8} {values}")
    print("=" * len(header))


def _save_batch_json(rows, save_path):
    path = Path(save_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[Batch] JSON saved: {path}")


def _save_batch_csv(rows, save_path):
    path = Path(save_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    feature_fields = list(FaceFeatureVector.field_names())
    slider_fields = sorted({
        key
        for row in rows
        for key in (row["slider_init"] or {}).keys()
    })

    slider_columns = [f"slider_{key}" for key in slider_fields]
    fieldnames = [
        "image_path",
        "image_name",
        "status",
        "template",
        "confidence",
        "error",
        *feature_fields,
        *slider_columns,
    ]

    with path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            feature_vector = row["feature_vector"] or {}
            slider_init = row["slider_init"] or {}
            writer.writerow(
                {
                    "image_path": row["image_path"],
                    "image_name": row["image_name"],
                    "status": row["status"],
                    "template": row["template"] or "",
                    "confidence": (
                        ""
                        if row["confidence"] is None
                        else f"{row['confidence']:.6f}"
                    ),
                    "error": row["error"] or "",
                    **{field: feature_vector.get(field, "") for field in feature_fields},
                    **{
                        f"slider_{field}": slider_init.get(field, "")
                        for field in slider_fields
                    },
                }
            )

    print(f"[Batch] CSV saved: {path}")


def _resolve_image_arg(image_arg: str) -> str:
    path = Path(image_arg)
    if path.is_file():
        _validate_image_suffix(path)
        return str(path)
    legacy_sample_path = _resolve_legacy_sample_image(path)
    if legacy_sample_path is not None:
        return str(legacy_sample_path)
    if path.is_dir():
        matches = _find_original_images(path)
        if len(matches) == 1:
            return str(matches[0])
        if not matches:
            raise FileNotFoundError(
                f"No supported *_original image found in directory: {path}"
            )
        raise ValueError(
            f"Multiple supported *_original images found in directory: {path}"
        )
    raise FileNotFoundError(f"Image path not found: {path}")


def _resolve_legacy_sample_image(path: Path) -> Path | None:
    if path.parent.name != "samples" or path.suffix.lower() not in ALLOWED_IMAGE_SUFFIXES:
        return None

    stem = path.stem
    if "_" not in stem:
        return None

    prefix, _ = stem.split("_", 1)
    sample_dir = path.parent / f"{prefix}_input"
    candidate = sample_dir / path.name
    if candidate.is_file():
        _validate_image_suffix(candidate)
        return candidate
    return None


def _find_original_images(path: Path) -> list[Path]:
    return sorted(
        child for child in path.iterdir()
        if child.is_file()
        and child.suffix.lower() in ALLOWED_IMAGE_SUFFIXES
        and child.stem.endswith("_original")
    )


def _validate_image_suffix(path: Path) -> None:
    if path.suffix.lower() not in ALLOWED_IMAGE_SUFFIXES:
        allowed = ", ".join(sorted(ALLOWED_IMAGE_SUFFIXES))
        raise ValueError(f"Unsupported image extension: {path.suffix}. Allowed: {allowed}")


def _resolve_image_args(image_args: list[str]) -> list[str]:
    resolved: list[str] = []

    for image_arg in image_args:
        path = Path(image_arg)
        if path.is_dir():
            sample_dirs = sorted(
                child for child in path.iterdir()
                if child.is_dir() and child.name.endswith("_input")
            )
            if sample_dirs:
                for sample_dir in sample_dirs:
                    resolved.append(_resolve_image_arg(str(sample_dir)))
                continue
        resolved.append(_resolve_image_arg(image_arg))

    return resolved


def main():
    parser = argparse.ArgumentParser(description="Virtual Avatar Pipeline")
    parser.add_argument("--output", default="./output", help="output directory")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="run the full pipeline")
    p_run.add_argument("--image", required=True, help="image path or sample input directory")
    p_run.add_argument("--provider", default="varco", choices=["meshy", "varco"])
    p_run.add_argument("--api-key", default="", dest="api_key")
    p_run.add_argument("--skip-3d", action="store_true", dest="skip_3d")
    p_run.add_argument("--glb", default=None)

    p_ext = sub.add_parser("extract", help="extract face features only")
    p_ext.add_argument("--image", required=True, help="image path or sample input directory")

    p_brun = sub.add_parser("batch-run", help="run the full pipeline for many images")
    p_brun.add_argument("--images", nargs="+", required=True, help="image paths, sample input directories, or samples root")
    p_brun.add_argument("--provider", default="varco", choices=["meshy", "varco"])
    p_brun.add_argument("--api-key", default="", dest="api_key")

    p_bat = sub.add_parser("batch", help="extract and compare features for many images")
    p_bat.add_argument("--images", nargs="+", required=True, help="image paths, sample input directories, or samples root")
    p_bat.add_argument("--save-json", dest="save_json", default=None)
    p_bat.add_argument("--save-csv", dest="save_csv", default=None)

    p_dbg = sub.add_parser("debug", help="visualize landmarks")
    p_dbg.add_argument("--image", required=True, help="image path or sample input directory")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "extract":
        cmd_extract(args)
    elif args.command == "batch-run":
        cmd_batch_run(args)
    elif args.command == "batch":
        cmd_batch(args)
    elif args.command == "debug":
        cmd_debug(args)


if __name__ == "__main__":
    main()
