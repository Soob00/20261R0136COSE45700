"""
Image -> 3D avatar generation pipeline orchestration (Stage 2-6).

Stage 2: Generate GLB with VARCO/Meshy API
Stage 3: Render GLB multi-view images (front/left/right/quarter)
Stage 4: Extract facial features with original-image priority and front-render fallback
Stage 5: Select cute/slim/mature template
Stage 6: Map initial slider values
"""

import json
from pathlib import Path

from .feature_extractor import extract_features
from .renderer import render_multiview
from .template_selector import select_template
from .varco_client import get_client
from .parameter_mapper import map_avatar_parameters


def run_pipeline(
    image_path: str,
    output_dir: str,
    provider: str = "meshy",
    api_key: str = "",
    skip_3d: bool = False,
    existing_glb: str | None = None,
) -> dict:
    """
    Run the full pipeline from image input to template selection.

    Returns:
        {
          "glb_path": str,
          "renders": {view_name: image_path},
          "feature_vector": {...},
          "feature_source": "original" | "front_render",
          "feature_debug": {...},
          "avatar_parameters": {...},
          "parameter_debug": {...},
          "template": str,
          "confidence": float,
          "all_scores": {...},
          "slider_init": {...},
        }
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    glb_path = _stage2_generate_glb(
        image_path, out, provider, api_key, skip_3d, existing_glb
    )
    renders, render_paths = _stage3_render(glb_path, out)
    fv, feature_source, feature_debug = _stage4_extract(image_path, renders)

    result = select_template(fv)
    avatar_parameters, parameter_debug = map_avatar_parameters(
        fv,
        template_name=result.template_name,
    )
    print(
        f"[Stage 5] template={result.template_name} "
        f"confidence={result.confidence:.3f} "
        f"scores={result.all_scores}"
    )
    print(f"[Stage 6] slider init={result.slider_init}")

    output = {
        "glb_path": glb_path,
        "renders": render_paths,
        "feature_vector": fv.to_dict(),
        "feature_source": feature_source,
        "feature_debug": feature_debug,
        "avatar_parameters": avatar_parameters,
        "parameter_debug": parameter_debug,
        "template": result.template_name,
        "confidence": result.confidence,
        "all_scores": result.all_scores,
        "slider_init": result.slider_init,
    }

    result_path = out / "pipeline_result.json"
    result_path.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"[Pipeline] result saved: {result_path}")

    return output


def _stage2_generate_glb(
    image_path: str,
    out: Path,
    provider: str,
    api_key: str,
    skip_3d: bool,
    existing_glb: str | None,
) -> str:
    if skip_3d:
        path = existing_glb or str(out / "avatar.glb")
        if not Path(path).exists():
            raise FileNotFoundError(f"GLB file not found: {path}")
        print(f"[Stage 2] using existing GLB: {path}")
        return path

    print(f"[Stage 2] generating GLB... (provider={provider})")
    client = get_client(provider, api_key)
    glb_path = str(out / "avatar.glb")
    client.image_to_3d(image_path, glb_path)
    print(f"[Stage 2] GLB saved: {glb_path}")
    return glb_path


def _stage3_render(glb_path: str, out: Path) -> tuple[dict, dict]:
    print("[Stage 3] rendering multiview images...")
    render_dir = str(out / "renders")
    renders = render_multiview(glb_path, render_dir)
    render_paths = {k: str(Path(render_dir) / f"{k}.png") for k in renders}
    print(f"[Stage 3] render complete: {list(render_paths.keys())}")
    return renders, render_paths


def _stage4_extract(image_path: str, renders: dict) -> tuple:
    """
    Try both original image and front render, but always prefer original.
    """
    print("[Stage 4] feature extraction (prefer original, diagnose front render)...")

    feature_debug = {
        "original": None,
        "front_render": None,
        "selected": None,
        "failures": [],
    }
    results = {}

    sources = [("original", image_path)]

    front_render = renders.get("front")
    if front_render is not None:
        sources.append(("front_render", front_render))
    else:
        feature_debug["failures"].append({
            "source": "front_render",
            "error": "front render missing",
        })

    for source_name, source_input in sources:
        try:
            feature_vector = extract_features(source_input)
            if feature_vector is None:
                raise ValueError("face not detected")

            results[source_name] = feature_vector
            feature_debug[source_name] = feature_vector.to_dict()
            print(f"[Stage 4] {source_name} extracted: {feature_vector.to_dict()}")
        except Exception as exc:
            error_message = str(exc) or exc.__class__.__name__
            feature_debug["failures"].append(
                {"source": source_name, "error": error_message}
            )
            print(f"[Stage 4] {source_name} failed: {error_message}")

    if "original" in results:
        feature_debug["selected"] = "original"
        return results["original"], "original", feature_debug

    if "front_render" in results:
        feature_debug["selected"] = "front_render"
        return results["front_render"], "front_render", feature_debug

    failure_text = ", ".join(
        f"{item['source']}: {item['error']}" for item in feature_debug["failures"]
    ) or "no failure details"
    raise RuntimeError(
        "Stage 4 feature extraction failed for both original and front_render. "
        f"Details: {failure_text}"
    )
