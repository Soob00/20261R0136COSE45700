from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from feasibility import STAGE_ORDER
from feasibility.common import (
    Context,
    Paths,
    append_pipeline_event,
    ensure_original_copy,
    load_json,
    sample_output_dir,
    stage_artifact_exists,
    validate_sample,
)
from feasibility.reporting import generate_reports
from feasibility.stages import STAGE_FUNCS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run accessory pipeline feasibility test.")
    parser.add_argument(
        "--manifest",
        required=True,
        help="Path to sample manifest JSON.",
    )
    parser.add_argument(
        "--config",
        default="experiments/accessory-feasibility/config/feasibility.json",
        help="Path to feasibility config JSON.",
    )
    parser.add_argument(
        "--env-file",
        default="experiments/accessory-feasibility/.env",
        help="Path to dotenv file. Missing file is allowed.",
    )
    parser.add_argument("--resume", action="store_true", help="Resume from unfinished stages.")
    parser.add_argument("--sample", help="Run a single sampleId only.")
    parser.add_argument(
        "--from-stage",
        choices=STAGE_ORDER,
        help="Start execution from this stage.",
    )
    parser.add_argument(
        "--force-stage",
        choices=STAGE_ORDER,
        help="Force re-run one stage even if already succeeded.",
    )
    return parser.parse_args()


def build_paths(workspace_root: Path) -> Paths:
    return Paths(
        root=workspace_root,
        config_dir=workspace_root / "config",
        inputs_dir=workspace_root / "inputs",
        outputs_dir=workspace_root / "outputs",
        reports_dir=workspace_root / "reports",
    )


def should_run_stage(stage: str, from_stage: str | None) -> bool:
    if from_stage is None:
        return True
    return STAGE_ORDER.index(stage) >= STAGE_ORDER.index(from_stage)


def load_dotenv_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    loaded: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        os.environ[key] = value
        loaded[key] = value
    return loaded


def main() -> int:
    args = parse_args()
    workspace_root = SCRIPT_DIR.parent
    paths = build_paths(workspace_root)
    env_path = Path(args.env_file)
    loaded_env = load_dotenv_file(env_path)
    config = load_json(Path(args.config))
    manifest_path = Path(args.manifest)
    samples = load_json(manifest_path)

    if isinstance(samples, dict) and isinstance(samples.get("samples"), list):
        samples = samples["samples"]

    if not isinstance(samples, list):
        raise ValueError(
            "Manifest must be a JSON array or an object with a 'samples' array: "
            f"{manifest_path}"
        )

    filtered_samples = []
    for sample in samples:
        validate_sample(sample)
        if args.sample and sample["sampleId"] != args.sample:
            continue
        filtered_samples.append(sample)

    force_stage_index = STAGE_ORDER.index(args.force_stage) if args.force_stage else None

    for sample in filtered_samples:
        ctx = Context(paths=paths, config=config, sample=sample)
        output_dir = sample_output_dir(ctx)
        output_dir.mkdir(parents=True, exist_ok=True)
        ensure_original_copy(ctx)
        append_pipeline_event(
            ctx,
            {
                "stage": "runner",
                "event": "started",
                "config": config,
                "envFile": str(env_path),
                "loadedEnvKeys": sorted(loaded_env.keys()),
                "resume": args.resume,
                "fromStage": args.from_stage,
                "forceStage": args.force_stage,
            },
        )

        for stage in STAGE_ORDER:
            if not should_run_stage(stage, args.from_stage):
                continue

            should_force_downstream = force_stage_index is not None and STAGE_ORDER.index(stage) >= force_stage_index

            if not should_force_downstream and stage_artifact_exists(ctx, stage):
                append_pipeline_event(
                    ctx,
                    {"stage": stage, "event": "reused", "reason": "already_reused"}
                )
                continue
            elif args.resume:
                # resume still runs unfinished stages; no-op here
                pass

            STAGE_FUNCS[stage](ctx)

        append_pipeline_event(ctx, {"stage": "runner", "event": "finished"})

    generate_reports(workspace_root, filtered_samples, config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
