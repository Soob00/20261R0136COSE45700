# Java Backend 설계 + API 스펙 초안 + 포트폴리오 템플릿

## 1. 최소 도메인 설계 (현재 레포 기준)

### 1.1 목표
프론트의 기존 계약(`src/lib/api/types.ts`)을 깨지 않고, Spring Boot 백엔드로 교체 가능한 최소 도메인을 설계한다.

### 1.2 도메인 경계
- Avatar Aggregate
  - 아바타 편집의 현재 상태 저장 단위
- AvatarVersion
  - 아바타 스냅샷(버전) 저장 단위
- Template
  - 기본 템플릿 조회 단위(읽기 전용 시작 가능)

### 1.3 최소 ERD

```text
users (선택: 인증 도입 시)
  - id (PK)
  - email
  - created_at

avatars
  - id (PK)                    # 내부 UUID
  - avatar_id (UK)             # 프론트 avatarId
  - user_id (FK, nullable)
  - template_id (string)
  - parameters_json (jsonb)
  - updated_at
  - created_at

avatar_versions
  - id (PK)
  - avatar_id (FK -> avatars.id)
  - version_key (string)       # 프론트 version.id
  - name (string)
  - parameters_json (jsonb)
  - thumbnail_data_url (text, nullable)
  - created_at

templates
  - id (PK, string)
  - name
  - description
  - thumbnail_url
  - vrm_url
  - default_values_json (jsonb, nullable)
  - tags_json (jsonb, nullable)
  - is_active (bool)
```

### 1.4 JSON 필드 정책
- `parameters_json`
  - 구조는 프론트 `AvatarParameters`와 동일
  - `morphTargets`, `boneScales`, `materials`를 JSON 그대로 저장
- 장점
  - 프론트 타입과 1:1 대응
  - 초기에 스키마 진화 비용 낮음
- 후속 확장
  - 분석/검색이 필요한 필드는 점진적으로 컬럼 승격

### 1.5 Spring 계층 구조 (권장)
- `controller`
  - REST 입출력, 상태코드, 검증 에러 매핑
- `service`
  - 버전 개수 제한, 소유권 검증, 비즈니스 규칙
- `repository`
  - JPA/JdbcTemplate
- `domain`
  - 엔티티/값객체
- `dto`
  - Request/Response 계약

### 1.6 최소 비즈니스 규칙
- Avatar upsert 허용 (`avatarId` 기준)
- Version 최대 5개 유지(현재 프론트와 동일 정책)
- Template은 초기엔 읽기 전용
- avatar/version 삭제 시 소유 데이터만 삭제 가능(인증 도입 시)

### 1.7 기술 선택
- Spring Boot 3.x, Java 21
- DB
  - 로컬 개발: SQLite 또는 Postgres
  - 포트폴리오 권장: Postgres (기업 설득력 높음)
- JSON 저장
  - Postgres: `jsonb`
  - SQLite: `text` + Jackson 직렬화

---

## 2. 엔드포인트 스펙 초안

기준: `src/lib/api/types.ts`

### 2.1 Avatar

1. `PUT /api/v1/avatars/{avatarId}`
- 설명: Avatar 저장/수정(upsert)
- Request
```json
{
  "templateId": "customizable-default",
  "parameters": {
    "morphTargets": { "Eye_Width": 0.2 },
    "boneScales": { "Head": { "x": 1.0, "y": 1.0, "z": 1.0 } },
    "materials": { "Hair": { "name": "Hair", "color": "#222222" } }
  }
}
```
- Response `200`
```json
{
  "avatarId": "default",
  "templateId": "customizable-default",
  "parameters": { "morphTargets": {}, "boneScales": {}, "materials": {} },
  "updatedAt": "2026-05-20T12:00:00Z"
}
```

2. `GET /api/v1/avatars/{avatarId}`
- Response `200 | 404`

3. `GET /api/v1/avatars`
- 설명: 사용자 소유 Avatar 목록
- Response `200`: `AvatarRecord[]`

4. `DELETE /api/v1/avatars/{avatarId}`
- Response `204`

### 2.2 Version

1. `POST /api/v1/avatars/{avatarId}/versions`
- 설명: 버전 저장
- Request: `AvatarVersion`
- Response `201`

2. `GET /api/v1/avatars/{avatarId}/versions`
- Response `200`: `AvatarVersion[]`

