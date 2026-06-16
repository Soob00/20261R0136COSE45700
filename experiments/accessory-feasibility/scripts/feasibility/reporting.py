from __future__ import annotations

from collections import defaultdict
from collections import Counter
from pathlib import Path
from typing import Any

from . import STAGE_ORDER
from .common import load_json, relative_to_workspace, save_json, save_text, validate_review_payload


def _rate(succeeded: int, attempted: int) -> float | None:
    if attempted <= 0:
        return None
    return round(succeeded / attempted, 4)


def _gate_rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def generate_reports(workspace_root: Path, samples: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    outputs_dir = workspace_root / "outputs"
    reports_dir = workspace_root / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    thresholds = (config or {}).get("thresholds", {})

    stage_stats = {
        stage: {
            "attempted": 0,
            "succeeded": 0,
            "failed": 0,
            "skipped": 0,
            "skipped_reasons": {},
            "failure_reasons": {},
        }
        for stage in STAGE_ORDER
    }
    category_stats = defaultdict(
        lambda: {
            "total_samples": 0,
            "stages": {
                stage: {
                    "attempted": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "skipped": 0,
                    "skipped_reasons": {},
                    "failure_reasons": {},
                }
                for stage in STAGE_ORDER
            },
            "approved": 0,
            "rejected": 0,
            "needs_fix": 0,
            "review_time_minutes_total": 0.0,
            "review_time_count": 0,
            "invalid_review_records": 0,
        }
    )
    failure_rows: list[dict[str, Any]] = []
    failure_counter: Counter[str] = Counter()
    skipped_samples = 0
    sample_input_sources: dict[str, str] = {}

    for sample in samples:
        sample_id = sample["sampleId"]
        category = sample["expectedCategory"]
        category_stats[category]["total_samples"] += 1
        sample_dir = outputs_dir / sample_id
        status_dir = sample_dir / ".stage_status"
        submit_payload = load_json(sample_dir / "varco" / "submit.json", default={}) or {}
        detect_status_details = (load_json(status_dir / "detect.json", default={}) or {}).get("details", {})
        sample_input_sources[sample_id] = (
            submit_payload.get("inputSource")
            or detect_status_details.get("inputSource")
            or sample.get("sampleType")
            or "unknown"
        )
        detect_status = load_json(status_dir / "detect.json", default=None)
        if detect_status and detect_status.get("status") == "skipped":
            skipped_samples += 1

        for stage in STAGE_ORDER:
            status = load_json(status_dir / f"{stage}.json", default=None)
            if not status:
                continue
            stage_status = status.get("status")
            bucket = stage_stats[stage]
            category_bucket = category_stats[category]["stages"][stage]
            if stage_status in {"succeeded", "reused"}:
                bucket["attempted"] += 1
                bucket["succeeded"] += 1
                category_bucket["attempted"] += 1
                category_bucket["succeeded"] += 1
            elif stage_status == "failed":
                bucket["attempted"] += 1
                bucket["failed"] += 1
                category_bucket["attempted"] += 1
                category_bucket["failed"] += 1
                reason = (status.get("details") or {}).get("reason", "unknown")
                bucket["failure_reasons"][reason] = bucket["failure_reasons"].get(reason, 0) + 1
                category_bucket["failure_reasons"][reason] = category_bucket["failure_reasons"].get(reason, 0) + 1
                failure_counter[reason] += 1
                failure_rows.append(
                    {
                        "sample_id": sample_id,
                        "stage": stage,
                        "input_source": sample_input_sources[sample_id],
                        "failure_reason": reason,
                        "skip_reason": "",
                        "review_outcome": "",
                        "review_note": "",
                    }
                )
            elif stage_status == "skipped":
                bucket["skipped"] += 1
                category_bucket["skipped"] += 1
                reason = (status.get("details") or {}).get("reason", "unknown")
                bucket["skipped_reasons"][reason] = bucket["skipped_reasons"].get(reason, 0) + 1
                category_bucket["skipped_reasons"][reason] = category_bucket["skipped_reasons"].get(reason, 0) + 1

        review_files = sorted((sample_dir / "review").glob("*_review.json"))
        if review_files:
            review = load_json(review_files[0], default={}) or {}
            is_valid, review_error = validate_review_payload(review)
            review_status = review.get("reviewStatus")
            review_outcome = review.get("reviewOutcome")
            review_time = review.get("reviewTimeMinutes")
            if not is_valid:
                category_stats[category]["invalid_review_records"] += 1
            elif review_status == "approved":
                category_stats[category]["approved"] += 1
            elif review_status == "rejected":
                category_stats[category]["rejected"] += 1
            if is_valid and review_outcome == "needs_fix":
                category_stats[category]["needs_fix"] += 1
            if is_valid and isinstance(review_time, (int, float)):
                category_stats[category]["review_time_minutes_total"] += float(review_time)
                category_stats[category]["review_time_count"] += 1

            for row in failure_rows:
                if row["sample_id"] == sample_id:
                    suffix = f" [invalid_review: {review_error}]" if review_error else ""
                    row["review_note"] = f"{review.get('reviewNote', '')}{suffix}"
                    row["review_outcome"] = review_outcome or ""

        for stage in STAGE_ORDER:
            status = load_json(status_dir / f"{stage}.json", default=None)
            if status and status.get("status") == "skipped":
                reason = (status.get("details") or {}).get("reason", "unknown")
                failure_rows.append(
                    {
                        "sample_id": sample_id,
                        "stage": stage,
                        "input_source": sample_input_sources[sample_id],
                        "failure_reason": "",
                        "skip_reason": reason,
                        "review_outcome": "",
                        "review_note": "",
                    }
                )

    for bucket in stage_stats.values():
        bucket["success_rate"] = _rate(bucket["succeeded"], bucket["attempted"])

    for category, payload in category_stats.items():
        for bucket in payload["stages"].values():
            bucket["success_rate"] = _rate(bucket["succeeded"], bucket["attempted"])
        count = payload["review_time_count"]
        payload["average_review_time_minutes"] = round(
            payload["review_time_minutes_total"] / count, 2
        ) if count else None

    attempted_samples = 0
    for sample in samples:
        detect_status = load_json(outputs_dir / sample["sampleId"] / ".stage_status" / "detect.json", default=None)
        if detect_status and detect_status.get("status") in {"succeeded", "reused", "failed"}:
            attempted_samples += 1

    gate_categories: dict[str, dict[str, Any]] = {}
    additional_sample_categories: list[str] = []
    threshold_detect = float(thresholds.get("detect_success_rate", 0.8))
    threshold_isolate = float(thresholds.get("isolate_usable_rate", 0.6))
    threshold_glb = float(thresholds.get("glb_usable_rate", 0.4))
    threshold_approved = float(thresholds.get("approved_rate", 0.3))
    threshold_review = float(thresholds.get("review_time_minutes_max", 5.0))

    for category, payload in category_stats.items():
        detect_attempted = payload["stages"]["detect"]["attempted"]
        detect_success = payload["stages"]["detect"]["succeeded"]
        isolate_attempted = payload["stages"]["isolation_validate"]["attempted"]
        isolate_success = payload["stages"]["isolation_validate"]["succeeded"]
        glb_attempted = payload["stages"]["validate_glb"]["attempted"]
        glb_success = payload["stages"]["validate_glb"]["succeeded"]
        approved = payload["approved"]
        review_average = payload["average_review_time_minutes"]

        detect_rate = _gate_rate(detect_success, detect_attempted)
        isolate_rate = _gate_rate(isolate_success, isolate_attempted)
        glb_rate = _gate_rate(glb_success, glb_attempted)
        approved_rate = _gate_rate(approved, payload["total_samples"])

        failures: list[str] = []
        if detect_rate is None or detect_rate < threshold_detect:
            failures.append("detect_success_rate")
        if isolate_rate is None or isolate_rate < threshold_isolate:
            failures.append("isolate_usable_rate")
        if glb_rate is None or glb_rate < threshold_glb:
            failures.append("glb_usable_rate")
        if approved_rate is None or approved_rate < threshold_approved:
            failures.append("approved_rate")
        if review_average is None or review_average > threshold_review:
            failures.append("review_time_minutes")

        gate_categories[category] = {
            "passed": len(failures) == 0,
            "failed_checks": failures,
            "detect_rate": detect_rate,
            "isolate_rate": isolate_rate,
            "glb_rate": glb_rate,
            "approved_rate": approved_rate,
            "average_review_time_minutes": review_average,
        }
        if payload["total_samples"] < 10 or failures:
            additional_sample_categories.append(category)

    overall_gate_passed = all(item["passed"] for item in gate_categories.values()) if gate_categories else False
    top_failure_reasons = failure_counter.most_common(3)
    summary = {
        "total_samples": len(samples),
        "attempted_samples": attempted_samples,
        "skipped_samples": skipped_samples,
        "sample_input_sources": sample_input_sources,
        "stages": stage_stats,
        "categories": category_stats,
        "mvp_gate": {
            "passed": overall_gate_passed,
            "categories": gate_categories,
            "top_failure_reasons": top_failure_reasons,
            "additional_sample_categories": sorted(set(additional_sample_categories)),
        },
    }

    summary_lines = [
        "# Feasibility Summary",
        "",
        f"- total_samples: {summary['total_samples']}",
        f"- attempted_samples: {summary['attempted_samples']}",
        f"- skipped_samples: {summary['skipped_samples']}",
        f"- mvp_gate_passed: {summary['mvp_gate']['passed']}",
        f"- top_failure_reasons: {summary['mvp_gate']['top_failure_reasons']}",
        f"- additional_sample_categories: {summary['mvp_gate']['additional_sample_categories']}",
        "",
        "## Stages",
        "",
    ]
    for stage, bucket in stage_stats.items():
        summary_lines.append(
            f"- {stage}: attempted={bucket['attempted']}, succeeded={bucket['succeeded']}, "
            f"failed={bucket['failed']}, skipped={bucket['skipped']}, success_rate={bucket['success_rate']}"
        )

    summary_lines.extend(["", "## Categories", ""])
    for category, payload in category_stats.items():
        summary_lines.append(
            f"- {category}: approved={payload['approved']}, rejected={payload['rejected']}, "
            f"needs_fix={payload['needs_fix']}, invalid_review_records={payload['invalid_review_records']}, "
            f"average_review_time_minutes={payload['average_review_time_minutes']}"
        )

    summary_lines.extend(["", "## Sample Input Sources", ""])
    for sample_id, input_source in sorted(sample_input_sources.items()):
        summary_lines.append(f"- {sample_id}: input_source={input_source}")

    failure_lines = [
        "# Failure Gallery",
        "",
        "| sample_id | stage | input_source | original | crop | isolated | asset_preview | attach_preview | failure_reason | skip_reason | review_outcome | review_note |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in failure_rows:
        sample_dir = outputs_dir / row["sample_id"]
        original = sample_dir / "original.png"
        crop = sample_dir / "crops" / "acc_001_crop.png"
        isolated = sample_dir / "isolated" / "acc_001_isolated.png"
        asset_preview = sample_dir / "preview" / "acc_001_asset_preview.png"
        attach_preview = sample_dir / "preview" / "acc_001_attach_preview.png"
        failure_lines.append(
            f"| {row['sample_id']} | {row.get('stage', '')} | {row.get('input_source', sample_input_sources.get(row['sample_id'], ''))} | "
            f"{relative_to_workspace(original, workspace_root) if original.exists() else ''} | "
            f"{relative_to_workspace(crop, workspace_root) if crop.exists() else ''} | "
            f"{relative_to_workspace(isolated, workspace_root) if isolated.exists() else ''} | "
            f"{relative_to_workspace(asset_preview, workspace_root) if asset_preview.exists() else ''} | "
            f"{relative_to_workspace(attach_preview, workspace_root) if attach_preview.exists() else ''} | "
            f"{row['failure_reason']} | {row.get('skip_reason', '')} | {row.get('review_outcome', '')} | {row['review_note']} |"
        )

    save_json(reports_dir / "summary.json", summary)
    save_text(reports_dir / "feasibility-summary.md", "\n".join(summary_lines) + "\n")
    save_text(reports_dir / "failure-gallery.md", "\n".join(failure_lines) + "\n")
    return summary
