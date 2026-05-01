"""
Avatar parameter specifications keyed by template Key_ID.

This module defines Key_ID spec metadata consumed by parameter mapping.
At runtime it is imported through parameter_mapper and contributes to
avatar_parameters / parameter_debug written in pipeline_result.json.
"""

from collections.abc import Iterator


ParameterSpec = dict[str, object]


def _spec(
    *,
    value_range: tuple[float, float],
    domain: str,
    source: str | None = None,
    feature: str | None = None,
    description: str,
    enabled: bool = False,
) -> ParameterSpec:
    mapping = "default"
    if enabled:
        mapping = "relative" if value_range == (-1.0, 1.0) else "strength"

    notes = (
        f"Mapped from FaceFeatureVector.{feature}; runtime mapping will be "
        "implemented in a later step."
        if enabled
        else "Disabled because the corresponding FaceFeatureVector feature is not implemented yet."
    )

    return {
        "range": value_range,
        "domain": domain,
        "source": source,
        "feature": feature,
        "mapping": mapping,
        "default": 0.0,
        "enabled": enabled,
        "description": description,
        "notes": notes,
    }


PARAMETER_SPECS: dict[str, ParameterSpec] = {
    "Eye_Width": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Horizontal eye width adjustment.",
    ),
    "Eye_WidthV": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        source="FaceFeatureVector",
        feature="eye_aspect_ratio",
        enabled=True,
        description="Vertical eye width adjustment based on eye aspect ratio.",
    ),
    "Eye_Height": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Overall eye height adjustment.",
    ),
    "Eye_Dist": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        source="FaceFeatureVector",
        feature="eye_distance_ratio",
        enabled=True,
        description="Distance between eyes based on normalized eye spacing.",
    ),
    "Eye_Rot": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Eye rotation adjustment.",
    ),
    "Eye_FrontHeight": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Front eye height adjustment.",
    ),
    "Eye_FrontFlat": _spec(
        value_range=(0.0, 1.0),
        domain="eye",
        description="Front eye flatness strength.",
    ),
    "Eye_TailHeight": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Outer eye tail height adjustment.",
    ),
    "Eye_TopLidFlat": _spec(
        value_range=(0.0, 1.0),
        domain="eye",
        description="Upper eyelid flatness strength.",
    ),
    "Eye_LowerLidFlat": _spec(
        value_range=(0.0, 1.0),
        domain="eye",
        description="Lower eyelid flatness strength.",
    ),
    "Eye_TopLidDown": _spec(
        value_range=(0.0, 1.0),
        domain="eye",
        description="Upper eyelid downward strength.",
    ),
    "Eye_LowerLidUp": _spec(
        value_range=(0.0, 1.0),
        domain="eye",
        description="Lower eyelid upward strength.",
    ),
    "Eye_PupilWidth": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Horizontal pupil width adjustment.",
    ),
    "Eye_PupilWidthV": _spec(
        value_range=(-1.0, 1.0),
        domain="eye",
        description="Vertical pupil width adjustment.",
    ),
    "Brow_Dist": _spec(
        value_range=(-1.0, 1.0),
        domain="brow",
        description="Distance between brows adjustment.",
    ),
    "Brow_Height": _spec(
        value_range=(-1.0, 1.0),
        domain="brow",
        description="Brow height adjustment.",
    ),
    "Brow_Rot": _spec(
        value_range=(-1.0, 1.0),
        domain="brow",
        description="Brow rotation adjustment.",
    ),
    "Brow_Width": _spec(
        value_range=(-1.0, 1.0),
        domain="brow",
        description="Horizontal brow width adjustment.",
    ),
    "Brow_WidthV": _spec(
        value_range=(-1.0, 1.0),
        domain="brow",
        description="Vertical brow width adjustment.",
    ),
    "Nose_Height": _spec(
        value_range=(-1.0, 1.0),
        domain="nose",
        source="FaceFeatureVector",
        feature="nose_height_ratio",
        enabled=True,
        description="Nose height adjustment based on normalized nose height.",
    ),
    "Nose_Width": _spec(
        value_range=(0.0, 1.0),
        domain="nose",
        source="FaceFeatureVector",
        feature="nose_width_ratio",
        enabled=True,
        description="Nose width strength based on normalized nose width.",
    ),
    "Nose_UnderNose": _spec(
        value_range=(-1.0, 1.0),
        domain="nose",
        description="Under-nose shape adjustment.",
    ),
    "Mouth_Width": _spec(
        value_range=(-1.0, 1.0),
        domain="mouth",
        source="FaceFeatureVector",
        feature="mouth_width_ratio",
        enabled=True,
        description="Mouth width adjustment based on normalized mouth width.",
    ),
    "Mouth_Height": _spec(
        value_range=(-1.0, 1.0),
        domain="mouth",
        description="Mouth height adjustment.",
    ),
    "Mouth_Corner": _spec(
        value_range=(-1.0, 1.0),
        domain="mouth",
        description="Mouth corner adjustment.",
    ),
    "Face_JawLine": _spec(
        value_range=(0.0, 1.0),
        domain="face",
        source="FaceFeatureVector",
        feature="jaw_width_ratio",
        enabled=True,
        description="Jawline strength based on normalized jaw width.",
    ),
    "Face_Cheek": _spec(
        value_range=(0.0, 1.0),
        domain="face",
        description="Cheek shape strength.",
    ),
    "Face_Roundness": _spec(
        value_range=(0.0, 1.0),
        domain="face",
        source="FaceFeatureVector",
        feature="face_width_height_ratio",
        enabled=True,
        description="Face roundness strength based on face width-height ratio.",
    ),
    "Face_ChinWidth": _spec(
        value_range=(0.0, 1.0),
        domain="face",
        source="FaceFeatureVector",
        feature="jaw_width_ratio",
        enabled=True,
        description="Chin width strength based on normalized jaw width.",
    ),
}


def get_parameter_spec(key_id: str) -> dict:
    return PARAMETER_SPECS[key_id]


def iter_enabled_specs() -> Iterator[tuple[str, dict]]:
    return (
        (key_id, spec)
        for key_id, spec in PARAMETER_SPECS.items()
        if spec["enabled"]
    )


def iter_all_specs() -> Iterator[tuple[str, dict]]:
    return iter(PARAMETER_SPECS.items())
