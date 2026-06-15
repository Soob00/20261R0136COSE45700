# Docs Index

이 디렉터리는 제품 요구사항, 아키텍처, 개발 표준, 구현 태스크, 의사결정을 분리해 관리한다.

## Structure

```text
docs/
  product/       제품 요구사항, 발표 자료, PRD 원본
  architecture/  프론트엔드, 백엔드, 데이터 구조 설계
  standards/     코딩 스타일, API 규칙, 테스트 기준
  tasks/         구현 계획, 영향 파일, 테스트 계획
  decisions/     ADR 및 기술 리서치
```

## Primary Reading Order

1. [product/requirements.md](product/requirements.md)
2. [architecture/frontend.md](architecture/frontend.md)
3. [architecture/backend.md](architecture/backend.md)
4. [architecture/db.md](architecture/db.md)
5. [architecture/deployment-aws.md](architecture/deployment-aws.md)
6. [tasks/task-001.md](tasks/task-001.md)
7. [tasks/task-002.md](tasks/task-002.md)
8. [tasks/task-003.md](tasks/task-003.md)
9. [standards/testing.md](standards/testing.md)

## Current Architecture Decision

별도 Java backend는 두지 않는다. `20261R0136COSE45700` 내부의 Next.js API Routes를 backend로 사용하고, 운영 저장소는 AWS RDS PostgreSQL을 사용한다. Java backend 관련 문서는 과거 검토 자료로 `decisions/`에 보존한다.

