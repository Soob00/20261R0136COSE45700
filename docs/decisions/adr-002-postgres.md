# ADR 002: PostgreSQL for Persistent Metadata

## Status

Proposed

## Context

아바타 편집 상태는 JSON 형태이며, 버전/파이프라인 실행 로그/템플릿 메타데이터가 함께 저장될 가능성이 높다. GLB, VRM, PNG 같은 바이너리는 DB에 직접 넣기 어렵다.

## Decision

운영 저장소가 필요해지면 PostgreSQL을 기본 DB로 사용한다. morph/material/hair parameters는 JSONB로 저장하고, 대용량 파일은 object storage 또는 파일 저장소로 분리한다.

## Consequences

- JSONB 덕분에 파라미터 shape 변경에 대응하기 쉽다.
- 정규화가 필요한 사용자, 아바타, 버전 관계는 RDB로 관리할 수 있다.
- 파일 보관 정책은 별도 설계가 필요하다.

