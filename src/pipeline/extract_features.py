from google import genai
from google.genai import types
from dotenv import load_dotenv
import cv2
import numpy as np
import os
import json
from pathlib import Path

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def sample_iris_colors(image_path: str, landmarks_path: str) -> dict:
    """landmark 기반으로 홍채 5방향 색상을 직접 픽셀 샘플링"""
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    with open(landmarks_path) as f:
        lm_data = json.load(f)
    lm = lm_data[0]["landmarks"]

    eyes = [
        {
            "cx": int(lm[14][0]), "cy": int(lm[14][1]),
            "rx": int(abs(lm[12][0] - lm[10][0]) / 2),
            "ry": int(abs(lm[13][1] - lm[11][1]) / 2),
        },
        {
            "cx": int(lm[19][0]), "cy": int(lm[19][1]),
            "rx": int(abs(lm[17][0] - lm[15][0]) / 2),
            "ry": int(abs(lm[18][1] - lm[16][1]) / 2),
        },
    ]

    def sample_sector(img_rgb, cx, cy, rx, ry, angle_start, angle_end, r_min=0.2, r_max=0.8):
        """부채꼴 영역의 대표 색상 — 채도 상위 25% 평균 (안광·동공 픽셀 제외)"""
        h, w = img_rgb.shape[:2]
        pixels = []
        for py in range(max(0, cy - ry), min(h, cy + ry)):
            for px in range(max(0, cx - rx), min(w, cx + rx)):
                nx = (px - cx) / rx
                ny = (py - cy) / ry
                r = np.sqrt(nx*nx + ny*ny)
                if r < r_min or r > r_max:
                    continue
                angle = np.degrees(np.arctan2(-ny, nx)) % 360
                if angle_start <= angle_end:
                    if not (angle_start <= angle <= angle_end):
                        continue
                else:
                    if not (angle >= angle_start or angle <= angle_end):
                        continue
                p = img_rgb[py, px]
                v      = int(max(p))
                chroma = int(max(p)) - int(min(p))
                # 동공(V<30) 제외, 안광·밝은 무채색(V>200 AND chroma<40) 제외
                if v < 30:
                    continue
                if v > 200 and chroma < 40:
                    continue
                pixels.append(p)

        if not pixels:
            return [128, 128, 128]

        arr = np.array(pixels, dtype=np.float32)
        chromas = arr.max(axis=1) - arr.min(axis=1)
        thresh = np.percentile(chromas, 75)
        saturated = arr[chromas >= thresh]
        avg = np.mean(saturated if len(saturated) > 0 else arr, axis=0)
        return [int(avg[0]), int(avg[1]), int(avg[2])]

    def sample_center(img_rgb, cx, cy, rx, ry, r_max=0.08):
        """동공 중심 색상 — 좁은 반경(r<0.08)에서 MEDIAN 사용.
        r_max를 0.08로 제한해 동공 중심부만 샘플링, 홍채 픽셀 혼입 최소화.
        채도 상위 선택 대신 MEDIAN으로 밝은 반사광 픽셀에 끌려가지 않게 함."""
        h, w = img_rgb.shape[:2]
        pixels = []
        for py in range(max(0, cy - ry), min(h, cy + ry)):
            for px in range(max(0, cx - rx), min(w, cx + rx)):
                nx = (px - cx) / rx
                ny = (py - cy) / ry
                if nx*nx + ny*ny > r_max*r_max:
                    continue
                p = img_rgb[py, px]
                v      = int(max(p))
                chroma = int(max(p)) - int(min(p))
                if v < 30:
                    continue
                if v > 200 and chroma < 40:
                    continue
                pixels.append(p)
        if not pixels:
            return [128, 128, 128]
        arr = np.array(pixels, dtype=np.float32)
        med = np.median(arr, axis=0)
        return [int(med[0]), int(med[1]), int(med[2])]

    def measure_top_shadow_v(img_rgb, cx, cy, rx, ry):
        """홍채 상단/하단의 HSV V값 비교로 top_shadow_ratio 측정.
        V만 사용 (hue/saturation 무관), 하이라이트·동공 제외.
        r=0.30~0.80 구간만 사용 (동공·외측 링 제외).
        """
        img_hsv = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2HSV)
        h_img, w_img = img_rgb.shape[:2]
        top_v, bot_v = [], []
        for py in range(max(0, cy - ry), min(h_img, cy + ry)):
            for px in range(max(0, cx - rx), min(w_img, cx + rx)):
                nx_ = (px - cx) / rx
                ny_ = (py - cy) / ry
                r2  = nx_*nx_ + ny_*ny_
                if r2 < 0.09 or r2 > 0.64:   # r=0.3~0.8 구간만
                    continue
                p = img_rgb[py, px]
                bright = int(max(p))
                chroma = bright - int(min(p))
                if bright < 30 or (bright > 200 and chroma < 40):
                    continue
                v_val = int(img_hsv[py, px, 2])
                if ny_ < -0.4:
                    top_v.append(v_val)
                elif ny_ > 0.4:
                    bot_v.append(v_val)
        if not top_v or not bot_v:
            return 0.0
        mean_top = float(np.mean(top_v))
        mean_bot = float(np.mean(bot_v))
        if mean_bot < 1:
            return 0.0
        return float(np.clip(1.0 - mean_top / mean_bot, 0.0, 1.0))

    all_samples = []
    for eye in eyes:
        cx, cy, rx, ry = eye["cx"], eye["cy"], eye["rx"], eye["ry"]
        all_samples.append({
            "top":    sample_sector(img_rgb, cx, cy, rx, ry,  30, 150),
            "bottom": sample_sector(img_rgb, cx, cy, rx, ry, 210, 330),
            "left":   sample_sector(img_rgb, cx, cy, rx, ry, 150, 210),
            "right":  sample_sector(img_rgb, cx, cy, rx, ry, 330,  30),
            "center": sample_center(img_rgb, cx, cy, rx, ry),
        })

    result = {}
    for key in ["top", "bottom", "center"]:
        result[key] = [
            int((all_samples[0][key][c] + all_samples[1][key][c]) / 2)
            for c in range(3)
        ]

    # left/right는 좌우 눈이 이미지에서 반전되어 있으므로 swap
    # all_samples[0] = 왼쪽 눈 (이미지상 왼쪽 = 캐릭터 오른쪽)
    # all_samples[1] = 오른쪽 눈 (이미지상 오른쪽 = 캐릭터 왼쪽)
    result["left"]  = [
        int((all_samples[0]["right"][c] + all_samples[1]["left"][c]) / 2)
        for c in range(3)
    ]
    result["right"] = [
        int((all_samples[0]["left"][c] + all_samples[1]["right"][c]) / 2)
        for c in range(3)
    ]

    # 양쪽 눈 top_shadow_ratio 측정 후 평균
    shadow_ratios = [
        measure_top_shadow_v(img_rgb, e["cx"], e["cy"], e["rx"], e["ry"])
        for e in eyes
    ]
    top_shadow_v = float(np.mean(shadow_ratios))

    return {
        "iris_top_color":    result["top"],
        "iris_bottom_color": result["bottom"],
        "iris_left_color":   result["left"],
        "iris_right_color":  result["right"],
        "iris_center_color": result["center"],
        "top_shadow_ratio":  top_shadow_v,   # Gemini 값 덮어씀
    }

