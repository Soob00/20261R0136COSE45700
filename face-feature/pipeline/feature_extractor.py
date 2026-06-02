"""
Anime face feature extractor using hysts/anime-face-detector (ADF, 28-point).

ADF keypoint layout (28 points):
  0-4:   face contour  [left_edge, left_jaw, chin, right_jaw, right_edge]
  5-7:   right brow    [outer→inner]
  8-10:  left brow     [inner→outer]
  11-16: right eye     upper(11,12,13) + lower(14,15,16)
  17-22: left eye      upper(17,18,19) + lower(20,21,22)
  23:    nose tip
  24-27: mouth         [left_corner, top_center, right_corner, bottom_center]

Public API:
    extract_features(image)            -> FaceFeatureVector | None
    extract_features_full(image)       -> (FaceFeatureVector | None, dict | None, dict)
    visualize_landmarks(image)         -> PIL.Image
    compute_avatar_keys(kps, ...)      -> dict[str, float]   (re-exported)
"""

from __future__ import annotations

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import tempfile
import warnings
from importlib import reload

import cv2
import numpy as np
from dataclasses import dataclass, asdict, fields
from pathlib import Path
from PIL import Image

from adf_client import query_adf, ADF_KP_GROUPS
from avatar_keys import compute_avatar_keys
import avatar_keys as _avatar_keys_module
from geometry import _EPS, _map_01, _compute_cheek_from_side, _angle_at

warnings.filterwarnings("ignore")


# ---------------------------------------------------------------------------
# Public data type (FaceFeatureVector — used by template_selector)
# ---------------------------------------------------------------------------

@dataclass
class FaceFeatureVector:
    # ── Global proportions (9) ────────────────────────────────────────────
    eye_aspect_ratio: float
    eye_distance_ratio: float
    face_width_height_ratio: float
    nose_height_ratio: float
    nose_width_ratio: float
    mouth_width_ratio: float
    jaw_width_ratio: float
    forehead_ratio: float
    chin_ratio: float
    # ── Eye shape detail (10) ─────────────────────────────────────────────
    eye_width_ratio: float
    eye_height_ratio: float
    eye_rot: float
    eye_front_height: float
    eye_front_flat: float
    eye_tail_height: float
    eye_top_lid_flat: float
    eye_lower_lid_flat: float
    eye_top_lid_down: float
    eye_lower_lid_up: float
    # ── Brow (4) ──────────────────────────────────────────────────────────
    brow_dist_ratio: float
    brow_height_ratio: float
    brow_rot: float
    brow_width_ratio: float
    # ── Mouth detail (2) ──────────────────────────────────────────────────
    mouth_corner_ratio: float
    mouth_height_ratio: float
    # ── Nose detail (1) ───────────────────────────────────────────────────
    nose_under_nose_ratio: float

    def to_dict(self) -> dict:
        return asdict(self)

    def to_array(self) -> np.ndarray:
        return np.array([getattr(self, f.name) for f in fields(self)], dtype=np.float32)

    @classmethod
    def field_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_features(
    image,
    min_confidence: float = 0.4,
) -> "FaceFeatureVector | None":
    fv, *_ = extract_features_full(image, min_confidence)
    return fv


