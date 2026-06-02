# ADR 001: Authentication

## Status

Proposed

## Context

현재 MVP는 로컬 개발과 파이프라인 검증이 중심이며, 사용자 계정 기반 저장은 구현되어 있지 않다. avatar/version 저장은 localStorage 또는 remote API client 계약만 존재한다.

## Decision

MVP 단계에서는 인증을 필수 범위에서 제외한다. 사용자별 영속 저장이 필요한 시점에 이메일/OAuth 기반 인증을 도입하고, `users` 테이블과 `avatars.user_id`를 연결한다.

## Consequences

- 단기 개발은 파이프라인 품질과 에디터 UX에 집중할 수 있다.
- 공유 환경에서 avatar ownership은 보장하지 않는다.
- 운영 전환 전에는 API key, 업로드 파일, 저장 데이터 접근 제어를 다시 설계해야 한다.

