# API Conventions

## Route Style

- Next.js API route는 `src/app/api/**/route.ts`에 둔다.
- pipeline endpoint는 multipart form-data를 입력으로 받고 JSON을 반환한다.
- 실패 응답은 `{ error: string }` 또는 `{ status: "error", error: string }` 형태를 사용한다.
- 404를 null로 처리해야 하는 client API는 `nullOn404` 같은 명시적 옵션을 둔다.

## Client Contract

- 프론트엔드는 `src/lib/api/types.ts`의 `APIClient` 인터페이스만 바라본다.
- `localAPIClient`는 개발 fallback이다.
- 운영에서는 별도 Java backend가 없으므로 same-origin Next.js API Routes를 기본 backend로 본다.
- `remoteAPIClient`는 외부 API 서버가 아니라 같은 배포 단위의 API route 또는 future API gateway로 향하게 한다.
- 외부 backend URL 환경변수는 사용 목적을 명확히 재정의하기 전까지 운영 필수값으로 두지 않는다.

## Pipeline Contract

- `PipelineResult`는 `src/types/pipeline.ts`와 Python output JSON이 동시에 맞아야 한다.
- texture API는 `textures`, `features`, `landmarks`, `hairMatch`, `faceKeys`를 반환한다.
- 대용량 바이너리는 JSON에 직접 넣지 않고, 필요할 때 data URL 또는 파일 경로 정책을 문서화한다.

## Security

- API key는 클라이언트 번들에 노출하지 않는다.
- `apiKey` form field는 개발 편의용으로만 보고, 운영에서는 서버 환경변수를 우선한다.
- uploaded file은 temp directory에서 처리하고 요청 종료 후 삭제한다.
- DB 접속 정보는 `NEXT_PUBLIC_*` 환경변수에 넣지 않는다.

