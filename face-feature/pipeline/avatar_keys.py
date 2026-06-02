"""
Avatar key computation — ADF 28-pt landmarks → 29 Key_IDs.

All keys are normalized to [-1, 1] or [0, 1] via _map_signed / _map_01.
lo/hi calibration ranges use curated valid samples with min/max plus a small margin.

Keys with structural limitations (fixed/proxy values):
  Eye_TopLidDown / Eye_LowerLidUp : proxy (ADF 3-pt lid insufficient)
  Eye_PupilWidth / Eye_PupilWidthV: Eye_WidthV proxy (iris size is not reliable in ADF)
    Brow_WidthV                     : 0.0   (no brow thickness in ADF)
    Nose_Width                      : 0.65  (no ala landmarks in ADF)
    Nose_Height                     : depth-based with 0.25 visible baseline
    Face_Cheek                      : 2D contour proxy; side depth overrides it in Stage 4
"""

from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np

from geometry import (
    _EPS,
    _map_signed, _map_signed_asym, _map_01,
    _angle_at,
    _lid_flatness,
    _compute_depth_features,
    _map_01 as map_01,
)
import config as cfg

# ── Calibration ranges ────────────────────────────────────────────────────────
# Single source of truth — imported by calibrate_keys.py / calibrate_keys_front_render.py
SIGNED_CALIBRATION = {
    "Eye_Width":       (0.1581, 0.3071),
    "Eye_WidthV":      (0.0149, 0.2407),
    "Eye_Height":      (0.1208, 0.9137),
    "Eye_Dist":        (0.2526, 0.6913),
    "Eye_Rot":         (-0.1906, 0.3168),
    "Eye_FrontHeight": (-0.2545, 0.1006),
    "Eye_TailHeight":  (-0.0185, 0.0401),
    "Eye_PupilWidth":  (0.0860, 0.2436),   # proxy = Eye_WidthV
    "Eye_PupilWidthV": (0.0860, 0.2436),   # proxy = Eye_WidthV
    "Brow_Dist":       (0.2309, 0.4115),
    "Brow_Height":     (0.7209, 1.0771),
    "Brow_Width":      (0.0800, 0.4000),
    "Brow_Rot":        (-0.3266, 0.2589),
    "Nose_Height":     (-0.0172, 0.1440),  # depth-based (renders only)
    "Nose_UnderNose":  (0.0979, 0.2109),
    "Mouth_Width":     (0.1581, 0.4615),
    "Mouth_Height":    (0.2488, 0.5108),
    "Mouth_Corner":    (-0.0294, 0.1035),
}

MAP01_CALIBRATION = {
    "Face_Cheek":       (1.450, 1.800),
    "Face_ChinWidth":   (0.6200, 0.7800),
    "Face_JawLine":     (0.2432, 0.6000),
    "Face_Roundness":   (0.0042, 0.0397),
    "Eye_FrontFlat":    (0.0982, 0.6729),  # inner gap / eye_width ratio
    "Eye_TopLidFlat":   (-0.0300, 0.4417),
    "Eye_LowerLidFlat": (-0.0600, 0.8230),
    "Eye_TopLidDown":   (0.2070, 1.0598),  # raw = opening (before inversion)
    "Eye_LowerLidUp":   (0.2070, 1.0598),  # proxy = Eye_TopLidDown
}

_SC = SIGNED_CALIBRATION
_MC = MAP01_CALIBRATION

_FACE_JAWLINE_GAMMA = 0.90
_FACE_ROUNDNESS_GAMMA = 1.85
_FACE_CHINWIDTH_GAMMA = 1.60
_FACE_CHEEK_GAMMA = 0.95
# emphasize chin width for illustrative (2D) faces so rounding/wider chins are stronger
_FACE_JAWLINE_WEIGHTS = {"chin_angle": 0.06, "chin_width": 0.60, "chin_depth": 0.34}
_FACE_ROUNDNESS_WEIGHTS = {"width_height": 0.25, "chin_angle": 0.05, "chin_depth": 0.15}
_EYE_TAIL_RAW_OFFSET = 0.006
_EYE_WIDTHV_POS_SCALE = 0.65
_EYE_ROT_BIAS = -0.65
_EYE_ROT_RAW_SCALE = 0.12
_EYE_ROT_MIN = -0.78
_EYE_ROT_MAX = -0.50
_EYE_TOP_LID_FLAT_SCALE = 0.48
_EYE_TOP_LID_FLAT_MAX = 0.62
_EYE_TOP_LID_DOWN_GAMMA = 1.35