def extract_eye_highlights(image_path: str, landmarks_path: str) -> list:
    """눈동자 안광(하이라이트) 위치·크기·형태를 OpenCV로 추출.

    반환: [{"nx": float, "ny": float, "size_ratio": float, "shape": str}, ...]
      nx, ny: 홍채 중심 기준 정규화 좌표 (-1~1)
      size_ratio: 홍채 면적 대비 안광 면적 비율
      shape: "circle" / "oval" / "star"
    """
    img = cv2.imread(image_path)
    if img is None:
        return []
    h_img, w_img = img.shape[:2]

    with open(landmarks_path) as f:
        lm_data = json.load(f)
    lm = lm_data[0]["landmarks"]

    eyes = [
        {
            "cx": int(lm[14][0]), "cy": int(lm[14][1]),
            "rx": max(1, int(abs(lm[12][0] - lm[10][0]) / 2)),
            "ry": max(1, int(abs(lm[13][1] - lm[11][1]) / 2)),
        },
        {
            "cx": int(lm[19][0]), "cy": int(lm[19][1]),
            "rx": max(1, int(abs(lm[17][0] - lm[15][0]) / 2)),
            "ry": max(1, int(abs(lm[18][1] - lm[16][1]) / 2)),
        },
    ]

    hsv_img = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    IRIS_SCALE = 0.60
    MIN_CIRC   = 0.3   # 선형 반사광 제거: 원형도 하한
    MAX_ASPECT = 3.0   # 장단축비 상한 (가늘고 긴 형태 제거)

    def _detect_one_eye(eye):
        cx, cy, rx, ry = eye["cx"], eye["cy"], eye["rx"], eye["ry"]
        if rx < 4 or ry < 4:
            return []

        iris_rx = max(1, int(rx * IRIS_SCALE))
        iris_ry = max(1, int(ry * IRIS_SCALE))

        iris_mask = np.zeros((h_img, w_img), dtype=np.uint8)
        cv2.ellipse(iris_mask, (cx, cy), (iris_rx, iris_ry), 0, 0, 360, 255, -1)

        bright    = (hsv_img[:, :, 1] < 20) & (hsv_img[:, :, 2] > 235) & (iris_mask > 0)
        bright_u8 = bright.astype(np.uint8) * 255
        kernel    = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        bright_u8 = cv2.morphologyEx(bright_u8, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(bright_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        iris_area    = np.pi * iris_rx * iris_ry

        results = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 3:
                continue

            perimeter   = cv2.arcLength(cnt, True)
            circularity = 4 * np.pi * area / (perimeter ** 2 + 1e-6)
            if circularity < MIN_CIRC:          # 선형 반사광 제거
                continue

            # 장단축비 필터 — fitEllipse 또는 boundingRect 사용
            try:
                if len(cnt) >= 5:
                    _, (w_el, h_el), _ = cv2.fitEllipse(cnt)
                    aspect = max(w_el, h_el) / (min(w_el, h_el) + 1e-6)
                else:
                    _, _, w_r, h_r = cv2.boundingRect(cnt)
                    aspect = max(w_r, h_r) / (min(w_r, h_r) + 1e-6)
            except Exception:
                _, _, w_r, h_r = cv2.boundingRect(cnt)
                aspect = max(w_r, h_r) / (min(w_r, h_r) + 1e-6)
            if aspect > MAX_ASPECT:
                continue

            M = cv2.moments(cnt)
            if M["m00"] == 0:
                continue
            hx = M["m10"] / M["m00"]
            hy = M["m01"] / M["m00"]
            nx = (hx - cx) / iris_rx
            ny = (hy - cy) / iris_ry
            if nx ** 2 + ny ** 2 > 1.0:
                continue

            shape = "circle" if circularity > 0.7 else "oval" if circularity > 0.4 else "star"

            _cnt_mask = np.zeros((h_img, w_img), dtype=np.uint8)
            cv2.drawContours(_cnt_mask, [cnt], -1, 255, -1)
            _v_vals    = hsv_img[:, :, 2][_cnt_mask > 0]
            brightness = float(np.clip((np.mean(_v_vals) - 235.0) / 20.0, 0.0, 1.0)) if len(_v_vals) > 0 else 1.0

            results.append({
                "nx":         float(nx),
                "ny":         float(ny),
                "size_ratio": float(area / iris_area),
                "shape":      shape,
                "brightness": brightness,
            })

        results.sort(key=lambda x: x["size_ratio"], reverse=True)
        return results[:4]

    # 두 눈 독립 처리 후 합산 → 크기 순 상위 4개
    collected = _detect_one_eye(eyes[0]) + _detect_one_eye(eyes[1])
    collected.sort(key=lambda x: x["size_ratio"], reverse=True)
    return collected[:4]


def match_hairstyle_preset(image_path: str, thumbnails_dir: str) -> dict:
    """업로드된 이미지를 5개 프리셋 썸네일과 직접 시각 비교하여 가장 유사한 프리셋 선택."""
    import time

    image_bytes = Path(image_path).read_bytes()
    ext = Path(image_path).suffix.lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp", ".bmp": "image/bmp"}
    mime_type = mime_map.get(ext, "image/png")

    # Load preset thumbnails
    preset_ids = ["hair-01", "hair-02", "hair-03", "hair-04", "hair-05"]
    thumbnail_parts = []
    for pid in preset_ids:
        thumb_path = Path(thumbnails_dir) / f"{pid}.png"
        if not thumb_path.exists():
            print(f"  [HairMatch] Thumbnail not found: {thumb_path}")
            return {"matched_preset": None, "confidence": 0.0, "reason": "thumbnails not found"}
        thumbnail_parts.append(types.Part.from_bytes(data=thumb_path.read_bytes(), mime_type="image/png"))

    prompt = """You are given 6 images:
- Image 1 (first): The uploaded character image to match
- Images 2-6: Five hair preset thumbnails in order: hair-01, hair-02, hair-03, hair-04, hair-05

Each preset has a DISTINCT hairstyle:
- hair-01: Medium-long straight hair with side-swept bangs, reaches mid-chest/shoulders. NOT past the elbows.
- hair-02: Short bob cut, hair barely reaches the chin/jaw. Clearly short.
- hair-03: High ponytail tied up on top, with an ahoge (antenna hair). Hair is pulled back.
- hair-04: VERY long straight hair, reaches waist or below. Significantly longer than hair-01. Past the elbows.
- hair-05: Short hair with a side braid on one side. Short overall length with braided element.

CRITICAL: The thumbnails show 3/4 side views, but the uploaded image may be from any angle.
Use BOTH the thumbnail images AND the text descriptions above to determine the best match.
The KEY differentiator between hair-01 and hair-04 is LENGTH:
- If hair reaches mid-chest or shoulders → hair-01
- If hair reaches waist/hips or below the elbows → hair-04

Do NOT match by color — all presets have the same brown color. Focus ONLY on hairstyle shape and length.

Reply ONLY in JSON format. No explanation, no markdown, no extra text.

{
  "matched_preset": "hair-01 or hair-02 or hair-03 or hair-04 or hair-05",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation of why this preset matches"
}
"""

    contents = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        *thumbnail_parts,
        prompt,
    ]

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents
            )
            break
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                print(f"  [HairMatch] API error (attempt {attempt+1}/{max_retries}): {e}")
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [HairMatch] All retries failed: {e}")
                return {"matched_preset": None, "confidence": 0.0, "reason": str(e)}

    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        print(f"  [HairMatch] Failed to parse response: {raw}")
        return {"matched_preset": None, "confidence": 0.0, "reason": "parse error"}

    print(f"  [HairMatch] Matched: {result.get('matched_preset')} (confidence: {result.get('confidence')}, reason: {result.get('reason')})")
    return result


