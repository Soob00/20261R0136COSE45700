from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from collections import deque
from io import BytesIO
from pathlib import Path
from typing import Any

from . import STAGE_ORDER
from .common import (
    category_group,
    clamp,
    Context,
    parse_glb_json_chunk,
    resolve_sample_type,
    STAGE_FAILED,
    STAGE_REUSED,
    STAGE_SKIPPED,
    STAGE_SUCCESS,
    append_pipeline_event,
    ensure_original_copy,
    load_json,
    map_raw_color_to_hex,
    normalize_raw_colors,
    relative_to_workspace,
    sample_output_dir,
    save_json,
    save_text,
    stage_status_path,
    to_data_uri,
    utc_now,
    validation_threshold,
    write_stage_status,
)


def _try_import_pil():
    try:
        from PIL import Image, ImageDraw  # type: ignore

        return Image, ImageDraw
    except ImportError:
        return None, None


def _try_import_requests():
    try:
        import requests  # type: ignore

        return requests
    except ImportError:
        return None


def _console_log(stage: str, status: str, details: dict[str, Any] | None = None) -> None:
    payload = details or {}
    suffix = ""
    if status == "started":
        reason = payload.get("provider") or payload.get("config") or ""
        suffix = f" {reason}" if isinstance(reason, str) and reason else ""
    elif status in {"reused", "skipped", "failed"}:
        reason = payload.get("reason")
        if reason:
            suffix = f" reason={reason}"
        depends_on = payload.get("depends_on")
        if depends_on:
            suffix += f" depends_on={depends_on}"
        if status == "failed":
            error = payload.get("error")
            if isinstance(error, str) and error:
                suffix += f" error={error}"
    elif status == "succeeded":
        provider = payload.get("provider")
        if isinstance(provider, str) and provider:
            suffix = f" provider={provider}"
    print(f"[feasibility] {stage} {status}{suffix}")


def _mark_started(ctx: Context, stage: str, extra: dict[str, Any] | None = None) -> None:
    _console_log(stage, "started", extra)
    append_pipeline_event(ctx, {"stage": stage, "event": "started", **(extra or {})})


def _mark_reused(ctx: Context, stage: str, extra: dict[str, Any] | None = None) -> None:
    _console_log(stage, "reused", extra)
    write_stage_status(ctx, stage, STAGE_REUSED, extra)
    append_pipeline_event(ctx, {"stage": stage, "event": "reused", **(extra or {})})


def _mark_skipped(
    ctx: Context,
    stage: str,
    reason: str,
    *,
    depends_on: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    details = {"reason": reason, **(extra or {})}
    if depends_on:
        details["depends_on"] = depends_on
    _console_log(stage, "skipped", details)
    write_stage_status(ctx, stage, STAGE_SKIPPED, details)
    append_pipeline_event(ctx, {"stage": stage, "event": "skipped", **details})


def _mark_failed(ctx: Context, stage: str, reason: str, extra: dict[str, Any] | None = None) -> None:
    details = {"reason": reason, **(extra or {})}
    _console_log(stage, "failed", details)
    write_stage_status(ctx, stage, STAGE_FAILED, details)
    append_pipeline_event(ctx, {"stage": stage, "event": "failed", **details})


def _mark_succeeded(ctx: Context, stage: str, details: dict[str, Any] | None = None) -> None:
    _console_log(stage, "succeeded", details)
    write_stage_status(ctx, stage, STAGE_SUCCESS, details)
    append_pipeline_event(ctx, {"stage": stage, "event": "succeeded", **(details or {})})


def _load_detection(ctx: Context) -> dict[str, Any] | None:
    return load_json(sample_output_dir(ctx) / "detection.json", default=None)


def _load_submit(ctx: Context) -> dict[str, Any] | None:
    return load_json(sample_output_dir(ctx) / "varco" / "submit.json", default=None)


def _load_poll_result(ctx: Context) -> dict[str, Any] | None:
    return load_json(sample_output_dir(ctx) / "varco" / "result.json", default=None)


def _stage_succeeded_or_reused(ctx: Context, stage: str) -> bool:
    status = load_json(stage_status_path(ctx, stage), default={}) or {}
    return status.get("status") in {STAGE_SUCCESS, STAGE_REUSED}


def _truncate_debug_text(value: str, limit: int = 1000) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "...(truncated)"


def _extract_http_error_debug(exc: urllib.error.HTTPError) -> dict[str, Any]:
    raw_body = ""
    parsed_body: Any = None
    try:
        raw_bytes = exc.read()
        raw_body = raw_bytes.decode("utf-8", errors="replace")
        if raw_body:
            try:
                parsed_body = json.loads(raw_body)
            except json.JSONDecodeError:
                parsed_body = None
    except Exception:
        raw_body = ""
        parsed_body = None

    summary = _truncate_debug_text(raw_body.replace("\r", " ").replace("\n", " ").strip(), 300) if raw_body else None
    return {
        "statusCode": getattr(exc, "code", None),
        "reason": getattr(exc, "reason", None),
        "headers": dict(getattr(exc, "headers", {}) or {}),
        "bodyText": raw_body or None,
        "bodyJson": parsed_body,
        "bodySummary": summary,
    }


def _save_detect_debug_artifact(ctx: Context, name: str, payload: Any) -> Path:
    path = sample_output_dir(ctx) / "detect" / "debug" / name
    save_json(path, payload)
    return path


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clear_varco_downstream_artifacts(sample_dir: Path) -> None:
    for path in [
        sample_dir / "varco" / "result.json",
        sample_dir / "glb_raw" / "acc_001_raw.glb",
        sample_dir / "glb_raw" / "validation.json",
        sample_dir / "preview" / "attachment_spec.json",
        sample_dir / "preview" / "postprocess.json",
        sample_dir / "preview" / "render_result.json",
        sample_dir / "preview" / "acc_001_attach_preview.png",
        sample_dir / "preview" / "acc_001_attach_preview_3d.png",
    ]:
        if path.exists():
            path.unlink()


def _clear_detect_downstream_artifacts(sample_dir: Path) -> None:
    for path in [
        sample_dir / "detection.json",
        sample_dir / "varco" / "submit.json",
        sample_dir / "varco" / "result.json",
        sample_dir / "glb_raw" / "acc_001_raw.glb",
        sample_dir / "glb_raw" / "validation.json",
        sample_dir / "preview" / "attachment_spec.json",
        sample_dir / "preview" / "postprocess.json",
        sample_dir / "preview" / "render_result.json",
        sample_dir / "preview" / "acc_001_attach_preview.png",
        sample_dir / "preview" / "acc_001_attach_preview_3d.png",
    ]:
        if path.exists():
            path.unlink()

    for directory in [
        sample_dir / "crops",
        sample_dir / "isolated",
        sample_dir / "preview",
        sample_dir / "review",
    ]:
        if directory.exists():
            shutil.rmtree(directory)

    for stage_name in STAGE_ORDER:
        if stage_name == "detect":
            continue
        status_path = sample_dir / ".stage_status" / f"{stage_name}.json"
        if status_path.exists():
            status_path.unlink()


def _attach_region_for_category(category: str) -> str:
    if category == "glasses":
        return "face"
    return "hair"


def _resolve_varco_input(ctx: Context) -> tuple[Path, str]:
    sample_type = resolve_sample_type(ctx.sample)
    if sample_type == "accessory_only":
        return sample_output_dir(ctx) / "original.png", "original"
    return sample_output_dir(ctx) / "isolated" / "acc_001_isolated.png", "isolated"


def _mask_metrics(mask: list[list[int]]) -> dict[str, Any]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    total = max(1, width * height)
    foreground = sum(sum(row) for row in mask)
    if foreground == 0:
        return {
            "width": width,
            "height": height,
            "foregroundPixels": 0,
            "nontransparentRatio": 0.0,
            "bboxFillRatio": 0.0,
            "edgeContactRatio": 0.0,
            "connectedComponents": 0,
            "bounds": None,
        }

    xs = [x for y in range(height) for x in range(width) if mask[y][x]]
    ys = [y for y in range(height) for x in range(width) if mask[y][x]]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    bbox_area = max(1, (max_x - min_x + 1) * (max_y - min_y + 1))
    edge_pixels = 0
    for y in range(height):
        for x in range(width):
            if not mask[y][x]:
                continue
            if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                edge_pixels += 1

    visited = [[False] * width for _ in range(height)]
    components = 0
    for y in range(height):
        for x in range(width):
            if not mask[y][x] or visited[y][x]:
                continue
            components += 1
            queue = deque([(x, y)])
            visited[y][x] = True
            while queue:
                cx, cy = queue.popleft()
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and mask[ny][nx] and not visited[ny][nx]:
                        visited[ny][nx] = True
                        queue.append((nx, ny))

    return {
        "width": width,
        "height": height,
        "foregroundPixels": foreground,
        "nontransparentRatio": round(foreground / total, 4),
        "bboxFillRatio": round(foreground / bbox_area, 4),
        "edgeContactRatio": round(edge_pixels / foreground, 4),
        "connectedComponents": components,
        "bounds": {
            "minX": min_x,
            "minY": min_y,
            "maxX": max_x,
            "maxY": max_y,
        },
    }


def _image_metrics(image) -> dict[str, Any]:
    alpha = image.getchannel("A")
    width, height = image.size
    mask = [[1 if alpha.getpixel((x, y)) > 0 else 0 for x in range(width)] for y in range(height)]
    return _mask_metrics(mask)


def _selected_bounds_payload_from_bounds(bounds: dict[str, int] | None, width: int, height: int) -> dict[str, Any]:
    if not bounds:
        return {
            "selectedBounds": None,
            "selectedBoundsWidthRatio": 0.0,
            "selectedBoundsHeightRatio": 0.0,
            "selectedClusterSpanX": 0.0,
            "selectedClusterSpanY": 0.0,
            "selectedCenterOffsetY": 0.0,
        }

    selected_width = max(0, int(bounds["maxX"]) - int(bounds["minX"]) + 1)
    selected_height = max(0, int(bounds["maxY"]) - int(bounds["minY"]) + 1)
    center_y = int(bounds["minY"]) + (selected_height - 1) / 2
    crop_center_y = (height - 1) / 2
    return {
        "selectedBounds": {
            "x": int(bounds["minX"]),
            "y": int(bounds["minY"]),
            "width": selected_width,
            "height": selected_height,
        },
        "selectedBoundsWidthRatio": round(selected_width / max(1, width), 4),
        "selectedBoundsHeightRatio": round(selected_height / max(1, height), 4),
        "selectedClusterSpanX": round(selected_width / max(1, width), 4),
        "selectedClusterSpanY": round(selected_height / max(1, height), 4),
        "selectedCenterOffsetY": round(abs((center_y - crop_center_y) / max(1.0, height)), 4),
    }


def _compute_isolated_image_metrics(
    image,
    *,
    selected_group: str,
    provider: str,
    fallback_used: bool,
    fallback_provider: str | None = None,
    selection: dict[str, Any] | None = None,
    selected_component_ids: list[int] | None = None,
    largest_selected_component_ratio: float | None = None,
) -> dict[str, Any]:
    metrics = _image_metrics(image)
    metrics["selectedCategoryGroup"] = selected_group
    metrics["provider"] = provider
    metrics["fallbackUsed"] = fallback_used
    if fallback_provider:
        metrics["fallbackProvider"] = fallback_provider

    if selection is not None:
        selected_payload = {
            "selectedBounds": selection.get("selectedBounds"),
            "selectedBoundsWidthRatio": float(selection.get("selectedBoundsWidthRatio", 0.0)),
            "selectedBoundsHeightRatio": float(selection.get("selectedBoundsHeightRatio", 0.0)),
            "selectedClusterSpanX": float(selection.get("selectedClusterSpanX", 0.0)),
            "selectedClusterSpanY": float(selection.get("selectedClusterSpanY", 0.0)),
            "selectedCenterOffsetY": float(selection.get("selectedCenterOffsetY", 0.0)),
        }
        metrics.update(selected_payload)
        metrics["selectedComponentCount"] = len(selected_component_ids or [])
        metrics["selectedAreaRatio"] = round(float(metrics["nontransparentRatio"]), 4)
        metrics["largestSelectedComponentRatio"] = round(
            float(
                largest_selected_component_ratio
                if largest_selected_component_ratio is not None
                else metrics["nontransparentRatio"]
            ),
            4,
        )
        return metrics

    derived_payload = _selected_bounds_payload_from_bounds(metrics.get("bounds"), metrics["width"], metrics["height"])
    metrics.update(derived_payload)
    metrics["selectedComponentCount"] = int(metrics.get("connectedComponents", 0))
    metrics["selectedAreaRatio"] = round(float(metrics["nontransparentRatio"]), 4)
    metrics["largestSelectedComponentRatio"] = round(float(metrics["nontransparentRatio"]), 4)
    return metrics


def _corner_background_rgb(image) -> tuple[float, float, float]:
    width, height = image.size
    points = [
        (0, 0),
        (max(0, width - 1), 0),
        (0, max(0, height - 1)),
        (max(0, width - 1), max(0, height - 1)),
    ]
    values = [image.getpixel(point)[:3] for point in points]
    return tuple(sum(channel[i] for channel in values) / len(values) for i in range(3))


def _remove_accessory_only_background(ctx: Context, image):
    isolate_config = ctx.config.get("isolate", {})
    accessory_config = isolate_config.get("accessory_only", {})
    near_white_threshold = int(accessory_config.get("near_white_threshold", 245))
    background_distance_threshold = float(accessory_config.get("background_distance_threshold", 20.0))

    output = image.copy()
    corner_bg = _corner_background_rgb(output)
    width, height = output.size
    foreground_pixels = 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = output.getpixel((x, y))
            distance = math.sqrt(
                ((r - corner_bg[0]) ** 2) + ((g - corner_bg[1]) ** 2) + ((b - corner_bg[2]) ** 2)
            )
            is_near_white = r >= near_white_threshold and g >= near_white_threshold and b >= near_white_threshold
            if is_near_white or distance <= background_distance_threshold:
                output.putpixel((x, y), (r, g, b, 0))
            else:
                output.putpixel((x, y), (r, g, b, a))
                foreground_pixels += 1

    return output, {
        "nearWhiteThreshold": near_white_threshold,
        "backgroundDistanceThreshold": background_distance_threshold,
        "cornerBackgroundRgb": [round(value, 2) for value in corner_bg],
        "foregroundPixelsAfterCleanup": foreground_pixels,
    }


def _clear_deterministic_isolate_artifacts(isolated_dir: Path) -> None:
    for path in [
        isolated_dir / "components.json",
        isolated_dir / "selection.json",
    ]:
        if path.exists():
            path.unlink()


def _clear_isolate_run_artifacts(sample_dir: Path) -> None:
    isolated_dir = sample_dir / "isolated"
    for path in [
        isolated_dir / "acc_001_isolated.png",
        isolated_dir / "metrics.json",
        isolated_dir / "validation.json",
        isolated_dir / "gemini_isolate.json",
        isolated_dir / "components.json",
        isolated_dir / "selection.json",
    ]:
        if path.exists():
            path.unlink()

    debug_dir = isolated_dir / "debug"
    if debug_dir.exists():
        for path in debug_dir.iterdir():
            if path.is_file():
                path.unlink()

    debug_dir = isolated_dir / "debug"
    for path in [
        debug_dir / "bg_distance_mask.png",
        debug_dir / "grayscale_edge_mask.png",
        debug_dir / "dark_pixel_mask.png",
        debug_dir / "color_distance_mask.png",
        debug_dir / "mask_stats.json",
        debug_dir / "combined_mask.png",
        debug_dir / "combined_mask_prefiltered.png",
        debug_dir / "final_mask.png",
    ]:
        if path.exists():
            path.unlink()


def _build_gemini_isolate_prompt(selected_candidate: dict[str, Any], selected_group: str) -> str:
    selected_category = selected_candidate.get("category") or "unknown"
    attach_region = selected_candidate.get("attachRegion") or "unknown"
    shape_description = selected_candidate.get("shapeDescription") or ""
    normalized_colors = selected_candidate.get("normalizedColors") or []
    color_hint = ", ".join(str(color) for color in normalized_colors[:4]) if normalized_colors else "none"
    return (
        "You are performing accessory isolation on an anime-style character crop. "
        "Return exactly one edited image result with a transparent background. "
        "Keep only the target accessory visible and remove everything else: face, skin, hair, eyes, background, clothes, and shadows. "
        "Do not create or invent a new object. Preserve the original accessory shape, pose, scale, and position within the crop. "
        "The output must be a transparent PNG-style RGBA image with the same width and height as the input crop. "
        f"Target accessory category: {selected_category}. "
        f"Target accessory group: {selected_group}. "
        f"Attach region: {attach_region}. "
        f"Accessory description: {shape_description}. "
        f"Normalized color hints: {color_hint}."
    )


def _extract_gemini_image_payload(payload: Any) -> tuple[bytes | None, str | None]:
    stack: deque[Any] = deque([payload])
    data_uri_pattern = re.compile(r"data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=]+)")
    while stack:
        current = stack.popleft()
        if isinstance(current, dict):
            inline = current.get("inlineData") or current.get("inline_data")
            if isinstance(inline, dict):
                mime_type = inline.get("mimeType") or inline.get("mime_type")
                data = inline.get("data")
                if isinstance(mime_type, str) and mime_type.startswith("image/") and isinstance(data, str):
                    try:
                        return base64.b64decode(data), mime_type
                    except Exception:  # noqa: BLE001
                        pass

            mime_type = current.get("mimeType") or current.get("mime_type")
            data = current.get("data")
            if isinstance(mime_type, str) and mime_type.startswith("image/") and isinstance(data, str):
                try:
                    return base64.b64decode(data), mime_type
                except Exception:  # noqa: BLE001
                    pass

            text = current.get("text")
            if isinstance(text, str):
                match = data_uri_pattern.search(text)
                if match:
                    try:
                        return base64.b64decode(match.group(2)), match.group(1)
                    except Exception:  # noqa: BLE001
                        pass

                stripped = text.strip()
                if stripped.startswith("{") or stripped.startswith("["):
                    try:
                        nested = json.loads(stripped)
                    except Exception:  # noqa: BLE001
                        nested = None
                    if nested is not None:
                        stack.append(nested)

            for value in current.values():
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)

    return None, None


