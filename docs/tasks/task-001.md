# Task 001: Pipeline Integration Stabilization

## Objective

이미지 업로드에서 face-keys, texture, hair matching 결과가 안정적으로 에디터 상태에 적용되도록 현재 통합 흐름을 점검하고 보강한다.

## Related Docs Read

- [product/requirements.md](../product/requirements.md)
- [architecture/frontend.md](../architecture/frontend.md)
- [architecture/backend.md](../architecture/backend.md)
- [architecture/repo_code_structure.md](../architecture/repo_code_structure.md)
- `face-feature/README.md`
- `face-feature/PIPELINE_DOC.md`

## Related Code Read

- `src/app/api/pipeline/face-keys/route.ts`
- `src/app/api/pipeline/texture/route.ts`
- `src/app/api/pipeline/generate-3d/route.ts`
- `src/lib/api/types.ts`
- `src/lib/api/remote.ts`
- `src/lib/api/provider.tsx`
- `src/components/editor/ReferenceModelUpload.tsx`
- `src/components/editor/FaceFeatureApply.tsx`
- `src/stores/editorStore.ts`
- `src/types/pipeline.ts`

## Implementation Plan

1. API response shape를 `src/types/pipeline.ts`와 Python output 기준으로 대조한다.
2. `texture` route의 `faceKeys`, `hairMatch`, `textures` 반환값이 UI에서 모두 소비되는지 확인한다.
3. `ReferenceModelUpload`와 `FaceFeatureApply`의 로딩/에러 상태를 통일한다.
4. `editorStore.applyPipelineResult`, `applyTextureResult`, hair recommendation 적용 action의 undo/redo 동작을 검증한다.
5. ADF 실패 시 fallback 결과가 UI에 적용 가능한 최소 shape를 보장한다.
6. 실패 메시지가 사용자에게 전달되는지 확인하고, 콘솔 전용 오류를 줄인다.

## Impact Files

- `src/app/api/pipeline/face-keys/route.ts`
- `src/app/api/pipeline/texture/route.ts`
- `src/components/editor/ReferenceModelUpload.tsx`
- `src/components/editor/FaceFeatureApply.tsx`
- `src/stores/editorStore.ts`
- `src/types/pipeline.ts`
- `face-feature/run_extract.py`
- `face-feature/pipeline/*`
- `src/pipeline/*`

## Test Plan

- `npm run lint`
- `npm run build`
- mock ADF 서버 실행 후 레퍼런스 이미지 업로드
- face-keys만 적용하는 흐름 확인
- texture + hair matching 통합 흐름 확인
- ADF 서버를 끈 상태에서 fallback 또는 오류 표시 확인
- undo/redo 후 morph/material 상태 복구 확인

## Acceptance Criteria

- 이미지 업로드 한 번으로 얼굴 슬라이더와 텍스처가 깨지지 않고 적용된다.
- 실패 시 API route가 JSON error를 반환하고 UI가 오류 상태를 보여준다.
- TypeScript build에서 pipeline result 타입 오류가 없다.