3. `PATCH /api/v1/avatars/{avatarId}/versions/{versionId}`
- 설명: 버전 이름 수정
- Request
```json
{ "name": "새 버전명" }
```
- Response `204`

4. `DELETE /api/v1/avatars/{avatarId}/versions/{versionId}`
- Response `204`

### 2.3 Template

1. `GET /api/v1/templates`
- Response `200`: `TemplateMetadata[]`

2. `GET /api/v1/templates/{templateId}`
- Response `200 | 404`

### 2.4 공통 에러 포맷 (권장)
```json
{
  "code": "AVATAR_NOT_FOUND",
  "message": "Avatar not found",
  "timestamp": "2026-05-20T12:00:00Z",
  "path": "/api/v1/avatars/default"
}
```

### 2.5 HTTP 상태코드 규칙
- `200`: 조회/수정 성공
- `201`: 생성 성공
- `204`: 삭제/이름수정 성공(바디 없음)
- `400`: 유효성 실패
- `401/403`: 인증/인가 실패
- `404`: 리소스 없음
- `409`: 충돌(중복 키 등)
- `500`: 서버 오류

---

## 3. 포트폴리오용 아키텍처 설명 템플릿

아래 템플릿은 README/발표자료에 바로 붙여서 쓸 수 있다.

### 3.1 프로젝트 개요
- 프로젝트명: Virtual Avatar Editor
- 문제정의: 사용자가 VRM 아바타를 실시간으로 커스터마이징하고 버전으로 관리할 수 있어야 한다.
- 핵심가치: 3D 편집 UX + 안정적인 상태 저장/복원 + 확장 가능한 API 구조

### 3.2 아키텍처 선택 이유
- 프론트: Next.js 기반 3D 에디터
- 백엔드: Spring Boot
- 선택 이유
  - 도메인 로직/트랜잭션/운영 표준을 백엔드에 명확히 분리
  - 프론트는 UI/BFF 관점에 집중
  - 기업 실무 관점에서 재사용 가능한 API 계층 구축

### 3.3 시스템 구성
```text
[Next.js Frontend]
  - Avatar Editor UI
  - API Client Layer (src/lib/api/types.ts)
        |
        | HTTP/JSON
        v
[Spring Boot API]
  - Avatar/Version/Template Controller
  - Service (rules, ownership, max versions)
  - Repository
        |
        v
[PostgreSQL]
  - avatars
  - avatar_versions
  - templates
```

### 3.4 데이터 흐름 (예: 버전 저장)
1. 사용자가 에디터에서 "버전 저장" 클릭
2. 프론트가 `POST /avatars/{avatarId}/versions` 호출
3. 백엔드가 유효성 검증 및 최대 버전 수 정책 적용
4. DB 저장 후 `201` 반환
5. 프론트가 목록 재조회 또는 로컬 상태 갱신

### 3.5 내가 해결한 기술 과제 (예시 문장)
- 프론트 상태 모델(`AvatarParameters`)과 백엔드 저장 모델(JSONB)을 정합성 있게 맞췄다.
- 버전 히스토리 정책(최대 5개)을 서버 규칙으로 고정해 클라이언트 의존도를 낮췄다.
- API 에러 포맷을 표준화하여 디버깅/운영 가시성을 높였다.

### 3.6 품질 전략
- 테스트
  - Controller: MockMvc
  - Service: 정책 단위 테스트(버전 제한/권한)
- 관측성
  - 요청 ID 로깅, 에러 코드 기준 모니터링
- 배포
  - Docker 이미지 빌드 + 환경별 설정 분리

### 3.7 확장 계획
- 인증/인가(JWT + role)
- 썸네일 Object Storage 분리(S3)
- OpenAPI 문서 자동화(springdoc)
- Python 파이프라인 결과와 Avatar 추천 API 연동

---

## 4. 구현 우선순위 (실행 순서)
1. Avatar/Version/Template API를 위 계약대로 구현
2. Postgres 스키마 + 마이그레이션(Flyway)
3. 프론트 `local.ts` 대체 `remote.ts` 추가(계약 동일)
4. 에러 표준화/테스트/Swagger 문서화

이 순서대로 진행하면, 기능 완성도와 포트폴리오 설득력을 동시에 확보할 수 있다.