def _extract_glb_metrics(glb_path: Path) -> dict[str, Any]:
    gltf = parse_glb_json_chunk(glb_path)
    meshes = gltf.get("meshes", [])
    accessors = gltf.get("accessors", [])

    mesh_count = len(meshes)
    primitive_count = 0
    vertex_count = 0
    face_count = 0
    bounds = None

    min_bounds = [math.inf, math.inf, math.inf]
    max_bounds = [-math.inf, -math.inf, -math.inf]

    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            primitive_count += 1
            position_accessor_index = primitive.get("attributes", {}).get("POSITION")
            if position_accessor_index is not None and 0 <= position_accessor_index < len(accessors):
                accessor = accessors[position_accessor_index]
                vertex_count += int(accessor.get("count", 0))
                accessor_min = accessor.get("min")
                accessor_max = accessor.get("max")
                if accessor_min and accessor_max and len(accessor_min) == 3 and len(accessor_max) == 3:
                    for i in range(3):
                        min_bounds[i] = min(min_bounds[i], accessor_min[i])
                        max_bounds[i] = max(max_bounds[i], accessor_max[i])

            index_accessor_index = primitive.get("indices")
            if index_accessor_index is not None and 0 <= index_accessor_index < len(accessors):
                index_accessor = accessors[index_accessor_index]
                face_count += int(index_accessor.get("count", 0)) // 3
            elif position_accessor_index is not None:
                face_count += int(accessors[position_accessor_index].get("count", 0)) // 3

    if all(value != math.inf for value in min_bounds) and all(value != -math.inf for value in max_bounds):
        bounds = {
            "min": [round(v, 6) for v in min_bounds],
            "max": [round(v, 6) for v in max_bounds],
        }

    return {
        "meshCount": mesh_count,
        "primitiveCount": primitive_count,
        "vertexCount": vertex_count,
        "faceCount": face_count,
        "bounds": bounds,
        "sceneCount": len(gltf.get("scenes", [])),
    }


def _resolve_isolate_group(selected_category: str | None) -> str:
    group = category_group(selected_category)
    if group in {"glasses", "hair_accessory"}:
        return group
    return "unsupported"


def _build_image_data(image) -> dict[str, Any]:
    width, height = image.size
    rgb = [[image.getpixel((x, y))[:3] for x in range(width)] for y in range(height)]
    luma = [
        [
            int(round(0.299 * r + 0.587 * g + 0.114 * b))
            for (r, g, b) in row
        ]
        for row in rgb
    ]
    return {"width": width, "height": height, "rgb": rgb, "luma": luma}


def _empty_mask(width: int, height: int) -> list[list[int]]:
    return [[0 for _ in range(width)] for _ in range(height)]


