# Data Architecture

## Current Persistence

현재 제품의 기본 영속성은 두 층이다.

- 브라우저 localStorage: 개발용 avatar/version 저장
- 파일/임시 디렉터리: API route에서 Python pipeline input/output 처리

운영용 DB는 아직 구현되어 있지 않다.

## Current Client Contract

`src/lib/api/types.ts` 기준으로 다음 리소스가 있다.

- Avatar
  - `avatarId`
  - `templateId`
  - `parameters`
  - `updatedAt`
- Version
  - `AvatarVersion`
  - avatar별 최대 5개 저장 정책
- Template
  - `TemplateMetadata`
- Pipeline
  - `PipelineResult`

## Proposed PostgreSQL Schema

운영 저장소가 필요해지면 PostgreSQL을 기준으로 시작한다.

```text
users
  id uuid pk
  email text unique
  created_at timestamptz

avatars
  id uuid pk
  avatar_id text unique
  user_id uuid null references users(id)
  template_id text
  parameters_json jsonb
  updated_at timestamptz
  created_at timestamptz

avatar_versions
  id uuid pk
  avatar_id uuid references avatars(id)
  version_key text
  name text
  parameters_json jsonb
  thumbnail_data_url text null
  created_at timestamptz

pipeline_runs
  id uuid pk
  avatar_id uuid null references avatars(id)
  kind text
  status text
  input_meta_json jsonb
  output_json jsonb
  error text null
  created_at timestamptz
```

## Storage Notes

- texture data URL과 thumbnail은 DB에 직접 넣기 전에 크기 제한을 둔다.
- GLB/VRM/PNG 산출물은 DB가 아니라 object storage 또는 파일 저장소로 분리한다.
- `parameters_json`은 morph/material/hair 구조가 바뀔 수 있으므로 JSONB로 시작한다.

