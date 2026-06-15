# Coding Style

## TypeScript

- TypeScript 타입은 `src/types/*` 또는 기능별 `types.ts`에 둔다.
- API 응답 타입은 Python 출력 JSON과 1:1로 맞추고, optional/null 가능성을 명시한다.
- React 컴포넌트는 UI 책임을 우선하고, 파이프라인 호출은 API client 계층을 통한다.
- browser-only 코드는 client component 또는 event handler 안에서 실행한다.
- 경로 alias는 기존 `@/` 패턴을 사용한다.

## React / UI

- 에디터 상태 변경은 `useEditorStore` action을 사용한다.
- 큰 3D 객체나 VRM runtime 객체는 Zustand에 넣지 않는다.
- 업로드, 로딩, 실패 상태는 UI에서 명시적으로 표시한다.
- 컴포넌트는 기존 `components/editor`, `components/viewer`, `components/ui` 경계를 따른다.

## Python

- 파이프라인 CLI는 JSON 파일 입출력을 기준으로 둔다.
- Next.js API route에서 호출되는 Python script는 stdout 로그와 output file을 분리한다.
- calibration 값과 mapping 공식은 `face-feature/pipeline` 쪽 문서와 함께 갱신한다.

## Documentation

- 제품 결정은 `docs/decisions/adr-*.md`에 기록한다.
- 구현 작업은 `docs/tasks/task-*.md`에 영향 파일과 테스트 계획을 포함한다.
- 리서치 원문은 보존하고, 표준 문서는 현재 결정과 실행 기준을 요약한다.