def _save_mask_png(mask: list[list[int]], path: Path) -> None:
    Image, _ = _try_import_pil()
    if Image is None:
        raise ImportError("Pillow")
    height = len(mask)
    width = len(mask[0]) if height else 0
    image = Image.new("L", (width, height), 0)
    for y in range(height):
        for x in range(width):
            image.putpixel((x, y), 255 if mask[y][x] else 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def _bg_distance_mask(image_data: dict[str, Any], threshold: float) -> list[list[int]]:
    width = image_data["width"]
    height = image_data["height"]
    rgb = image_data["rgb"]
    corners = [
        rgb[0][0],
        rgb[0][max(0, width - 1)],
        rgb[max(0, height - 1)][0],
        rgb[max(0, height - 1)][max(0, width - 1)],
    ]
    bg_rgb = [sum(pixel[i] for pixel in corners) / len(corners) for i in range(3)]
    mask = _empty_mask(width, height)
    for y in range(height):
        for x in range(width):
            r, g, b = rgb[y][x]
            distance = math.sqrt(
                (r - bg_rgb[0]) ** 2 +
                (g - bg_rgb[1]) ** 2 +
                (b - bg_rgb[2]) ** 2
            )
            mask[y][x] = 1 if distance >= threshold else 0
    return mask


def _grayscale_edge_mask(image_data: dict[str, Any], threshold: float) -> list[list[int]]:
    width = image_data["width"]
    height = image_data["height"]
    luma = image_data["luma"]
    mask = _empty_mask(width, height)
    for y in range(height):
        for x in range(width):
            gx = 0 if x == width - 1 else abs(luma[y][x] - luma[y][x + 1])
            gy = 0 if y == height - 1 else abs(luma[y][x] - luma[y + 1][x])
            edge = max(gx, gy)
            mask[y][x] = 1 if edge >= threshold else 0
    return mask


def _dark_pixel_mask(image_data: dict[str, Any], threshold: int) -> list[list[int]]:
    width = image_data["width"]
    height = image_data["height"]
    luma = image_data["luma"]
    mask = _empty_mask(width, height)
    for y in range(height):
        for x in range(width):
            mask[y][x] = 1 if luma[y][x] <= threshold else 0
    return mask


def _dilate_mask(mask: list[list[int]], radius: int = 1) -> list[list[int]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    expanded = _empty_mask(width, height)
    for y in range(height):
        for x in range(width):
            if not mask[y][x]:
                continue
            for ny in range(max(0, y - radius), min(height, y + radius + 1)):
                for nx in range(max(0, x - radius), min(width, x + radius + 1)):
                    expanded[ny][nx] = 1
    return expanded


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    try:
        value = hex_color.strip().lstrip("#")
        if len(value) != 6:
            return None
        return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    except ValueError:
        return None


def _color_distance_mask(image_data: dict[str, Any], colors: list[str], threshold: float) -> list[list[int]] | None:
    palette = [_hex_to_rgb(color) for color in colors]
    palette = [item for item in palette if item is not None]
    if not palette:
        return None
    width = image_data["width"]
    height = image_data["height"]
    rgb = image_data["rgb"]
    mask = _empty_mask(width, height)
    for y in range(height):
        for x in range(width):
            r, g, b = rgb[y][x]
            nearest = min(
                math.sqrt((r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2)
                for pr, pg, pb in palette
            )
            mask[y][x] = 1 if nearest <= threshold else 0
    return mask


def _combine_masks(group: str, masks: dict[str, list[list[int]]]) -> list[list[int]]:
    first_mask = next(iter(masks.values()))
    height = len(first_mask)
    width = len(first_mask[0]) if height else 0
    combined = _empty_mask(width, height)
    bg_mask = masks.get("bg_distance_mask", _empty_mask(width, height))
    edge_mask = _dilate_mask(masks.get("grayscale_edge_mask", _empty_mask(width, height)), radius=1)
    dark_mask = _dilate_mask(masks.get("dark_pixel_mask", _empty_mask(width, height)), radius=1)
    color_mask = _dilate_mask(masks.get("color_distance_mask", _empty_mask(width, height)), radius=1)
    for y in range(height):
        for x in range(width):
            bg = bg_mask[y][x]
            edge = edge_mask[y][x]
            dark = dark_mask[y][x]
            color = color_mask[y][x]
            center_band = abs(y - ((height - 1) / 2)) <= (height * 0.18)

            if group == "glasses":
                combined[y][x] = 1 if ((dark and edge) or (dark and color and center_band)) else 0
            else:
                combined[y][x] = 1 if ((bg and edge) or (color and edge)) else 0
    return combined


def _extract_components(mask: list[list[int]], luma: list[list[int]], mask_sources: dict[str, list[list[int]]]) -> list[dict[str, Any]]:
    height = len(mask)
    width = len(mask[0]) if height else 0
    visited = [[False] * width for _ in range(height)]
    components: list[dict[str, Any]] = []
    component_id = 1

    for y in range(height):
        for x in range(width):
            if not mask[y][x] or visited[y][x]:
                continue
            pixels: list[tuple[int, int]] = []
            queue = deque([(x, y)])
            visited[y][x] = True
            min_x = max_x = x
            min_y = max_y = y
            edge_touch_count = 0
            luma_total = 0
            source_counts = {name: 0 for name in mask_sources}

            while queue:
                cx, cy = queue.popleft()
                pixels.append((cx, cy))
                luma_total += luma[cy][cx]
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                if cx == 0 or cy == 0 or cx == width - 1 or cy == height - 1:
                    edge_touch_count += 1
                for name, source_mask in mask_sources.items():
                    if source_mask[cy][cx]:
                        source_counts[name] += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and mask[ny][nx] and not visited[ny][nx]:
                        visited[ny][nx] = True
                        queue.append((nx, ny))

            area = len(pixels)
            bbox_width = max_x - min_x + 1
            bbox_height = max_y - min_y + 1
            bbox_area = max(1, bbox_width * bbox_height)
            components.append(
                {
                    "componentId": component_id,
                    "pixels": pixels,
                    "area": area,
                    "bbox": {"x": min_x, "y": min_y, "width": bbox_width, "height": bbox_height},
                    "center": {"x": round((min_x + max_x) / 2, 2), "y": round((min_y + max_y) / 2, 2)},
                    "edgeTouchCount": edge_touch_count,
                    "edgeTouchRatio": round(edge_touch_count / max(1, area), 4),
                    "aspectRatio": round(bbox_width / max(1, bbox_height), 4),
                    "fillRatio": round(area / bbox_area, 4),
                    "distanceToCropCenter": None,
                    "meanLuma": round(luma_total / max(1, area), 2),
                    "maskSources": [name for name, count in source_counts.items() if count > 0],
                }
            )
            component_id += 1

    crop_center_x = (width - 1) / 2
    crop_center_y = (height - 1) / 2
    diag = math.sqrt(width * width + height * height)
    for component in components:
        dx = component["center"]["x"] - crop_center_x
        dy = component["center"]["y"] - crop_center_y
        component["distanceToCropCenter"] = round(math.sqrt(dx * dx + dy * dy) / max(1.0, diag), 4)
        component["areaRatio"] = round(component["area"] / max(1, width * height), 4)
        component["bboxWidthRatio"] = round(component["bbox"]["width"] / max(1, width), 4)
        component["bboxHeightRatio"] = round(component["bbox"]["height"] / max(1, height), 4)
        component["centerOffsetX"] = round(dx / max(1.0, width), 4)
        component["centerOffsetY"] = round(dy / max(1.0, height), 4)
        component["centerBandDistanceX"] = round(abs(dx) / max(1.0, width), 4)
        component["centerBandDistanceY"] = round(abs(dy) / max(1.0, height), 4)
    return components


def _prefilter_components(group: str, components: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[int], dict[int, list[str]]]:
    kept: list[dict[str, Any]] = []
    rejected_ids: list[int] = []
    reasons: dict[int, list[str]] = {}

    for component in components:
        component_id = component["componentId"]
        component_reasons: list[str] = []
        area_ratio = float(component["areaRatio"])
        bbox_width_ratio = float(component["bboxWidthRatio"])
        bbox_height_ratio = float(component["bboxHeightRatio"])
        edge_touch_ratio = float(component["edgeTouchRatio"])
        mask_sources = component.get("maskSources", [])

        if area_ratio >= 0.60:
            component_reasons.append("area_ratio")
        if bbox_width_ratio >= 0.90 and bbox_height_ratio >= 0.90:
            component_reasons.append("bbox_full_crop")
        if edge_touch_ratio >= 0.20:
            component_reasons.append("edge_touch_ratio")
        if int(component["area"]) <= 2:
            component_reasons.append("tiny_area")
        if mask_sources in (["bg_distance_mask"], ["color_distance_mask"]):
            component_reasons.append("weak_mask_sources")

        if group == "glasses":
            if bbox_width_ratio < 0.04:
                component_reasons.append("bbox_width_ratio")
            if bbox_height_ratio > 0.55:
                component_reasons.append("bbox_height_ratio")
            if float(component["aspectRatio"]) < 0.45:
                component_reasons.append("aspect_ratio")
            if float(component["centerBandDistanceY"]) > 0.22:
                component_reasons.append("center_band_distance_y")
        elif group == "hair_accessory":
            if area_ratio >= 0.25:
                component_reasons.append("component_area_ratio")
            if bbox_width_ratio > 0.55:
                component_reasons.append("bbox_width_ratio")
            if bbox_height_ratio > 0.55:
                component_reasons.append("bbox_height_ratio")
            if float(component["centerBandDistanceX"]) > 0.42:
                component_reasons.append("center_band_distance_x")
            if float(component["centerBandDistanceY"]) > 0.42:
                component_reasons.append("center_band_distance_y")
            if float(component["fillRatio"]) < 0.08:
                component_reasons.append("fill_ratio")
            if float(component["fillRatio"]) > 0.75:
                component_reasons.append("fill_ratio_upper")
            if "grayscale_edge_mask" not in mask_sources:
                component_reasons.append("missing_edge_support")

        if component_reasons:
            rejected_ids.append(component_id)
            reasons[component_id] = component_reasons
            continue
        kept.append(component)

    return kept, rejected_ids, reasons


def _score_component(group: str, component: dict[str, Any], crop_width: int, crop_height: int) -> dict[str, float]:
    area_ratio = float(component["areaRatio"])
    bbox_width_ratio = float(component["bboxWidthRatio"])
    bbox_height_ratio = float(component["bboxHeightRatio"])
    center_x_score = 1.0 - min(1.0, float(component["centerBandDistanceX"]) / 0.35)
    center_y_score = 1.0 - min(1.0, float(component["centerBandDistanceY"]) / 0.22)
    edge_penalty = float(component["edgeTouchRatio"])
    aspect_ratio = float(component["aspectRatio"])

    if group == "glasses":
        aspect_min = 0.45
        aspect_max = 5.0
        if aspect_ratio < aspect_min:
            aspect_score = max(0.0, aspect_ratio / aspect_min)
        elif aspect_ratio > aspect_max:
            aspect_score = max(0.0, aspect_max / aspect_ratio)
        else:
            aspect_score = 1.0
        area_min = 0.015
        area_max = 0.08
        if area_ratio < area_min:
            area_fit = max(0.0, area_ratio / area_min)
        elif area_ratio > area_max:
            area_fit = max(0.0, 1.0 - ((area_ratio - area_max) / area_max))
        else:
            area_fit = 1.0
        width_score = 0.0
        if bbox_width_ratio >= 0.18 and bbox_width_ratio <= 0.60:
            width_score = 1.0
        elif bbox_width_ratio < 0.18:
            width_score = max(0.0, bbox_width_ratio / 0.18)
        else:
            width_score = max(0.0, 1.0 - ((bbox_width_ratio - 0.60) / 0.60))
        height_score = 0.0
        if bbox_height_ratio >= 0.03 and bbox_height_ratio <= 0.22:
            height_score = 1.0
        elif bbox_height_ratio < 0.03:
            height_score = max(0.0, bbox_height_ratio / 0.03)
        else:
            height_score = max(0.0, 1.0 - ((bbox_height_ratio - 0.22) / 0.22))
        darkness_score = 1.0 - min(1.0, component["meanLuma"] / 255.0)
        total_score = (
            center_x_score * 0.20 +
            center_y_score * 0.30 +
            aspect_score * 0.20 +
            ((area_fit + width_score + height_score) / 3.0) * 0.20 +
            darkness_score * 0.10
        )
        return {
            "centerXScore": round(center_x_score, 4),
            "centerYScore": round(center_y_score, 4),
            "aspectRatioScore": round(aspect_score, 4),
            "areaFitScore": round(area_fit, 4),
            "bboxWidthScore": round(width_score, 4),
            "bboxHeightScore": round(height_score, 4),
            "darknessScore": round(darkness_score, 4),
            "edgePenalty": round(edge_penalty, 4),
            "totalScore": round(total_score, 4),
        }

    target_area_min = 0.01
    target_area_max = 0.12
    if area_ratio < target_area_min:
        area_fit = max(0.0, area_ratio / target_area_min)
    elif area_ratio > target_area_max:
        area_fit = max(0.0, 1.0 - ((area_ratio - target_area_max) / target_area_max))
    else:
        area_fit = 1.0
    center_distance_score = 1.0 - min(1.0, float(component["distanceToCropCenter"]) / 0.25)
    compactness = float(component["fillRatio"])
    color_support = 1.0 if "color_distance_mask" in component.get("maskSources", []) else 0.0
    total_score = (
        center_distance_score * 0.35 +
        area_fit * 0.20 +
        compactness * 0.20 +
        (1.0 - edge_penalty) * 0.10 +
        color_support * 0.15
    )
    return {
        "centerDistanceScore": round(center_distance_score, 4),
        "areaFitScore": round(area_fit, 4),
        "compactnessScore": round(compactness, 4),
        "edgePenalty": round(edge_penalty, 4),
        "colorSupportScore": round(color_support, 4),
        "totalScore": round(total_score, 4),
    }


def _compute_selected_bounds(components: list[dict[str, Any]], selected_ids: set[int], crop_width: int, crop_height: int) -> dict[str, Any]:
    selected_components = [component for component in components if component["componentId"] in selected_ids]
    if not selected_components:
        return {
            "selectedBounds": None,
            "selectedBoundsWidthRatio": 0.0,
            "selectedBoundsHeightRatio": 0.0,
            "selectedClusterSpanX": 0.0,
            "selectedClusterSpanY": 0.0,
        }
    min_x = min(component["bbox"]["x"] for component in selected_components)
    min_y = min(component["bbox"]["y"] for component in selected_components)
    max_x = max(component["bbox"]["x"] + component["bbox"]["width"] - 1 for component in selected_components)
    max_y = max(component["bbox"]["y"] + component["bbox"]["height"] - 1 for component in selected_components)
    width = max_x - min_x + 1
    height = max_y - min_y + 1
    return {
        "selectedBounds": {"x": min_x, "y": min_y, "width": width, "height": height},
        "selectedBoundsWidthRatio": round(width / max(1, crop_width), 4),
        "selectedBoundsHeightRatio": round(height / max(1, crop_height), 4),
        "selectedClusterSpanX": round(width / max(1, crop_width), 4),
        "selectedClusterSpanY": round(height / max(1, crop_height), 4),
        "selectedCenterOffsetY": round(abs((((min_y + max_y) / 2) - ((crop_height - 1) / 2)) / max(1.0, crop_height)), 4),
    }


def _select_components(group: str, components: list[dict[str, Any]], crop_width: int, crop_height: int) -> dict[str, Any]:
    if not components:
        return {
            "selectedComponentIds": [],
            "scoreMap": {},
            "selectionReason": "no_components",
            "preFilteredRejectedIds": [],
            "preFilterReasons": {},
            "selectedBounds": None,
            "selectedBoundsWidthRatio": 0.0,
            "selectedBoundsHeightRatio": 0.0,
            "selectedClusterSpanX": 0.0,
            "selectedClusterSpanY": 0.0,
            "selectedCenterOffsetY": 0.0,
        }

    filtered_components, prefiltered_rejected_ids, prefilter_reasons = _prefilter_components(group, components)
    if not filtered_components:
        return {
            "selectedComponentIds": [],
            "scoreMap": {},
            "selectionReason": "all_prefiltered",
            "preFilteredRejectedIds": prefiltered_rejected_ids,
            "preFilterReasons": prefilter_reasons,
            "selectedBounds": None,
            "selectedBoundsWidthRatio": 0.0,
            "selectedBoundsHeightRatio": 0.0,
            "selectedClusterSpanX": 0.0,
            "selectedClusterSpanY": 0.0,
            "selectedCenterOffsetY": 0.0,
        }

    scored: list[tuple[dict[str, Any], dict[str, float]]] = []
    for component in filtered_components:
        score = _score_component(group, component, crop_width, crop_height)
        scored.append((component, score))
    scored.sort(key=lambda item: item[1]["totalScore"], reverse=True)
    score_map = {component["componentId"]: score for component, score in scored}

    if group == "glasses":
        anchor = next(
            (
                component
                for component, score in scored
                if (component["area"] / max(1, crop_width * crop_height)) >= 0.001
                and score["aspectRatioScore"] >= 0.5
            ),
            scored[0][0],
        )
        anchor_center = anchor["center"]
        selected = [anchor["componentId"]]
        max_components = 4
        for component, _score in scored[1:]:
            if len(selected) >= max_components:
                break
            if component["componentId"] == anchor["componentId"]:
                continue
            if abs(component["center"]["y"] - anchor_center["y"]) > crop_height * 0.20:
                continue
            if abs(component["center"]["x"] - anchor_center["x"]) > crop_width * 0.45:
                continue
            area_ratio = component["area"] / max(1, crop_width * crop_height)
            if area_ratio > 0.20 or area_ratio < 0.0005:
                continue
            selected.append(component["componentId"])
        selected_set = set(selected)
        bounds_payload = _compute_selected_bounds(components, selected_set, crop_width, crop_height)
        if bounds_payload["selectedClusterSpanY"] > 0.28:
            return {
                "selectedComponentIds": [],
                "scoreMap": score_map,
                "selectionReason": "glasses_cluster_span_y",
                "preFilteredRejectedIds": prefiltered_rejected_ids,
                "preFilterReasons": prefilter_reasons,
                **bounds_payload,
            }
        if bounds_payload["selectedClusterSpanX"] < 0.15:
            return {
                "selectedComponentIds": [],
                "scoreMap": score_map,
                "selectionReason": "glasses_cluster_span_x",
                "preFilteredRejectedIds": prefiltered_rejected_ids,
                "preFilterReasons": prefilter_reasons,
                **bounds_payload,
            }
        return {
            "selectedComponentIds": selected,
            "scoreMap": score_map,
            "selectionReason": "glasses_cluster",
            "preFilteredRejectedIds": prefiltered_rejected_ids,
            "preFilterReasons": prefilter_reasons,
            **bounds_payload,
        }

    selected = []
    max_components = 3
    anchor = scored[0][0]
    for component, _score in scored:
        if len(selected) >= max_components:
            break
        if component["distanceToCropCenter"] > anchor["distanceToCropCenter"] + 0.20:
            continue
        if float(component["areaRatio"]) < 0.003:
            continue
        selected.append(component["componentId"])
    selected_set = set(selected)
    bounds_payload = _compute_selected_bounds(components, selected_set, crop_width, crop_height)
    if bounds_payload["selectedClusterSpanX"] > 0.45:
        return {
            "selectedComponentIds": [],
            "scoreMap": score_map,
            "selectionReason": "hair_accessory_cluster_span_x",
            "preFilteredRejectedIds": prefiltered_rejected_ids,
            "preFilterReasons": prefilter_reasons,
            **bounds_payload,
        }
    if bounds_payload["selectedClusterSpanY"] > 0.45:
        return {
            "selectedComponentIds": [],
            "scoreMap": score_map,
            "selectionReason": "hair_accessory_cluster_span_y",
            "preFilteredRejectedIds": prefiltered_rejected_ids,
            "preFilterReasons": prefilter_reasons,
            **bounds_payload,
        }
    return {
        "selectedComponentIds": selected,
        "scoreMap": score_map,
        "selectionReason": "hair_accessory_top_components",
        "preFilteredRejectedIds": prefiltered_rejected_ids,
        "preFilterReasons": prefilter_reasons,
        **bounds_payload,
    }


def _build_selected_mask(width: int, height: int, components: list[dict[str, Any]], selected_ids: set[int]) -> list[list[int]]:
    mask = _empty_mask(width, height)
    for component in components:
        if component["componentId"] not in selected_ids:
            continue
        for x, y in component["pixels"]:
            mask[y][x] = 1
    return mask


def _rgba_from_mask(image, mask: list[list[int]]):
    output = image.copy()
    width, height = output.size
    for y in range(height):
        for x in range(width):
            r, g, b, _a = output.getpixel((x, y))
            output.putpixel((x, y), (r, g, b, 255 if mask[y][x] else 0))
    return output


def _run_isolate_gemini(
    ctx: Context,
    *,
    crop_path: Path,
    image,
    selected_candidate: dict[str, Any],
    selected_group: str,
    isolated_dir: Path,
    debug_dir: Path,
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    gemini_config = ctx.config.get("isolate", {}).get("gemini", {})
    model_env = str(gemini_config.get("model_env", "GEMINI_ISOLATE_MODEL"))
    model = os.getenv(model_env) or str(gemini_config.get("default_model", "gemini-2.5-flash-image"))
    timeout_seconds = int(gemini_config.get("timeout_seconds", 60))
    max_retries = int(gemini_config.get("max_retries", 1))
    sanity_min_alpha_ratio = float(gemini_config.get("sanity_min_alpha_ratio", 0.002))
    sanity_max_alpha_ratio = float(gemini_config.get("sanity_max_alpha_ratio", 0.80))

    prompt = _build_gemini_isolate_prompt(selected_candidate, selected_group)
    prompt_path = debug_dir / "gemini_input_prompt.txt"
    response_path = debug_dir / "gemini_response.json"
    metadata_path = isolated_dir / "gemini_isolate.json"
    save_text(prompt_path, prompt)

    if not api_key:
        payload = {
            "provider": "gemini",
            "ok": False,
            "model": model,
            "error": "api_key_missing",
            "promptPath": relative_to_workspace(prompt_path, ctx.paths.root),
            "responsePath": relative_to_workspace(response_path, ctx.paths.root),
        }
        save_json(metadata_path, payload)
        return {"ok": False, "provider": "gemini", "model": model, "error": "api_key_missing"}

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": to_data_uri(crop_path).split(",", 1)[1],
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "candidateCount": 1,
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    last_error = "unknown_error"
    last_response: dict[str, Any] | None = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                last_response = json.loads(response.read().decode("utf-8"))
            save_json(response_path, last_response)
            image_bytes, mime_type = _extract_gemini_image_payload(last_response)
            if not image_bytes or not mime_type:
                last_error = "missing_image_output"
                continue

            Image, _ = _try_import_pil()
            if Image is None:
                last_error = "pillow_missing"
                continue

            isolated_image = Image.open(BytesIO(image_bytes)).convert("RGBA")
            if isolated_image.size != image.size:
                last_error = f"unexpected_image_size:{isolated_image.size[0]}x{isolated_image.size[1]}"
                continue

            sanity_metrics = _image_metrics(isolated_image)
            alpha_ratio = float(sanity_metrics["nontransparentRatio"])
            if alpha_ratio <= sanity_min_alpha_ratio:
                last_error = "alpha_ratio_too_small"
                continue
            if alpha_ratio >= sanity_max_alpha_ratio:
                last_error = "alpha_ratio_too_large"
                continue

            metadata = {
                "provider": "gemini",
                "ok": True,
                "model": model,
                "mimeType": mime_type,
                "attempt": attempt,
                "promptPath": relative_to_workspace(prompt_path, ctx.paths.root),
                "responsePath": relative_to_workspace(response_path, ctx.paths.root),
                "sanityMetrics": sanity_metrics,
            }
            save_json(metadata_path, metadata)
            return {
                "ok": True,
                "provider": "gemini",
                "model": model,
                "image": isolated_image,
                "metadata": metadata,
            }
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            try:
                last_response = json.loads(body) if body else {"status": exc.code, "body": body}
            except Exception:  # noqa: BLE001
                last_response = {"status": exc.code, "body": body}
            save_json(response_path, last_response or {})
            last_error = f"http_error:{exc.code}"
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
            if last_response is not None:
                save_json(response_path, last_response)

    failure_payload = {
        "provider": "gemini",
        "ok": False,
        "model": model,
        "error": last_error,
        "promptPath": relative_to_workspace(prompt_path, ctx.paths.root),
        "responsePath": relative_to_workspace(response_path, ctx.paths.root),
    }
    if last_response is not None:
        failure_payload["responseCaptured"] = True
    save_json(metadata_path, failure_payload)
    return {"ok": False, "provider": "gemini", "model": model, "error": last_error, "metadata": failure_payload}


def _run_isolate_deterministic(
    ctx: Context,
    *,
    image,
    selected_candidate: dict[str, Any],
    selected_group: str,
    isolated_dir: Path,
    debug_dir: Path,
) -> dict[str, Any]:
    width, height = image.size
    image_data = _build_image_data(image)
    bg_threshold = float(ctx.config.get("isolate", {}).get("bg_distance_threshold", 36))
    edge_threshold = float(ctx.config.get("isolate", {}).get("grayscale_edge_threshold", 24))
    dark_threshold = int(ctx.config.get("isolate", {}).get("dark_luma_threshold", 100))
    color_threshold = float(ctx.config.get("isolate", {}).get("color_distance_threshold", 80))

    mask_candidates: dict[str, list[list[int]]] = {
        "bg_distance_mask": _bg_distance_mask(image_data, bg_threshold),
        "grayscale_edge_mask": _grayscale_edge_mask(image_data, edge_threshold),
        "dark_pixel_mask": _dark_pixel_mask(image_data, dark_threshold),
    }
    color_mask = _color_distance_mask(
        image_data,
        selected_candidate.get("normalizedColors") or [],
        color_threshold,
    )
    if color_mask is not None:
        mask_candidates["color_distance_mask"] = color_mask

    mask_stats: dict[str, Any] = {}
    for name, mask in mask_candidates.items():
        _save_mask_png(mask, debug_dir / f"{name}.png")
        mask_stats[name] = _mask_metrics(mask)
    save_json(debug_dir / "mask_stats.json", mask_stats)

    combined_mask = _combine_masks(selected_group, mask_candidates)
    _save_mask_png(combined_mask, debug_dir / "combined_mask.png")
    components = _extract_components(combined_mask, image_data["luma"], mask_candidates)
    save_json(
        isolated_dir / "components.json",
        [
            {key: value for key, value in component.items() if key != "pixels"}
            for component in components
        ],
    )

    selection = _select_components(selected_group, components, width, height)
    selected_ids = selection["selectedComponentIds"]
    if not selected_ids:
        return {
            "ok": False,
            "provider": "deterministic",
            "error": "isolate_no_selected_components",
            "selectionReason": selection["selectionReason"],
        }

    selection_payload = {
        "group": selected_group,
        "selectedComponentIds": selected_ids,
        "rejectedComponentIds": [component["componentId"] for component in components if component["componentId"] not in selected_ids],
        "scoreBreakdown": selection["scoreMap"],
        "selectionReason": selection["selectionReason"],
        "preFilteredRejectedIds": selection["preFilteredRejectedIds"],
        "preFilterReasons": selection["preFilterReasons"],
        "selectedBounds": selection["selectedBounds"],
        "selectedBoundsWidthRatio": selection["selectedBoundsWidthRatio"],
        "selectedBoundsHeightRatio": selection["selectedBoundsHeightRatio"],
        "selectedClusterSpanX": selection["selectedClusterSpanX"],
        "selectedClusterSpanY": selection["selectedClusterSpanY"],
    }
    save_json(isolated_dir / "selection.json", selection_payload)

    final_mask = _build_selected_mask(width, height, components, set(selected_ids))
    _save_mask_png(final_mask, debug_dir / "final_mask.png")
    isolated_image = _rgba_from_mask(image, final_mask)
    selected_components = [component for component in components if component["componentId"] in set(selected_ids)]
    largest_selected_component_ratio = round(
        max((component["area"] for component in selected_components), default=0) / max(1, width * height),
        4,
    )
    prefiltered_mask = _build_selected_mask(
        width,
        height,
        components,
        set(
            component["componentId"]
            for component in components
            if component["componentId"] not in set(selection["preFilteredRejectedIds"])
        ),
    )
    _save_mask_png(prefiltered_mask, debug_dir / "combined_mask_prefiltered.png")
    return {
        "ok": True,
        "provider": "deterministic",
        "image": isolated_image,
        "selection": selection,
        "selected_ids": selected_ids,
        "largest_selected_component_ratio": largest_selected_component_ratio,
        "metadata": {
            "selectedCategoryGroup": selected_group,
            "selectedComponentIds": selected_ids,
            "selectionReason": selection["selectionReason"],
        },
    }


def _finalize_isolate_result(
    ctx: Context,
    *,
    stage: str,
    isolated_dir: Path,
    isolated_path: Path,
    isolated_image,
    selected_group: str,
    provider: str,
    fallback_used: bool,
    fallback_provider: str | None = None,
    selection: dict[str, Any] | None = None,
    selected_ids: list[int] | None = None,
    largest_selected_component_ratio: float | None = None,
    details_extra: dict[str, Any] | None = None,
) -> None:
    isolated_image.save(isolated_path)
    metrics = _compute_isolated_image_metrics(
        isolated_image,
        selected_group=selected_group,
        provider=provider,
        fallback_used=fallback_used,
        fallback_provider=fallback_provider,
        selection=selection,
        selected_component_ids=selected_ids,
        largest_selected_component_ratio=largest_selected_component_ratio,
    )
    save_json(isolated_dir / "metrics.json", metrics)
    details = {
        "isolatedPath": relative_to_workspace(isolated_path, ctx.paths.root),
        "metrics": metrics,
        "provider": provider,
        "fallbackUsed": fallback_used,
        "selectedCategoryGroup": selected_group,
    }
    if fallback_provider:
        details["fallbackProvider"] = fallback_provider
    if selected_ids is not None:
        details["selectedComponentIds"] = selected_ids
    if details_extra:
        details.update(details_extra)
    _mark_succeeded(ctx, stage, details)


def _expanded_crop_bbox(
    *,
    x: int,
    y: int,
    width: int,
    height: int,
    image_width: int,
    image_height: int,
    min_crop_size: int,
) -> dict[str, int]:
    base = max(width, height)
    if base < 64:
        expand_scale = 2.5
    elif base < 128:
        expand_scale = 2.0
    else:
        expand_scale = 1.5

    expanded_size = max(int(round(base * expand_scale)), min_crop_size)
    cx = x + width / 2
    cy = y + height / 2

    left = int(round(cx - expanded_size / 2))
    top = int(round(cy - expanded_size / 2))
    right = left + expanded_size
    bottom = top + expanded_size

    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > image_width:
        shift = right - image_width
        left = max(0, left - shift)
        right = image_width
    if bottom > image_height:
        shift = bottom - image_height
        top = max(0, top - shift)
        bottom = image_height

    return {
        "x": left,
        "y": top,
        "width": max(1, right - left),
        "height": max(1, bottom - top),
    }


def _sanitize_bbox(bbox: dict[str, Any] | None) -> dict[str, float] | None:
    if not isinstance(bbox, dict):
        return None
    try:
        x = float(bbox.get("x", 0))
        y = float(bbox.get("y", 0))
        width = float(bbox.get("width", 0))
        height = float(bbox.get("height", 0))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _round_bbox(bbox: dict[str, float]) -> dict[str, int]:
    x = int(round(bbox["x"]))
    y = int(round(bbox["y"]))
    width = int(round(bbox["width"]))
    height = int(round(bbox["height"]))
    return {
        "x": max(0, x),
        "y": max(0, y),
        "width": max(1, width),
        "height": max(1, height),
    }


def _clip_bbox_to_image(bbox: dict[str, int], image_width: int, image_height: int) -> dict[str, int]:
    x = clamp(bbox["x"], 0, max(0, image_width - 1))
    y = clamp(bbox["y"], 0, max(0, image_height - 1))
    right = clamp(x + bbox["width"], x + 1, image_width)
    bottom = clamp(y + bbox["height"], y + 1, image_height)
    return {"x": x, "y": y, "width": max(1, right - x), "height": max(1, bottom - y)}


def _adjust_detect_bbox(
    bbox: dict[str, Any] | None,
    *,
    image_width: int,
    image_height: int,
) -> tuple[dict[str, int] | None, dict[str, Any]]:
    sanitized = _sanitize_bbox(bbox)
    if sanitized is None:
        return None, {"bboxCoordinateSpace": "invalid"}

    right = sanitized["x"] + sanitized["width"]
    bottom = sanitized["y"] + sanitized["height"]

    if (
        0.0 <= sanitized["x"] <= 1.0
        and 0.0 <= sanitized["y"] <= 1.0
        and 0.0 < sanitized["width"] <= 1.0
        and 0.0 < sanitized["height"] <= 1.0
        and right <= 1.05
        and bottom <= 1.05
    ):
        scaled = {
            "x": sanitized["x"] * image_width,
            "y": sanitized["y"] * image_height,
            "width": sanitized["width"] * image_width,
            "height": sanitized["height"] * image_height,
        }
        clipped = _clip_bbox_to_image(_round_bbox(scaled), image_width, image_height)
        return clipped, {
            "bboxCoordinateSpace": "normalized_0_1",
            "bboxScaleApplied": {"scaleX": image_width, "scaleY": image_height},
        }

    max_dim = max(image_width, image_height)
    if max_dim >= 900 and right <= 512 and bottom <= 512:
        scale_x = image_width / 512.0
        scale_y = image_height / 512.0
        scaled = {
            "x": sanitized["x"] * scale_x,
            "y": sanitized["y"] * scale_y,
            "width": sanitized["width"] * scale_x,
            "height": sanitized["height"] * scale_y,
        }
        clipped = _clip_bbox_to_image(_round_bbox(scaled), image_width, image_height)
        return clipped, {
            "bboxCoordinateSpace": "scaled_from_512",
            "bboxScaleApplied": {
                "sourceWidth": 512,
                "sourceHeight": 512,
                "scaleX": round(scale_x, 4),
                "scaleY": round(scale_y, 4),
            },
        }

    clipped = _clip_bbox_to_image(_round_bbox(sanitized), image_width, image_height)
    return clipped, {"bboxCoordinateSpace": "original_pixels"}


def run_detect(ctx: Context) -> None:
    stage = "detect"
    _mark_started(ctx, stage, {"sampleId": ctx.sample["sampleId"]})
    _clear_detect_downstream_artifacts(sample_output_dir(ctx))

    sample_type = resolve_sample_type(ctx.sample)
    if sample_type == "accessory_only":
        image_path = ensure_original_copy(ctx)
        Image, _ = _try_import_pil()
        width = None
        height = None
        if Image is not None:
            try:
                with Image.open(image_path) as image:
                    width, height = image.size
            except Exception:
                width = None
                height = None

        expected = ctx.sample["expectedCategory"]
        expected_group = category_group(expected)
        bbox = {
            "x": 0,
            "y": 0,
            "width": width or 1,
            "height": height or 1,
        }
        selected = {
            "category": expected,
            "bbox": bbox,
            "attachRegion": _attach_region_for_category(expected),
            "confidence": 1.0,
            "rawColors": [],
            "normalizedColors": [],
            "sizeHint": "unknown",
            "occlusionRisk": "low",
            "isolationDifficulty": "low",
            "generationPriority": "high",
            "shapeDescription": str(ctx.sample.get("notes", "")),
            "bboxCoordinateSpace": "original_pixels",
        }
        detection = {
            "sampleId": ctx.sample["sampleId"],
            "sampleType": sample_type,
            "expectedCategory": expected,
            "expectedCategoryGroup": expected_group,
            "selectedCandidate": selected,
            "candidates": [selected],
            "model": "synthetic_accessory_only",
        }
        save_json(sample_output_dir(ctx) / "detection.json", detection)
        _mark_succeeded(
            ctx,
            stage,
            {
                "selectedCategory": expected,
                "selectedCategoryGroup": expected_group,
                "selectedConfidence": 1.0,
                "categoryMatchType": "exact",
                "bboxCoordinateSpace": "original_pixels",
                "mode": "accessory_only",
                "detectionPath": relative_to_workspace(sample_output_dir(ctx) / "detection.json", ctx.paths.root),
            },
        )
        return

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        _mark_skipped(ctx, stage, "api_key_missing")
        return

    image_path = ensure_original_copy(ctx)
    image_width = None
    image_height = None
    Image, _ = _try_import_pil()
    if Image is not None:
        try:
            with Image.open(image_path) as image:
                image_width, image_height = image.size
        except Exception:
            image_width = None
            image_height = None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    prompt = (
        "Return JSON only. Detect anime-style character accessories from the image. "
        "Return an object with candidates: [{category, bbox:{x,y,width,height}, attachRegion, "
        "confidence, rawColors, sizeHint, occlusionRisk, isolationDifficulty, generationPriority, "
        "shapeDescription}]. "
        f"The bbox must use the ORIGINAL input image pixel coordinates"
        + (f" for the exact input size {image_width}x{image_height}" if image_width and image_height else "")
        + ". Allowed categories: glasses, hairpin, hair_clip, hair_bow, unknown, unsupported."
    )
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": image_path.read_bytes().hex(),
                        }
                    },
                ]
            }
        ]
    }
    # Gemini expects base64, not hex.
    payload["contents"][0]["parts"][1]["inlineData"]["data"] = to_data_uri(image_path).split(",", 1)[1]

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_debug = _extract_http_error_debug(exc)
        debug_path = _save_detect_debug_artifact(
            ctx,
            "http_error.json",
            {
                "stage": stage,
                "endpoint": endpoint.rsplit("?key=", 1)[0],
                "model": model,
                "sampleId": ctx.sample["sampleId"],
                **error_debug,
            },
        )
        _mark_failed(
            ctx,
            stage,
            "detect_request_failed",
            {
                "error": str(exc),
                "statusCode": error_debug.get("statusCode"),
                "errorReason": error_debug.get("reason"),
                "errorBodySummary": error_debug.get("bodySummary"),
                "debugPath": relative_to_workspace(debug_path, ctx.paths.root),
            },
        )
        return
    except urllib.error.URLError as exc:
        _mark_failed(ctx, stage, "detect_request_failed", {"error": str(exc)})
        return

    try:
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text.strip("`\n ")) if text.strip().startswith("{") else {}
        if not parsed:
            from .common import parse_json_block

            parsed = parse_json_block(text)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(ctx, stage, "detect_parse_failed", {"error": str(exc)})
        return

    candidates = parsed.get("candidates", [])
    bbox_adjustments: list[dict[str, Any]] = []
    for candidate in candidates:
        raw_colors = candidate.get("rawColors") or candidate.get("colors") or []
        candidate["rawColors"] = raw_colors
        candidate["normalizedColors"] = normalize_raw_colors(raw_colors)
        if image_width and image_height:
            original_bbox = candidate.get("bbox")
            adjusted_bbox, adjustment = _adjust_detect_bbox(
                original_bbox,
                image_width=image_width,
                image_height=image_height,
            )
            if adjusted_bbox is not None:
                candidate["bboxOriginal"] = original_bbox
                candidate["bbox"] = adjusted_bbox
                candidate.update(adjustment)
                bbox_adjustments.append(
                    {
                        "category": candidate.get("category"),
                        "bboxOriginal": original_bbox,
                        "bboxAdjusted": adjusted_bbox,
                        **adjustment,
                    }
                )

    expected = ctx.sample["expectedCategory"]
    expected_group = category_group(expected)
    selected = None
    for candidate in candidates:
        if candidate.get("category") == expected:
            selected = candidate
            break
    if not selected:
        for candidate in candidates:
            if category_group(candidate.get("category")) == expected_group:
                selected = candidate
                break
    if not selected and candidates:
        selected = sorted(candidates, key=lambda item: item.get("confidence", 0), reverse=True)[0]
    if not selected:
        _mark_failed(ctx, stage, "detect_no_accessory")
        return

    detection = {
        "sampleId": ctx.sample["sampleId"],
        "expectedCategory": expected,
        "expectedCategoryGroup": expected_group,
        "selectedCandidate": selected,
        "candidates": candidates,
        "model": model,
    }
    if bbox_adjustments:
        detection["bboxAdjustments"] = bbox_adjustments
    save_json(sample_output_dir(ctx) / "detection.json", detection)
    _mark_succeeded(
        ctx,
        stage,
        {
            "selectedCategory": selected.get("category"),
            "selectedCategoryGroup": category_group(selected.get("category")),
            "selectedConfidence": selected.get("confidence"),
            "categoryMatchType": (
                "exact"
                if selected.get("category") == expected
                else "group"
                if category_group(selected.get("category")) == expected_group
                else "fallback"
            ),
            "bboxCoordinateSpace": selected.get("bboxCoordinateSpace"),
            "detectionPath": relative_to_workspace(sample_output_dir(ctx) / "detection.json", ctx.paths.root),
        },
    )


