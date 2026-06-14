# Accessory Feasibility Test

액세서리 오프라인 파이프라인의 feasibility test 전용 작업공간입니다.

## 목적

- Gemini detect, isolate, VARCO 3D, 파일 기반 검수가 실제로 usable preset 후보를 만들 수 있는지 확인합니다.
- 웹 UI 구현 전에 카테고리별 통과 가능성과 실패 원인을 정량/정성으로 확인합니다.

## 구조

```text
experiments/accessory-feasibility/
  .env
  .env.example
  config/
  inputs/
  outputs/
  reports/
  scripts/
```

- `config/feasibility.json`: 실행 설정
- `config/samples.example.json`: 샘플 manifest 예시
- `config/samples.json`: 실제 실행용 manifest, 기본 ignore
- `.env`: API 키와 provider 설정
- `outputs/`: 실행 산출물, ignore
- `reports/summary.json`: 실행 통계, ignore
- `reports/failure-gallery.md`: 실패 케이스 갤러리, ignore
- `reports/feasibility-summary.md`: 사람이 읽는 요약 리포트

## .env 사용

실제 키는 repo에 커밋하지 말고 `experiments/accessory-feasibility/.env`에 저장합니다.

```dotenv
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
VARCO_PROVIDER=varco
VARCO_API_KEY=your_varco_key
```

- 샘플 파일은 [experiments/accessory-feasibility/.env.example](C:\Users\yscho\projects\Practice_SW\20261R0136COSE45700\experiments\accessory-feasibility\.env.example) 입니다.
- 러너는 기본적으로 `experiments/accessory-feasibility/.env`를 자동 로드합니다.
- 다른 파일을 쓰고 싶으면 `--env-file`로 지정할 수 있습니다.

## 실행 예시

```powershell
.venv\Scripts\python.exe experiments/accessory-feasibility/scripts/run_feasibility.py `
  --manifest experiments/accessory-feasibility/config/samples.json `
  --config experiments/accessory-feasibility/config/feasibility.json
```

다른 env 파일 사용:

```powershell
.venv\Scripts\python.exe experiments/accessory-feasibility/scripts/run_feasibility.py `
  --manifest experiments/accessory-feasibility/config/samples.json `
  --config experiments/accessory-feasibility/config/feasibility.json `
  --env-file experiments/accessory-feasibility/.env.local
```

resume / idempotency:

```powershell
.venv\Scripts\python.exe experiments/accessory-feasibility/scripts/run_feasibility.py --manifest experiments/accessory-feasibility/config/samples.json --resume
.venv\Scripts\python.exe experiments/accessory-feasibility/scripts/run_feasibility.py --manifest experiments/accessory-feasibility/config/samples.json --sample sample_001 --from-stage varco_poll
.venv\Scripts\python.exe experiments/accessory-feasibility/scripts/run_feasibility.py --manifest experiments/accessory-feasibility/config/samples.json --force-stage isolate
```

## 주의

- `outputs/`와 생성된 GLB/preview는 기본 ignore 대상입니다.
- `review/*.json`만 수동 수정 대상으로 간주합니다.
- attach preview 성공을 보려면 `preview.base_avatar_path`는 이미지 파일이어야 합니다.
- 현재 기본 `python` 환경에는 Pillow가 없을 수 있으므로, 검증은 `.venv\Scripts\python.exe` 사용을 권장합니다.