def extract_features_full(
    image,
    min_confidence: float = 0.4,
) -> "tuple[FaceFeatureVector | None, dict[str, float] | None, dict]":
    """Run ADF once; return (FaceFeatureVector, avatar_keys dict, raw debug dict)."""
    img_bgr        = _to_bgr(image)
    img_path, _tmp = _ensure_path(image, img_bgr)
    groups, _, kps_raw = _run_adf(img_bgr, img_path)
    if _tmp:
        try: os.unlink(_tmp)
        except OSError: pass
    if groups is None:
        return None, None

    depth = None
    _side_cheek_raw = None
    if isinstance(image, str):
        parent = Path(image).parent
        stem   = Path(image).stem
        front_d = parent / (stem + "_depth.npy")
        if front_d.is_file():
            depth = np.load(str(front_d)).astype(np.float32)
        for sp in (parent / "left_depth.npy", parent / "right_depth.npy"):
            if sp.is_file():
                r = _compute_cheek_from_side(
                    np.load(str(sp)).astype(np.float32), kps_raw, img_bgr.shape[0]
                )
                if r is not None and r >= 0.15:
                    _side_cheek_raw = (_side_cheek_raw or 0.0) + r
        if _side_cheek_raw is not None:
            _side_cheek_raw /= sum(
                1 for sp in (parent / "left_depth.npy", parent / "right_depth.npy")
                if sp.is_file()
            )

    fv      = _compute_features(groups)
    raw_out: dict = {}
    avatar_keys = compute_avatar_keys(kps_raw, _raw_out=raw_out, depth=depth, img_shape=img_bgr.shape[:2])

    if kps_raw is not None:
        raw_out["_adf_landmarks"] = [[float(p[0]), float(p[1])] for p in kps_raw]

    face_cheek_2d_raw = raw_out.get("Face_Cheek")

    if _side_cheek_raw is not None:
        avatar_keys["Face_Cheek"] = 0.0
        raw_out["Face_Cheek"] = {"value": _side_cheek_raw, "source": "renderer/depth"}
    else:
        raw_out["Face_Cheek"] = {"value": face_cheek_2d_raw, "source": "adf/2d_proxy"}

    return fv, avatar_keys, raw_out