def run_crop(ctx: Context) -> None:
    stage = "crop"
    _mark_started(ctx, stage)

    if not _stage_succeeded_or_reused(ctx, "detect"):
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="detect")
        return

    detection = _load_detection(ctx)
    if not detection or not detection.get("selectedCandidate"):
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="detect")
        return

    Image, _ = _try_import_pil()
    if Image is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "Pillow"})
        return

    sample_type = resolve_sample_type(ctx.sample)
    if sample_type == "accessory_only":
        original = ensure_original_copy(ctx)
        image = Image.open(original).convert("RGBA")
        crop_dir = sample_output_dir(ctx) / "crops"
        crop_dir.mkdir(parents=True, exist_ok=True)
        crop_path = crop_dir / "acc_001_crop.png"
        image.save(crop_path)
        bbox = {"x": 0, "y": 0, "width": image.width, "height": image.height}
        _mark_succeeded(
            ctx,
            stage,
            {
                "cropPath": relative_to_workspace(crop_path, ctx.paths.root),
                "bbox": bbox,
                "expandedBbox": bbox,
                "minCropSizePx": int(validation_threshold(ctx, "min_crop_size_px", 96)),
                "mode": "accessory_only",
            },
        )
        return

    selected = detection["selectedCandidate"]
    bbox = selected.get("bbox") or {}
    x = int(bbox.get("x", 0))
    y = int(bbox.get("y", 0))
    width = int(bbox.get("width", 0))
    height = int(bbox.get("height", 0))
    if width <= 0 or height <= 0:
        _mark_failed(ctx, stage, "crop_bbox_invalid", {"bbox": bbox})
        return

    original = ensure_original_copy(ctx)
    image = Image.open(original).convert("RGBA")
    min_crop_size = int(validation_threshold(ctx, "min_crop_size_px", 96))
    expanded_bbox = _expanded_crop_bbox(
        x=x,
        y=y,
        width=width,
        height=height,
        image_width=image.width,
        image_height=image.height,
        min_crop_size=min_crop_size,
    )
    cropped = image.crop(
        (
            expanded_bbox["x"],
            expanded_bbox["y"],
            expanded_bbox["x"] + expanded_bbox["width"],
            expanded_bbox["y"] + expanded_bbox["height"],
        )
    )
    crop_dir = sample_output_dir(ctx) / "crops"
    crop_dir.mkdir(parents=True, exist_ok=True)
    crop_path = crop_dir / "acc_001_crop.png"
    cropped.save(crop_path)
    _mark_succeeded(
        ctx,
        stage,
        {
            "cropPath": relative_to_workspace(crop_path, ctx.paths.root),
            "bbox": bbox,
            "expandedBbox": expanded_bbox,
            "minCropSizePx": min_crop_size,
        },
    )


