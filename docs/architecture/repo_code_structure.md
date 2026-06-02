# Repository Code Structure Analysis

## 1) 한 줄 요약
이 레포는 **Next.js 16 기반 3D 아바타 편집기(프론트엔드)**와 **Python 기반 얼굴 특징 추출/파라미터 추정 파이프라인**, 그리고 **헤어/의상 에셋 가공 스크립트**가 함께 들어있는 멀티 파트 프로젝트다.

## 2) 최상위 디렉터리 구조

```text
.
├── src/                         # Next.js 앱 소스
├── public/                      # 정적 리소스(썸네일 등)
├── scripts/                     # VRM/GLB 가공 및 분석 스크립트(JS/Python)
├── face-feature/                # 이미지→아바타 파라미터 추출 Python 파이프라인
├── experiments/                 # 실험 코드(애니메 얼굴 검출 등)
├── hair-library/                # 헤어 라이브러리 산출물(GLB/메타/썸네일)
├── docs/                        # 설계/리서치/가이드 문서
├── _bmad/, _bmad-output/        # BMAD 관련 워크플로/설정 산출물
└── package.json                 # Next.js 앱 의존성/스크립트
```

## 3) 애플리케이션(Next.js) 구조 (`src`)

### 3.1 라우팅 / 엔트리
- `src/app/page.tsx`
  - 루트(`/`) 접근 시 `/dev/viewer`로 즉시 redirect.
- `src/app/dev/viewer/page.tsx`
  - 메인 편집 화면.
  - 좌측 사이드바(탭/슬라이더/프리셋/버전) + 우측 3D 뷰포트 구성.
- `src/app/layout.tsx`
  - 전역 레이아웃/폰트/메타데이터 설정.

### 3.2 UI 계층
- `src/components/viewer/*`
  - `ThreeJSViewer.tsx`: react-three-fiber `Canvas` 루트.
  - `VRMModel.tsx`: VRM 모델 로딩/연동.
  - `HairAttachment.tsx`, `OutfitAttachment.tsx`: 선택 에셋 부착.
  - `CameraControls.tsx`, `SceneLighting.tsx`, `ViewerToolbar.tsx`, `WebGLCheck.tsx`.
- `src/components/editor/*`
  - Morph/Material/Template/Preset/Version 편집 패널 컴포넌트.

### 3.3 상태 관리
- `src/stores/editorStore.ts` (Zustand)
  - 핵심 편집 상태: morph/bone/material/hair/outfit/version.
  - undo/redo 스택 내장(`MAX_HISTORY=50`).
  - 버전 저장/복원/삭제/이름변경(localStorage 연동).

### 3.4 도메인 로직
- `src/lib/vrm/*`
  - VRM 로딩, 재질 탐지, 참조 보관.
- `src/lib/hair-matching/*`
  - VRM 헤어 색/기하 특징 추출 후 프리셋 매칭 추천.
- `src/lib/api/*`
  - API 추상화 계층. 현재 `local.ts`는 localStorage 기반 구현.

### 3.5 데이터/타입/훅
- `src/data/templates.ts`, `src/data/presets.ts`: 템플릿/프리셋 메타데이터.
- `src/types/*`: editor/preset/template 타입 정의.
- `src/hooks/*`: 단축키, 캡처, VRM 접근, 테마 훅.

## 4) 런타임 동작 흐름 (프론트)

1. `/` 진입 → `/dev/viewer` 리다이렉트.
2. `ThreeJSViewer`가 기본 VRM(`/models/CustomizableCharacter.vrm`)을 로드.
3. 로드 완료 시 morph/expression/bone/material 목록을 수집.
4. `hair-matching`이 VRM+재질 분석 후 헤어 프리셋 추천값 생성.
5. 사용자가 슬라이더/프리셋/재질/버전을 조정하면 `editorStore`가 상태 반영.
6. 선택된 hair/outfit 프리셋은 Attachment 컴포넌트에서 씬에 부착.
7. 버전 저장은 썸네일 캡처와 함께 localStorage에 저장.

## 5) Python 파이프라인 구조 (`face-feature`)

- `main.py`
  - CLI 진입점. `run`, `extract`, `debug`, `batch` 명령 지원.
- `pipeline/`
  - `pipeline.py`: Stage 2~6 오케스트레이션.
  - `feature_extractor.py`, `avatar_keys.py`, `geometry.py`: 특징 계산 핵심.
  - `renderer.py`: GLB 멀티뷰 렌더링(front/left/right/quarter + depth).
  - `template_selector.py`: 특징 기반 템플릿 선택.
  - `adf_client.py`, `pupil_detector.py`: 랜드마크/눈동자 검출.
  - `varco_client.py`: 외부 2D→3D 서비스 연동.
- `tools/`
  - 시각화/검증 유틸리티.
- `PIPELINE_DOC.md`
  - 단계별 입력/출력 및 모델 의존성을 상세 기술.

## 6) 스크립트 영역 (`scripts`)

VRM/GLB 자산을 실제 서비스 용도로 정리하는 배치/유틸 스크립트 모음.

- JS(mjs): `extract-hair`, `extract-cloth`, `merge-hair`, `inspect-vrm`, `test-hair-match` 등.
- Python: `retopo_avatar`, `verify_retopo`, `build_custom_avatar`, `analyze_topology` 등.
- 일부 결과 JSON(`hair-analysis.json`, `topology_report.json` 등)이 같은 폴더에 저장됨.

## 7) 실험/에셋 영역

- `experiments/anime_face_detector/`
  - 외부 리포 기반 실험 코드 + 입력/출력 샘플 + 파이프라인 스크립트.
- `hair-library/output/front/front_001/`
  - 헤어 단위 산출물 예시(`mesh.glb`, `meta.json`, 썸네일).

## 8) 기술 스택 요약

- Frontend: `Next 16.2.4`, `React 19`, `TypeScript`, `Tailwind v4`.
- 3D: `three`, `@react-three/fiber`, `@react-three/drei`, `@pixiv/three-vrm`.
- State: `zustand`.
- Pipeline: Python + OpenCV + ADF + pyrender 기반 처리.

## 9) 현재 구조의 특징

- 단일 레포 안에 **실시간 편집 UI + 오프라인 분석 파이프라인 + 자산 가공 툴링**이 공존.
- 실행 경로가 명확히 분리됨.
  - 웹앱 실행: `npm run dev`
  - 파이프라인 실행: `python face-feature/main.py ...`
  - 자산 가공: `scripts/*` 개별 실행
- 기능적으로는 “아바타 편집기”가 중심이고, 나머지 영역은 편집 품질/자동화 고도화를 지원하는 보조 축으로 보임.
