"""Configuration for face-feature pipeline tunables.

Keep style-correction-related defaults here so they can be tuned without editing
`avatar_keys.py` directly. This file is intentionally simple and documented for
operators to adjust.
"""

# Style detection thresholds (used to compute style_strength)
STYLE = {
    # Eye_FrontFlat range mapped to 0..1
    "front_flat_lo": 0.50,
    "front_flat_hi": 1.00,
    # Eye_TopLidFlat range mapped to 0..1
    "top_lid_lo": 0.40,
    "top_lid_hi": 1.00,
    # width_height center and span for inversion → score
    "wh_center": 1.8,
    "wh_span": 0.5,

    # Style-driven correction bases & scales
    "jaw_blend_base": 0.20,
    "jaw_blend_scale": 0.25,   # additional blend at full style_strength
    "jaw_target": 0.75,

    "chin_delta_base": 0.12,
    "chin_delta_scale": 0.18,

    "round_delta_base": 0.10,
    "round_delta_scale": 0.05,

    "cheek_delta_scale": 0.06,
}

DEFAULTS = {
    # Whether corrections are applied by default. Useful to set to False in
    # environments that require raw ADF outputs.
    "apply_style_corrections": False,
}
