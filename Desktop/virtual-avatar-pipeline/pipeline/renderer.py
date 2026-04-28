"""
GLB → 멀티뷰 2D 이미지 렌더러

pyrender를 primary로 사용.
- Windows (개발): pyglet 백엔드 (display 필요)
- Linux 서버 (운영): EGL 백엔드
  → PYOPENGL_PLATFORM=egl python main.py

4개 뷰 렌더링: front, left, right, quarter(45°)
"""

import os
import math
import numpy as np
from pathlib import Path
from PIL import Image
import trimesh
import pyrender


VIEWS = {
    "front":   {"yaw": 0,   "pitch": 0},
    "left":    {"yaw": 90,  "pitch": 0},
    "right":   {"yaw": -90, "pitch": 0},
    "quarter": {"yaw": 45,  "pitch": 5},
}

RESOLUTION = (512, 512)


def _make_camera_pose(yaw_deg: float, pitch_deg: float, distance: float = 1.5) -> np.ndarray:
    """
    yaw  : Y축 회전 (좌우)
    pitch: X축 회전 (상하)
    카메라가 원점을 바라보는 pose matrix 반환
    """
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)

    # 구면좌표 → 카메라 위치
    x = distance * math.sin(yaw) * math.cos(pitch)
    y = distance * math.sin(pitch)
    z = distance * math.cos(yaw) * math.cos(pitch)
    cam_pos = np.array([x, y, z])

    # look-at 행렬
    forward = -cam_pos / np.linalg.norm(cam_pos)
    world_up = np.array([0.0, 1.0, 0.0])
    right = np.cross(forward, world_up)
    if np.linalg.norm(right) < 1e-6:
        right = np.array([1.0, 0.0, 0.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)

    pose = np.eye(4)
    pose[:3, 0] = right
    pose[:3, 1] = up
    pose[:3, 2] = -forward
    pose[:3, 3] = cam_pos
    return pose


def _load_scene(glb_path: str) -> pyrender.Scene:
    mesh_or_scene = trimesh.load(glb_path, force="scene")

    scene = pyrender.Scene(bg_color=[1.0, 1.0, 1.0, 1.0], ambient_light=[0.4, 0.4, 0.4])

    if isinstance(mesh_or_scene, trimesh.Scene):
        for mesh in mesh_or_scene.geometry.values():
            if len(mesh.vertices) == 0:
                continue
            pr_mesh = pyrender.Mesh.from_trimesh(mesh, smooth=False)
            scene.add(pr_mesh)
    else:
        pr_mesh = pyrender.Mesh.from_trimesh(mesh_or_scene, smooth=False)
        scene.add(pr_mesh)

    return scene


def _add_lighting(scene: pyrender.Scene):
    # 정면 주광
    light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=3.0)
    scene.add(light, pose=_make_camera_pose(0, 20, 2.0))

    # 보조광 (좌측)
    fill = pyrender.DirectionalLight(color=[0.8, 0.8, 1.0], intensity=1.5)
    scene.add(fill, pose=_make_camera_pose(60, 10, 2.0))


def _center_scene_bounds(glb_path: str) -> tuple[float, float]:
    """GLB 로드 → 바운딩 박스 기준 distance 계산."""
    mesh_or_scene = trimesh.load(glb_path, force="scene")
    if isinstance(mesh_or_scene, trimesh.Scene):
        bounds = mesh_or_scene.bounds
    else:
        bounds = mesh_or_scene.bounds

    if bounds is None:
        return 1.5, 0.0

    center_y = (bounds[0][1] + bounds[1][1]) / 2.0
    size = np.linalg.norm(bounds[1] - bounds[0])
    distance = size * 1.2
    return distance, center_y


def render_multiview(glb_path: str, output_dir: str = None, resolution: tuple = RESOLUTION) -> dict[str, Image.Image]:
    """
    GLB 파일을 VIEWS에 정의된 각도로 렌더링.

    Args:
        glb_path: 입력 GLB 파일 경로
        output_dir: 이미지 저장 디렉토리 (None이면 저장 안 함)
        resolution: 출력 해상도 (width, height)

    Returns:
        {view_name: PIL.Image} 딕셔너리
    """
    distance, center_y = _center_scene_bounds(glb_path)

    renderer = pyrender.OffscreenRenderer(*resolution)
    camera = pyrender.PerspectiveCamera(yfov=math.radians(40), aspectRatio=resolution[0] / resolution[1])

    results = {}

    for view_name, angles in VIEWS.items():
        scene = _load_scene(glb_path)
        _add_lighting(scene)

        cam_pose = _make_camera_pose(angles["yaw"], angles["pitch"], distance)
        # Y축 center 보정
        cam_pose[1, 3] += center_y
        scene.add(camera, pose=cam_pose)

        color, _ = renderer.render(scene)
        img = Image.fromarray(color)
        results[view_name] = img

        if output_dir:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            img.save(str(Path(output_dir) / f"{view_name}.png"))
            print(f"[Renderer] saved {view_name}.png")

    renderer.delete()
    return results
