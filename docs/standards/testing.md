# Testing Standard

## Required Checks

일반 코드 변경 후 기본 확인:

```bash
npm run lint
npm run build
```

DB/API 변경 후 추가 확인:

```bash
npm run lint
npm run build
```

그리고 RDS 또는 로컬 PostgreSQL에 대해 migration, avatar save/load, version save/list/delete를 확인한다.

파이프라인 변경 후 추가 확인:

```bash
python face-feature/tools/mock_adf_server.py --port 8000
npm run dev
```

브라우저에서 확인:

- 레퍼런스 이미지 업로드
- face-keys 적용
- texture 생성
- hair recommendation 적용
- undo/redo
- version save/restore

## API Route Tests

수동 검증 기준:

- 이미지 없는 요청은 400을 반환한다.
- Python output JSON이 없으면 500을 반환한다.
- `PIPELINE_PYTHON`이 잘못됐을 때 에러 메시지가 JSON으로 반환된다.
- ADF 실패 시 texture route가 Kanosawa fallback을 시도한다.

## Visual Tests

3D/VRM 관련 변경은 Playwright 또는 브라우저 확인으로 다음을 본다.

- Canvas가 blank가 아닌지
- 모델이 정면에 로드되는지
- morph target 변경이 즉시 반영되는지
- 텍스처 data URL 적용 후 재질이 깨지지 않는지
- 헤어 GLB attachment 위치가 머리 기준으로 유지되는지

## Regression Areas

- `src/types/pipeline.ts`와 Python output 불일치
- `editorStore` undo/redo stack 누락
- localStorage version migration
- SSR 중 `window`, `localStorage`, `File` 접근
- API route temp/debug 파일 처리
- RDS 연결 문자열이 client bundle에 노출되는 문제
- EC2에서 Python interpreter, native dependency, ADF server 경로가 달라지는 문제

