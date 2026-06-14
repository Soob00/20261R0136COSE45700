from __future__ import annotations

import base64
import struct
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ALLOWED_CATEGORIES = {"glasses", "hairpin", "hair_clip", "hair_bow"}
ALLOWED_SAMPLE_TYPES = {"character_image", "accessory_only"}
CATEGORY_GROUPS = {
    "glasses": "glasses",
    "hairpin": "hair_accessory",
    "hair_clip": "hair_accessory",
    "hair_bow": "hair_accessory",
    "unknown": "unknown",
    "unsupported": "unsupported",
}
STAGE_SUCCESS = "succeeded"
STAGE_FAILED = "failed"
STAGE_SKIPPED = "skipped"
STAGE_REUSED = "reused"

SKIP_REASONS = {
    "api_key_missing",
    "endpoint_missing",
    "dependency_missing",
    "previous_stage_failed",
    "already_reused",
    "manual_skip",
    "config_missing",
    "base_avatar_missing",
    "unsupported_base_avatar_preview",
    "unsupported_category_group",
}

HEX_PATTERN = re.compile(r"^#?[0-9a-fA-F]{6}$")
COLOR_NAME_TO_HEX = {
    "black": "#111111",
    "white": "#F5F5F5",
    "gray": "#9CA3AF",
    "grey": "#9CA3AF",
    "silver": "#C0C0C0",
    "gold": "#D4AF37",
    "beige": "#D6C4A1",
    "brown": "#8B5E3C",
    "red": "#EF4444",
    "orange": "#F97316",
    "yellow": "#EAB308",
    "green": "#22C55E",
    "mint": "#6EE7B7",
    "blue": "#3B82F6",
    "light blue": "#93C5FD",
    "sky blue": "#7DD3FC",
    "navy": "#1E3A8A",
    "purple": "#8B5CF6",
    "pink": "#F9A8D4",
    "hot pink": "#EC4899",
}


@dataclass
class Paths:
    root: Path
    config_dir: Path
    inputs_dir: Path
    outputs_dir: Path
    reports_dir: Path


@dataclass
class Context:
    paths: Paths
    config: dict[str, Any]
    sample: dict[str, Any]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path, default: Any | None = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def sample_output_dir(ctx: Context) -> Path:
    return ctx.paths.outputs_dir / ctx.sample["sampleId"]


def sample_stage_dir(ctx: Context) -> Path:
    return sample_output_dir(ctx) / ".stage_status"


def stage_status_path(ctx: Context, stage: str) -> Path:
    return sample_stage_dir(ctx) / f"{stage}.json"


def load_stage_status(ctx: Context, stage: str) -> dict[str, Any] | None:
    return load_json(stage_status_path(ctx, stage))


def write_stage_status(
    ctx: Context,
    stage: str,
    status: str,
    details: dict[str, Any] | None = None,
) -> None:
    payload = {
        "stage": stage,
        "status": status,
        "updatedAt": utc_now(),
        "details": details or {},
    }
    save_json(stage_status_path(ctx, stage), payload)


def pipeline_log_path(ctx: Context) -> Path:
    return sample_output_dir(ctx) / "pipeline_log.json"


def append_pipeline_event(ctx: Context, event: dict[str, Any]) -> None:
    log = load_json(pipeline_log_path(ctx), default=[])
    log.append({
        "timestamp": utc_now(),
        **event,
    })
    save_json(pipeline_log_path(ctx), log)


def stage_artifact_exists(ctx: Context, stage: str) -> bool:
    path = stage_status_path(ctx, stage)
    if not path.exists():
        return False
    payload = load_json(path, default={}) or {}
    return payload.get("status") in {STAGE_SUCCESS, STAGE_REUSED}


def ensure_original_copy(ctx: Context) -> Path:
    output = sample_output_dir(ctx)
    output.mkdir(parents=True, exist_ok=True)
    src = resolve_sample_image_path(ctx)
    dst = output / "original.png"
    if not dst.exists():
        shutil.copy2(src, dst)
    return dst


