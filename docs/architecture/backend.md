# Backend Architecture

## Current Shape

현재 백엔드는 별도 Java/Spring 서버가 아니라 이 저장소 내부의 Next.js API Routes다. Node.js runtime에서 Python 파이프라인을 subprocess로 실행하고, 운영 데이터는 RDS PostgreSQL에 저장한다.

## Deployment Shape

```text
Browser
  -> EC2 public endpoint / reverse proxy
  -> Next.js app in 20261R0136COSE45700
     -> src/app/api/** route handlers
     -> Python pipeline subprocess
     -> RDS PostgreSQL
     -> external AI APIs where needed
```

이 구조에서 frontend와 backend는 같은 Next.js 배포 단위다. `src/app/api`가 backend boundary이며, Java backend repository는 만들지 않는다.

## API Routes

- `POST /api/pipeline/face-keys`
  - 파일: `src/app/api/pipeline/face-keys/route.ts`
  - 입력: multipart `image`, 선택 `renderDir`
  - 실행: `face-feature/run_extract.py`
  - 출력: `PipelineResult`

- `POST /api/pipeline/texture`
  - 파일: `src/app/api/pipeline/texture/route.ts`
  - 입력: multipart `image`
  - 실행: `src/pipeline/extract_features.py`, `src/pipeline/adjust_texture.py`, `face-feature/run_extract.py`
  - 출력: textures, features, landmarks, hairMatch, faceKeys

- `POST /api/pipeline/generate-3d`
  - 파일: `src/app/api/pipeline/generate-3d/route.ts`
  - 입력: multipart `image`, provider, apiKey, skip3d, existingGlb
  - 실행: `face-feature/main.py run`
  - 출력: full pipeline result

## Pipeline Dependencies

- `PIPELINE_PYTHON`: Python interpreter path
- `ADF_SERVER_URL`: anime-face-detector server
- `GEMINI_API_KEY`: texture feature extraction
- `VARCO_API_KEY`: optional 2D to 3D provider
- `DATABASE_URL`: RDS PostgreSQL connection string
- `NEXT_PUBLIC_API_MODE`: same-origin route를 기본으로 사용할 경우 제거하거나 `local/remote` 전환 정책을 재정의

## Backend Strategy

현재 결정은 Next.js 내부 backend 유지다. Java backend 분리는 active plan이 아니다. 과거 비교 문서는 decisions에 보존한다.

관련 문서:

- [../decisions/backend_strategy_comparison.md](../decisions/backend_strategy_comparison.md)
- [../decisions/java_backend_design_and_portfolio_template.md](../decisions/java_backend_design_and_portfolio_template.md)
- [deployment-aws.md](deployment-aws.md)

## Operational Concerns

- API route timeout은 face-keys 3분, texture 5분, generate-3d 7분 기준이다.
- 임시 작업 디렉터리는 OS temp에 만들고 finally에서 삭제한다.
- debug copy는 `debug/face-keys`, `debug/texture` 아래에 비동기로 저장된다.
- Python stderr는 실패가 아니어도 로그에 남을 수 있으므로 exit status와 output JSON 존재 여부를 함께 본다.
- EC2 단일 인스턴스 배포에서는 긴 Python 작업이 Node.js worker를 점유할 수 있다. 사용량이 늘면 job queue 전환을 검토한다.
