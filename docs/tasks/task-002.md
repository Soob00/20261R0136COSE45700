# Task 002: Persistence and API Contract Hardening

## Objective

현재 localStorage 중심 저장과 remote API client 계약을 정리해, 이후 PostgreSQL 또는 별도 백엔드로 옮겨도 프론트 계약이 흔들리지 않게 한다.

## Related Docs Read

- [architecture/db.md](../architecture/db.md)
- [architecture/backend.md](../architecture/backend.md)
- [architecture/backend_strategy_comparison.md](../architecture/backend_strategy_comparison.md)
- [architecture/java_backend_design_and_portfolio_template.md](../architecture/java_backend_design_and_portfolio_template.md)
- [standards/api-conventions.md](../standards/api-conventions.md)

## Related Code Read

- `src/lib/api/types.ts`
- `src/lib/api/local.ts`
- `src/lib/api/remote.ts`
- `src/lib/api/provider.tsx`
- `src/hooks/useVersionSync.ts`
- `src/stores/editorStore.ts`
- `src/types/editor.ts`
- `src/data/templates.ts`

## Implementation Plan

1. `AvatarRecord`, `AvatarVersion`, `TemplateMetadata`의 필수/선택 필드를 확정한다.
2. local client와 remote client의 메서드 반환값을 같은 shape로 맞춘다.
3. `NEXT_PUBLIC_API_MODE`와 `NEXT_PUBLIC_API_URL` 동작을 README와 API conventions에 맞춘다.
4. version 저장 정책을 store localStorage와 API client 중 어디가 source of truth인지 결정한다.
5. 운영 DB 후보 스키마를 `architecture/db.md` 기준으로 보강한다.
6. remote API가 없을 때 local fallback을 명확히 유지할지, 명시 전환만 허용할지 결정한다.

## Impact Files

- `src/lib/api/types.ts`
- `src/lib/api/local.ts`
- `src/lib/api/remote.ts`
- `src/lib/api/provider.tsx`
- `src/hooks/useVersionSync.ts`
- `src/stores/editorStore.ts`
- `src/types/editor.ts`
- `docs/architecture/db.md`
- `docs/standards/api-conventions.md`

## Test Plan

- `NEXT_PUBLIC_API_MODE=local npm run build`
- 기본 remote mode에서 `npm run build`
- localStorage avatar/version 저장, 목록 조회, 삭제 수동 확인
- remote API URL이 잘못됐을 때 오류가 UI까지 전달되는지 확인
- version save/rename/delete/restore가 최대 5개 정책을 지키는지 확인

## Acceptance Criteria

- local/remote client가 같은 TypeScript interface를 만족한다.
- API mode 전환 규칙이 문서와 코드에서 일치한다.
- DB 도입 시 필요한 테이블과 JSON 필드 경계가 문서화되어 있다.

