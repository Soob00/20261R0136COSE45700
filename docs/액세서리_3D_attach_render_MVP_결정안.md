# 액세서리 3D Attach Render MVP 결정안

## 1. 목적

이 문서는 액세서리 feasibility test 이후, `2D attach preview` 대신 `3D attach render`를 MVP 검증 경로로 채택하기로 한 결정과 구현 경계를 정리한다.

핵심 목표는 다음과 같다.

- VARCO로 생성한 액세서리 GLB를 아바타에 실제로 부착했을 때 결과가 검수 가능한지 확인한다.
- feasibility 전용 실행 코드와 제품 공통 규칙을 분리한다.
- 이후 프론트 편집 기능이 붙더라도 placement 규칙과 preset 메타데이터를 재사용할 수 있게 한다.

## 2. 왜 2D preview를 대체하는가

기존 `base_avatar_image` 방식은 다음 한계가 확인되었다.

- 2D 합성 결과만으로는 실제 3D 공간에서 부착이 되었는지 판단하기 어렵다.
- scale, depth, pivot, rotation 문제가 preview에 충분히 드러나지 않는다.
- `postprocess`는 성공해도 attach preview가 검수 목적을 만족하지 못할 수 있다.

따라서 attach preview의 주 경로를 `3D avatar render`로 바꾸고, 2D 합성은 fallback/debug 용도로만 유지한다.

## 3. 최종 구조 결정

구현 위치는 전부 `experiments/` 아래에 두지 않는다. 반대로 전부 앱 코드(`src/`)로도 올리지 않는다.

최종 구조는 다음처럼 나눈다.

### 3.1 `src/`에 둘 것

위치:

- `src/lib/accessory-attachment/types.ts`
- `src/lib/accessory-attachment/defaults.ts`
- `src/lib/accessory-attachment/index.ts`

역할:

- 액세서리 부착 spec 타입 정의
- `attachRegion -> anchorBone` 기본 매핑
- `category + attachRegion -> defaultScale/defaultRotation/defaultOffset` 규칙
- attach preview mode 타입 정의

이 계층은 제품 공통 규칙이다. feasibility, preset 등록, 프론트 runtime이 모두 공유해야 한다.

### 3.2 `experiments/`에 둘 것

위치:

- `experiments/accessory-feasibility/scripts/feasibility/stages.py`
- 필요 시 `experiments/accessory-feasibility/scripts/feasibility/render_attach_3d.py`

역할:

- feasibility `postprocess` orchestration
- sample/output 파일 경로 관리
- `postprocess.json`, `attachment_spec.json` 생성
- skip/fail/reused 로깅
- 3D render 호출 및 fallback 처리

이 계층은 실험 실행기다. 제품 runtime 코드와 수명주기가 다르므로 `src/`와 분리한다.

## 4. MVP 범위

이번 MVP는 다음 범위로 제한한다.

- 정면 1뷰 렌더
- 액세서리 1개 부착
- category별 기본 scale/rotation/offset 적용
- `anchorBone` 기본값은 `head` 중심으로 시작
- rigid attachment만 지원

이번 MVP에서 하지 않는 것:

- spring bone
- cloth/secondary animation
- 사용자 드래그 기반 위치 편집
- 다중 카메라 뷰 렌더
- 자동 pivot 보정

### 4.1 렌더 엔진 결정

3D attach render의 실제 렌더 엔진은 Python 단독 구현으로 두지 않는다.

- feasibility orchestration은 기존처럼 Python이 담당한다.
- 실제 3D render는 Node + `three` + VRM loader 기반 오프라인 스크립트로 고정한다.
- Python `postprocess`는 이 렌더 스크립트를 호출하고, 산출물과 메타를 수집하는 역할만 가진다.

이유:

- 현재 앱 코드에는 이미 VRM/attachment 관련 핵심 구현이 `three` 계열에 있다.
- Python 단독 렌더 경로를 만들면 제품 runtime과 실험 경로가 다시 갈라진다.
- 오프라인 렌더와 제품 런타임이 같은 3D 스택을 공유해야 placement 규칙 재사용이 가능하다.

## 5. Config 결정

`feasibility.json`에는 3D attach render용 항목을 별도로 둔다.