def run_isolate(ctx: Context) -> None:
    stage = "isolate"
    _mark_started(ctx, stage)

    if not _stage_succeeded_or_reused(ctx, "crop"):
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="crop")
        return

    sample_dir = sample_output_dir(ctx)
    _clear_isolate_run_artifacts(sample_dir)

    crop_path = sample_dir / "crops" / "acc_001_crop.png"
    if not crop_path.exists():
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="crop")
        return

    Image, _ = _try_import_pil()
    if Image is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "Pillow"})
        return

    isolated_dir = sample_dir / "isolated"
    isolated_dir.mkdir(parents=True, exist_ok=True)
    isolated_path = isolated_dir / "acc_001_isolated.png"
    debug_dir = isolated_dir / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    image = Image.open(crop_path).convert("RGBA")
    detection = _load_detection(ctx) or {}
    selected_candidate = detection.get("selectedCandidate") or {}
    selected_category = selected_candidate.get("category")
    selected_group = _resolve_isolate_group(selected_category)

    if resolve_sample_type(ctx.sample) == "accessory_only":
        cleaned_image, cleanup_metadata = _remove_accessory_only_background(ctx, image)
        cleaned_image.save(debug_dir / "accessory_only_cleaned.png")
        _finalize_isolate_result(
            ctx,
            stage=stage,
            isolated_dir=isolated_dir,
            isolated_path=isolated_path,
            isolated_image=cleaned_image,
            selected_group=selected_group,
            provider="accessory_only_cleanup",
            fallback_used=False,
            details_extra={
                "mode": "accessory_only",
                "cleanupMetadata": cleanup_metadata,
            },
        )
        return

    if selected_group == "unsupported":
        _mark_skipped(
            ctx,
            stage,
            "unsupported_category_group",
            extra={
                "selectedCategory": selected_category,
                "selectedCategoryGroup": selected_group,
            },
        )
        return

    isolate_config = ctx.config.get("isolate", {})
    provider = str(isolate_config.get("provider", "deterministic")).lower()
    fallback_provider = str(isolate_config.get("fallback_provider", "deterministic")).lower() if isolate_config.get("fallback_provider") else None

    if provider == "gemini":
        gemini_result = _run_isolate_gemini(
            ctx,
            crop_path=crop_path,
            image=image,
            selected_candidate=selected_candidate,
            selected_group=selected_group,
            isolated_dir=isolated_dir,
            debug_dir=debug_dir,
        )
        if gemini_result.get("ok"):
            _clear_deterministic_isolate_artifacts(isolated_dir)
            _finalize_isolate_result(
                ctx,
                stage=stage,
                isolated_dir=isolated_dir,
                isolated_path=isolated_path,
                isolated_image=gemini_result["image"],
                selected_group=selected_group,
                provider="gemini",
                fallback_used=False,
                details_extra={
                    "geminiModel": gemini_result.get("model"),
                    "geminiMetadata": gemini_result.get("metadata"),
                },
            )
            return

        if fallback_provider != "deterministic":
            _mark_failed(
                ctx,
                stage,
                "isolate_provider_failed",
                {
                    "provider": "gemini",
                    "fallbackUsed": False,
                    "geminiModel": gemini_result.get("model"),
                    "geminiError": gemini_result.get("error"),
                },
            )
            return

        deterministic_result = _run_isolate_deterministic(
            ctx,
            image=image,
            selected_candidate=selected_candidate,
            selected_group=selected_group,
            isolated_dir=isolated_dir,
            debug_dir=debug_dir,
        )
        if not deterministic_result.get("ok"):
            _mark_failed(
                ctx,
                stage,
                deterministic_result.get("error", "isolate_provider_failed"),
                {
                    "provider": "gemini",
                    "fallbackUsed": True,
                    "fallbackProvider": "deterministic",
                    "geminiModel": gemini_result.get("model"),
                    "geminiError": gemini_result.get("error"),
                    "selectionReason": deterministic_result.get("selectionReason"),
                },
            )
            return

        _finalize_isolate_result(
            ctx,
            stage=stage,
            isolated_dir=isolated_dir,
            isolated_path=isolated_path,
            isolated_image=deterministic_result["image"],
            selected_group=selected_group,
            provider="deterministic",
            fallback_used=True,
            fallback_provider="deterministic",
            selection=deterministic_result.get("selection"),
            selected_ids=deterministic_result.get("selected_ids"),
            largest_selected_component_ratio=deterministic_result.get("largest_selected_component_ratio"),
            details_extra={
                "geminiModel": gemini_result.get("model"),
                "geminiError": gemini_result.get("error"),
                **(deterministic_result.get("metadata") or {}),
            },
        )
        return

    deterministic_result = _run_isolate_deterministic(
        ctx,
        image=image,
        selected_candidate=selected_candidate,
        selected_group=selected_group,
        isolated_dir=isolated_dir,
        debug_dir=debug_dir,
    )
    if not deterministic_result.get("ok"):
        _mark_failed(
            ctx,
            stage,
            deterministic_result.get("error", "isolate_no_selected_components"),
            {
                "provider": "deterministic",
                "selectedCategory": selected_category,
                "selectedCategoryGroup": selected_group,
                "selectionReason": deterministic_result.get("selectionReason"),
            },
        )
        return

    _finalize_isolate_result(
        ctx,
        stage=stage,
        isolated_dir=isolated_dir,
        isolated_path=isolated_path,
        isolated_image=deterministic_result["image"],
        selected_group=selected_group,
        provider="deterministic",
        fallback_used=False,
        selection=deterministic_result.get("selection"),
        selected_ids=deterministic_result.get("selected_ids"),
        largest_selected_component_ratio=deterministic_result.get("largest_selected_component_ratio"),
        details_extra=deterministic_result.get("metadata"),
    )


