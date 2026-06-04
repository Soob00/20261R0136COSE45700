# Task 003: EC2/RDS Deployment Preparation

## Objective

별도 Java backend 없이 `20261R0136COSE45700` 내부 Next.js backend를 EC2에 배포하고, RDS PostgreSQL 기반 persistence를 붙인다.

## Related Docs Read

- [../architecture/backend.md](../architecture/backend.md)
- [../architecture/db.md](../architecture/db.md)
- [../architecture/deployment-aws.md](../architecture/deployment-aws.md)
- [../decisions/adr-002-postgres.md](../decisions/adr-002-postgres.md)
- [../decisions/adr-004-nextjs-internal-backend.md](../decisions/adr-004-nextjs-internal-backend.md)
- AWS EC2/RDS connectivity docs
- AWS RDS security group docs
- AWS RDS backup docs

## Related Code to Read

- `src/app/api/pipeline/face-keys/route.ts`
- `src/app/api/pipeline/texture/route.ts`
- `src/app/api/pipeline/generate-3d/route.ts`
- `src/lib/api/types.ts`
- `src/lib/api/local.ts`
- `src/lib/api/remote.ts`
- `src/stores/editorStore.ts`
- `face-feature/run_extract.py`
- `src/pipeline/*`

## Implementation Plan

1. DB access layer 결정
   - lightweight SQL client or ORM 선택
   - `DATABASE_URL` 기반 connection helper 생성
   - migration 실행 방식을 정한다.
2. Persistence API 구현
   - `avatars` save/load/list/delete
   - `avatar_versions` save/list/update/delete
   - template은 static data로 유지하거나 DB read-only seed로 전환
3. Client contract 정리
   - `localAPIClient`는 dev fallback
   - production은 same-origin API route 사용
   - `NEXT_PUBLIC_API_*` 환경변수 정책 정리
4. AWS 배포 준비
   - EC2 provision
   - RDS PostgreSQL provision
   - security group 연결
   - server-only env 설정
   - Python venv와 ADF server 실행 방식 결정
5. 운영 프로세스 구성
   - `npm ci`
   - `npm run build`
   - `npm run start`
   - systemd/pm2 service 등록
   - Nginx/HTTPS 구성
6. Smoke test
   - page load
   - avatar save/load
   - version save/list/delete
   - face-keys API
   - texture API

## Impact Files

- `src/app/api/**`
- `src/lib/api/**`
- `src/stores/editorStore.ts`
- `src/types/editor.ts`
- `src/types/pipeline.ts`
- new DB helper/migration files
- `.env.example` or deployment env docs
- `package.json` if DB dependencies are added
- `docs/architecture/deployment-aws.md`
- `docs/standards/api-conventions.md`

## Test Plan

- Local:
  - `npm run lint`
  - `npm run build`
  - local PostgreSQL or RDS dev DB migration
  - avatar/version API route CRUD
- EC2:
  - `npm ci`
  - `npm run build`
  - `npm run start`
  - process restart test
  - environment variable check
- RDS:
  - EC2에서 `psql` or app health check로 connection 확인
  - RDS inbound가 EC2 security group만 허용되는지 확인
  - automated backups enabled 확인
- Browser:
  - editor loads
  - reference image upload
  - save/load version
  - pipeline failure message visible

## Acceptance Criteria

- Java backend 없이 Next.js app 하나로 frontend/API가 실행된다.
- EC2에서 RDS PostgreSQL에 연결된다.
- avatar와 version이 RDS에 저장되고 다시 로드된다.
- AWS 배포 절차와 운영 체크리스트가 문서화되어 있다.