권장 구조:

```json
{
  "preview": {
    "attach_render_mode": "3d",
    "base_avatar_model_path": "../../public/models/CustomizableCharacter.vrm",
    "base_avatar_path": "../../public/thumbnails/hair-02.png",
    "camera_view": "front",
    "render_width": 1024,
    "render_height": 1024,
    "background": "transparent",
    "camera_distance": 1.8,
    "camera_fov": 30,
    "light_preset": "studio_soft",
    "fallback_to_2d": true
  },
  "attachment": {
    "default_anchor_bone_by_region": {
      "face_center": "head",
      "head_top": "head",
      "head_side_upper_left": "head",
      "head_side_upper_right": "head"
    },
    "default_scale_by_category": {
      "glasses": 1.0,
      "hairpin": 0.35,
      "hair_clip": 0.4,
      "hair_bow": 0.55
    },
    "default_offset_by_region": {
      "face_center": [0.0, 0.02, 0.08],
      "head_top": [0.0, 0.18, 0.0],
      "head_side_upper_left": [-0.09, 0.12, 0.0],
      "head_side_upper_right": [0.09, 0.12, 0.0]
    },
    "default_rotation_by_region": {
      "face_center": [0, 0, 0],
      "head_top": [0, 0, 0],
      "head_side_upper_left": [0, 0, -12],
      "head_side_upper_right": [0, 0, 12]
    }
  }
}
```

의미:

- `base_avatar_model_path`는 실제 3D attach render 대상 아바타다.
- `base_avatar_path`는 2D fallback/debug 용도다.
- `attachment.*`는 제품 공통 placement 기본값의 실험용 override다.

추가 원칙:

- `glasses`는 `head` bone 단독 부착으로 해석하지 않는다.
- `glasses`는 반드시 `face_center` 전용 offset preset을 적용한다.
- 즉, `anchorBone = head`는 기준점일 뿐이며 최종 배치는 `region-aware offset`까지 포함한 spec으로 결정한다.

### 5.1 좌표계와 단위

placement 관련 수치는 아래 규칙으로 고정한다.

- `offset`: anchor bone local space 기준 `[x, y, z]`
- `rotation`: degrees 기준 `[x, y, z]`
- `scale`: uniform scale 단일 값

초기 MVP에서는 `scale`을 벡터가 아닌 단일 값으로 제한한다.
비균일 scale은 이후 단계로 미룬다.

### 5.2 bone 탐색 fallback

`anchorBone` 해석은 아래 순서로 수행한다.

1. VRM humanoid bone 이름 기준 탐색
2. scene graph 이름 기반 fallback 탐색
3. 둘 다 실패하면 `anchor_bone_not_found`

즉, `head`라는 문자열이 scene에 없더라도 VRM humanoid의 `head`를 우선 사용한다.

## 6. `postprocess.json` 스키마 결정

`postprocess.json`은 2D preview 중심에서 3D 부착 결과 요약 중심으로 확장한다.

권장 스키마:

```json
{
  "faceCount": 292558,
  "vertexCount": 194817,
  "meshCount": 1,
  "bounds": {
    "min": [-0.5, -0.14072, -0.494731],
    "max": [0.49998, 0.140743, 0.494719]
  },
  "defaultScale": 1.0,
  "defaultRotation": [0, 0, 0],
  "defaultOffset": [0.0, 0.02, 0.08],
  "pivotPolicy": "object_center",
  "anchorBone": "head",
  "attachRegion": "face_center",
  "inputSource": "original",
  "assetPreviewPath": "outputs/glasses_only_001/preview/acc_001_asset_preview.png",
  "attachPreviewPath": "outputs/glasses_only_001/preview/acc_001_attach_preview_3d.png",
  "attachPreviewMode": "3d_avatar_render",
  "baseAvatarModelPath": "../../public/models/CustomizableCharacter.vrm",
  "avatarTemplateId": "base_vrm_v1",
  "attachmentSpecPath": "outputs/glasses_only_001/preview/attachment_spec.json",
  "placementSource": "config_default",
  "resolvedPlacement": {
    "scale": 1.0,
    "rotation": [0, 0, 0],
    "offset": [0.0, 0.02, 0.08]
  },
  "camera": {
    "view": "front",
    "distance": 1.8,
    "fov": 30
  },
  "render": {
    "width": 1024,
    "height": 1024,
    "background": "transparent"
  },
  "visibility": {
    "inFrame": true,
    "projectedBBox": [420, 300, 210, 88],
    "projectedAreaRatio": 0.0176
  }
}
```