def run_isolation_validate(ctx: Context) -> None:
    stage = "isolation_validate"
    _mark_started(ctx, stage)

    if resolve_sample_type(ctx.sample) == "accessory_only":
        _mark_skipped(ctx, stage, "manual_skip", extra={"mode": "accessory_only", "inputSource": "original"})
        return

    isolate_status = load_json(stage_status_path(ctx, "isolate"), default={}) or {}
    if isolate_status.get("status") not in {STAGE_SUCCESS, STAGE_REUSED}:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="isolate")
        return

    isolated_path = sample_output_dir(ctx) / "isolated" / "acc_001_isolated.png"
    if not isolated_path.exists():
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="isolate")
        return

    Image, _ = _try_import_pil()
    if Image is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "Pillow"})
        return

    image = Image.open(isolated_path).convert("RGBA")
    metrics_path = sample_output_dir(ctx) / "isolated" / "metrics.json"
    stored_metrics = load_json(metrics_path, default={}) if metrics_path.exists() else {}
    metrics = _image_metrics(image)
    if isinstance(stored_metrics, dict):
        # Validation must use the same selected-metrics payload that isolate persisted,
        # otherwise reason_detail and metrics snapshot can diverge.
        metrics.update(stored_metrics)
    width, height = image.size
    min_width = int(ctx.config["validation"]["min_isolated_width_px"])
    min_height = int(ctx.config["validation"]["min_isolated_height_px"])
    if width < min_width or height < min_height:
        _mark_failed(ctx, stage, "isolate_too_small", {"width": width, "height": height})
        return

    max_nontransparent_ratio = float(validation_threshold(ctx, "max_nontransparent_ratio", 0.95))
    max_edge_contact_ratio = float(validation_threshold(ctx, "max_edge_contact_ratio", 0.15))
    selected_group = metrics.get("selectedCategoryGroup", "unsupported")
    selected_component_count = int(metrics.get("selectedComponentCount", 0))
    selected_area_ratio = float(metrics.get("selectedAreaRatio", 0.0))
    largest_selected_component_ratio = float(metrics.get("largestSelectedComponentRatio", 0.0))
    selected_bounds_width_ratio = float(metrics.get("selectedBoundsWidthRatio", 0.0))
    selected_bounds_height_ratio = float(metrics.get("selectedBoundsHeightRatio", 0.0))
    selected_cluster_span_x = float(metrics.get("selectedClusterSpanX", 0.0))
    selected_cluster_span_y = float(metrics.get("selectedClusterSpanY", 0.0))
    selected_center_offset_y = float(metrics.get("selectedCenterOffsetY", 0.0))

    if metrics["edgeContactRatio"] > max_edge_contact_ratio:
        _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "edge_contact_ratio", "metrics": metrics})
        return
    if selected_group == "glasses":
        group_config = ctx.config.get("isolate", {}).get("glasses", {})
        if selected_component_count > int(group_config.get("max_selected_components", 4)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_component_count", "metrics": metrics})
            return
        if selected_area_ratio < float(group_config.get("min_selected_area_ratio", 0.01)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_area_ratio", "metrics": metrics})
            return
        if selected_area_ratio > float(group_config.get("max_selected_area_ratio", 0.20)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_area_ratio", "metrics": metrics})
            return
        if selected_bounds_width_ratio < float(group_config.get("min_selected_bounds_width_ratio", 0.18)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_bounds_width_ratio", "metrics": metrics})
            return
        if selected_bounds_height_ratio > float(group_config.get("max_selected_bounds_height_ratio", 0.28)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_bounds_height_ratio", "metrics": metrics})
            return
        if selected_cluster_span_y > float(group_config.get("max_selected_cluster_span_y", 0.28)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_cluster_span_y", "metrics": metrics})
            return
        if selected_center_offset_y > float(group_config.get("max_selected_center_offset_y", 0.12)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_center_offset_y", "metrics": metrics})
            return
        if metrics["nontransparentRatio"] > float(group_config.get("max_nontransparent_ratio", 0.45)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "nontransparent_ratio", "metrics": metrics})
            return
        if largest_selected_component_ratio > float(group_config.get("max_largest_selected_component_ratio", 0.2)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "largest_selected_component_ratio", "metrics": metrics})
            return
    elif selected_group == "hair_accessory":
        group_config = ctx.config.get("isolate", {}).get("hair_accessory", {})
        if selected_component_count > int(group_config.get("max_selected_components", 3)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_component_count", "metrics": metrics})
            return
        if selected_area_ratio < float(group_config.get("min_selected_area_ratio", 0.005)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_area_ratio", "metrics": metrics})
            return
        if selected_area_ratio > float(group_config.get("max_selected_area_ratio", 0.18)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_area_ratio", "metrics": metrics})
            return
        if selected_bounds_width_ratio > float(group_config.get("max_selected_bounds_width_ratio", 0.45)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_bounds_width_ratio", "metrics": metrics})
            return
        if selected_bounds_height_ratio > float(group_config.get("max_selected_bounds_height_ratio", 0.45)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "selected_bounds_height_ratio", "metrics": metrics})
            return
        if largest_selected_component_ratio > float(group_config.get("max_largest_selected_component_ratio", 0.2)):
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "largest_selected_component_ratio", "metrics": metrics})
            return
        if metrics["nontransparentRatio"] > max_nontransparent_ratio:
            _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "nontransparent_ratio", "metrics": metrics})
            return
    else:
        _mark_failed(ctx, stage, "isolation_validate_failed", {"reason_detail": "connected_components", "metrics": metrics})
        return

    save_json(
        sample_output_dir(ctx) / "isolated" / "validation.json",
        {"width": width, "height": height, "validatedAt": utc_now(), "metrics": metrics},
    )
    _mark_succeeded(ctx, stage, {"width": width, "height": height, "metrics": metrics})


def _get_provider_and_key(ctx: Context) -> tuple[str, str | None]:
    provider = os.getenv("VARCO_PROVIDER", ctx.config.get("provider", "varco")).lower()
    if provider == "meshy":
        return provider, os.getenv("MESHY_API_KEY") or os.getenv("VARCO_API_KEY")
    return provider, os.getenv("VARCO_API_KEY")


def _load_varco_client():
    import sys

    root = Path(__file__).resolve().parents[4]
    feature_root = root / "face-feature"
    if str(feature_root) not in sys.path:
        sys.path.insert(0, str(feature_root))
    from pipeline.varco_client import get_client  # type: ignore

    return get_client


def run_varco_submit(ctx: Context) -> None:
    stage = "varco_submit"
    _mark_started(ctx, stage, {"config": ctx.config.get("varco", {})})

    sample_type = resolve_sample_type(ctx.sample)
    if sample_type != "accessory_only":
        if not (stage_status_path(ctx, "isolation_validate").exists() and (load_json(stage_status_path(ctx, "isolation_validate"), default={}) or {}).get("status") in {"succeeded", "reused"}):
            _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="isolation_validate")
            return

    provider, api_key = _get_provider_and_key(ctx)
    if not api_key:
        _mark_skipped(ctx, stage, "api_key_missing", extra={"provider": provider})
        return

    requests = _try_import_requests()
    if requests is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "requests"})
        return

    input_path, input_source = _resolve_varco_input(ctx)
    depends_on = "isolate" if input_source == "isolated" else "detect"
    if not input_path.exists():
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on=depends_on, extra={"inputSource": input_source})
        return
    input_sha256 = _file_sha256(input_path)

    submit_json = sample_output_dir(ctx) / "varco" / "submit.json"
    if submit_json.exists():
        payload = load_json(submit_json, default={})
        request_id = payload.get("requestId") or payload.get("taskId")
        if request_id and payload.get("varcoInputSha256") == input_sha256 and payload.get("inputSource") == input_source:
            _mark_reused(ctx, stage, {"requestId": request_id, "provider": provider, "reason": "already_reused", "inputSource": input_source})
            return

    _clear_varco_downstream_artifacts(sample_output_dir(ctx))

    get_client = _load_varco_client()
    client = get_client(provider=provider, api_key=api_key)
    submit_dir = sample_output_dir(ctx) / "varco"
    submit_dir.mkdir(parents=True, exist_ok=True)

    try:
        if provider == "varco":
            normalized_path = client._ensure_png(str(input_path), submit_dir / "_inputs")  # type: ignore[attr-defined]
            request_id = client._submit(normalized_path)  # type: ignore[attr-defined]
            payload = {
                "provider": provider,
                "requestId": request_id,
                "normalizedInputPath": relative_to_workspace(Path(normalized_path), ctx.paths.root),
                "inputSource": input_source,
                "varcoInputPath": relative_to_workspace(input_path, ctx.paths.root),
                "varcoInputSha256": input_sha256,
                "params": ctx.config.get("varco", {}),
            }
        else:
            image_url = client._upload_image(str(input_path))  # type: ignore[attr-defined]
            task_id = client._create_task(image_url)  # type: ignore[attr-defined]
            payload = {
                "provider": provider,
                "taskId": task_id,
                "inputSource": input_source,
                "varcoInputPath": relative_to_workspace(input_path, ctx.paths.root),
                "varcoInputSha256": input_sha256,
                "params": ctx.config.get("varco", {}),
            }
        save_json(submit_json, payload)
        _mark_succeeded(ctx, stage, payload)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(ctx, stage, "varco_failed", {"error": str(exc), "provider": provider})


