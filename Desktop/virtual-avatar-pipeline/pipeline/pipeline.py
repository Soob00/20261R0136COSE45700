"""
이미지 → 3D 아바타 생성 파이프라인 오케스트레이터 (Stage 2-6)

Stage 2: VARCO/Meshy API → GLB
Stage 3: GLB → 멀티뷰 렌더 (front/left/right/quarter)
Stage 4: MediaPipe 특징 추출
         - 원본 입력 이미지 우선 (렌더된 3D 이미지보다 안정적)
         - 실패 시 rendered front view로 폴백
Stage 5: cute/slim/mature 템플릿 자동 선택
Stage 6: 슬라이더 초기값 매핑
"""

import json
from pathlib import Path

from .varco_client import get_client
from .renderer import render_multiview
from .feature_extractor import extract_features
from .template_selector import select_template


def run_pipeline(
    image_path: str,
    output_dir: str,
    provider: str = "meshy",
    api_key: str = "",
    skip_3d: bool = False,
    existing_glb: str | None = None,
) -> dict:
    """
    이미지 → 특징 벡터 + 템플릿 선택까지 전체 파이프라인 실행.

    Args:
        image_path:   원본 입력 이미지 경로 (NSFW 필터는 호출 전 처리 가정)
        output_dir:   결과물 저장 디렉토리
        provider:     "meshy" | "varco"
        api_key:      API 키
        skip_3d:      True면 GLB 생성 건너뜀 (기존 GLB 재사용 시)
        existing_glb: skip_3d=True일 때 사용할 GLB 경로

    Returns:
        {
          "glb_path": str,
          "renders": {view_name: image_path},
          "feature_vector": {...},
          "feature_source": "original" | "front_render",
          "template": str,
          "confidence": float,
          "all_scores": {...},
          "slider_init": {...},
        }
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # ── Stage 2: GLB 생성 ────────────────────────────────────────────────────
    glb_path = _stage2_generate_glb(
        image_path, out, provider, api_key, skip_3d, existing_glb
    )

    # ── Stage 3: 멀티뷰 렌더 ────────────────────────────────────────────────
    renders, render_paths = _stage3_render(glb_path, out)

    # ── Stage 4: 특징 추출 ───────────────────────────────────────────────────
    fv, feature_source = _stage4_extract(image_path, renders)

    # ── Stage 5-6: 템플릿 선택 + 슬라이더 초기화 ────────────────────────────
    result = select_template(fv)
    print(
        f"[Stage 5] 템플릿: {result.template_name}  "
        f"confidence={result.confidence:.3f}  "
        f"scores={result.all_scores}"
    )
    print(f"[Stage 6] 슬라이더 초기값: {result.slider_init}")

    output = {
        "glb_path": glb_path,
        "renders": render_paths,
        "feature_vector": fv.to_dict(),
        "feature_source": feature_source,
        "template": result.template_name,
        "confidence": result.confidence,
        "all_scores": result.all_scores,
        "slider_init": result.slider_init,
    }

    result_path = out / "pipeline_result.json"
    result_path.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"[Pipeline] 결과 저장됨: {result_path}")

    return output


# ---------------------------------------------------------------------------
# Stage helpers
# ---------------------------------------------------------------------------

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
            raise FileNotFoundError(f"GLB 파일을 찾을 수 없습니다: {path}")
        print(f"[Stage 2] 기존 GLB 사용: {path}")
        return path

    print(f"[Stage 2] GLB 생성 중... (provider={provider})")
    client = get_client(provider, api_key)
    glb_path = str(out / "avatar.glb")
    client.image_to_3d(image_path, glb_path)
    print(f"[Stage 2] GLB 저장됨: {glb_path}")
    return glb_path


def _stage3_render(glb_path: str, out: Path) -> tuple[dict, dict]:
    print("[Stage 3] 멀티뷰 렌더 중...")
    render_dir = str(out / "renders")
    renders = render_multiview(glb_path, render_dir)
    render_paths = {k: str(Path(render_dir) / f"{k}.png") for k in renders}
    print(f"[Stage 3] 렌더 완료: {list(render_paths.keys())}")
    return renders, render_paths


def _stage4_extract(image_path: str, renders: dict) -> tuple:
    """
    Stage 3 렌더 이미지(front view) → MediaPipe 특징 추출.
    PRD 흐름: GLB 렌더 → MediaPipe (Stage 4)
    """
    print("[Stage 4] 특징 추출 중 (front render)...")
    fv = extract_features(renders["front"])
    if fv is not None:
        print(f"[Stage 4] 추출 성공: {fv.to_dict()}")
        return fv, "front_render"

    raise RuntimeError(
        "front render에서 얼굴을 감지하지 못했습니다. "
        "VARCO 렌더 결과를 확인하거나 renderer.py의 RESOLUTION을 높여 주세요."
    )