추가 산출물:

- `preview/attachment_spec.json`
- `preview/acc_001_attach_preview_3d.png`

필수 추가 필드 설명:

- `avatarTemplateId`: 어떤 아바타 기준으로 placement를 계산했는지 식별
- `placementSource`: `config_default | preset_default | manual_override`
- `visibility`: 렌더 결과가 실제로 검수 가능한지 판단하기 위한 최소 sanity 정보

### 6.1 `attachment_spec.json` 권장 스키마

`attachment_spec.json`은 render 입력 계약을 담당한다.

```json
{
  "sampleId": "glasses_only_001",
  "category": "glasses",
  "avatarTemplateId": "base_vrm_v1",
  "assetModelPath": "outputs/glasses_only_001/glb_raw/acc_001_raw.glb",
  "baseAvatarModelPath": "../../public/models/CustomizableCharacter.vrm",
  "anchorBone": "head",
  "attachRegion": "face_center",
  "pivotPolicy": "object_center",
  "scale": 1.0,
  "rotation": [0, 0, 0],
  "offset": [0.0, 0.02, 0.08],
  "placementSource": "config_default",
  "cameraView": "front",
  "renderWidth": 1024,
  "renderHeight": 1024,
  "background": "transparent"
}
```

## 6.2 Node render script I/O 계약

Python `postprocess`는 Node render script를 아래 계약으로 호출한다.

입력:

- `attachment_spec.json` 경로

출력:

- `preview/acc_001_attach_preview_3d.png`
- `preview/render_result.json`

`render_result.json` 최소 필드:

```json
{
  "ok": true,
  "inFrame": true,
  "projectedBBox": [420, 300, 210, 88],
  "projectedAreaRatio": 0.0176,
  "anchorBoneResolved": "head",
  "warnings": []
}
```

종료 코드:

- `0`: render 수행 완료, 결과 JSON 생성
- `1`: render 실패, 결과 JSON에 오류 기록 시도

즉, Python은 종료 코드와 `render_result.json`을 함께 보고 최종 성공/실패를 판단한다.

## 7. 제품 공통 타입 결정

`src/types/accessory.ts`를 기준으로 다음 타입/필드를 재사용한다.

- `anchorBone`
- `attachRegion`
- `pivotPolicy`
- `defaultScale`
- `defaultRotation`
- `defaultOffset`

추가 권장 타입:

```ts
export type AttachPreviewMode =
  | '3d_avatar_render'
  | 'base_avatar_image'
  | '2d_fallback';

export interface AccessoryAttachmentSpec {
  category: AccessoryCategory;
  avatarTemplateId?: string;
  anchorBone: string;
  attachRegion: AttachRegion;
  pivotPolicy: PivotPolicy;
  scale: number;
  rotation: [number, number, number];
  offset: [number, number, number];
  placementSource?: 'config_default' | 'preset_default' | 'manual_override';
}
```

## 8. 구현 파일별 변경안

### 8.1 `src/lib/accessory-attachment/types.ts`

추가 내용:

- `AttachPreviewMode`
- `AccessoryAttachmentSpec`

### 8.2 `src/lib/accessory-attachment/defaults.ts`

추가 내용:

- `resolveDefaultAnchorBone(region)`
- `resolveDefaultAttachmentSpec(category, region)`

초기 규칙:

- `glasses + face_center`
- `hairpin/hair_clip/hair_bow + head_side_upper_left/right or head_top`

추가 규칙:

- `glasses`는 `head` bone 기준에 `face_center` 전용 offset preset을 반드시 결합한다.
- `glasses`는 기본적으로 화면 전면 가시성을 확보하는 방향으로 `z` offset을 가진다.
- `hair_accessory` 계열은 좌우 비대칭 부착을 허용하되, 초기 MVP는 단일 side 기준 preset만 둔다.

### 8.3 `src/lib/accessory-attachment/index.ts`