def extract_face_features(image_path: str, landmarks_path: str = None) -> dict:
    image_bytes = Path(image_path).read_bytes()
    ext = Path(image_path).suffix.lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
    mime_type = mime_map.get(ext, "image/png")

    prompt = """
Analyze this Japanese anime-style character image.
Reply ONLY in JSON format. No explanation, no markdown, no extra text.

{
  "face": {
    "skin_tone": [R, G, B],
    "skin_shading_intensity": 0.0~1.0,
    "blush_present": true/false,
    "blush_color": [R, G, B],
    "blush_opacity": 0.0~1.0,
    "blush_position": "cheek_high/cheek_center/cheek_low",
    "markings": [
      {
        "type": "one of: mole/star/teardrop/triangle/diamond/line/tattoo/scar/other",
        "color": [R, G, B],
        "size": "one of: tiny/small/medium/large",
        "side": "left/right/center",
        "reference": "one of: left_eye/right_eye/nose/mouth/left_cheek/right_cheek/forehead/chin",
        "offset_x": "one of: far_left/left/center/right/far_right",
        "offset_y": "one of: far_above/above/same/below/far_below (use same if at same height as reference, NOT center)"
      }
    ]
  },
  "eyebrow": {
    "color": [R, G, B],
    "shape": "arch/straight/down",
    "thickness": "thin/medium/thick",
    "opacity": 0.0~1.0,
    "has_gradient": true/false
  },
  "eyeline": {
    "eyeline_type": "one of: simple/simplelash/cute/cutelash/maturelash",
    "eyeliner_color": [R, G, B],
    "eyeliner_thickness": "thin/medium/thick",
    "has_eyelid_crease": true/false,
    "eyelid_crease_depth": "shallow/medium/deep",
    "eyelid_crease_color": [R, G, B],
    "lash_intensity": "light/medium/heavy",
    "eyeshadow_present": true/false,
    "eyeshadow_color": [R, G, B],
    "eyeshadow_opacity": 0.0~1.0,
    "eyeshadow_position": "lid_only/lid_and_crease/under_eye/full"
  },
  "pupil": {
    "iris_top_color": [R, G, B],
    "iris_bottom_color": [R, G, B],
    "iris_left_color": [R, G, B],
    "iris_right_color": [R, G, B],
    "iris_center_color": [R, G, B],
    "pupil_color": [R, G, B],
    "pupil_size_ratio": 0.0~1.0,
    "top_shadow_ratio": 0.0~1.0,
"highlights": []
  },
  "general": {
    "hair_color": [R, G, B],
    "hair_style": "one of: long_straight/short_bob/ponytail/very_long_straight/short_braid/twin_tails/other",
    "hair_length": "one of: short/medium/long/very_long",
    "bangs_style": "one of: full/side_swept/curtain/none",
    "overall_style": "soft/sharp/cute/mature"
  }
}

Rules:
- RGB values: integers 0~255
- Ratios: floats 0.0~1.0
- blush is a soft, diffuse color on cheeks — handled separately in blush fields, NOT in markings
- markings: ONLY hard-edged, clearly distinct features such as:
  * mole: a tiny sharply defined dot, NOT a soft color area
  * star/teardrop/triangle/diamond: geometric symbols drawn on the face
  * tattoo/scar: visible markings on skin
- mole must be: very small, sharply defined, single dot — NOT a soft diffuse area
- circle type does NOT exist — use mole for dots
- markings: empty array [] if none present
- Do NOT include blush/flush/soft cheek color as a marking
- Do NOT include eyeshadow or soft gradient areas as markings
- reference: the nearest facial landmark to the marking
- offset_x: horizontal position relative to reference (far_left=far to the left side of face)
- offset_y: vertical position relative to reference (above=slightly above, far_above=much higher)
- eyeshadow is a soft diffuse color on the eyelid area, NOT the eyeliner
- top_shadow_ratio: how much darker the top of the iris is compared to the bottom
  * 0.0 = no shadow (top and bottom same brightness)
  * 0.5 = moderate shadow (top noticeably darker)
  * 1.0 = very strong shadow (top much darker than bottom)
  * Sample the top 20% and bottom 20% of the iris and compare their brightness
- iris colors: CRITICAL - divide the iris into a 3x3 grid (like a numpad):
  +---+---+---+
  | 7 | 8 | 9 |
  +---+---+---+
  | 4 | 5 | 6 |
  +---+---+---+
  | 1 | 2 | 3 |
  +---+---+---+
  Sample ONLY these 5 cells and report the DOMINANT color in each cell (not average):
  * iris_top_color:    cell 8 (top center)
  * iris_left_color:   cell 4 (middle left)
  * iris_center_color: cell 5 (center, around pupil)
  * iris_right_color:  cell 6 (middle right)
  * iris_bottom_color: cell 2 (bottom center)
  * DOMINANT color = the most visually prominent color in that cell, not an average
  * Each cell will likely have a different hue in anime characters
  * anime irises frequently have totally different hues top vs bottom (e.g. purple top, teal/cyan bottom)
  * if a cell looks teal, report teal. if it looks purple, report purple. do NOT blend them
- grid_col: 0=left third, 1=center third, 2=right third of the iris
- grid_row: 0=top third, 1=middle third, 2=bottom third of the iris
- highlights: always return empty array []
- eyeshadow_color: dominant shadow color if present, [0,0,0] if not
- position must be chosen from the exact list provided
- eyeline_type: choose ONE from the list below
  Step 1 — lash 유무: 속눈썹 획이 실제로 그려져 있는가?
    * lash NONE : 아이라인만 있고 개별 속눈썹 선(획)이 없음 → suffix 없음
    * lash PRESENT: 눈 가장자리에 뾰족한 속눈썹 선이 하나 이상 그려져 있음 → "lash" suffix
    (overall_style·face maturity는 기준이 아님 — 속눈썹 선의 존재 자체만 봄)

  Step 2 — 속눈썹 복잡도 (lash PRESENT인 경우에만):
    * "simple"   계열 : 속눈썹 획이 2~4개 이하, 간결하고 짧음
    * "cute"     계열 : 속눈썹 획 5~8개, 중간 밀도, 보통 길이
    * "mature"   계열 : 속눈썹 획 9개 이상 또는 겹겹이 쌓인 두꺼운 속눈썹

  Step 3 — lash NONE인 경우 eyeliner 스타일:
    * "simple" : 얇은 한 줄 라인
    * "cute"   : 약간 굵거나 끝이 올라간 라인

  Final types: "simple" / "simplelash" / "cute" / "cutelash" / "maturelash"
  (mature는 항상 lash가 있음)
"""

    import time

    def _default_features() -> dict:
        """Gemini API 불가 시 기본값 반환 (텍스처 파이프라인은 계속 진행)."""
        print("  [경고] Gemini API 사용 불가 — 기본 특징값으로 대체합니다.")
        return {
            "face": {
                "skin_tone": [240, 210, 190],
                "skin_shading_intensity": 0.2,
                "blush_present": False,
                "blush_color": [220, 130, 130],
                "blush_opacity": 0.0,
                "blush_position": "cheek_center",
                "markings": [],
            },
            "eyebrow": {
                "color": [80, 60, 50],
                "shape": "arch",
                "thickness": "medium",
                "opacity": 1.0,
                "has_gradient": False,
            },
            "eyeline": {
                "eyeline_type": "simple",
                "eyeliner_color": [30, 20, 20],
                "eyeliner_thickness": "medium",
                "has_eyelid_crease": False,
                "eyelid_crease_depth": "shallow",
                "eyelid_crease_color": [200, 170, 170],
                "lash_intensity": "medium",
                "eyeshadow_present": False,
                "eyeshadow_color": [0, 0, 0],
                "eyeshadow_opacity": 0.0,
                "eyeshadow_position": "lid_only",
            },
            "pupil": {
                "iris_top_color": [100, 100, 160],
                "iris_bottom_color": [120, 140, 200],
                "iris_left_color": [110, 120, 180],
                "iris_right_color": [110, 120, 180],
                "iris_center_color": [100, 110, 165],
                "pupil_color": [20, 20, 20],
                "pupil_size_ratio": 0.3,
                "top_shadow_ratio": 0.3,
                "highlights": [],
            },
            "general": {
                "hair_color": [120, 90, 70],
                "hair_style": "other",
                "hair_length": "medium",
                "bangs_style": "none",
                "overall_style": "cute",
            },
            "_gemini_fallback": True,
        }

    max_retries = 5
    gemini_response = None
    for attempt in range(max_retries):
        try:
            gemini_response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    prompt
                ]
            )
            break
        except Exception as e:
            err_str = str(e)
            # 크레딧 소진 / 결제 오류는 재시도해도 해결 불가 → 즉시 fallback
            if "RESOURCE_EXHAUSTED" in err_str or "prepayment credits" in err_str or "429" in err_str:
                print(f"  [오류] Gemini API 크레딧 부족 (429 RESOURCE_EXHAUSTED) — 기본값 사용.")
                return _default_features()
            if attempt < max_retries - 1:
                wait = 15 * (attempt + 1)  # 15, 30, 45, 60초
                print(f"  API 오류 (시도 {attempt+1}/{max_retries}): {e}")
                print(f"  {wait}초 후 재시도...")
                time.sleep(wait)
            else:
                raise

    raw = gemini_response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    features = json.loads(raw)

    # 홍채 색상: OpenCV 직접 샘플링 (Gemini보다 정확)
    if landmarks_path and Path(landmarks_path).exists():
        iris_colors = sample_iris_colors(image_path, landmarks_path)
        features["pupil"].update(iris_colors)
        print("  홍채 색상: OpenCV 직접 샘플링 완료")

        # 안광(하이라이트) 위치/형태: OpenCV 감지
        highlights = extract_eye_highlights(image_path, landmarks_path)
        features["pupil"]["highlights"] = highlights
        if highlights:
            print(f"  안광 감지: {len(highlights)}개 → {[h['shape'] for h in highlights]}")
        else:
            print("  안광 감지: 없음 (기본 하이라이트 텍스처 유지)")


    return features