def _curve_01(value: float, gamma: float) -> float:
    value = float(max(0.0, min(1.0, value)))
    return float(value ** gamma)


def compute_avatar_keys(
    kps: list,
    manual: "dict | None" = None,
    _raw_out: "dict | None" = None,
    depth: "np.ndarray | None" = None,
    img_shape: "tuple | None" = None,
    apply_style_corrections: bool = None,
) -> dict[str, float]:
    """
    Compute all 29 avatar Key_IDs from ADF 28-pt keypoints.

    kps       : list of 28 (x, y) tuples, image coordinates (y down).
    manual    : optional pupil points {R_PL, R_PR, L_PL, L_PR, R_PT, R_PB, L_PT, L_PB}.
    _raw_out  : if provided, raw (un-normalized) values are written here.
    depth     : optional pyrender depth array (float32, smaller = closer).
    img_shape : (H, W) required when depth is provided.
    """
    def p(i):
        return np.array(kps[i], dtype=float)

    def d(a, b):
        return float(np.linalg.norm(np.array(a, dtype=float) - np.array(b, dtype=float)))

    def mid(a, b):
        return (np.array(a, dtype=float) + np.array(b, dtype=float)) / 2.0

    # ── Section 2: face scale ─────────────────────────────────────────────
    F0, F1, F2, F3, F4 = [p(i) for i in range(5)]
    face_width        = d(F0, F4)
    lower_face_height = d(mid(F0, F4), F2)
    face_scale        = max(0.75 * face_width + 0.25 * lower_face_height, _EPS)

    # ── Section 3: eye points (kp11-22) ──────────────────────────────────
    R_eye_left    = p(11);  R_eye_mid_u = p(12);  R_eye_right   = p(13)
    R_eye_left_l  = p(14);  R_eye_mid_l = p(15);  R_eye_right_l = p(16)
    L_eye_left    = p(17);  L_eye_mid_u = p(18);  L_eye_right   = p(19)
    L_eye_left_l  = p(20);  L_eye_mid_l = p(21);  L_eye_right_l = p(22)

    R_left_corner  = mid(R_eye_left,  R_eye_left_l)
    R_right_corner = mid(R_eye_right, R_eye_right_l)
    L_left_corner  = mid(L_eye_left,  L_eye_left_l)
    L_right_corner = mid(L_eye_right, L_eye_right_l)

    R_inner = R_right_corner
    R_outer = R_left_corner
    L_inner = L_left_corner
    L_outer = L_right_corner

    R_eye_w = d(R_left_corner, R_right_corner)
    L_eye_w = d(L_left_corner, L_right_corner)

    R_eye_h = max(float(
        max(R_eye_left_l[1], R_eye_mid_l[1], R_eye_right_l[1])
        - min(R_eye_left[1], R_eye_mid_u[1], R_eye_right[1])
    ), _EPS)
    L_eye_h = max(float(
        max(L_eye_left_l[1], L_eye_mid_l[1], L_eye_right_l[1])
        - min(L_eye_left[1], L_eye_mid_u[1], L_eye_right[1])
    ), _EPS)

    R_center   = mid(R_left_corner, R_right_corner)
    L_center   = mid(L_left_corner, L_right_corner)
    eye_center = mid(R_center, L_center)
    eye_open_ratio = ((R_eye_h / max(R_eye_w, _EPS)) + (L_eye_h / max(L_eye_w, _EPS))) / 2.0

    # ── Section 4: Eye keys ───────────────────────────────────────────────
    _rv = (R_eye_w + L_eye_w) / 2.0 / face_scale
    Eye_Width = _map_signed(_rv, *_SC["Eye_Width"])
    if _raw_out is not None: _raw_out["Eye_Width"] = _rv

    _rv = (R_eye_h + L_eye_h) / 2.0 / face_scale
    Eye_WidthV = _map_signed(_rv, *_SC["Eye_WidthV"])
    if Eye_WidthV > 0.0:
        Eye_WidthV *= _EYE_WIDTHV_POS_SCALE
    if _raw_out is not None: _raw_out["Eye_WidthV"] = _rv

    chin_y = float(F2[1])
    _rv = (chin_y - float(eye_center[1])) / face_scale
    Eye_Height = _map_signed(_rv, *_SC["Eye_Height"])
    if _raw_out is not None: _raw_out["Eye_Height"] = _rv

    _rv = d(R_inner, L_inner) / face_scale
    Eye_Dist = _map_signed(_rv, *_SC["Eye_Dist"])
    if _raw_out is not None: _raw_out["Eye_Dist"] = _rv

    # outer_y - inner_y: positive = outer lower (drooping tail), negative = outer higher (upward tail)
    # Both eyes use same semantic direction to avoid mirror-sign cancellation
    R_rot_slope = (float(R_outer[1]) - float(R_inner[1])) / max(R_eye_w, _EPS)
    L_rot_slope = (float(L_outer[1]) - float(L_inner[1])) / max(L_eye_w, _EPS)
    _rv = (R_rot_slope + L_rot_slope) / 2.0
    # ADF corners are noisy, but a fixed value makes every face look too similar.
    # Keep a strong upward-tail prior and let raw slope make only a small correction.
    rot_norm = _map_signed(_rv, *_SC["Eye_Rot"])
    Eye_Rot = float(max(_EYE_ROT_MIN, min(_EYE_ROT_MAX, _EYE_ROT_BIAS + _EYE_ROT_RAW_SCALE * rot_norm)))
    if _raw_out is not None: _raw_out["Eye_Rot"] = _rv

    R_mid_y = float(R_center[1])
    L_mid_y = float(L_center[1])
    _rv = (
        ((R_mid_y - float(R_inner[1])) / R_eye_h
         + (L_mid_y - float(L_inner[1])) / L_eye_h) / 2.0
    )
    Eye_FrontHeight = _map_signed(_rv, *_SC["Eye_FrontHeight"])
    if _raw_out is not None: _raw_out["Eye_FrontHeight"] = _rv

    _rv = (
        (R_mid_y - float(R_outer[1]))
        + (L_mid_y - float(L_outer[1]))
    ) / 2.0 / face_scale
    _rv += _EYE_TAIL_RAW_OFFSET
    Eye_TailHeight = _map_signed(_rv, *_SC["Eye_TailHeight"])
    if _raw_out is not None: _raw_out["Eye_TailHeight"] = _rv

    # inner corner vertical gap / eye_width — ratio-based, no degree units
    R_inner_gap = max(float(R_eye_right_l[1] - R_eye_right[1]), 0.0)
    L_inner_gap = max(float(L_eye_left_l[1]  - L_eye_left[1]),  0.0)
    _rv = (R_inner_gap / max(R_eye_w, _EPS) + L_inner_gap / max(L_eye_w, _EPS)) / 2.0
    Eye_FrontFlat = _map_01(_rv, *_MC["Eye_FrontFlat"])
    if _raw_out is not None: _raw_out["Eye_FrontFlat"] = _rv

    _top_lid_flat_raw = float(
        (_lid_flatness(R_left_corner, R_right_corner, R_eye_mid_u, R_eye_h)
         + _lid_flatness(L_left_corner, L_right_corner, L_eye_mid_u, L_eye_h)) / 2.0
    )
    Eye_TopLidFlat = min(
        _map_01(_top_lid_flat_raw, *_MC["Eye_TopLidFlat"]) * _EYE_TOP_LID_FLAT_SCALE,
        _EYE_TOP_LID_FLAT_MAX,
    )

    _lower_lid_flat_raw = float(
        (_lid_flatness(R_left_corner, R_right_corner, R_eye_mid_l, R_eye_h)
         + _lid_flatness(L_left_corner, L_right_corner, L_eye_mid_l, L_eye_h)) / 2.0
    )
    Eye_LowerLidFlat = _map_01(_lower_lid_flat_raw, *_MC["Eye_LowerLidFlat"])
    if _raw_out is not None:
        _raw_out["Eye_TopLidFlat"]   = _top_lid_flat_raw
        _raw_out["Eye_LowerLidFlat"] = _lower_lid_flat_raw

    # Eye_TopLidDown: pupil center 기준 (detect 성공 시), ADF mid-lid fallback
    if manual is not None:
        R_cy = (float(manual["R_PT"][1]) + float(manual["R_PB"][1])) / 2.0
        L_cy = (float(manual["L_PT"][1]) + float(manual["L_PB"][1])) / 2.0
        R_gap = (R_cy - float(R_eye_mid_u[1])) / max(R_eye_h, _EPS)
        L_gap = (L_cy - float(L_eye_mid_u[1])) / max(L_eye_h, _EPS)
        opening = (R_gap + L_gap) / 2.0
    else:
        R_center_opening = d(R_eye_mid_u, R_eye_mid_l) / max(R_eye_w, _EPS)
        L_center_opening = d(L_eye_mid_u, L_eye_mid_l) / max(L_eye_w, _EPS)
        opening = (R_center_opening + L_center_opening) / 2.0
    if _raw_out is not None: _raw_out["Eye_TopLidDown"] = opening
    Eye_TopLidDown = _curve_01(1.0 - _map_01(opening, *_MC["Eye_TopLidDown"]), _EYE_TOP_LID_DOWN_GAMMA)
    Eye_LowerLidUp = _curve_01(1.0 - _map_01(opening, *_MC["Eye_LowerLidUp"]), _EYE_TOP_LID_DOWN_GAMMA)
    if _raw_out is not None: _raw_out["Eye_LowerLidUp"] = opening

    # Eye_PupilWidth/V: radius is unreliable, so use Eye_WidthV as the intentional proxy.
    Eye_PupilWidth  = Eye_WidthV
    Eye_PupilWidthV = Eye_WidthV
    if _raw_out is not None:
        _raw_out["Eye_PupilWidth"]  = _raw_out.get("Eye_WidthV")
        _raw_out["Eye_PupilWidthV"] = _raw_out.get("Eye_WidthV")

    # ── Section 5: Brow keys (kp5-10) ────────────────────────────────────
    R_brow_outer = p(5);  R_brow_mid = p(6);  R_brow_inner = p(7)
    L_brow_inner = p(8);  L_brow_mid = p(9);  L_brow_outer = p(10)

    R_brow_w = d(R_brow_outer, R_brow_inner)
    L_brow_w = d(L_brow_inner, L_brow_outer)

    _rv = d(R_brow_inner, L_brow_inner) / face_scale
    Brow_Dist = _map_signed(_rv, *_SC["Brow_Dist"])
    if _raw_out is not None: _raw_out["Brow_Dist"] = _rv

    brow_mean_y = (float(R_brow_mid[1]) + float(L_brow_mid[1])) / 2.0
    _rv = (float(F2[1]) - brow_mean_y) / face_scale
    Brow_Height = _map_signed(_rv, *_SC["Brow_Height"])
    if Brow_Height > 0.0:
        Brow_Height *= 0.75
    if _raw_out is not None: _raw_out["Brow_Height"] = _rv

    # outer_y - inner_y: same semantic direction for both brows (mirror-sign fix)
    R_brow_slope = (float(R_brow_outer[1]) - float(R_brow_inner[1])) / max(R_brow_w, _EPS)
    L_brow_slope = (float(L_brow_outer[1]) - float(L_brow_inner[1])) / max(L_brow_w, _EPS)
    _rv = (R_brow_slope + L_brow_slope) / 2.0
    Brow_Rot = float(max(-1.0, min(1.0, _rv / 0.50)))
    if _raw_out is not None: _raw_out["Brow_Rot"] = _rv

    _rv = (R_brow_w + L_brow_w) / 2.0 / face_scale
    Brow_Width = _map_signed(_rv, *_SC["Brow_Width"])
    if Brow_Width > 0.0:
        Brow_Width *= 0.75
    if _raw_out is not None: _raw_out["Brow_Width"] = _rv

    Brow_WidthV = 0.0

    # ── Section 6: Nose keys (kp23) ───────────────────────────────────────
    N         = p(23)
    mouth_ctr = mid(p(24), p(26))
    eye_y     = float(eye_center[1])
    mouth_y   = float(mouth_ctr[1])

    Nose_Height = 0.25  # visible baseline; depth can raise it further
    if _raw_out is not None: _raw_out["Nose_Height"] = None
    Nose_Width = 0.65

    _rv = (float(p(25)[1]) - float(N[1])) / face_scale
    Nose_UnderNose = _map_signed(_rv, *_SC["Nose_UnderNose"])
    if _raw_out is not None: _raw_out["Nose_UnderNose"] = _rv

    # ── Section 7: Mouth keys (kp24-27) ──────────────────────────────────
    M_L = p(24);  M_U = p(25);  M_R = p(26);  M_D = p(27)
    M_C          = mid(M_U, M_D)
    M_corner_mid = mid(M_L, M_R)

    _rv = d(M_L, M_R) / face_scale
    Mouth_Width = _map_signed_asym(
        _rv, *_SC["Mouth_Width"], pivot=0.376, gamma_lo=0.72, gamma_hi=1.75
    )
    if _raw_out is not None: _raw_out["Mouth_Width"] = _rv

    _rv = float(M_corner_mid[1] - eye_center[1]) / face_scale
    Mouth_Height = -_map_signed(_rv, *_SC["Mouth_Height"])
    if _raw_out is not None: _raw_out["Mouth_Height"] = _rv

    _rv = (float(M_C[1]) - float((M_L[1] + M_R[1]) / 2.0)) / face_scale
    Mouth_Corner = _map_signed(_rv, *_SC["Mouth_Corner"])
    if Mouth_Corner < 0.0:
        Mouth_Corner *= 0.55
    if _raw_out is not None: _raw_out["Mouth_Corner"] = _rv

    # ── Section 8: Face keys (kp0-4) ─────────────────────────────────────
    jaw_width        = d(F1, F3)
    chin_width_ratio = jaw_width / max(face_width, _EPS)
    chin_angle       = _angle_at(F1, F2, F3)
    jaw_mid          = mid(F1, F3)
    chin_depth       = d(jaw_mid, F2)
    chin_depth_ratio = chin_depth / max(face_width, _EPS)
    width_height_ratio = face_width / max(lower_face_height, _EPS)

    angle_score = float(max(0.0, min(1.0, (130.0 - chin_angle)      / (130.0 - 60.0))))
    width_score = float(max(0.0, min(1.0, 1.0 - _map_01(chin_width_ratio, 0.58, 0.82))))
    depth_score = float(max(0.0, min(1.0, (chin_depth_ratio - 0.08) / (0.25 - 0.08))))
    jawline_base = float(max(0.0, min(1.0,
        _FACE_JAWLINE_WEIGHTS["chin_angle"] * angle_score
        + _FACE_JAWLINE_WEIGHTS["chin_width"] * width_score
        + _FACE_JAWLINE_WEIGHTS["chin_depth"] * depth_score
    )))
    jawline_norm = _map_01(jawline_base, *_MC["Face_JawLine"])
    Face_JawLine = _curve_01(jawline_norm, _FACE_JAWLINE_GAMMA)

    _r_wh = _map_01(width_height_ratio, 1.5, 2.5)
    _r_ca = _map_01(chin_angle, 80.0, 140.0)
    _r_cd = 1.0 - _map_01(chin_depth_ratio, 0.08, 0.25)
    round_w_wh = _FACE_ROUNDNESS_WEIGHTS["width_height"]
    round_w_ca = _FACE_ROUNDNESS_WEIGHTS["chin_angle"]
    round_w_cd = _FACE_ROUNDNESS_WEIGHTS["chin_depth"]
    roundness_base = float(max(0.0, min(1.0, round_w_wh * _r_wh + round_w_ca * _r_ca + round_w_cd * _r_cd)))
    roundness_raw = float(max(0.0, roundness_base * 0.12))
    roundness_norm = _map_01(roundness_raw, *_MC["Face_Roundness"])
    Face_Roundness = _curve_01(roundness_norm, _FACE_ROUNDNESS_GAMMA)

    mouth_width_ratio = d(M_L, M_R) / max(face_scale, _EPS)
    jaw_softness = 1.0 - _map_01(jawline_base, 0.45, 0.63)
    cheek_base = 0.0
    cheek_boost = (
        (max(jaw_softness, 0.0) ** 1.5)
        * (max(Face_Roundness, 0.0) ** 1.4)
        * (_map_01(eye_open_ratio, 0.32, 0.80) ** 1.1)
        * (_map_01(mouth_width_ratio, 0.14, 0.28) ** 1.2)
        * 5.0
    )
    cheek_value = max(0.0, min(1.0, cheek_base + cheek_boost))
    Face_Cheek = _curve_01(cheek_value, _FACE_CHEEK_GAMMA)
    if _raw_out is not None:
        _raw_out["Face_Cheek"] = {
            "value": cheek_value,
            "calibrated": cheek_value,
            "adjusted": Face_Cheek,
            "visual_gamma": _FACE_CHEEK_GAMMA,
            "base": cheek_base,
            "boost": cheek_boost,
            "components": {
                "jaw_softness": round(max(jaw_softness, 0.0), 4),
                "roundness": round(max(Face_Roundness, 0.0), 4),
                "eye_open": round(_map_01(eye_open_ratio, 0.32, 0.80), 4),
                "mouth_width": round(_map_01(mouth_width_ratio, 0.14, 0.28), 4),
            },
        }

    _rv = chin_width_ratio * (0.68 + 0.32 * float(max(0.0, min(1.0, (chin_angle - 85.0) / (125.0 - 85.0)))) )
    chin_width_norm = _map_01(_rv, *_MC["Face_ChinWidth"])
    Face_ChinWidth = _curve_01(chin_width_norm, _FACE_CHINWIDTH_GAMMA)
    if _raw_out is not None:
        _raw_out["Face_ChinWidth"] = {
            "value": _rv,
            "calibrated": chin_width_norm,
            "adjusted": Face_ChinWidth,
            "visual_gamma": _FACE_CHINWIDTH_GAMMA,
        }
    if _raw_out is not None:
        _raw_out["Face_JawLine"] = {
            "value": jawline_base,
            "calibrated": jawline_norm,
            "adjusted": Face_JawLine,
            "visual_gamma": _FACE_JAWLINE_GAMMA,
            "weights": _FACE_JAWLINE_WEIGHTS,
            "chin_angle": round(angle_score, 4),
            "chin_width": round(width_score, 4),
            "chin_depth": round(depth_score, 4),
        }
        _raw_out["Face_Roundness"] = {
            "value": roundness_raw,
            "calibrated": roundness_norm,
            "adjusted": Face_Roundness,
            "visual_gamma": _FACE_ROUNDNESS_GAMMA,
            "measured": roundness_base,
            "weights": {"width_height": round_w_wh, "chin_angle": round_w_ca, "chin_depth": round_w_cd},
            "width_height": round(_r_wh, 4),
            "chin_angle":   round(_r_ca, 4),
            "chin_depth":   round(_r_cd, 4),
        }

    # ── 2D / 일러스트 스타일 판별 및 조건부 보정 (raw_out 디버그 이후 적용) ────
    is_2d_style = False
    try:
        if depth is None:
            if (Eye_FrontFlat > 0.50) or (Eye_TopLidFlat > 0.40) or (width_height_ratio < 1.65):
                is_2d_style = True
    except Exception:
        is_2d_style = False

    # determine whether to apply style corrections; default from config if None
    if apply_style_corrections is None:
        apply_style_corrections = bool(cfg.DEFAULTS.get("apply_style_corrections", True))

    if is_2d_style and apply_style_corrections:
        orig_jaw = float(Face_JawLine)
        orig_chin = float(Face_ChinWidth)
        orig_round = float(Face_Roundness)
        orig_cheek = float(Face_Cheek)

        def _norm(v, lo, hi):
            if hi <= lo:
                return 0.0
            return float(max(0.0, min(1.0, (v - lo) / (hi - lo))))

        front_flat_score = _norm(Eye_FrontFlat, cfg.STYLE["front_flat_lo"], cfg.STYLE["front_flat_hi"])        # strong flat -> closer to 1
        top_lid_flat_score = _norm(Eye_TopLidFlat, cfg.STYLE["top_lid_lo"], cfg.STYLE["top_lid_hi"])     # flat upper lid -> closer to 1
        wh_score = float(max(0.0, min(1.0, (cfg.STYLE["wh_center"] - width_height_ratio) / cfg.STYLE["wh_span"])))

        style_strength = (front_flat_score + top_lid_flat_score + wh_score) / 3.0

        jaw_blend_base = cfg.STYLE.get("jaw_blend_base", 0.20)
        jaw_blend = jaw_blend_base + cfg.STYLE.get("jaw_blend_scale", 0.25) * style_strength        # scaled blend when strongly 2D
        jaw_target = cfg.STYLE.get("jaw_target", 0.75)

        chin_delta_base = cfg.STYLE.get("chin_delta_base", 0.12)
        chin_delta = chin_delta_base + cfg.STYLE.get("chin_delta_scale", 0.18) * style_strength     # increase chin width when 2D

        round_delta = cfg.STYLE.get("round_delta_base", 0.10) + cfg.STYLE.get("round_delta_scale", 0.05) * style_strength
        cheek_delta = cfg.STYLE.get("cheek_delta_scale", 0.06) * style_strength

        Face_JawLine = float(max(0.0, min(1.0, orig_jaw * (1.0 - jaw_blend) + jaw_target * jaw_blend)))
        Face_ChinWidth = float(max(0.0, min(1.0, orig_chin + chin_delta)))
        Face_Roundness = float(max(0.0, min(1.0, orig_round + round_delta)))
        Face_Cheek = float(max(0.0, min(1.0, orig_cheek + cheek_delta)))

        if _raw_out is not None:
            _raw_out.setdefault("style_detection", {})
            _raw_out["style_detection"]["proportional"] = {
                "front_flat_score": round(front_flat_score, 4),
                "top_lid_flat_score": round(top_lid_flat_score, 4),
                "width_height_score": round(wh_score, 4),
                "style_strength": round(style_strength, 4),
                "jaw_blend": round(jaw_blend, 4),
                "chin_delta": round(chin_delta, 4),
                "round_delta": round(round_delta, 4),
                "cheek_delta": round(cheek_delta, 4),
            }
            _raw_out["style_detection"]["applied"] = {
                "Face_JawLine": {"orig": orig_jaw, "new": Face_JawLine},
                "Face_ChinWidth": {"orig": orig_chin, "new": Face_ChinWidth},
                "Face_Roundness": {"orig": orig_round, "new": Face_Roundness},
                "Face_Cheek": {"orig": orig_cheek, "new": Face_Cheek},
            }

    # ── Depth override ────────────────────────────────────────────────────
    if depth is not None and img_shape is not None:
        ih, iw = img_shape
        _d_nose, _ = _compute_depth_features(depth, kps, ih, iw)
        if _d_nose is not None:
            Nose_Height = max(0.25, _map_signed(_d_nose, *_SC["Nose_Height"]))
            if _raw_out is not None: _raw_out["Nose_Height"] = _d_nose

    return {
        "Eye_Width":        Eye_Width,
        "Eye_WidthV":       Eye_WidthV,
        "Eye_Height":       Eye_Height,
        "Eye_Dist":         Eye_Dist,
        "Eye_Rot":          Eye_Rot,
        "Eye_FrontHeight":  Eye_FrontHeight,
        "Eye_FrontFlat":    Eye_FrontFlat,
        "Eye_TailHeight":   Eye_TailHeight,
        "Eye_TopLidFlat":   Eye_TopLidFlat,
        "Eye_LowerLidFlat": Eye_LowerLidFlat,
        "Eye_TopLidDown":   Eye_TopLidDown,
        "Eye_LowerLidUp":   Eye_LowerLidUp,
        "Eye_PupilWidth":   Eye_PupilWidth,
        "Eye_PupilWidthV":  Eye_PupilWidthV,
        "Brow_Dist":        Brow_Dist,
        "Brow_Height":      Brow_Height,
        "Brow_Rot":         Brow_Rot,
        "Brow_Width":       Brow_Width,
        "Brow_WidthV":      Brow_WidthV,
        "Nose_Height":      Nose_Height,
        "Nose_Width":       Nose_Width,
        "Nose_UnderNose":   Nose_UnderNose,
        "Mouth_Width":      Mouth_Width,
        "Mouth_Height":     Mouth_Height,
        "Mouth_Corner":     Mouth_Corner,
        "Face_JawLine":     Face_JawLine,
        "Face_Cheek":       Face_Cheek,
        "Face_Roundness":   Face_Roundness,
        "Face_ChinWidth":   Face_ChinWidth,
    }