추가 내용:

- 위 타입과 resolver re-export

### 8.4 `experiments/accessory-feasibility/scripts/feasibility/stages.py`

변경 내용:

- `run_postprocess()`를 orchestration 중심으로 정리
- `_build_attachment_spec(...)` 추가
- `_render_attach_3d(...)` 추가
- `_render_attach_2d_fallback(...)` 분리
- `postprocess.json`에 3D render 메타 기록
- 실패 시 `fallback_to_2d` 설정에 따라 2D fallback 수행

추가 원칙:

- `_render_attach_3d(...)`는 직접 3D 로직을 구현하지 않고, Node render script 호출 어댑터로 시작한다.
- render 결과가 있어도 `visibility` sanity를 통과하지 못하면 성공으로 처리하지 않는다.

### 8.5 `experiments/accessory-feasibility/config/feasibility.json`

변경 내용:

- `preview.attach_render_mode`
- `preview.base_avatar_model_path`
- `preview.fallback_to_2d`
- `preview.render_width`
- `preview.render_height`
- `preview.camera_distance`
- `preview.camera_fov`
- `attachment.*` 기본값

## 9. 성공/실패 기준

성공:

- `attachment_spec.json` 생성
- `acc_001_attach_preview_3d.png` 생성
- `postprocess.json`에 `attachPreviewMode = "3d_avatar_render"` 기록
- accessory가 카메라 프레임 안에 들어와야 한다.
- `projectedBBox`가 비어 있지 않아야 한다.
- `projectedAreaRatio`가 너무 작지 않아야 한다.

즉, 파일 생성만으로는 성공으로 보지 않는다. `render succeeded`와 `render usable`을 구분한다.

초기 MVP visibility threshold:

- `inFrame == true`
- `projectedAreaRatio >= 0.003`
- `projectedBBox.width >= 24`
- `projectedBBox.height >= 12`

실패 분류:

- `base_avatar_model_missing`
- `accessory_model_missing`
- `unsupported_avatar_format`
- `anchor_bone_not_found`
- `render_failed`
- `render_visibility_failed`

partial success:

- 3D render 실패
- `fallback_to_2d = true`
- `attachPreviewMode = "2d_fallback"`

해석 원칙:

- `2d_fallback`은 디버그 산출물이다.
- `2d_fallback`은 feasibility pass 판정에 포함하지 않는다.
- 3D render가 실패했는데 2D fallback만 남은 경우 최종 상태는 `partial_success`로 본다.

### 9.1 stage status 기록 규칙

`.stage_status/postprocess.json`은 기존 status 체계를 유지하되, `partial_success`는 details로 표현한다.

규칙:

- 3D render 성공: `status = "succeeded"`
- 3D render 실패 + 2D fallback 없음: `status = "failed"`
- 3D render 실패 + 2D fallback 있음: `status = "failed"` + `details.partialSuccess = true`

이렇게 해야 summary 집계가 2D fallback을 성공으로 오인하지 않는다.

### 9.2 preset 등록 경계

MVP 기준으로는 다음 조건을 모두 만족해야 preset 등록 후보로 승격할 수 있다.

- GLB validation 성공
- 3D attach render 성공
- visibility sanity 통과
- review에서 `approved`

즉, GLB만 정상이고 3D 부착 검증이 실패한 asset은 등록 후보로 취급하지 않는다.

## 10. 구현 순서

1. `src/lib/accessory-attachment/` 추가
2. `feasibility.json` 확장
3. `attachment_spec.json` 생성 구현
4. `postprocess.json` 확장
5. Node render script I/O 계약 구현
6. 3D render 연결
7. 2D fallback 정리

## 11. 최종 판단

3D attach render는 feasibility 전용 로직이 아니라, 향후 preset 등록과 runtime attachment가 공유해야 할 placement 규칙을 포함한다.

따라서 최종 구현 결정은 다음과 같다.

- 제품 공통 규칙과 타입은 `src/lib/accessory-attachment/`로 올린다.
- feasibility 실행과 산출물 생성은 `experiments/accessory-feasibility/`에 남긴다.
- `postprocess`의 주 경로는 `3D avatar render`로 전환하고, 2D 합성은 fallback/debug로만 유지한다.