def _sample_eyeshadow_color(image_path: str, landmarks_path: str) -> list:
    """눈꺼풀(눈 위쪽) 영역 픽셀 샘플링으로 아이섀도우 색상 추출.
    Gemini의 present/position 판단은 유지하고, color만 OpenCV로 대체.
    """
    img = cv2.imread(image_path)
    if img is None:
        return []
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]

    with open(landmarks_path) as f:
        lm_data = json.load(f)
    lm = lm_data[0]["landmarks"]

    # 눈꺼풀 영역: 눈 위쪽 끝(lm[11]/lm[16]) ~ 눈썹 아래(lm[3-5]/lm[6-8])
    eye_regions = [
        {
            "cx":       int(lm[14][0]),
            "eye_top":  int(lm[11][1]),
            "brow_bot": int((lm[3][1] + lm[4][1] + lm[5][1]) / 3),
            "rx":       max(4, int(abs(lm[12][0] - lm[10][0]) / 2)),
        },
        {
            "cx":       int(lm[19][0]),
            "eye_top":  int(lm[16][1]),
            "brow_bot": int((lm[6][1] + lm[7][1] + lm[8][1]) / 3),
            "rx":       max(4, int(abs(lm[17][0] - lm[15][0]) / 2)),
        },
    ]

    all_pixels = []
    for er in eye_regions:
        cx, rx = er["cx"], er["rx"]
        y_top = min(er["brow_bot"], er["eye_top"])
        y_bot = er["eye_top"] - 1
        if y_top >= y_bot:
            continue
        for py in range(max(0, y_top), min(h, y_bot)):
            for px in range(max(0, cx - rx), min(w, cx + rx)):
                p = img_rgb[py, px]
                v = int(max(p))
                chroma = v - int(min(p))
                if v < 30 or (v > 230 and chroma < 30):
                    continue
                all_pixels.append(p)

    if not all_pixels:
        return []

    arr = np.array(all_pixels, dtype=np.float32)
    med = np.median(arr, axis=0)
    return [int(med[0]), int(med[1]), int(med[2])]


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    PROJECT_ROOT = Path(__file__).parent.parent

    parser = argparse.ArgumentParser()
    parser.add_argument("--image",   default=str(PROJECT_ROOT / "test_face.png"))
    parser.add_argument("--output",  default=str(PROJECT_ROOT / "features.json"))
    args = parser.parse_args()

    print(f"이미지 분석 중: {args.image}\n")
    # landmarks.json 경로 추정 (output 폴더 기준)
    import os
    landmarks_path = os.path.join(os.path.dirname(args.output), "landmarks.json")
    features = extract_face_features(args.image, landmarks_path)

    print("추출된 특징:")
    print(json.dumps(features, indent=2, ensure_ascii=False))

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(features, f, indent=2, ensure_ascii=False)
    print(f"\n{args.output} 저장 완료")