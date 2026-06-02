# Frontend Architecture

## Current Shape

프론트엔드는 Next.js 16 App Router 기반의 3D 아바타 에디터다. 루트 화면은 `/dev/viewer` 중심으로 동작하며, UI 컴포넌트, 3D 뷰어, Zustand store, API client가 분리되어 있다.

## Main Files

- `src/app/dev/viewer/page.tsx`: 에디터 화면, 업로드, 탭, 사이드바, 뷰어 조합
- `src/components/editor/*`: 슬라이더, 템플릿, 프리셋, 버전, 이미지 업로드 UI
- `src/components/viewer/*`: Three.js Canvas, VRM 로딩, 헤어/의상 attachment, 카메라/조명
- `src/stores/editorStore.ts`: morph/material/hair/version 상태와 undo/redo
- `src/types/editor.ts`, `src/types/pipeline.ts`: 에디터 및 파이프라인 계약 타입
- `src/lib/api/*`: local/remote API client와 provider

## Data Flow

```text
ReferenceModelUpload / FaceFeatureApply
  -> APIProvider(useAPI)
  -> Next.js API route or remote API
  -> PipelineResult / TextureResult
  -> editorStore.applyPipelineResult / applyTextureResult
  -> VRMModel / HairAttachment / MaterialEditor
```

## Implementation Guidelines

- UI 컴포넌트는 store mutation을 직접 호출하되, API 호출은 `src/lib/api` 계약을 통해 수행한다.
- VRM/Three.js 객체 접근은 viewer 계층에 가둔다.
- 파이프라인 결과 타입은 `src/types/pipeline.ts`를 기준으로 맞춘다.
- localStorage 기반 동작은 개발 fallback으로 유지하되, remote mode가 기본값이다.

## Risks

- pipeline response shape가 Python과 TypeScript에서 동시에 바뀌면 UI 적용이 깨질 수 있다.
- base64 texture data URL은 상태 크기를 키우므로 저장/동기화 범위를 제한해야 한다.
- browser-only API(localStorage, File, Canvas)는 SSR 경계에서 접근하지 않아야 한다.

