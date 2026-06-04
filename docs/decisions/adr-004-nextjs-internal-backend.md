# ADR 004: Next.js Internal Backend

## Status

Accepted

## Context

이 프로젝트는 Next.js frontend, API Routes, Python 파이프라인이 같은 저장소에 있다. 별도 Java backend를 만들면 API 계약, 배포, 인증, CORS, CI/CD 경계가 늘어난다. 현재 목표는 EC2/RDS 기반으로 빠르게 운영 가능한 MVP를 만드는 것이다.

## Decision

별도 Java backend를 두지 않는다. `20261R0136COSE45700` 내부의 Next.js API Routes를 backend로 사용한다. EC2에는 Next.js 앱과 Python 파이프라인 런타임을 함께 배포하고, RDS PostgreSQL을 운영 DB로 사용한다.

## Consequences

- 한 저장소, 한 배포 단위로 MVP 속도를 유지할 수 있다.
- frontend와 backend 타입/계약을 같은 코드베이스에서 관리할 수 있다.
- API route가 긴 Python 작업을 직접 실행하므로, 트래픽 증가 시 queue/worker 분리가 필요하다.
- Java backend 설계 문서는 active architecture가 아니라 과거 검토 자료로 보존한다.
