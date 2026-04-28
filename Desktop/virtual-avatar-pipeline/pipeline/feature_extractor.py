"""
MediaPipe FaceLandmarker (Tasks API) 기반 얼굴 특징 추출기
mediapipe 0.10+ 전용

모델 파일(face_landmarker.task)은 최초 실행 시 자동 다운로드됩니다.
"""

import urllib.request
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from dataclasses import dataclass, asdict, fields
from pathlib import Path
from PIL import Image


_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
)
_MODEL_PATH = Path(__file__).parent / "face_landmarker.task"

# landmark index map (mediapipe canonical face mesh 기준)
_LM = {
    "left_eye_outer":  33,
    "left_eye_inner":  133,
    "left_eye_top":    159,
    "left_eye_bottom": 145,
    "right_eye_outer":  263,
    "right_eye_inner":  362,
    "right_eye_top":    386,
    "right_eye_bottom": 374,
    "nose_tip":    1,
    "nose_bridge": 168,
    "nose_left":   129,
    "nose_right":  358,
    "mouth_left":   61,
    "mouth_right":  291,
    "forehead":    10,
    "chin":       152,
    "left_cheek":  234,
    "right_cheek": 454,
    "left_jaw":    172,
    "right_jaw":   397,
}


@dataclass
class FaceFeatureVector:
    eye_aspect_ratio: float
    eye_distance_ratio: float
    face_width_height_ratio: float
    nose_height_ratio: float
    nose_width_ratio: float
    mouth_width_ratio: float
    jaw_width_ratio: float
    forehead_ratio: float
    chin_ratio: float

    def to_dict(self) -> dict:
        return asdict(self)

    def to_array(self) -> np.ndarray:
        return np.array([getattr(self, f.name) for f in fields(self)], dtype=np.float32)

    @classmethod
    def field_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]


def extract_features(
    image: "Image.Image | str | np.ndarray",
    min_confidence: float = 0.4,
) -> "FaceFeatureVector | None":
    img_rgb = _to_rgb(image)
    lm = _detect_landmarks(img_rgb, min_confidence)
    if lm is None:
        return None
    return _compute_features(lm, img_rgb.shape)


def visualize_landmarks(
    image: "Image.Image | str | np.ndarray",
    save_path: "str | None" = None,
) -> Image.Image:
    img_rgb = _to_rgb(image)
    lm = _detect_landmarks(img_rgb, 0.3)
    if lm is None:
        return Image.fromarray(img_rgb)

    h, w = img_rgb.shape[:2]
    vis = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    for key, idx in _LM.items():
        pt = lm[idx]
        x, y = int(pt.x * w), int(pt.y * h)
        cv2.circle(vis, (x, y), 3, (0, 255, 0), -1)
        cv2.putText(vis, key[:3], (x + 2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (255, 255, 0), 1)

    img = Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
    if save_path:
        img.save(save_path)
    return img


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ensure_model():
    if not _MODEL_PATH.exists():
        print(f"[MediaPipe] 모델 다운로드 중... ({_MODEL_URL})")
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
        print(f"[MediaPipe] 모델 저장됨: {_MODEL_PATH}")


def _to_rgb(image) -> np.ndarray:
    if isinstance(image, str):
        img = cv2.imread(image)
        if img is None:
            raise FileNotFoundError(f"이미지를 읽을 수 없습니다: {image}")
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    if isinstance(image, Image.Image):
        return np.array(image.convert("RGB"))
    # BGR ndarray
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def _detect_landmarks(img_rgb: np.ndarray, min_confidence: float):
    _ensure_model()
    base_options = mp_python.BaseOptions(model_asset_path=str(_MODEL_PATH))
    options = mp_vision.FaceLandmarkerOptions(
        base_options=base_options,
        num_faces=1,
        min_face_detection_confidence=min_confidence,
        min_face_presence_confidence=min_confidence,
    )
    detector = mp_vision.FaceLandmarker.create_from_options(options)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
    result = detector.detect(mp_image)
    if not result.face_landmarks:
        return None
    return result.face_landmarks[0]  # list of NormalizedLandmark


def _pt(lm, key: str, h: int, w: int) -> np.ndarray:
    l = lm[_LM[key]]
    return np.array([l.x * w, l.y * h], dtype=np.float32)


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _compute_features(lm, shape: tuple) -> FaceFeatureVector:
    h, w = shape[:2]
    g = lambda k: _pt(lm, k, h, w)

    face_w = _dist(g("left_cheek"), g("right_cheek"))
    face_h = _dist(g("forehead"), g("chin"))
    eps = 1e-6

    left_ear = _dist(g("left_eye_top"), g("left_eye_bottom")) / (
        _dist(g("left_eye_outer"), g("left_eye_inner")) + eps
    )
    right_ear = _dist(g("right_eye_top"), g("right_eye_bottom")) / (
        _dist(g("right_eye_outer"), g("right_eye_inner")) + eps
    )
    eye_ar = (left_ear + right_ear) / 2.0

    left_center = (g("left_eye_outer") + g("left_eye_inner")) / 2.0
    right_center = (g("right_eye_outer") + g("right_eye_inner")) / 2.0
    eye_dist_ratio = _dist(left_center, right_center) / (face_w + eps)

    nose_h = _dist(g("nose_bridge"), g("nose_tip")) / (face_h + eps)
    nose_w = _dist(g("nose_left"), g("nose_right")) / (face_w + eps)
    mouth_w = _dist(g("mouth_left"), g("mouth_right")) / (face_w + eps)
    jaw_w = _dist(g("left_jaw"), g("right_jaw")) / (face_w + eps)

    nose_tip_y = g("nose_tip")[1]
    forehead_y = g("forehead")[1]
    chin_y = g("chin")[1]
    forehead_ratio = (nose_tip_y - forehead_y) / (face_h + eps)
    chin_ratio = (chin_y - nose_tip_y) / (face_h + eps)

    return FaceFeatureVector(
        eye_aspect_ratio=float(eye_ar),
        eye_distance_ratio=float(eye_dist_ratio),
        face_width_height_ratio=float(face_w / (face_h + eps)),
        nose_height_ratio=float(nose_h),
        nose_width_ratio=float(nose_w),
        mouth_width_ratio=float(mouth_w),
        jaw_width_ratio=float(jaw_w),
        forehead_ratio=float(forehead_ratio),
        chin_ratio=float(chin_ratio),
    )