def resolve_sample_image_path(ctx: Context) -> Path:
    raw_path = Path(ctx.sample["imagePath"])
    if raw_path.is_absolute():
        return raw_path

    candidates = [
        (ctx.paths.root / raw_path).resolve(),
        (ctx.paths.root.parent.parent / raw_path).resolve(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate

    return candidates[0]


def relative_to_workspace(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path.resolve())


def validate_sample(sample: dict[str, Any]) -> None:
    required = {"sampleId", "imagePath", "expectedCategory", "notes"}
    missing = sorted(required - set(sample))
    if missing:
        raise ValueError(f"Sample missing required fields: {', '.join(missing)}")
    if sample["expectedCategory"] not in ALLOWED_CATEGORIES:
        raise ValueError(f"Unsupported expectedCategory: {sample['expectedCategory']}")
    sample_type = sample.get("sampleType", "character_image")
    if sample_type not in ALLOWED_SAMPLE_TYPES:
        raise ValueError(f"Unsupported sampleType: {sample_type}")


def resolve_sample_type(sample: dict[str, Any]) -> str:
    sample_type = sample.get("sampleType")
    if sample_type in ALLOWED_SAMPLE_TYPES:
        return sample_type
    return "character_image"


def category_group(category: str | None) -> str | None:
    if not category:
        return None
    return CATEGORY_GROUPS.get(category, category)


def parse_json_block(text: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", text, re.DOTALL)
    if fenced:
      text = fenced.group(1)

    text = text.strip()
    return json.loads(text)


def normalize_color_name(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip().lower().replace("_", " ").replace("-", " "))


def normalize_hex(raw: str) -> str | None:
    candidate = raw.strip()
    if not HEX_PATTERN.match(candidate):
        return None
    if not candidate.startswith("#"):
        candidate = f"#{candidate}"
    return candidate.upper()


def map_raw_color_to_hex(raw: str) -> str | None:
    normalized = normalize_hex(raw)
    if normalized:
        return normalized
    return COLOR_NAME_TO_HEX.get(normalize_color_name(raw))


def normalize_raw_colors(raw_colors: list[str]) -> list[str]:
    seen: list[str] = []
    for raw in raw_colors:
        mapped = map_raw_color_to_hex(raw)
        if mapped and mapped not in seen:
            seen.append(mapped)
    return seen


def to_data_uri(path: Path) -> str:
    suffix = path.suffix.lower().lstrip(".") or "png"
    mime = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(suffix, f"image/{suffix}")
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def validation_threshold(ctx: Context, key: str, default: float | int) -> float | int:
    return ctx.config.get("validation", {}).get(key, default)


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def parse_glb_json_chunk(glb_path: Path) -> dict[str, Any]:
    raw = glb_path.read_bytes()
    if len(raw) < 20:
        raise ValueError("GLB too small")

    magic, version, total_length = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF":
        raise ValueError("Invalid GLB header")
    if total_length > len(raw):
        raise ValueError("GLB length header exceeds file size")

    offset = 12
    json_chunk = None
    while offset + 8 <= len(raw):
        chunk_length, chunk_type = struct.unpack_from("<I4s", raw, offset)
        offset += 8
        chunk_data = raw[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == b"JSON":
            json_chunk = chunk_data.decode("utf-8").rstrip(" \t\r\n\0")
            break

    if not json_chunk:
        raise ValueError("Missing GLB JSON chunk")
    return json.loads(json_chunk)


def validate_review_payload(review: dict[str, Any]) -> tuple[bool, str | None]:
    review_status = review.get("reviewStatus")
    review_outcome = review.get("reviewOutcome")

    if review_status == "pending":
        if review_outcome is not None:
            return False, "pending_requires_null_outcome"
        return True, None

    if review_status == "approved":
        if review_outcome != "approved":
            return False, "approved_requires_approved_outcome"
        return True, None

    if review_status == "rejected":
        if review_outcome not in {"rejected", "needs_fix"}:
            return False, "rejected_requires_rejected_or_needs_fix"
        return True, None

    return False, "invalid_review_status"
