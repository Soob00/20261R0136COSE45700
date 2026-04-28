파이프라인 Phase별 코드 정리

main.py로 전체 실행

Stage 2 — 이미지 → 3D GLB 생성
파일: varco_client.py

Stage 3 — GLB → 멀티뷰 렌더
파일: renderer.py

Stage 4 — 얼굴 특징 추출
파일: feature_extractor.py

Stage 5-6 — 템플릿 선택 + 슬라이더 초기화
파일: template_selector.py
