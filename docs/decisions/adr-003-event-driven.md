# ADR 003: Pipeline Execution Model

## Status

Proposed

## Context

현재 pipeline API는 요청 중 Node.js route가 Python subprocess를 직접 실행한다. face-keys는 비교적 짧지만 texture와 generate-3d는 수 분까지 걸릴 수 있다.

## Decision

MVP에서는 synchronous API route 실행을 유지한다. 다만 generate-3d처럼 긴 작업은 이후 job queue 기반 비동기 실행으로 전환할 수 있게 `pipeline_runs` 개념을 문서화한다.

## Consequences

- 단기 구현과 디버깅이 단순하다.
- 긴 요청은 timeout과 사용자 대기 UX 문제가 있다.
- 비동기 전환 시 API는 `runId` 반환, status polling, artifact 조회 방식으로 바뀌어야 한다.

