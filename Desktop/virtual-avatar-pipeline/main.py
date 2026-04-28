"""
Virtual Avatar Pipeline CLI (Stage 2-6)

사용법:
    # 전체 파이프라인 (이미지 → GLB → 렌더 → 특징 추출 → 템플릿 선택)
    python main.py run --image face.jpg --api-key YOUR_MESHY_KEY

    # 특징 추출만 (기존 이미지 대상, API 키 불필요)
    python main.py extract --image face.jpg

    # 기존 GLB 재사용 (3D 생성 스킵)
    python main.py run --image face.jpg --skip-3d --glb ./output/avatar.glb

    # 랜드마크 디버깅 시각화
    python main.py debug --image face.jpg
"""

import argparse
import json
import sys

from pipeline import run_pipeline, extract_features, visualize_landmarks, FaceFeatureVector


def cmd_run(args):
    result = run_pipeline(
        image_path=args.image,
        output_dir=args.output,
        provider=args.provider,
        api_key=args.api_key,
        skip_3d=args.skip_3d,
        existing_glb=args.glb,
    )
    print("\n[완료] Pipeline result:")
    print(json.dumps(result, indent=2, ensure_ascii=False))


def cmd_extract(args):
    """API 키 없이 특징 추출만 테스트."""
    print(f"[Extract] 이미지: {args.image}")
    fv = extract_features(args.image)
    if fv is None:
        print("[Extract] 얼굴을 감지하지 못했습니다.")
        sys.exit(1)

    print("[Extract] 특징 벡터:")
    for k, v in fv.to_dict().items():
        print(f"  {k}: {v:.4f}")

    from pipeline import select_template
    result = select_template(fv)
    print(f"\n[Select] 템플릿: {result.template_name}  (confidence={result.confidence:.3f})")
    print(f"[Select] 전체 점수: {result.all_scores}")
    print(f"[Select] 슬라이더 초기값:")
    for k, v in result.slider_init.items():
        print(f"  {k}: {v:.3f}")


def cmd_debug(args):
    """랜드마크 시각화 이미지를 저장한다."""
    from pathlib import Path
    save_path = str(Path(args.output) / "landmarks_debug.png")
    Path(args.output).mkdir(parents=True, exist_ok=True)
    img = visualize_landmarks(args.image, save_path=save_path)
    print(f"[Debug] 랜드마크 시각화 저장됨: {save_path}")
    return img


def cmd_batch_run(args):
    """여러 이미지를 순서대로 전체 파이프라인 실행 (VARCO 포함)."""
    from pathlib import Path

    images = args.images
    results = []

    for img_path in images:
        name = Path(img_path).stem
        out_dir = str(Path(args.output) / name)
        print(f"\n[BatchRun] ▶ {img_path} → {out_dir}")
        try:
            result = run_pipeline(
                image_path=img_path,
                output_dir=out_dir,
                provider=args.provider,
                api_key=args.api_key,
            )
            results.append({"image": img_path, "status": "ok", **result})
            print(f"[BatchRun] ✅ {img_path} → template={result['template']}")
        except Exception as e:
            results.append({"image": img_path, "status": "failed", "error": str(e)})
            print(f"[BatchRun] ❌ {img_path} → {e}")

    print(f"\n[BatchRun] 완료: {len([r for r in results if r['status']=='ok'])}/{len(images)} 성공")


def cmd_batch(args):
    """여러 이미지를 한번에 특징 추출하고 비교 테이블로 출력한다."""
    from pathlib import Path
    from pipeline import select_template

    images = args.images
    rows = []

    for img_path in images:
        name = Path(img_path).name
        fv = extract_features(img_path)
        if fv is None:
            print(f"[Batch] ❌ {name} — 얼굴 미검출")
            rows.append({"name": name, "failed": True})
            continue

        result = select_template(fv)
        row = {"name": name, "template": result.template_name, **fv.to_dict()}
        rows.append(row)
        print(f"[Batch] ✅ {name} → {result.template_name} (confidence={result.confidence:.3f})")

    # 비교 테이블 출력
    if not rows:
        return

    succeeded = [r for r in rows if not r.get("failed")]
    if not succeeded:
        return

    fields = list(FaceFeatureVector.field_names())
    col_w = 22

    header = f"{'이미지':<20} {'템플릿':<8} " + " ".join(f"{f[:col_w]:<{col_w}}" for f in fields)
    print("\n" + "=" * len(header))
    print(header)
    print("=" * len(header))
    for r in succeeded:
        vals = " ".join(f"{r[f]:<{col_w}.4f}" for f in fields)
        print(f"{r['name']:<20} {r['template']:<8} {vals}")
    print("=" * len(header))


def main():
    parser = argparse.ArgumentParser(description="Virtual Avatar Pipeline")
    parser.add_argument("--output", default="./output", help="결과 저장 디렉토리")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p_run = sub.add_parser("run", help="전체 파이프라인 실행 (Stage 2-6)")
    p_run.add_argument("--image", required=True)
    p_run.add_argument("--provider", default="varco", choices=["meshy", "varco"])
    p_run.add_argument("--api-key", default="", dest="api_key")
    p_run.add_argument("--skip-3d", action="store_true", dest="skip_3d")
    p_run.add_argument("--glb", default=None)

    # extract
    p_ext = sub.add_parser("extract", help="특징 추출만 (API 불필요)")
    p_ext.add_argument("--image", required=True)

    # batch-run
    p_brun = sub.add_parser("batch-run", help="여러 이미지 전체 파이프라인 실행 (VARCO 포함)")
    p_brun.add_argument("--images", nargs="+", required=True)
    p_brun.add_argument("--provider", default="varco", choices=["meshy", "varco"])
    p_brun.add_argument("--api-key", default="", dest="api_key")

    # batch
    p_bat = sub.add_parser("batch", help="여러 이미지 한번에 특징 추출 + 비교 (API 불필요)")
    p_bat.add_argument("--images", nargs="+", required=True, help="이미지 경로들 (스페이스로 구분)")

    # debug
    p_dbg = sub.add_parser("debug", help="랜드마크 시각화")
    p_dbg.add_argument("--image", required=True)

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