def apply_gemini_face_corrections(
    avatar_keys: dict,
    gemini_features: dict,
    blend_weight: float = 0.3,
) -> dict:
    """
    Gemini의 정성적 얼굴 형태 분석(face_shape, chin_shape, jaw_prominence)과
    눈썹 두께(eyebrow.thickness)를 0~1 수치로 매핑하고, ADF 키값과 블렌딩하여 보정.

    gemini_features: full Gemini features dict (with general, eyebrow, etc.)
                     또는 general 섹션만 전달해도 동작.
    ADF (1 - blend_weight) + Gemini (blend_weight) 비율로 블렌딩.
    """
    result = avatar_keys.copy()

    # general 섹션 (직접 전달 또는 nested)
    gemini_general = gemini_features.get("general", gemini_features)

    # face_shape → Face_Roundness 보정
    face_shape_map = {
        "oval": 0.45, "round": 0.75, "heart": 0.35,
        "square": 0.20, "oblong": 0.30,
    }
    face_shape = gemini_general.get("face_shape")
    if face_shape and face_shape in face_shape_map:
        gemini_roundness = face_shape_map[face_shape]
        result["Face_Roundness"] = (
            result["Face_Roundness"] * (1 - blend_weight) +
            gemini_roundness * blend_weight
        )

    # chin_shape → Face_ChinWidth 보정
    chin_shape_map = {
        "pointed": 0.20, "round": 0.50, "square": 0.70, "wide": 0.85,
    }
    chin_shape = gemini_general.get("chin_shape")
    if chin_shape and chin_shape in chin_shape_map:
        gemini_chin = chin_shape_map[chin_shape]
        result["Face_ChinWidth"] = (
            result["Face_ChinWidth"] * (1 - blend_weight) +
            gemini_chin * blend_weight
        )

    # jaw_prominence → Face_JawLine 보정
    jaw_map = {
        "soft": 0.15, "moderate": 0.40, "defined": 0.65, "strong": 0.85,
    }
    jaw_prominence = gemini_general.get("jaw_prominence")
    if jaw_prominence and jaw_prominence in jaw_map:
        gemini_jaw = jaw_map[jaw_prominence]
        result["Face_JawLine"] = (
            result["Face_JawLine"] * (1 - (blend_weight * 0.65)) +
            gemini_jaw * (blend_weight * 0.65)
        )

    # eyebrow.thickness → Brow_WidthV 보정
    eyebrow = gemini_features.get("eyebrow", {})
    brow_thickness_map = {"thin": -0.3, "medium": 0.0, "thick": 0.3}
    thickness = eyebrow.get("thickness")
    if thickness and thickness in brow_thickness_map:
        result["Brow_WidthV"] = brow_thickness_map[thickness]

    return result