def visualize_measurements(
    image,
    save_path: "str | None" = None,
) -> Image.Image:
    """Draw measurement lines with raw→normalized values and calibration range indicators.

    Automatically loads front_depth.npy from the same directory if available
    (enables accurate Face_Roundness / Face_JawLine / Face_Cheek from 3D renders).
    """
    img_bgr        = _to_bgr(image)
    img_path, _tmp = _ensure_path(image, img_bgr)
    groups, face_bbox, kps_raw = _run_adf(img_bgr, img_path)
    if _tmp:
        try: os.unlink(_tmp)
        except OSError: pass
    if groups is None:
        return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))

    # depth 자동 로드 (renders/front_depth.npy 옆에 있으면 사용)
    depth = None
    img_shape = None
    if isinstance(image, str):
        depth_path = Path(image).parent / "front_depth.npy"
        if depth_path.is_file():
            depth = np.load(str(depth_path))
            img_shape = (img_bgr.shape[0], img_bgr.shape[1])

    # Pull the freshest avatar key definitions so long-lived IDE sessions do
    # not show stale calibration ranges in measurement overlays.
    avatar_keys_module = reload(_avatar_keys_module)
    compute_avatar_keys_current = avatar_keys_module.compute_avatar_keys
    _all_calib = {
        **avatar_keys_module.SIGNED_CALIBRATION,
        **avatar_keys_module.MAP01_CALIBRATION,
    }

    raw_out: dict = {}
    avatar_keys: dict = {}
    if kps_raw is not None:
        avatar_keys = compute_avatar_keys_current(
            kps_raw, _raw_out=raw_out, depth=depth, img_shape=img_shape
        )

    _depth_available = depth is not None

    vis = img_bgr.copy()
    eps = _EPS

    fc   = groups["face_contour"]
    F0   = np.array(fc[0]); F2 = np.array(fc[2]); F4 = np.array(fc[4])
    face_w       = float(np.linalg.norm(F4 - F0))
    lower_face_h = float(np.linalg.norm((F0 + F4) / 2.0 - F2))
    face_scale   = max(0.75 * face_w + 0.25 * lower_face_h, 1.0)

    def pt(p):
        return (int(float(p[0])), int(float(p[1])))

    def midp(a, b):
        return ((float(a[0])+float(b[0]))/2.0, (float(a[1])+float(b[1]))/2.0)

    def _raw_val(key):
        v = raw_out.get(key)
        if isinstance(v, dict):
            v = v.get("value")
        return float(v) if v is not None else None

    def _line_color(key: str) -> tuple:
        raw = _raw_val(key)
        if raw is None or key not in _all_calib:
            return (180, 180, 180)
        lo, hi = _all_calib[key]
        return (60, 200, 60) if lo <= raw <= hi else (50, 50, 220)


    # lbl_anchor: "left"|"right"|"mid", lbl_side: "above"|"below"
    def mline(p1, p2, color, label="", thick=1,
              lbl_anchor="mid", lbl_side="above", lbl_dx=4):
        cv2.line(vis, pt(p1), pt(p2), color, thick)
        if not label:
            return
        x1, y1 = float(p1[0]), float(p1[1])
        x2, y2 = float(p2[0]), float(p2[1])
        if lbl_anchor == "left":
            bx, by = x1, y1
        elif lbl_anchor == "right":
            bx, by = x2, y2
        else:
            bx, by = (x1+x2)/2.0, (y1+y2)/2.0
        oy = -14 if lbl_side == "above" else 12
        cv2.putText(vis, label, (int(bx)+lbl_dx, int(by)+oy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.32, color, 1)

    def key_label(key: str) -> tuple[str, tuple]:
        raw = _raw_val(key)
        val = avatar_keys.get(key)
        col = _line_color(key)
        if raw is None:
            return f"{key}", col
        if key in _all_calib:
            lo, hi = _all_calib[key]
            v_str = f"{val:+.2f}" if val is not None else "?"
            return f"{key} {raw:.3f}[{lo:.2f}~{hi:.2f}]={v_str}", col
        return f"{key} raw={raw:.3f}", col

    # ── Face geometry (no calibration key) ───────────────────────────────
    # face_w: 왼쪽 끝에, 위
    mline(fc[0], fc[4], (0, 210, 210),
          f"face_w/scale={face_w/face_scale:.3f}", thick=2,
          lbl_anchor="left", lbl_side="above", lbl_dx=4)
    # lower face height: 수직선 → 오른쪽에 레이블
    top_mid = midp(fc[0], fc[4])
    mline(top_mid, fc[2], (210, 170, 0),
          f"lface_h/scale={lower_face_h/face_scale:.3f}", thick=2,
          lbl_anchor="mid", lbl_side="above", lbl_dx=6)

    # ── Jaw → Face_ChinWidth: 왼쪽 끝, 아래 ──────────────────────────────
    lbl, col = key_label("Face_ChinWidth")
    mline(fc[1], fc[3], col, lbl, thick=2,
          lbl_anchor="left", lbl_side="below", lbl_dx=4)

    # ── Eye labeling ─────────────────────────────────────────────────────
    r_eye_pts = groups["right_eye"]
    l_eye_pts = groups["left_eye"]
    r_outer, r_inner, r_top, r_bot = _auto_label_eye(r_eye_pts, is_right=True)
    l_outer, l_inner, l_top, l_bot = _auto_label_eye(l_eye_pts, is_right=False)

    # ── Eye_Width: 오른쪽 눈 선 왼쪽 끝, 위 ─────────────────────────────
    lbl, col = key_label("Eye_Width")
    mline(r_outer, r_inner, col, lbl, thick=1,
          lbl_anchor="left", lbl_side="above", lbl_dx=2)
    mline(l_outer, l_inner, col, thick=1)

    # ── Eye_Dist: 오른쪽 끝, 아래 ────────────────────────────────────────
    R_corner = midp(r_eye_pts[2], r_eye_pts[5])
    L_corner = midp(l_eye_pts[0], l_eye_pts[3])
    lbl, col = key_label("Eye_Dist")
    mline(R_corner, L_corner, col, lbl, thick=2,
          lbl_anchor="right", lbl_side="below", lbl_dx=-len(lbl)*5)
    cv2.circle(vis, pt(R_corner), 4, col, -1)
    cv2.circle(vis, pt(L_corner), 4, col, -1)

    # ── Brow_Height: 수직선 → 오른쪽에 레이블 ────────────────────────────
    r_brow = groups["right_brow"]
    l_brow = groups["left_brow"]
    r_brow_mid = (sum(p[0] for p in r_brow)/3.0, sum(p[1] for p in r_brow)/3.0)
    l_brow_mid = (sum(p[0] for p in l_brow)/3.0, sum(p[1] for p in l_brow)/3.0)
    brow_mean = midp(r_brow_mid, l_brow_mid)
    lbl, col = key_label("Brow_Height")
    mline(brow_mean, fc[2], col, lbl, thick=2,
          lbl_anchor="mid", lbl_side="below", lbl_dx=6)
    cv2.circle(vis, pt(brow_mean), 5, col, -1)

    # ── Brow_Dist: x거리만 측정 → 수평선으로 표시 ───────────────────────
    r_brow_by_x = sorted(r_brow, key=lambda p: p[0])
    l_brow_by_x = sorted(l_brow, key=lambda p: p[0])
    r_brow_inner = r_brow_by_x[-1]
    l_brow_inner = l_brow_by_x[0]
    # 수평선: y는 두 점의 평균 y 사용 (실제 측정은 x 차이만)
    brow_mid_y = (float(r_brow_inner[1]) + float(l_brow_inner[1])) / 2.0
    r_brow_inner_h = (float(r_brow_inner[0]), brow_mid_y)
    l_brow_inner_h = (float(l_brow_inner[0]), brow_mid_y)
    lbl, col = key_label("Brow_Dist")
    mline(r_brow_inner_h, l_brow_inner_h, col, lbl, thick=1,
          lbl_anchor="mid", lbl_side="above", lbl_dx=4)
    # 원래 점 위치도 표시
    cv2.circle(vis, pt(r_brow_inner), 3, col, -1)
    cv2.circle(vis, pt(l_brow_inner), 3, col, -1)

    # ── Mouth_Width: 왼쪽 끝, 아래 ───────────────────────────────────────
    mp = groups["mouth"]
    lbl, col = key_label("Mouth_Width")
    mline(mp[0], mp[2], col, lbl, thick=1,
          lbl_anchor="left", lbl_side="below", lbl_dx=4)

    # ── Forehead proxy: 오른쪽, 위 ───────────────────────────────────────
    eye_center_y = ((r_top[1]+r_bot[1])/2.0 + (l_top[1]+l_bot[1])/2.0) / 2.0
    eye_center_x = (float(r_inner[0]) + float(l_inner[0])) / 2.0
    nose = groups["nose"][0]
    fore_raw = (float(nose[1]) - eye_center_y) / (face_scale + eps)
    mline((eye_center_x, eye_center_y), nose, (190, 0, 190),
          f"fore={fore_raw:.3f}", thick=1,
          lbl_anchor="mid", lbl_side="above", lbl_dx=6)
    cv2.circle(vis, pt((eye_center_x, eye_center_y)), 4, (190, 0, 190), -1)

    # ── Face contour polygon (kp0→1→2→3→4) ──────────────────────────────
    fc_col = (160, 160, 0)
    for i in range(len(fc) - 1):
        cv2.line(vis, pt(fc[i]), pt(fc[i+1]), fc_col, 1)

    # ── Chin angle arc at F2 (kp2) ────────────────────────────────────────
    F1_pt = np.array(fc[1]); F3_pt = np.array(fc[3])
    chin_angle = _angle_at(F1_pt, F2, F3_pt)
    jaw_val   = avatar_keys.get("Face_JawLine", 0.0)
    round_val = avatar_keys.get("Face_Roundness", 0.0)

    # arc: vectors from F2 toward F1 and F3
    v1 = F1_pt - F2; v3 = F3_pt - F2
    ang1_deg = float(np.degrees(np.arctan2(float(v1[1]), float(v1[0]))))
    ang3_deg = float(np.degrees(np.arctan2(float(v3[1]), float(v3[0]))))
    arc_r = max(20, int(face_w * 0.10))
    a_start = int(min(ang1_deg, ang3_deg))
    a_end   = int(max(ang1_deg, ang3_deg))
    # JawLine: 낮을수록 둥근 턱(=각도 넓음), 높을수록 날카로운 턱(=각도 좁음)
    jaw_col = (60, 200, 60) if jaw_val >= 0.4 else (50, 50, 220)
    cv2.ellipse(vis, pt(F2), (arc_r, arc_r), 0, a_start, a_end, jaw_col, 2)

    # chin_angle 레이블 — F2 위 / 오른쪽
    lx = int(float(F2[0])) + arc_r + 4
    ly = int(float(F2[1])) - 10
    cv2.putText(vis, f"chin={chin_angle:.0f}deg", (lx, ly),
                cv2.FONT_HERSHEY_SIMPLEX, 0.33, jaw_col, 1)
    cv2.putText(vis, f"JawLine={jaw_val:.2f}", (lx, ly+14),
                cv2.FONT_HERSHEY_SIMPLEX, 0.33, jaw_col, 1)
    cv2.putText(vis, f"Roundness={round_val:.2f}", (lx, ly+28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.33, (180, 120, 60), 1)

    # ── Side panel: all avatar keys with raw / normalized / range ─────────
    h_img, w_img = vis.shape[:2]
    pad = 255
    panel_h = max(h_img, 30 + len(avatar_keys) * 17 + 20)
    canvas = np.full((panel_h, w_img + pad, 3), 20, dtype=np.uint8)
    canvas[:h_img, :w_img] = vis

    depth_tag = "[depth: ON]" if _depth_available else "[depth: OFF - 2D only]"
    depth_col = (80, 200, 80) if _depth_available else (60, 60, 200)
    cv2.putText(canvas, depth_tag, (w_img + 4, 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.33, depth_col, 1)
    cv2.putText(canvas, "KEY              raw    lo~hi      val",
                (w_img + 4, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (180, 180, 80), 1)
    cv2.line(canvas, (w_img + 4, 27), (w_img + pad - 4, 27), (80, 80, 80), 1)

    sorted_keys = sorted(avatar_keys.keys())
    for i, k in enumerate(sorted_keys):
        val = avatar_keys[k]
        raw = _raw_val(k)
        y = 38 + i * 17

        if raw is not None and k in _all_calib:
            lo, hi = _all_calib[k]
            in_r = lo <= raw <= hi
            col = (70, 200, 70) if in_r else (60, 60, 220)
            lo_str = f"{lo:.3f}"
            hi_str = f"{hi:.3f}"
            out_mark = "" if in_r else "!"
            text = f"{k:<18} {raw:+.3f}  {lo_str}~{hi_str}  {val:+.3f} {out_mark}"
        elif raw is None and k not in _all_calib:
            col = (130, 130, 130)
            text = f"{k:<18} {'--':>6}  fixed        {val:+.3f}"
        else:
            col = (160, 160, 160)
            raw_str = f"{raw:+.3f}" if raw is not None else "  --"
            text = f"{k:<18} {raw_str}  --            {val:+.3f}"

        cv2.putText(canvas, text, (w_img + 4, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.32, col, 1)

    img = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
    if save_path:
        img.save(save_path)
    return img


def visualize_landmarks(
    image,
    save_path: "str | None" = None,
    kps_list: "list | None" = None,
) -> Image.Image:
    img_bgr = _to_bgr(image)
    face_bbox = None
    if kps_list is not None:
        lm_px = [(float(p[0]), float(p[1])) for p in kps_list]
        groups = {r: [lm_px[i] for i in idx] for r, idx in ADF_KP_GROUPS.items()}
    else:
        img_path, _tmp = _ensure_path(image, img_bgr)
        groups, face_bbox, _ = _run_adf(img_bgr, img_path)
        if _tmp:
            try: os.unlink(_tmp)
            except OSError: pass
    if groups is None:
        return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))

    vis = img_bgr.copy()
    if face_bbox is not None:
        x1, y1, x2, y2 = [int(v) for v in face_bbox]
        cv2.rectangle(vis, (x1, y1), (x2, y2), (180, 180, 180), 1)

    _COLORS = {
        "face_contour": (120, 120, 120),
        "right_eye": (0, 255, 255), "left_eye": (0, 255, 255),
        "right_brow": (0, 165, 255), "left_brow": (0, 165, 255),
        "nose": (255, 200, 0), "mouth": (0, 80, 255),
    }

    fc = [_ipt(p) for p in groups["face_contour"]]
    for pt in fc:
        cv2.circle(vis, pt, 3, _COLORS["face_contour"], -1)
    for i in range(len(fc) - 1):
        cv2.line(vis, fc[i], fc[i + 1], _COLORS["face_contour"], 1)

    for side in ("right_brow", "left_brow"):
        pts = [_ipt(p) for p in groups[side]]
        for pt in pts: cv2.circle(vis, pt, 3, _COLORS[side], -1)
        for i in range(len(pts) - 1): cv2.line(vis, pts[i], pts[i+1], _COLORS[side], 1)

    for eye_key in ("right_eye", "left_eye"):
        pts = [_ipt(p) for p in groups[eye_key]]
        upper, lower = pts[:3], pts[3:]
        for pt in upper: cv2.circle(vis, pt, 3, (0, 255, 80), -1)
        for i in range(len(upper) - 1): cv2.line(vis, upper[i], upper[i+1], (0, 255, 80), 1)
        for pt in lower: cv2.circle(vis, pt, 3, (255, 180, 0), -1)
        for i in range(len(lower) - 1): cv2.line(vis, lower[i], lower[i+1], (255, 180, 0), 1)

    cv2.circle(vis, _ipt(groups["nose"][0]), 4, _COLORS["nose"], -1)
    mp = [_ipt(p) for p in groups["mouth"]]
    for pt in mp: cv2.circle(vis, pt, 3, _COLORS["mouth"], -1)
    for a, b in [(0,1),(1,2),(2,3),(3,0)]:
        cv2.line(vis, mp[a], mp[b], _COLORS["mouth"], 1)

    n = 0
    for region in ("face_contour","right_brow","left_brow","right_eye","left_eye","nose","mouth"):
        for pt in groups[region]:
            x, y = int(pt[0]), int(pt[1])
            cv2.putText(vis, str(n), (x+3, y-3), cv2.FONT_HERSHEY_SIMPLEX, 0.28,
                        _COLORS.get(region, (255,255,255)), 1)
            n += 1

    img = Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
    if save_path:
        img.save(save_path)
    return img


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _run_adf(img_bgr: np.ndarray, img_path: "str | None"):
    """Returns (groups, face_bbox, kps_raw) or (None, None, None)."""
    if img_path is None:
        return None, None, None
    result = query_adf(img_path, img_bgr)
    if result is None:
        return None, None, None
    bbox_raw, kps = result
    h, w = img_bgr.shape[:2]
    face_bbox = (
        max(float(bbox_raw[0]), 0.0), max(float(bbox_raw[1]), 0.0),
        min(float(bbox_raw[2]), float(w)), min(float(bbox_raw[3]), float(h)),
    )
    lm_px  = [(float(kp[0]), float(kp[1])) for kp in kps[:28]]
    groups = {r: [lm_px[i] for i in idx] for r, idx in ADF_KP_GROUPS.items()}
    return groups, face_bbox, lm_px


def _ensure_path(image, img_bgr: np.ndarray) -> "tuple[str | None, str | None]":
    if isinstance(image, str):
        return image, None
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    cv2.imwrite(tmp.name, img_bgr)
    return tmp.name, tmp.name


def _to_bgr(image) -> np.ndarray:
    if isinstance(image, str):
        img = cv2.imdecode(np.fromfile(image, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(f"Image not found: {image}")
        return img
    if isinstance(image, Image.Image):
        return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    return image


def _ipt(p) -> tuple:
    return (int(p[0]), int(p[1]))


def _dist(a, b) -> float:
    return float(np.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1])))


def _auto_label_eye(eye_pts, is_right: bool):
    by_x = sorted(eye_pts, key=lambda p: p[0])
    by_y = sorted(eye_pts, key=lambda p: p[1])
    outer  = by_x[0]  if is_right else by_x[-1]
    inner  = by_x[-1] if is_right else by_x[0]
    return outer, inner, by_y[0], by_y[-1]


# ---------------------------------------------------------------------------
# FaceFeatureVector computation (template_selector cosine similarity)
# ---------------------------------------------------------------------------

def _compute_features(groups: dict) -> FaceFeatureVector:
    eps = _EPS
    fc    = groups["face_contour"]
    F0    = np.array(fc[0]);  F2 = np.array(fc[2]);  F4 = np.array(fc[4])
    face_w       = float(np.linalg.norm(F4 - F0))
    lower_face_h = float(np.linalg.norm((F0 + F4) / 2.0 - F2))
    face_scale   = max(0.75 * face_w + 0.25 * lower_face_h, 1.0)
    face_mid_y   = float(((F0[1] + F4[1]) / 2.0 + F2[1]) / 2.0)

    r_eye_pts = groups["right_eye"]
    l_eye_pts = groups["left_eye"]
    r_upper, r_lower = r_eye_pts[:3], r_eye_pts[3:]
    l_upper, l_lower = l_eye_pts[:3], l_eye_pts[3:]

    r_outer, r_inner, r_top, r_bot = _auto_label_eye(r_eye_pts, is_right=True)
    l_outer, l_inner, l_top, l_bot = _auto_label_eye(l_eye_pts, is_right=False)

    r_eye_w = _dist(r_outer, r_inner)
    l_eye_w = _dist(l_outer, l_inner)
    r_h = max(float(max(p[1] for p in r_lower) - min(p[1] for p in r_upper)), eps)
    l_h = max(float(max(p[1] for p in l_lower) - min(p[1] for p in l_upper)), eps)

    eye_ar = (r_h / (r_eye_w + eps) + l_h / (l_eye_w + eps)) / 2.0

    R_right_corner = ((r_eye_pts[2][0]+r_eye_pts[5][0])/2.0, (r_eye_pts[2][1]+r_eye_pts[5][1])/2.0)
    L_left_corner  = ((l_eye_pts[0][0]+l_eye_pts[3][0])/2.0, (l_eye_pts[0][1]+l_eye_pts[3][1])/2.0)
    eye_dist_ratio  = _dist(R_right_corner, L_left_corner) / (face_w + eps)
    eye_width_ratio = ((r_eye_w + l_eye_w) / 2.0) / (face_w + eps)
    eye_center_y    = ((r_top[1]+r_bot[1])/2.0 + (l_top[1]+l_bot[1])/2.0) / 2.0
    eye_height_ratio = (face_mid_y - eye_center_y) / (face_scale + eps)
    eye_rot = (
        (r_outer[1]-r_inner[1])/(r_eye_w+eps) + (l_outer[1]-l_inner[1])/(l_eye_w+eps)
    ) / 2.0

    r_mid_y = (r_top[1]+r_bot[1]) / 2.0
    l_mid_y = (l_top[1]+l_bot[1]) / 2.0
    eye_front_height = ((r_inner[1]-r_mid_y)/(r_h+eps) + (l_inner[1]-l_mid_y)/(l_h+eps)) / 2.0
    eye_tail_height  = ((r_outer[1]-r_mid_y)/(r_h+eps) + (l_outer[1]-l_mid_y)/(l_h+eps)) / 2.0

    def _flat(pts, h):
        ys = [p[1] for p in pts]
        return float(max(0.0, min(1.0, 1.0 - (max(ys)-min(ys)) / (h+eps))))

    def _inner_flat(upper_pts, inner_x, outer_x, h):
        mid_x = (inner_x + outer_x) / 2.0
        half  = [p for p in upper_pts if (p[0]>=mid_x if inner_x>outer_x else p[0]<=mid_x)]
        return _flat(half or upper_pts, h)

    eye_top_lid_flat   = (_flat(r_upper, r_h) + _flat(l_upper, l_h)) / 2.0
    eye_lower_lid_flat = (_flat(r_lower, r_h) + _flat(l_lower, l_h)) / 2.0
    eye_front_flat = (
        _inner_flat(r_upper, r_inner[0], r_outer[0], r_h)
        + _inner_flat(l_upper, l_inner[0], l_outer[0], l_h)
    ) / 2.0
    eye_top_lid_down = (
        max(0.0, min(1.0, (max(p[1] for p in r_upper)-r_top[1])/(r_h+eps)))
        + max(0.0, min(1.0, (max(p[1] for p in l_upper)-l_top[1])/(l_h+eps)))
    ) / 2.0
    eye_lower_lid_up = (
        max(0.0, min(1.0, (r_bot[1]-min(p[1] for p in r_lower))/(r_h+eps)))
        + max(0.0, min(1.0, (l_bot[1]-min(p[1] for p in l_lower))/(l_h+eps)))
    ) / 2.0

    r_brow_by_x  = sorted(groups["right_brow"], key=lambda p: p[0])
    l_brow_by_x  = sorted(groups["left_brow"],  key=lambda p: p[0])
    r_brow_outer = r_brow_by_x[0];  r_brow_inner = r_brow_by_x[-1]
    l_brow_outer = l_brow_by_x[-1]; l_brow_inner = l_brow_by_x[0]
    r_brow_w = _dist(r_brow_outer, r_brow_inner)
    l_brow_w = _dist(l_brow_outer, l_brow_inner)

    brow_dist_ratio   = (l_brow_inner[0]-r_brow_inner[0]) / (face_w+eps)
    brow_mean_y       = (sum(p[1] for p in groups["right_brow"])/3
                         + sum(p[1] for p in groups["left_brow"])/3) / 2.0
    brow_height_ratio = (min(float(r_top[1]),float(l_top[1])) - brow_mean_y) / (face_scale+eps)
    brow_rot = (
        (r_brow_outer[1]-r_brow_inner[1])/(r_brow_w+eps)
        + (l_brow_outer[1]-l_brow_inner[1])/(l_brow_w+eps)
    ) / 2.0
    brow_width_ratio = ((r_brow_w+l_brow_w)/2.0) / (face_w+eps)

    nose_tip      = groups["nose"][0]
    nose_tip_y    = float(nose_tip[1])
    nose_bridge_y = (float(max(p[1] for p in r_lower))+float(max(p[1] for p in l_lower)))/2.0
    nose_h_ratio  = (nose_tip_y - nose_bridge_y) / (face_scale+eps)
    nose_w_ratio  = eye_dist_ratio * 0.65

    mouth_l, mouth_top, mouth_r, mouth_bot = groups["mouth"]
    mouth_w_ratio      = _dist(mouth_l, mouth_r) / (face_w+eps)
    mouth_center_y     = (float(mouth_top[1])+float(mouth_bot[1])) / 2.0
    mouth_corner_y     = (float(mouth_l[1])+float(mouth_r[1])) / 2.0
    mouth_corner_ratio = (mouth_center_y - mouth_corner_y) / (face_scale+eps)
    mouth_height_ratio = (mouth_center_y - face_mid_y) / (face_scale+eps)
    nose_under_nose_ratio = (float(mouth_top[1]) - nose_tip_y) / (face_scale+eps)

    jaw_w_ratio    = (float(fc[3][0])-float(fc[1][0])) / (face_w+eps)
    forehead_ratio = (nose_tip_y - eye_center_y) / (face_scale+eps)
    chin_ratio     = (float(fc[2][1]) - nose_tip_y) / (face_scale+eps)

    return FaceFeatureVector(
        eye_aspect_ratio=float(eye_ar),
        eye_distance_ratio=float(eye_dist_ratio),
        face_width_height_ratio=float(face_w/face_scale),
        nose_height_ratio=float(nose_h_ratio),
        nose_width_ratio=float(nose_w_ratio),
        mouth_width_ratio=float(mouth_w_ratio),
        jaw_width_ratio=float(jaw_w_ratio),
        forehead_ratio=float(forehead_ratio),
        chin_ratio=float(chin_ratio),
        eye_width_ratio=float(eye_width_ratio),
        eye_height_ratio=float(eye_height_ratio),
        eye_rot=float(eye_rot),
        eye_front_height=float(eye_front_height),
        eye_front_flat=float(eye_front_flat),
        eye_tail_height=float(eye_tail_height),
        eye_top_lid_flat=float(eye_top_lid_flat),
        eye_lower_lid_flat=float(eye_lower_lid_flat),
        eye_top_lid_down=float(eye_top_lid_down),
        eye_lower_lid_up=float(eye_lower_lid_up),
        brow_dist_ratio=float(brow_dist_ratio),
        brow_height_ratio=float(brow_height_ratio),
        brow_rot=float(brow_rot),
        brow_width_ratio=float(brow_width_ratio),
        mouth_corner_ratio=float(mouth_corner_ratio),
        mouth_height_ratio=float(mouth_height_ratio),
        nose_under_nose_ratio=float(nose_under_nose_ratio),
    )
