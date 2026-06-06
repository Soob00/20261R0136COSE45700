"""
마스터 텍스처를 features.json 기반으로 HSV 색조 보정 + 특징 반영.
원본 RGBA PNG의 알파 채널을 그대로 유지.

Usage:
  python3 adjust_texture.py \
    --features features.json \
    --input_dir assets/textures \
    --output_dir adjusted_textures
"""
import cv2
import numpy as np
import json
import os
import shutil
import argparse
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from landmark_utils import (
    marking_to_uv_coords,
    blush_to_img_coords,
    img_to_uv
)


def load_features(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_rgba(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    return img


def adjust_hue(
    texture_bgra: np.ndarray,
    target_rgb: list,
    opacity: float = 1.0
) -> np.ndarray:
    """
    알파 > 0인 영역의 Hue/Saturation을 target_rgb 기준으로 보정.
    opacity로 보정 강도 조절 (0.0 = 원본 유지, 1.0 = 완전 보정).
    """
    result = texture_bgra.copy()
    bgr = texture_bgra[:, :, :3]
    alpha = texture_bgra[:, :, 3]

    hsv_orig = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv_new = hsv_orig.copy()

    target_bgr = np.uint8([[[target_rgb[2], target_rgb[1], target_rgb[0]]]])
    target_hsv = cv2.cvtColor(target_bgr, cv2.COLOR_BGR2HSV)[0][0].astype(np.float32)

    ys, xs = np.where(alpha > 0)
    if len(ys) == 0:
        return result

    region = hsv_orig[ys, xs]
    orig_s_mean = np.mean(region[:, 1]) + 1e-6

    hsv_new[ys, xs, 0] = target_hsv[0]

    # 원본 채도가 낮을 때(무채색에 가까울 때) 타겟 채도를 직접 적용
    # 비율 곱셈 대신 원본 채도 + 타겟 채도 블렌딩으로 처리
    if orig_s_mean < 30:
        # 채도 낮은 경우: 타겟 채도를 opacity 비율로 직접 추가
        hsv_new[ys, xs, 1] = np.clip(
            region[:, 1] + target_hsv[1] * opacity * 0.5, 0, 255
        )
    else:
        hsv_new[ys, xs, 1] = np.clip(
            region[:, 1] * (target_hsv[1] / orig_s_mean), 0, 255
        )

    # opacity 블렌딩
    hsv_blended = hsv_orig.copy()
    hsv_blended[ys, xs] = (
        hsv_orig[ys, xs] * (1 - opacity) + hsv_new[ys, xs] * opacity
    )

    new_bgr = cv2.cvtColor(hsv_blended.astype(np.uint8), cv2.COLOR_HSV2BGR)
    result[:, :, :3] = new_bgr
    result[:, :, 3] = alpha
    return result


# UV 좌표 상수 (UV_Face.png 실측 + uv_grid 시각 확인 기반)
# 눈 구멍: Y=0.541 (실측), 좌X=0.341, 우X=0.657
# 볼터치:  Y=0.62, X=0.25(좌)/0.75(우) (시각 확인)
# 점:      Y=0.64, X=0.33(좌)/0.67(우) (시각 확인)
# 코:      Y=0.66 (실측)
# 입:      Y=0.76 (실측)
UV_FACE = {
    "eye_y":          0.541,
    "eye_left_x":     0.341,
    "eye_right_x":    0.657,
    "cheek_high_y":   0.600,
    "cheek_center_y": 0.620,  # 확정값
    "cheek_low_y":    0.645,
    "cheek_left_x":   0.250,  # 확정값
    "cheek_right_x":  0.750,  # 확정값
    "nose_y":         0.660,
    "mouth_y":        0.760,
}

# 정면 얼굴 → UV Y 좌표 보간 앵커
# 정면 기준점: 눈=0.40, 볼=0.65, 코=0.67, 입=0.75
# UV 실측값:   눈=0.541, 볼=0.620, 코=0.660, 입=0.760
_FACE_Y_ANCHORS = [0.00,  0.40,  0.65,  0.67,  0.75,  1.00]
_UV_Y_ANCHORS   = [0.30,  0.541, 0.620, 0.660, 0.760, 0.95]

def face_to_uv(x_ratio: float, y_ratio: float) -> tuple:
    """
    정면 얼굴 비율(0~1) → Face UV 좌표 변환.
    실측 앵커 기반 선형 보간.
    """
    uv_y = float(np.interp(y_ratio, _FACE_Y_ANCHORS, _UV_Y_ANCHORS))
    uv_x = x_ratio
    return uv_x, uv_y


def add_blush(
    texture_bgra: np.ndarray,
    blush_color_rgb: list,
    blush_opacity: float,
    position: str,
    lm: list,
    img_w: int = 1024,
    img_h: int = 1024
) -> np.ndarray:
    """볼터치 오버레이 추가 — landmark 기반 UV 좌표"""
    result = texture_bgra.copy()
    h, w = result.shape[:2]

    # UV 고정 좌표 직접 사용 (이미지 좌표 변환 불필요)
    from landmark_utils import blush_to_uv_coords
    luv, ruv = blush_to_uv_coords(position)

    centers = [
        (int(luv[0] * w), int(luv[1] * h)),
        (int(ruv[0] * w), int(ruv[1] * h)),
    ]

    blush_bgr = (blush_color_rgb[2], blush_color_rgb[1], blush_color_rgb[0])
    radius_x = int(w * 0.07)
    radius_y = int(h * 0.05)

    # 볼터치 마스크 생성 (볼터치 영역만 따로)
    blush_mask = np.zeros((h, w), dtype=np.float32)
    for cx, cy in centers:
        cv2.ellipse(blush_mask, (cx, cy), (radius_x, radius_y), 0, 0, 360, 1.0, -1)

    kernel_size = int(w * 0.12) | 1
    blush_mask_blurred = cv2.GaussianBlur(blush_mask, (kernel_size, kernel_size), 0)
    blush_mask_blurred = np.clip(blush_mask_blurred * blush_opacity, 0, 1)

    alpha = result[:, :, 3]
    valid = alpha > 0

    # 볼터치 색상 배열 생성
    blush_layer = np.full((h, w, 3), blush_bgr, dtype=np.float32)

    # 볼터치 마스크 영역에서만 원본과 블렌딩
    mask_3ch = blush_mask_blurred[:, :, np.newaxis]
    result[:, :, :3] = np.where(
        (mask_3ch > 0) & (alpha[:, :, np.newaxis] > 0),
        np.clip(
            result[:, :, :3].astype(np.float32) * (1 - mask_3ch) +
            blush_layer * mask_3ch,
            0, 255
        ).astype(np.uint8),
        result[:, :, :3]
    )

    return result


def add_markings(
    texture_bgra: np.ndarray,
    markings: list,
    lm: list,
    img_w: int = 1024,
    img_h: int = 1024
) -> np.ndarray:
    """점/문양 추가 — landmark 기반 UV 좌표"""
    result = texture_bgra.copy()
    h, w = result.shape[:2]

    size_radius = {"tiny": 3, "small": 5, "medium": 8, "large": 12}

    # 같은 reference를 가진 left/right 쌍의 UV Y를 평균으로 대칭화
    uv_coords = {}
    for marking in markings:
        uv_x, uv_y = marking_to_uv_coords(marking, lm, img_w, img_h)
        uv_coords[id(marking)] = (uv_x, uv_y)

    # reference별로 left/right 쌍 찾아서 Y 평균화
    ref_groups = {}
    for marking in markings:
        ref = marking.get("reference", "")
        side = marking.get("side", "center")
        if side in ("left", "right"):
            if ref not in ref_groups:
                ref_groups[ref] = {}
            ref_groups[ref][side] = marking

    for ref, sides in ref_groups.items():
        if "left" in sides and "right" in sides:
            l_uv = uv_coords[id(sides["left"])]
            r_uv = uv_coords[id(sides["right"])]
            avg_y = (l_uv[1] + r_uv[1]) / 2
            uv_coords[id(sides["left"])]  = (l_uv[0], avg_y)
            uv_coords[id(sides["right"])] = (r_uv[0], avg_y)

    for marking in markings:
        uv_x, uv_y = uv_coords[id(marking)]
        cx = int(uv_x * w)
        cy = int(uv_y * h)
        color_rgb = marking.get("color", [40, 20, 20])
        color_bgra = (color_rgb[2], color_rgb[1], color_rgb[0], 255)
        r = size_radius.get(marking.get("size", "tiny"), 3)
        mtype = marking.get("type", "mole")

        if mtype == "mole":
            cv2.circle(result, (cx, cy), r, color_bgra, -1)
            cv2.circle(result, (cx, cy), r + 2, (*color_bgra[:3], 60), 1)

        elif mtype == "star":
            pts = []
            for i in range(5):
                angle = np.radians(i * 72 - 90)
                pts.append([cx + int(r * 2 * np.cos(angle)),
                             cy + int(r * 2 * np.sin(angle))])
                angle2 = np.radians(i * 72 - 90 + 36)
                pts.append([cx + int(r * np.cos(angle2)),
                             cy + int(r * np.sin(angle2))])
            cv2.fillPoly(result, [np.array(pts)], color_bgra)

        elif mtype == "teardrop":
            cv2.circle(result, (cx, cy), r, color_bgra, -1)
            tip = np.array([[cx, cy + r * 3], [cx - r, cy], [cx + r, cy]])
            cv2.fillPoly(result, [tip], color_bgra)

        elif mtype in ["triangle", "diamond"]:
            if mtype == "triangle":
                pts = np.array([[cx, cy - r*2], [cx - r, cy + r], [cx + r, cy + r]])
            else:
                pts = np.array([[cx, cy - r*2], [cx + r, cy], [cx, cy + r*2], [cx - r, cy]])
            cv2.fillPoly(result, [pts], color_bgra)

        else:
            # 기타: 작은 원으로 fallback
            cv2.circle(result, (cx, cy), r, color_bgra, -1)

    return result


def adjust_face(texture_bgra: np.ndarray, features: dict, lm: list = None, img_w: int = 1024, img_h: int = 1024) -> np.ndarray:
    face = features["face"]
    result = adjust_hue(texture_bgra, face["skin_tone"])

    if lm and face.get("blush_present"):
        result = add_blush(
            result,
            face["blush_color"],
            face.get("blush_opacity", 0.6),
            face.get("blush_position", "cheek_center"),
            lm, img_w, img_h
        )

    if lm and face.get("markings"):
        result = add_markings(result, face["markings"], lm, img_w, img_h)

    return result


def adjust_eyebrow(texture_bgra: np.ndarray, features: dict) -> np.ndarray:
    eyebrow = features["eyebrow"]
    opacity = eyebrow.get("opacity", 1.0)
    result = adjust_hue(texture_bgra, eyebrow["color"], opacity)
    return result


def add_face_eyeshadow(
    texture_bgra: np.ndarray,
    eyeline_features: dict,
) -> np.ndarray:
    """아이섀도우를 Face 텍스처의 눈 주변 UV 영역에 타원형 오버레이로 렌더링."""
    result = texture_bgra.copy()
    h, w = result.shape[:2]
    alpha = result[:, :, 3]

    color_rgb = eyeline_features.get("eyeshadow_color", [180, 160, 180])
    opacity   = eyeline_features.get("eyeshadow_opacity", 0.5)
    position  = eyeline_features.get("eyeshadow_position", "lid_only")

    shadow_bgr = (color_rgb[2], color_rgb[1], color_rgb[0])

    # position별 눈 위 Y 오프셋 (UV 공간, 눈 위쪽 = 작은 Y)
    EYE_Y_UV = 0.541  # 눈 UV Y 좌표
    if position == "lid_only":
        y_off, ry_uv = 0.025, 0.018   # 눈꺼풀 좁게
    elif position == "lid_and_crease":
        y_off, ry_uv = 0.040, 0.030   # 쌍커풀까지 넓게
    elif position == "under_eye":
        y_off, ry_uv = -0.018, 0.018  # 눈 아래쪽
    else:  # full
        y_off, ry_uv = 0.040, 0.040

    # 좌/우 눈 UV X 좌표
    for eye_x_uv in [0.341, 0.657]:
        cx = int(eye_x_uv * w)
        cy = int((EYE_Y_UV - y_off) * h)
        rx = int(0.075 * w)
        ry = max(int(ry_uv * h), 2)

        mask = np.zeros((h, w), dtype=np.float32)
        cv2.ellipse(mask, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)

        blur_k = max(int(ry * 2.5) | 1, 5)
        mask = cv2.GaussianBlur(mask, (blur_k, blur_k), 0)
        mask = np.clip(mask * opacity, 0, 1) * (alpha > 0).astype(np.float32)

        m3 = mask[:, :, np.newaxis]
        layer = np.full((h, w, 3), shadow_bgr, dtype=np.float32)
        result[:, :, :3] = np.where(
            m3 > 0,
            np.clip(
                result[:, :, :3].astype(np.float32) * (1 - m3 * 0.65) +
                layer * m3 * 0.65,
                0, 255
            ).astype(np.uint8),
            result[:, :, :3]
        )

    return result


def adjust_eyeline(texture_bgra: np.ndarray, features: dict) -> np.ndarray:
    eyeline = features["eyeline"]
    result = texture_bgra.copy()
    h, w = result.shape[:2]
    alpha = result[:, :, 3]

    # 상단 40% = 쌍커풀 라인 영역, 하단 60% = 아이라인 영역
    crease_boundary = int(h * 0.4)

    # 쌍커풀 영역 마스크
    crease_mask = np.zeros((h, w), dtype=np.uint8)
    crease_mask[:crease_boundary, :] = alpha[:crease_boundary, :]

    # 아이라인 영역 마스크
    liner_mask = np.zeros((h, w), dtype=np.uint8)
    liner_mask[crease_boundary:, :] = alpha[crease_boundary:, :]

    # 쌍커풀: eyelid_crease_color 기반, 깊이에 따라 opacity 조정
    crease_depth_opacity = {"shallow": 0.4, "medium": 0.7, "deep": 1.0}
    crease_opacity = crease_depth_opacity.get(
        eyeline.get("eyelid_crease_depth", "medium"), 0.7
    ) if eyeline.get("has_eyelid_crease") else 0.0

    if crease_opacity > 0:
        temp = result.copy()
        temp[:, :, 3] = crease_mask
        temp = adjust_hue(temp, eyeline["eyelid_crease_color"], crease_opacity)
        valid = crease_mask > 0
        result[valid] = temp[valid]

    # 아이라인: eyeliner_color 기반
    liner_thickness_opacity = {"thin": 0.7, "medium": 0.9, "thick": 1.0}
    liner_opacity = liner_thickness_opacity.get(
        eyeline.get("eyeliner_thickness", "medium"), 0.9
    )
    temp = result.copy()
    temp[:, :, 3] = liner_mask
    temp = adjust_hue(temp, eyeline["eyeliner_color"], liner_opacity)
    valid = liner_mask > 0
    result[valid] = temp[valid]

    result[:, :, 3] = alpha
    return result


def adjust_pupil(texture_bgra: np.ndarray, features: dict) -> np.ndarray:
    """
    LAB 색공간 기반 홍채 색상 보정.
    - L: 원본 상대 밝기(p5~p95, gamma=0.6) × 위치별 타겟 L → 밝기 부스트 + 링·동공 구조 보존
    - A, B: 타겟 85% + 원본 15% 블렌드 → 색상을 강하게 반영하면서 원본 질감 유지
    HSV hue rotation 대신 LAB 직접 블렌드를 사용하여 방향 계산 오류 없이 색상 적용.
    """
    pupil = features.get("pupil", {})
    h, w = texture_bgra.shape[:2]
    result = texture_bgra.copy()
    alpha = texture_bgra[:, :, 3]

    def bgr_list(rgb): return [rgb[2], rgb[1], rgb[0]]

    DIRS = ["top", "bottom", "left", "right", "center"]
    FIELDS = {
        "top":    ("iris_top_color",    [150, 100, 200]),
        "bottom": ("iris_bottom_color", [200, 180, 220]),
        "left":   ("iris_left_color",   [160, 120, 180]),
        "right":  ("iris_right_color",  [160, 120, 180]),
        "center": ("iris_center_color", [130, 100, 160]),
    }
    tgt_bgr_dirs = {
        d: np.array(bgr_list(pupil.get(FIELDS[d][0], FIELDS[d][1])), dtype=np.float32)
        for d in DIRS
    }

    # BaseTexture 실측 기반 좌/우 눈 영역
    eyes = [
        {"cx": int(0.2515 * w), "cy": int(0.5078 * h), "rx": int(0.1079 * w), "ry": int(0.2441 * h)},
        {"cx": int(0.7476 * w), "cy": int(0.5078 * h), "rx": int(0.1079 * w), "ry": int(0.2441 * h)},
    ]

    # 타겟 색상 강도 (1.0 = 완전 타겟, 0.0 = 완전 원본)
    COLOR_STR = 0.90
    # 채도 강화 배율 (LAB A·B의 neutral(128) 대비 편차를 증폭)
    CHROMA_BOOST = 1.3

    for eye_idx, eye in enumerate(eyes):
        cx, cy, rx, ry = eye["cx"], eye["cy"], eye["rx"], eye["ry"]

        y0 = max(0, cy - ry);  y1 = min(h, cy + ry)
        x0 = max(0, cx - rx);  x1 = min(w, cx + rx)

        PY, PX = np.mgrid[y0:y1, x0:x1]
        NX = (PX - cx).astype(np.float32) / rx
        NY = (PY - cy).astype(np.float32) / ry
        R  = np.sqrt(NX**2 + NY**2)
        in_iris = (R <= 1.0) & (alpha[y0:y1, x0:x1] > 0)

        # 5방향 가중치
        wt   = np.maximum(0.0, -NY)
        wb   = np.maximum(0.0,  NY)
        wl   = np.maximum(0.0, -NX)
        wr   = np.maximum(0.0,  NX)
        wc   = np.maximum(0.0, 1.0 - (np.abs(NX) + np.abs(NY)))
        wtot = wt + wb + wl + wr + wc + 1e-6
        weights = [wt, wb, wl, wr, wc]

        # 위치별 타겟 BGR (5방향 가중 보간) → LAB 변환
        tgt_b = sum(tgt_bgr_dirs[DIRS[i]][0] * weights[i] for i in range(5)) / wtot
        tgt_g = sum(tgt_bgr_dirs[DIRS[i]][1] * weights[i] for i in range(5)) / wtot
        tgt_r = sum(tgt_bgr_dirs[DIRS[i]][2] * weights[i] for i in range(5)) / wtot
        tgt_bgr_img = np.stack([tgt_b, tgt_g, tgt_r], axis=-1).clip(0, 255).astype(np.uint8)

        orig_crop = result[y0:y1, x0:x1, :3].astype(np.uint8)
        orig_lab  = cv2.cvtColor(orig_crop,   cv2.COLOR_BGR2LAB).astype(np.float32)
        tgt_lab   = cv2.cvtColor(tgt_bgr_img, cv2.COLOR_BGR2LAB).astype(np.float32)

        # 베이스 텍스처 기준 동공/홍채 경계
        PUPIL_R   = 0.35
        L_FLOOR   = 0.50
        L_MIN_TGT = 150.0

        # ── 링 위치 파라미터 (앞에서 정의 — blend·그라데이션과 기준 통일) ──
        RING_R      = PUPIL_R + 0.017   # 동공 상하좌우 각 2px 확대 (2/117.5≈0.017)
        RING_NY_OFF = 0.032
        RING_NX_OFF = 0.036
        RING_SIGMA  = 0.015
        MAX_DARKEN  = 0.45
        nx_sign     = +1.0 if eye_idx == 0 else -1.0
        NX_ring = NX - nx_sign * RING_NX_OFF
        NY_ring = NY - RING_NY_OFF
        R_ring  = np.sqrt(NX_ring**2 + NY_ring**2)

        L_all = orig_lab[:, :, 0][in_iris]
        if len(L_all) > 0:
            L_lo = float(np.percentile(L_all,  5))
            L_hi = float(np.percentile(L_all, 95))
        else:
            L_lo, L_hi = 0.0, 255.0
        L_range = max(L_hi - L_lo, 1.0)
        orig_L_norm = np.clip((orig_lab[:, :, 0] - L_lo) / L_range, 0.0, 1.0)

        # 동공/홍채 경계 블렌드 — R_ring 기준 (링 내부 = 동공, 외부 = 홍채)
        BLEND_W = 0.07
        blend_iris = np.clip((R_ring - RING_R + BLEND_W) / (BLEND_W * 2.0), 0.0, 1.0)

        # ── 위치별 그라데이션 인자 (L 채널에 통합) ──────────────────
        # iris_top/bottom V 비율로 위치별 배율을 tgt_lab_L에 곱함
        # L_MIN_TGT 부스트 전에 적용해야 상단 어둡기가 인위적으로 올라가지 않음
        v_top_g  = float(np.max(tgt_bgr_dirs["top"]))
        v_bot_g  = float(np.max(tgt_bgr_dirs["bottom"]))
        v_mean_g = max((v_top_g + v_bot_g) / 2.0, 1.0)
        if abs(v_top_g - v_bot_g) / v_mean_g > 0.12:
            t_pos     = np.clip((NY + 1.0) / 2.0, 0.0, 1.0)
            pos_v_fac = ((v_top_g / v_mean_g) * (1.0 - t_pos)
                        + (v_bot_g / v_mean_g) * t_pos)
        else:
            pos_v_fac = np.ones_like(NY, dtype=np.float32)

        # ── A, B 채널 (홍채·내측 공통) ────────────────────────────
        tgt_A_boosted = 128.0 + (tgt_lab[:, :, 1] - 128.0) * CHROMA_BOOST
        tgt_B_boosted = 128.0 + (tgt_lab[:, :, 2] - 128.0) * CHROMA_BOOST
        iris_A = orig_lab[:, :, 1] * (1 - COLOR_STR) + np.clip(tgt_A_boosted, 0, 255) * COLOR_STR
        iris_B = orig_lab[:, :, 2] * (1 - COLOR_STR) + np.clip(tgt_B_boosted, 0, 255) * COLOR_STR

        # ── L 채널: 외측(홍채) ────────────────────────────────────
        # 그라데이션 적용 후 eff_L → L_MIN_TGT를 80으로 낮춰 상단 어둡기 보존
        L_MIN_LOWER = 80.0
        tgt_L_grad  = tgt_lab[:, :, 0] * pos_v_fac
        eff_L       = np.maximum(tgt_L_grad, L_MIN_LOWER)
        new_L_iris  = np.clip(eff_L * (L_FLOOR + orig_L_norm * (1.0 - L_FLOOR)), 0, 255)

        # 내측(동공): iris_center V / iris 평균 V 비율로 L_FLOOR_INNER 동적 결정
        v_center    = float(np.max(tgt_bgr_dirs["center"]))
        v_iris_mean = float(np.mean([np.max(tgt_bgr_dirs[d])
                                     for d in ["top", "bottom", "left", "right"]]))
        pupil_v_ratio = v_center / max(v_iris_mean, 1.0)
        L_FLOOR_INNER = float(np.clip(0.80 * pupil_v_ratio, 0.30, 0.90))

        new_L_inner = np.clip(
            tgt_lab[:, :, 0] * (L_FLOOR_INNER + orig_L_norm * (1.0 - L_FLOOR_INNER)), 0, 255
        )

        # ── 블렌드 ────────────────────────────────────────────────
        new_L = blend_iris * new_L_iris + (1.0 - blend_iris) * new_L_inner
        new_A = iris_A
        new_B = iris_B

        new_lab = orig_lab.copy()
        new_lab[:, :, 0] = new_L
        new_lab[:, :, 1] = np.clip(new_A, 0, 255)
        new_lab[:, :, 2] = np.clip(new_B, 0, 255)
        new_bgr = cv2.cvtColor(new_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)

        mask3 = in_iris[:, :, np.newaxis]
        result[y0:y1, x0:x1, :3] = np.where(mask3, new_bgr, result[y0:y1, x0:x1, :3])

        # 상단-하단 그라데이션은 위의 L 채널 계산에 통합됨 (pos_v_fac)

        # ── 동공 경계 링 (Multiply) ──────────────────────────────
        # NX_ring, NY_ring, R_ring, RING_R, RING_SIGMA, MAX_DARKEN 은 위에서 정의됨
        ring_gauss = np.exp(-((R_ring - RING_R) / RING_SIGMA) ** 2)

        center_v = float(np.max(tgt_bgr_dirs["center"]))   # iris_center_color V
        ring_str = np.clip(center_v / 255.0, 0.2, 1.0)    # 밝은 동공 → 강한 링
        ring_mult = 1.0 - ring_gauss * ring_str * MAX_DARKEN

        ring_region = result[y0:y1, x0:x1, :3].astype(np.uint8)
        ring_hsv    = cv2.cvtColor(ring_region, cv2.COLOR_BGR2HSV).astype(np.float32)
        ring_hsv[:, :, 2] = np.where(
            in_iris,
            np.clip(ring_hsv[:, :, 2] * ring_mult, 0, 255),
            ring_hsv[:, :, 2]
        )
        result[y0:y1, x0:x1, :3] = cv2.cvtColor(
            ring_hsv.astype(np.uint8), cv2.COLOR_HSV2BGR
        )

    return result


def adjust_highlight(texture_bgra: np.ndarray, features: dict) -> np.ndarray:
    """안광 텍스처에 features.json 기반 하이라이트 렌더링."""
    pupil = features.get("pupil", {})
    highlights = pupil.get("highlights", [])

    if not highlights:
        return texture_bgra

    result = texture_bgra.copy()
    h, w = result.shape[:2]

    # BaseTexture 실측 기반 양쪽 눈 UV 중심/반경
    EYE_CX   = [0.2515, 0.7476]
    EYE_CY   = 0.5078
    EYE_RX   = 0.1079
    EYE_RY   = 0.2441

    for hl in highlights:
        nx         = hl.get("nx", 0.0)
        ny         = hl.get("ny", 0.0)
        size_ratio = hl.get("size_ratio", 0.01)
        shape      = hl.get("shape", "circle")

        for ecx_ratio in EYE_CX:
            ecx = int(ecx_ratio * w)
            ecy = int(EYE_CY   * h)
            erx = int(EYE_RX   * w)
            ery = int(EYE_RY   * h)

            hx = int(ecx + nx * erx)
            hy = int(ecy + ny * ery)
            hr = max(2, int(erx * np.sqrt(size_ratio) * 1.5))

            if shape == "oval":
                cv2.ellipse(result, (hx, hy), (hr, max(2, hr // 2)),
                            0, 0, 360, (255, 255, 255, 255), -1)
            else:  # circle / star → 원형
                cv2.circle(result, (hx, hy), hr, (255, 255, 255, 255), -1)
                # 소프트 엣지
                cv2.circle(result, (hx, hy), hr + 2, (255, 255, 255, 100), 1)

    return result


def process(input_dir: str, output_dir: str, features: dict):
    os.makedirs(output_dir, exist_ok=True)

    # landmarks 로드
    lm = None
    lm_path = os.path.join(os.path.dirname(args.features if hasattr(args, 'features') else '.'), "landmarks.json")
    landmarks_path = Path(args.features).parent / "landmarks.json"
    if landmarks_path.exists():
        with open(landmarks_path) as f:
            lm_data = json.load(f)
        lm = lm_data[0]["landmarks"] if lm_data else None
        print(f"landmarks.json 로드 완료: {len(lm)}개 포인트\n")
    else:
        print("landmarks.json 없음 — blush/marking 적용 스킵\n")

    generate_targets = [
        ("BaseTexture_Generate_Face.png",      adjust_face,      "Face 피부톤 + 볼터치 + 점"),
        ("BaseTexture_Generate_Eyebrow.png",   adjust_eyebrow,   "Eyebrow 눈썹"),
        ("BaseTexture_Generate_Pupil.png",     adjust_pupil,     "Pupil 눈동자"),
        ("BaseTexture_Static_EyeHighlight.png", adjust_highlight, "EyeHighlight 안광"),
    ]

    static_targets = [
        "BaseTexture_Static_EyeWhite.png",
        "BaseTexture_Static_MouthInside.png",
    ]

    # Eyeline: eyeline_type 기반으로 assets/eyeline/ 에서 베이스 선택 후 복사
    # assets/eyeline/ 경로: input_dir(assets/textures)의 상위 폴더 기준
    eyeline_dir  = Path(input_dir) / "eyeline"
    eyeline_type = features.get("eyeline", {}).get("eyeline_type", "default")
    eyeline_src  = eyeline_dir / f"eyeline_{eyeline_type}.png"
    if not eyeline_src.exists():
        eyeline_src = eyeline_dir / "eyeline_default.png"   # 폴백
    eyeline_dst = Path(output_dir) / "BaseTexture_Generate_Eyeline.png"

    print("=== Generate 텍스처 보정 ===\n")
    for tex_name, adjust_fn, label in generate_targets:
        print(f"  [{label}]")
        tex_path = os.path.join(input_dir, tex_name)
        out_path = os.path.join(output_dir, tex_name)

        if not Path(tex_path).exists():
            print(f"    건너뜀: {tex_path} 없음\n")
            continue

        texture = read_rgba(tex_path)
        h, w = texture.shape[:2]
        valid_px = np.count_nonzero(texture[:, :, 3])
        print(f"    텍스처: {w}x{h}, 유효 픽셀: {valid_px}")

        if adjust_fn == adjust_face:
            result = adjust_fn(texture, features, lm)
        else:
            result = adjust_fn(texture, features)
        cv2.imwrite(out_path, result)
        print(f"    저장: {out_path}\n")

    print("=== Static 텍스처 복사 ===\n")
    for name in static_targets:
        src = os.path.join(input_dir, name)
        dst = os.path.join(output_dir, name)
        if Path(src).exists():
            shutil.copy2(src, dst)
            print(f"  복사: {name}")
        else:
            print(f"  건너뜀: {name} 없음")

    print("\n=== Eyeline 베이스 선택 ===\n")
    if eyeline_src.exists():
        shutil.copy2(str(eyeline_src), str(eyeline_dst))
        print(f"  선택: {eyeline_src.name}  (type={eyeline_type})")
        print(f"  복사: {eyeline_dst}\n")
    else:
        print(f"  건너뜀: eyeline 베이스 없음 ({eyeline_src})\n")

    print(f"완료. 결과 폴더: {output_dir}")


if __name__ == "__main__":
    # 프로젝트 루트 = src/ 의 상위 폴더
    PROJECT_ROOT = Path(__file__).parent.parent

    parser = argparse.ArgumentParser()
    parser.add_argument("--features",   default=str(PROJECT_ROOT / "features.json"))
    parser.add_argument("--input_dir",  default=str(PROJECT_ROOT / "assets/textures"))
    parser.add_argument("--output_dir", default=str(PROJECT_ROOT / "output"))
    args = parser.parse_args()

    features = load_features(args.features)
    print(f"특징값 로드 완료: {args.features}\n")

    process(args.input_dir, args.output_dir, features)