def run_varco_poll(ctx: Context) -> None:
    stage = "varco_poll"
    _mark_started(ctx, stage)

    submit_status = load_json(stage_status_path(ctx, "varco_submit"), default={}) or {}
    if submit_status.get("status") not in {STAGE_SUCCESS, STAGE_REUSED}:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="varco_submit")
        return

    submit_payload = _load_submit(ctx)
    if not submit_payload:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="varco_submit")
        return

    provider, api_key = _get_provider_and_key(ctx)
    if not api_key:
        _mark_skipped(ctx, stage, "api_key_missing", extra={"provider": provider})
        return

    requests = _try_import_requests()
    if requests is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "requests"})
        return

    get_client = _load_varco_client()
    client = get_client(provider=provider, api_key=api_key)
    poll_interval = int(ctx.config["varco"]["poll_interval_seconds"])
    timeout = int(ctx.config["varco"]["timeout_seconds"])
    start = time.time()

    try:
        if provider == "varco":
            request_id = submit_payload["requestId"]
            model_url = client._poll_until_done(request_id, poll_interval, timeout)  # type: ignore[attr-defined]
            payload = {"provider": provider, "requestId": request_id, "modelUrl": model_url}
        else:
            task_id = submit_payload["taskId"]
            glb_url = client._poll_until_done(task_id, poll_interval, timeout)  # type: ignore[attr-defined]
            payload = {"provider": provider, "taskId": task_id, "glbUrl": glb_url}
        payload["elapsedSeconds"] = round(time.time() - start, 2)
        save_json(sample_output_dir(ctx) / "varco" / "result.json", payload)
        _mark_succeeded(ctx, stage, payload)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(ctx, stage, "varco_failed", {"error": str(exc), "provider": provider})


def run_download_glb(ctx: Context) -> None:
    stage = "download_glb"
    _mark_started(ctx, stage)

    poll_status = load_json(stage_status_path(ctx, "varco_poll"), default={}) or {}
    if poll_status.get("status") not in {STAGE_SUCCESS, STAGE_REUSED}:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="varco_poll")
        return

    poll_payload = _load_poll_result(ctx)
    if not poll_payload:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="varco_poll")
        return

    requests = _try_import_requests()
    if requests is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "requests"})
        return

    glb_path = sample_output_dir(ctx) / "glb_raw" / "acc_001_raw.glb"
    if glb_path.exists():
        _mark_reused(ctx, stage, {"glbPath": relative_to_workspace(glb_path, ctx.paths.root), "reason": "already_reused"})
        return

    url = poll_payload.get("modelUrl") or poll_payload.get("glbUrl")
    if not url:
        _mark_failed(ctx, stage, "download_glb_failed", {"error": "Missing model URL"})
        return

    glb_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with requests.get(url, stream=True, timeout=120) as response:
            response.raise_for_status()
            with glb_path.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=8192):
                    handle.write(chunk)
        _mark_succeeded(ctx, stage, {"glbPath": relative_to_workspace(glb_path, ctx.paths.root)})
    except Exception as exc:  # noqa: BLE001
        _mark_failed(ctx, stage, "download_glb_failed", {"error": str(exc)})


def run_validate_glb(ctx: Context) -> None:
    stage = "validate_glb"
    _mark_started(ctx, stage)

    download_status = load_json(stage_status_path(ctx, "download_glb"), default={}) or {}
    if download_status.get("status") not in {STAGE_SUCCESS, STAGE_REUSED}:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="download_glb")
        return

    glb_path = sample_output_dir(ctx) / "glb_raw" / "acc_001_raw.glb"
    if not glb_path.exists():
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="download_glb")
        return

    header = glb_path.read_bytes()[:4]
    if header != b"glTF":
        _mark_failed(ctx, stage, "glb_invalid", {"header": header.hex()})
        return

    try:
        metrics = _extract_glb_metrics(glb_path)
    except Exception as exc:  # noqa: BLE001
        _mark_failed(ctx, stage, "glb_invalid", {"error": str(exc)})
        return

    if metrics["meshCount"] < 1 or metrics["primitiveCount"] < 1:
        _mark_failed(ctx, stage, "glb_invalid", {"reason_detail": "empty_scene", "metrics": metrics})
        return
    if metrics["bounds"] is None:
        _mark_failed(ctx, stage, "glb_invalid", {"reason_detail": "missing_bounds", "metrics": metrics})
        return

    save_json(sample_output_dir(ctx) / "glb_raw" / "validation.json", metrics)
    _mark_succeeded(ctx, stage, {"sizeBytes": glb_path.stat().st_size, "metrics": metrics})


