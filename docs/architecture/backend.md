# Backend Architecture

## Current Shape

현재 백엔드는 독립 서버가 아니라 Next.js API Routes가 Node.js에서 Python 파이프라인을 subprocess로 실행하는 구조다. 별도 Java/Spring 백엔드는 설계 후보로 유지한다.

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

## Backend Strategy

단기 구현은 Next.js API Routes를 유지한다. Spring/Java 백엔드는 인증, 영속 저장, 대규모 운영이 필요해지는 시점에 분리한다.

관련 문서:

- [backend_strategy_comparison.md](backend_strategy_comparison.md)
- [java_backend_design_and_portfolio_template.md](java_backend_design_and_portfolio_template.md)

## Operational Concerns

- API route timeout은 face-keys 3분, texture 5분, generate-3d 7분 기준이다.
- 임시 작업 디렉터리는 OS temp에 만들고 finally에서 삭제한다.
- debug copy는 `debug/face-keys`, `debug/texture` 아래에 비동기로 저장된다.
- Python stderr는 실패가 아니어도 로그에 남을 수 있으므로 exit status와 output JSON 존재 여부를 함께 본다.

