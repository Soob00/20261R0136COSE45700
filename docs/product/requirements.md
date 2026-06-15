# Product Requirements

## Goal

Virtual Avatar는 애니메이션 스타일 레퍼런스 이미지 한 장으로부터 VRM 아바타 초안을 자동 생성하고, 사용자가 웹 에디터에서 미세 조정할 수 있게 하는 시스템이다.

## Core User Flow

1. 사용자가 레퍼런스 이미지를 업로드한다.
2. 시스템이 얼굴 슬라이더, 텍스처, 헤어 프리셋을 자동 추출한다.
3. 추출 결과가 3D VRM 뷰어에 즉시 적용된다.
4. 사용자가 슬라이더, 재질, 헤어, 버전을 조정한다.
5. 조정 결과를 저장하거나 이후 VRM export 단계로 연결한다.

## Functional Requirements

- 이미지 업로드를 통해 29개 Avatar Key를 추출한다.
- cute, slim, mature 템플릿 중 하나를 추천한다.
- 얼굴, 눈썹, 아이라인, 홍채, 흰자, 하이라이트, 입 텍스처를 생성한다.
- 이미지 기반 헤어 색상/스타일 분석 결과로 프리셋 헤어를 추천한다.
- VRM 모델에 morph target, material texture, hair attachment를 적용한다.
- 사용자는 undo/redo와 최대 5개 버전 저장을 사용할 수 있다.
- ADF 서버가 없거나 실패하는 경우 Kanosawa fallback 또는 mock 서버로 개발 흐름을 유지한다.

## Non-Functional Requirements

- 개발 서버는 `npm run dev`로 실행 가능해야 한다.
- 프론트엔드 빌드는 `npm run build` 기준으로 깨지지 않아야 한다.
- Python 파이프라인 실행 경로는 `PIPELINE_PYTHON` 환경변수로 고정 가능해야 한다.
- 외부 API 키는 `.env`에 두고 Git에 포함하지 않는다.
- 대용량 모델 파일은 필요한 경우 별도 공유하고 `.gitignore` 정책을 유지한다.

## Source Materials

- [presentation.md](presentation.md)
- [Virtual_Avatar_PRD.pdf](Virtual_Avatar_PRD.pdf)
- [헤어_프리셋_라이브러리_설계.md](헤어_프리셋_라이브러리_설계.md)
- [중간발표_슬라이드_내용.md](중간발표_슬라이드_내용.md)