def _render_info_card(
    title: str,
    subtitle: str,
    output_path: Path,
    *,
    image_path: Path | None = None,
) -> None:
    Image, ImageDraw = _try_import_pil()
    if Image is None or ImageDraw is None:
        raise ImportError("Pillow")

    canvas = Image.new("RGBA", (1024, 1024), (20, 24, 32, 255))
    draw = ImageDraw.Draw(canvas)
    draw.text((40, 40), title, fill=(240, 244, 248, 255))
    draw.text((40, 90), subtitle, fill=(160, 170, 180, 255))

    if image_path and image_path.exists():
        image = Image.open(image_path).convert("RGBA")
        image.thumbnail((820, 820))
        canvas.alpha_composite(image, ((1024 - image.width) // 2, 160))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)


def _render_attach_composite(
    *,
    base_avatar_path: Path,
    isolated_path: Path,
    output_path: Path,
    attach_region: str,
    title: str,
) -> str:
    Image, ImageDraw = _try_import_pil()
    if Image is None or ImageDraw is None:
        raise ImportError("Pillow")

    try:
        if base_avatar_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            canvas = Image.open(base_avatar_path).convert("RGBA")
            render_mode = "base_avatar_image"
        else:
            canvas = Image.new("RGBA", (1024, 1024), (18, 22, 30, 255))
            draw = ImageDraw.Draw(canvas)
            draw.ellipse((312, 120, 712, 520), fill=(80, 92, 110, 255))
            draw.rounded_rectangle((372, 460, 652, 940), radius=120, fill=(60, 70, 88, 255))
            draw.text((40, 40), title, fill=(230, 236, 242, 255))
            draw.text((40, 88), f"base_avatar={base_avatar_path.name}", fill=(160, 170, 180, 255))
            render_mode = "base_avatar_placeholder"
    except Exception:
        canvas = Image.new("RGBA", (1024, 1024), (18, 22, 30, 255))
        render_mode = "base_avatar_placeholder"

    accessory = Image.open(isolated_path).convert("RGBA")
    max_dim = 280 if attach_region == "face_center" else 220
    accessory.thumbnail((max_dim, max_dim))

    anchor_map = {
        "face_center": (512, 330),
        "head_side_upper_left": (360, 255),
        "head_side_upper_right": (664, 255),
        "head_top": (512, 150),
        "head_side_left": (360, 255),
        "head_side_right": (664, 255),
    }
    center_x, center_y = anchor_map.get(attach_region, (512, 260))
    x = int(center_x - accessory.width / 2)
    y = int(center_y - accessory.height / 2)

    canvas.alpha_composite(accessory, (x, y))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)
    return render_mode


def _render_attach_2d_fallback(
    *,
    ctx: Context,
    attachment_spec: dict[str, Any],
    base_avatar_path: Path,
    isolated_path: Path,
    output_path: Path,
) -> str:
    return _render_attach_composite(
        base_avatar_path=base_avatar_path,
        isolated_path=isolated_path,
        output_path=output_path,
        attach_region=str(attachment_spec["attachRegion"]),
        title=f"Attach Preview view={ctx.config['preview'].get('camera_view', 'front')}",
    )


def _default_attach_region_for_category(category: str) -> str:
    if category == "glasses":
        return "face_center"
    if category in {"hairpin", "hair_clip"}:
        return "head_side_upper_left"
    return "head_top"


def _postprocess_input_source(ctx: Context) -> str:
    if resolve_sample_type(ctx.sample) == "accessory_only":
        return "original"
    return "isolated"


def _resolve_attachment_defaults(
    ctx: Context,
    category: str,
    attach_region: str,
) -> dict[str, Any]:
    attachment_config = ctx.config.get("attachment", {})
    preview_config = ctx.config.get("preview", {})
    anchor_map = attachment_config.get("default_anchor_bone_by_region", {}) or {}
    scale_map = attachment_config.get("default_scale_by_category", {}) or {}
    offset_map = attachment_config.get("default_offset_by_region", {}) or {}
    rotation_map = attachment_config.get("default_rotation_by_region", {}) or {}

    resolved_region = "face_center" if category == "glasses" else attach_region
    return {
        "anchorBone": anchor_map.get(resolved_region, "head"),
        "scale": float(scale_map.get(category, 1.0)),
        "rotation": list(rotation_map.get(resolved_region, [0, 0, 0])),
        "offset": list(offset_map.get(resolved_region, [0, 0, 0])),
        "pivotPolicy": preview_config.get("pivot_policy", "object_center"),
        "attachRegion": resolved_region,
    }


def _build_attachment_spec(
    ctx: Context,
    validation_metrics: dict[str, Any],
    selected_candidate: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    default_base_avatar_model_path = "../../public/models/CustomizableCharacter.vrm"
    category = str(ctx.sample["expectedCategory"])
    attach_region = (
        ctx.sample.get("expectedLocation")
        or selected_candidate.get("attachRegion")
        or _default_attach_region_for_category(category)
    )
    defaults = _resolve_attachment_defaults(ctx, category, attach_region)
    preview_config = ctx.config.get("preview", {})
    input_source = _postprocess_input_source(ctx)
    sample_dir = sample_output_dir(ctx)
    glb_path = sample_dir / "glb_raw" / "acc_001_raw.glb"
    base_avatar_model_path = preview_config.get("base_avatar_model_path") or default_base_avatar_model_path
    missing_base_avatar_model_config = not bool(preview_config.get("base_avatar_model_path"))

    spec = {
        "sampleId": ctx.sample["sampleId"],
        "category": category,
        "avatarTemplateId": preview_config.get("avatar_template_id"),
        "assetModelPath": relative_to_workspace(glb_path, ctx.paths.root),
        "baseAvatarModelPath": base_avatar_model_path,
        "anchorBone": defaults["anchorBone"],
        "attachRegion": defaults["attachRegion"],
        "pivotPolicy": defaults["pivotPolicy"],
        "scale": defaults["scale"],
        "rotation": defaults["rotation"],
        "offset": defaults["offset"],
        "placementSource": "config_default",
        "cameraView": preview_config.get("camera_view", "front"),
        "renderWidth": int(preview_config.get("render_width", 1024)),
        "renderHeight": int(preview_config.get("render_height", 1024)),
        "cameraDistance": float(preview_config.get("camera_distance", 1.8)),
        "cameraFov": float(preview_config.get("camera_fov", 30)),
        "lightPreset": preview_config.get("light_preset", "studio_soft"),
        "background": preview_config.get("background", "transparent"),
        "inputSource": input_source,
    }
    details = {
        "anchorBone": defaults["anchorBone"],
        "baseAvatarModelPath": base_avatar_model_path,
        "avatarTemplateId": preview_config.get("avatar_template_id"),
        "placementSource": "config_default",
        "defaultScale": defaults["scale"],
        "defaultRotation": defaults["rotation"],
        "defaultOffset": defaults["offset"],
        "resolvedPlacement": {
            "scale": defaults["scale"],
            "rotation": defaults["rotation"],
            "offset": defaults["offset"],
        },
        "inputSource": input_source,
        "attachRegion": defaults["attachRegion"],
        "pivotPolicy": defaults["pivotPolicy"],
        "attachmentSpecPath": relative_to_workspace(
            sample_dir / "preview" / "attachment_spec.json",
            ctx.paths.root,
        ),
        "missingConfig": "preview.base_avatar_model_path" if missing_base_avatar_model_config else None,
        "baseAvatarModelPathFallbackUsed": missing_base_avatar_model_config,
    }
    if validation_metrics:
        details.update({
            "faceCount": validation_metrics.get("faceCount"),
            "vertexCount": validation_metrics.get("vertexCount"),
            "meshCount": validation_metrics.get("meshCount"),
            "bounds": validation_metrics.get("bounds"),
        })
    return spec, details


def _resolve_render_script_path(ctx: Context, raw_path: str) -> Path:
    candidate_paths = [
        (ctx.paths.root / raw_path).resolve(),
        (ctx.paths.root.parent.parent / raw_path).resolve(),
    ]
    for candidate in candidate_paths:
        if candidate.exists():
            return candidate
    return candidate_paths[-1]


def _load_render_result(ctx: Context) -> dict[str, Any] | None:
    return load_json(sample_output_dir(ctx) / "preview" / "render_result.json", default=None)


def _render_debug_details(render_run: dict[str, Any] | None) -> dict[str, Any]:
    if not render_run:
        return {
            "renderBaseUrl": None,
            "renderExitCode": None,
            "renderStdoutTail": None,
            "renderStderrTail": None,
        }
    return {
        "renderBaseUrl": render_run.get("renderBaseUrl"),
        "renderExitCode": render_run.get("exitCode"),
        "renderStdoutTail": _truncate_debug_text(str(render_run.get("stdout") or ""), 1200) or None,
        "renderStderrTail": _truncate_debug_text(str(render_run.get("stderr") or ""), 1200) or None,
    }


def _run_attach_render_3d(ctx: Context, attachment_spec_path: Path) -> dict[str, Any]:
    preview_config = ctx.config.get("preview", {})
    render_base_url = str(preview_config.get("render_base_url", "http://localhost:3000"))
    render_timeout_ms = int(preview_config.get("render_timeout_ms", 30000))
    render_script_raw = str(preview_config.get("render_script_path", "scripts/render-accessory-attach.mjs"))
    render_script_path = _resolve_render_script_path(ctx, render_script_raw)
    command = [
        "node",
        str(render_script_path),
        "--spec",
        str(attachment_spec_path),
        "--url",
        render_base_url,
        "--timeout",
        str(render_timeout_ms),
    ]
    completed = subprocess.run(
        command,
        cwd=str(ctx.paths.root.parent.parent),
        capture_output=True,
        text=True,
        timeout=max(5, math.ceil(render_timeout_ms / 1000) + 10),
    )
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "renderBaseUrl": render_base_url,
        "renderTimeoutMs": render_timeout_ms,
        "renderScriptPath": str(render_script_path),
    }


def _evaluate_render_visibility(render_result: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    warnings = render_result.get("warnings") or []
    in_frame = render_result.get("inFrame")
    projected_bbox = render_result.get("projectedBBox")
    projected_area_ratio = render_result.get("projectedAreaRatio")
    accessory_ahead_of_head = render_result.get("accessoryAheadOfHead")
    depth_delta_z = render_result.get("depthDeltaZ")
    details = {
        "inFrame": in_frame,
        "projectedBBox": projected_bbox,
        "projectedAreaRatio": projected_area_ratio,
        "accessoryAheadOfHead": accessory_ahead_of_head,
        "depthDeltaZ": depth_delta_z,
    }
    if "visibility_not_implemented" in warnings:
        return False, {"reason_detail": "visibility_not_implemented", **details}
    if in_frame is not True:
        return False, {"reason_detail": "in_frame", **details}
    if not isinstance(projected_bbox, list) or len(projected_bbox) != 4:
        return False, {"reason_detail": "projected_bbox_missing", **details}
    bbox_width = projected_bbox[2]
    bbox_height = projected_bbox[3]
    if projected_area_ratio is None:
        return False, {"reason_detail": "projected_area_ratio_missing", **details}
    if float(projected_area_ratio) < 0.003:
        return False, {"reason_detail": "projected_area_ratio", **details}
    if float(bbox_width) < 24:
        return False, {"reason_detail": "projected_bbox_width", **details}
    if float(bbox_height) < 12:
        return False, {"reason_detail": "projected_bbox_height", **details}
    if accessory_ahead_of_head is not True:
        return False, {"reason_detail": "accessory_behind_head", **details}
    return True, details


def _postprocess_payload(
    ctx: Context,
    *,
    asset_preview: Path,
    attachment_details: dict[str, Any],
    render_result_path: Path,
    render_visibility_details: dict[str, Any],
    render_run: dict[str, Any] | None,
    attach_preview_path: Path | None,
    attach_preview_mode: str | None,
    partial_success: bool,
    fallback_used: bool,
    fallback_reason: str | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "assetPreviewPath": relative_to_workspace(asset_preview, ctx.paths.root),
        "attachPreviewPath": relative_to_workspace(attach_preview_path, ctx.paths.root) if attach_preview_path and attach_preview_path.exists() else None,
        "attachPreviewMode": attach_preview_mode,
        "renderResultPath": relative_to_workspace(render_result_path, ctx.paths.root) if render_result_path.exists() else None,
        "visibility": render_visibility_details,
        "partialSuccess": partial_success,
        "fallbackUsed": fallback_used,
        "fallbackReason": fallback_reason,
    }
    payload.update(_render_debug_details(render_run))
    payload.update(attachment_details)
    if extra:
        payload.update(extra)
    return payload


def run_postprocess(ctx: Context) -> None:
    stage = "postprocess"
    _mark_started(ctx, stage)

    validate_status = load_json(stage_status_path(ctx, "validate_glb"), default={}) or {}
    if validate_status.get("status") not in {"succeeded", "reused"}:
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="validate_glb")
        return

    glb_path = sample_output_dir(ctx) / "glb_raw" / "acc_001_raw.glb"
    if not glb_path.exists():
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="validate_glb")
        return

    Image, _ = _try_import_pil()
    if Image is None:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "Pillow"})
        return

    isolated_path = sample_output_dir(ctx) / "isolated" / "acc_001_isolated.png"
    preview_dir = sample_output_dir(ctx) / "preview"
    asset_preview = preview_dir / "acc_001_asset_preview.png"
    attach_preview = preview_dir / "acc_001_attach_preview.png"
    attach_preview_3d = preview_dir / "acc_001_attach_preview_3d.png"
    attachment_spec_path = preview_dir / "attachment_spec.json"
    detection = _load_detection(ctx) or {}
    selected_candidate = detection.get("selectedCandidate") or {}
    render_result_path = preview_dir / "render_result.json"
    validation_metrics = load_json(sample_output_dir(ctx) / "glb_raw" / "validation.json", default={}) or {}
    for stale_path in [attach_preview, attach_preview_3d, render_result_path]:
        if stale_path.exists():
            stale_path.unlink()
    if not validation_metrics:
        details = {
            "assetPreviewPath": None,
            "attachPreviewPath": None,
            "reason": "previous_stage_failed",
            "depends_on": "validate_glb",
        }
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_skipped(ctx, stage, "previous_stage_failed", depends_on="validate_glb", extra=details)
        return

    try:
        _render_info_card(
            "Accessory Asset Preview",
            f"sample={ctx.sample['sampleId']} category={ctx.sample['expectedCategory']}",
            asset_preview,
            image_path=isolated_path if isolated_path.exists() else None,
        )
    except ImportError:
        _mark_skipped(ctx, stage, "dependency_missing", extra={"dependency": "Pillow"})
        return

    attachment_spec, attachment_details = _build_attachment_spec(ctx, validation_metrics, selected_candidate)
    save_json(attachment_spec_path, attachment_spec)
    attach_region = str(attachment_spec["attachRegion"])

    render_run: dict[str, Any] | None = None
    render_result: dict[str, Any] | None = None
    render_ok = False
    render_visibility_ok = False
    render_visibility_details: dict[str, Any] = {}
    fallback_used = False
    fallback_reason: str | None = None
    preview_config = ctx.config.get("preview", {}) or {}
    fallback_to_2d = bool(preview_config.get("fallback_to_2d", True))

    try:
        render_run = _run_attach_render_3d(ctx, attachment_spec_path)
        render_result = _load_render_result(ctx)
    except subprocess.TimeoutExpired as error:
        render_run = {
            "exitCode": None,
            "stdout": "",
            "stderr": "",
            "renderBaseUrl": ctx.config.get("preview", {}).get("render_base_url", "http://localhost:3000"),
            "renderTimeoutMs": int(ctx.config.get("preview", {}).get("render_timeout_ms", 30000)),
            "renderScriptPath": str(_resolve_render_script_path(ctx, str(ctx.config.get("preview", {}).get("render_script_path", "scripts/render-accessory-attach.mjs")))),
            "timeout": True,
            "error": str(error),
        }
    except Exception as error:
        render_run = {
            "exitCode": None,
            "stdout": "",
            "stderr": "",
            "renderBaseUrl": ctx.config.get("preview", {}).get("render_base_url", "http://localhost:3000"),
            "renderTimeoutMs": int(ctx.config.get("preview", {}).get("render_timeout_ms", 30000)),
            "renderScriptPath": str(_resolve_render_script_path(ctx, str(ctx.config.get("preview", {}).get("render_script_path", "scripts/render-accessory-attach.mjs")))),
            "error": str(error),
        }

    if render_run and render_run.get("exitCode") == 0 and render_result and render_result.get("ok") is True:
        render_ok = True
        render_visibility_ok, render_visibility_details = _evaluate_render_visibility(render_result)
    elif render_result:
        render_visibility_details = {
            "reason_detail": "render_failed",
            "inFrame": render_result.get("inFrame"),
            "projectedBBox": render_result.get("projectedBBox"),
            "projectedAreaRatio": render_result.get("projectedAreaRatio"),
        }
    else:
        render_visibility_details = {
            "reason_detail": "render_result_missing",
            "inFrame": None,
            "projectedBBox": None,
            "projectedAreaRatio": None,
        }

    base_avatar_raw = ctx.config.get("preview", {}).get("base_avatar_path", "")
    if render_ok and render_visibility_ok:
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=attach_preview_3d,
            attach_preview_mode="3d_avatar_render",
            partial_success=False,
            fallback_used=False,
            fallback_reason=None,
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_succeeded(ctx, stage, details)
        return

    fallback_reason = "render_visibility_failed" if render_ok and not render_visibility_ok else "render_failed"
    if not fallback_to_2d:
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=None,
            attach_preview_mode=None,
            partial_success=False,
            fallback_used=False,
            fallback_reason=fallback_reason,
            extra={"fallbackConfigured": False},
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_failed(ctx, stage, fallback_reason, details)
        return

    if not base_avatar_raw:
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=None,
            attach_preview_mode=None,
            partial_success=False,
            fallback_used=False,
            fallback_reason=fallback_reason,
            extra={
                "fallbackConfigured": True,
                "fallbackErrorReason": "config_missing",
                "missingConfig": "preview.base_avatar_path",
            },
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_failed(ctx, stage, fallback_reason, details)
        return

    base_avatar = (ctx.paths.root / base_avatar_raw).resolve()
    if not base_avatar.exists():
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=None,
            attach_preview_mode=None,
            partial_success=False,
            fallback_used=False,
            fallback_reason=fallback_reason,
            extra={
                "fallbackConfigured": True,
                "fallbackErrorReason": "base_avatar_missing",
                "baseAvatarPath": base_avatar_raw,
            },
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_failed(ctx, stage, fallback_reason, details)
        return

    try:
        attach_render_mode = _render_attach_2d_fallback(
            ctx=ctx,
            attachment_spec=attachment_spec,
            base_avatar_path=base_avatar,
            isolated_path=isolated_path,
            output_path=attach_preview,
        )
    except ImportError:
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=None,
            attach_preview_mode=None,
            partial_success=False,
            fallback_used=False,
            fallback_reason=fallback_reason,
            extra={
                "fallbackConfigured": True,
                "fallbackErrorReason": "dependency_missing",
                "dependency": "Pillow",
            },
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_failed(ctx, stage, fallback_reason, details)
        return

    fallback_used = True

    if attach_render_mode != "base_avatar_image":
        details = _postprocess_payload(
            ctx,
            asset_preview=asset_preview,
            attachment_details=attachment_details,
            render_result_path=render_result_path,
            render_visibility_details=render_visibility_details,
            render_run=render_run,
            attach_preview_path=attach_preview,
            attach_preview_mode=attach_render_mode,
            partial_success=True,
            fallback_used=fallback_used,
            fallback_reason=fallback_reason,
            extra={
                "fallbackConfigured": True,
                "fallbackErrorReason": "unsupported_base_avatar_preview",
                "baseAvatarPath": base_avatar_raw,
            },
        )
        save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
        _mark_failed(ctx, stage, fallback_reason, details)
        return

    details = _postprocess_payload(
        ctx,
        asset_preview=asset_preview,
        attachment_details=attachment_details,
        render_result_path=render_result_path,
        render_visibility_details=render_visibility_details,
        render_run=render_run,
        attach_preview_path=attach_preview,
        attach_preview_mode="2d_fallback",
        partial_success=True,
        fallback_used=fallback_used,
        fallback_reason=fallback_reason,
        extra={"fallbackConfigured": True},
    )
    save_json(sample_output_dir(ctx) / "preview" / "postprocess.json", details)
    _mark_failed(ctx, stage, fallback_reason, details)


def run_review_stub(ctx: Context) -> None:
    stage = "review_stub"
    _mark_started(ctx, stage)

    review_dir = sample_output_dir(ctx) / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    review_path = review_dir / "acc_001_review.json"
    payload = {
        "sampleId": ctx.sample["sampleId"],
        "expectedCategory": ctx.sample["expectedCategory"],
        "reviewStatus": "pending",
        "reviewOutcome": None,
        "reviewNote": "",
        "reviewTimeMinutes": None,
        "manualFixTimeMinutes": None,
    }
    save_json(review_path, payload)
    _mark_succeeded(ctx, stage, {"reviewPath": relative_to_workspace(review_path, ctx.paths.root)})


STAGE_FUNCS = {
    "detect": run_detect,
    "crop": run_crop,
    "isolate": run_isolate,
    "isolation_validate": run_isolation_validate,
    "varco_submit": run_varco_submit,
    "varco_poll": run_varco_poll,
    "download_glb": run_download_glb,
    "validate_glb": run_validate_glb,
    "postprocess": run_postprocess,
    "review_stub": run_review_stub,
}
