"""
Map extracted face features to avatar Key_ID parameters.

This module is connected to the pipeline Stage 6 and maps extracted features
to avatar parameter outputs plus debug metadata.
"""

from typing import TYPE_CHECKING, Any

from .parameter_specs import iter_all_specs

if TYPE_CHECKING:
    from .feature_extractor import FaceFeatureVector


FEATURE_CALIBRATION: dict[str, dict[str, float]] = {
    "eye_aspect_ratio": {"ref": 0.34, "half_range": 0.15},
    "eye_distance_ratio": {"ref": 0.45, "half_range": 0.12},
    "face_width_height_ratio": {"ref": 0.98, "half_range": 0.16},
    "nose_height_ratio": {"ref": 0.28, "half_range": 0.15},
    "nose_width_ratio": {"ref": 0.26, "half_range": 0.12},
    "mouth_width_ratio": {"ref": 0.35, "half_range": 0.20},
    "jaw_width_ratio": {"ref": 0.70, "half_range": 0.15},
    "forehead_ratio": {"ref": 0.50, "half_range": 0.15},
    "chin_ratio": {"ref": 0.32, "half_range": 0.12},
}


def map_avatar_parameters(
    feature_vector: "FaceFeatureVector | dict[str, float]",
    template_name: str | None = None,
) -> tuple[dict[str, float], dict[str, dict]]:
    avatar_parameters: dict[str, float] = {}
    parameter_debug: dict[str, dict] = {}

    for key_id, spec in iter_all_specs():
        default = float(spec["default"])
        enabled = bool(spec["enabled"])
        mapping = str(spec["mapping"])
        value_range = spec["range"]

        raw_value = None
        error = None
        output = default

        if not enabled or mapping == "default":
            notes = spec.get("notes")
        else:
            notes = None
            feature_name = spec.get("feature")
            raw_value = (
                _get_feature_value(feature_vector, feature_name)
                if isinstance(feature_name, str)
                else None
            )
            calibration = (
                FEATURE_CALIBRATION.get(feature_name)
                if isinstance(feature_name, str)
                else None
            )

            try:
                if raw_value is None:
                    raise ValueError(f"missing feature value: {feature_name}")
                if calibration is None:
                    raise ValueError(f"missing calibration: {feature_name}")

                raw_float = float(raw_value)
                raw_value = raw_float
                if mapping == "relative":
                    output = _map_relative(raw_float, calibration, value_range)
                elif mapping == "strength":
                    output = _map_strength(raw_float, calibration, value_range)
                elif mapping == "default":
                    output = default
                else:
                    raise ValueError(f"unsupported mapping: {mapping}")
            except (TypeError, ValueError, KeyError) as exc:
                output = default
                error = str(exc)

        avatar_parameters[key_id] = output
        parameter_debug[key_id] = _build_debug(
            spec=spec,
            raw_value=raw_value,
            output=output,
            template_name=template_name,
            error=error,
            notes=notes,
        )

    return avatar_parameters, parameter_debug


def _get_feature_value(feature_vector, feature_name):
    if isinstance(feature_vector, dict):
        return feature_vector.get(feature_name)
    return getattr(feature_vector, feature_name, None)


def _clip(value, value_range):
    low, high = value_range
    return float(max(float(low), min(float(high), float(value))))


def _map_relative(raw_value, calibration, value_range):
    mapped = (raw_value - calibration["ref"]) / calibration["half_range"]
    return _clip(mapped, value_range)


def _map_strength(raw_value, calibration, value_range):
    mapped = 0.5 + 0.5 * ((raw_value - calibration["ref"]) / calibration["half_range"])
    return _clip(mapped, value_range)


def _build_debug(
    *,
    spec: dict[str, Any],
    raw_value,
    output: float,
    template_name: str | None,
    error: str | None = None,
    notes: str | None = None,
) -> dict:
    debug = {
        "enabled": bool(spec["enabled"]),
        "source": spec.get("source"),
        "feature": spec.get("feature"),
        "raw_value": raw_value,
        "mapping": spec.get("mapping"),
        "range": spec.get("range"),
        "default": spec.get("default"),
        "output": output,
        "calibration_status": "temporary" if spec["enabled"] else None,
        "template_name": template_name,
    }
    if error:
        debug["error"] = error
    if notes:
        debug["notes"] = notes
    return debug
