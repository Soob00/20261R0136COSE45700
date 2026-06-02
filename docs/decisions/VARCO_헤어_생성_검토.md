# VARCO 3D API로 헤어 라이브러리 빌드 검토

> 우리가 이미 사용 중인 VARCO API를 라이브러리 빌드에도 활용할 수 있는가?
> 작성일: 2026-05-05

---

## 결론 한 줄

> **라이브러리 35종 사전 빌드 용도로는 가성비 ★★ — 자체 제작/VRoid가 더 빠르고 품질 좋다.** 그러나 **"사용자별 맞춤 헤어 추출" (사용자 사진의 헤어를 마스터에 적용) PoC 용도로는 ★★★★ — Phase 2 가치 있음**. 두 사용 케이스를 분리해 판단해야 한다.

---

## 1. VARCO 3D 능력 정확히 — 헤어만 생성 가능한가?

### 사실 확인 (NC AI 공식 문서 기반)

- VARCO 3D는 **캐릭터/오브젝트 전체 생성** 도구 ([3d.varco.ai](https://3d.varco.ai/))
- 입력: 텍스트 프롬프트 또는 이미지
- 출력: GLB (단일 메시 + 텍스처)
- **"헤어만" 생성하는 전용 모드 없음**
- 캐릭터 전체 생성 → 그 안에서 헤어 부분만 분리해야 함

### 2025년 헤어 전용 AI 도구는 별도로 존재
- [DiffLocks (2025.5)](https://arxiv.org/abs/2505.06166): 단일 이미지 → strand 기반 3D 헤어
- [TANGLED (2025.2)](https://arxiv.org/abs/2502.06392): braid·복잡한 헤어 처리
- [HairStep](https://paulyzheng.github.io/research/hairstep/), [Im2Haircut](https://im2haircut.is.tue.mpg.de/): 단일 이미지 헤어 재구성

**문제:** 모두 strand 기반 출력 → VRM 카드 헤어로 변환하는 별도 자동화 필요. 학생 6주에 추가 인프라 구축 부담.

---

## 2. VARCO 활용 시 워크플로우와 비용

### 워크플로우 (라이브러리 빌드용)

```
[1] 헤어 카탈로그 사진 (예: 짧은 단발) 또는
    텍스트 프롬프트 ("anime cute short bob hair")
   ↓
[2] VARCO API 호출 → 캐릭터 전체 GLB 생성 (~5분)
   ↓
[3] BiSeNet (2D 정면 렌더 → 헤어 마스크)
   또는 P3-SAM (3D 직접 분할)
   → 헤어 vertex group 생성
   ↓
[4] Blender bpy: hair vertex만 분리 (P 키)
   ↓
[5] 단독 헤어 메시 → retopology (수동, 30분)
   또는 우리 마스터 템플릿에 wrap deformation
   ↓
[6] SpringBone 자동 추가, MToon 변환
   ↓
[7] 단독 GLB export → 라이브러리 등록
```

### 비용 분석

**VARCO 가격 (확인됨):**
- 무료: 2,000 크레딧 = 10 자산 → 자산당 약 200원
- Plus: 22,000원/월 = 10,000 크레딧 → 자산당 약 2,200원
- Premium: 165,000원/월 = 75,000 크레딧

**35종 라이브러리 빌드 추정:**
- 시도 + 실패 (3배 호출 가정) = 35 × 3 = 105 자산
- Plus 플랜 약 2.3만원 (1개월 구독)
- 또는 무료 플랜 다회 사용 ~0원

**결론:** VARCO API 비용 자체는 **5만원 미만**으로 매우 저렴.

### 시간 분석

| 작업 | 1종당 시간 |
|---|---|
| (1) 입력 이미지 준비 | 5분 |
| (2) VARCO 호출 + 결과 받기 | ~5분 |
| (3) 헤어 영역 분할 (BiSeNet/P3-SAM) | 5분 (자동) |
| (4) Blender에서 헤어 분리 | 5분 (자동) |
| (5) **Retopology / Wrap deformation** | **20~40분 (수동/반자동)** |
| (6) SpringBone + MToon | 5분 (자동) |
| (7) export | 1분 |
| **합계 1종당** | **~50분** |
| **35종 합계** | **~30시간** |

비교:
- 자체 제작 (VRoid): 1종당 ~35분, 35종 ~20시간
- **VARCO 방식이 시간상 1.5배 더 걸림** (retopology 부담 때문)

---

## 3. 품질 비교 — 더 큰 문제

### VARCO 출력 한계
1. **사실적 인물 학습 위주** → anime 카드 헤어 룩이 잘 안 나옴
2. **단일 메시 dense topology** → 우리 마스터의 카드 헤어와 호환 안 됨
3. **헤어 strand 분리 부정확** → VARCO 출력에서 "어디까지가 헤어"인지 불분명한 경우 다수
4. **머리카락이 두피와 통합된 메시**일 때 분할 불가능

### 실제 출력 예상 품질
- 짧은 단발: ★★★ (성공률 ~60%)
- 긴 생머리: ★★ (단일 메시 분할 어려움)
- 복잡한 스타일 (트윈테일, 비대칭): ★ (성공률 < 30%)

### VRoid 비교
- 모든 스타일: ★★★★~★★★★★ (VRoid는 anime 카드 헤어 전용 도구)
- 작가 의도대로 정확히 만들 수 있음

---

## 4. 평가 매트릭스 — 라이브러리 빌드용

| 방식 | 35종 비용 | 35종 시간 | 품질 | 라이선스 | 추천도 |
|---|---|---|---|---|---|
| **자체 제작 (VRoid Studio)** | 0원 | 20h (자동화) | ★★★★★ | 우리 소유 | **★★★★★** |
| Sketchfab CC0 큐레이션 | 0원 | 70h (변환) | ★★ | 안전 | ★★ |
| **VARCO API + 후처리** | ~5만원 | 30h | ★★~★★★ | 우리 소유 | **★★★** |
| BOOTH Extended | 100~300만원 | 50h | ★★★★ | 안전 | ★★★ (학생 비용 부담) |
| AI 도구 (FiberShop 등) | 0~50만원 | 50h | ★★★ | 우리 소유 | ★★★★ |

**라이브러리 빌드 결론: VRoid가 여전히 가성비 1위.** VARCO는 시간·품질 모두 VRoid에 미달.

---

## 5. 그러나 — VARCO의 진짜 가치는 "사용자별 맞춤 헤어"

### Phase 2 PoC: 사용자 헤어 자동 추출 + 적용

우리 9단계 파이프라인의 Stage 2에서 **VARCO는 이미 사용자 사진 → 3D 캐릭터를 만들고 있음**. 그 출력에서:

```
사용자 사진
   ↓
VARCO API → 사용자 캐릭터 GLB
   ↓
[NEW] BiSeNet + P3-SAM → 사용자의 실제 헤어 메시 분리
   ↓
[NEW] Wrap deformation → 우리 마스터 템플릿에 fitting
   ↓
SpringBone + MToon 자동 → VRM 익스포트
```

이것이 가능하다면:
- ✅ 사용자가 **자신의 실제 헤어 스타일**을 가질 수 있음 (프리셋 매칭 X)
- ✅ "내 머리와 다르다" 인식 문제 해결
- ✅ 차별화 포인트가 큼 (경쟁사 못 따라옴)

**현재 평가 (이전 방법론 문서 참조):**
- MVP: ★★ (난이도 너무 높음)
- Phase 2 PoC: ★★★★ (검토 가치 충분)
- Phase 3 제품화: ★★★★★ (성공 시 큰 차별화)

### Phase 2 PoC 워크플로우

```python
# 사용자 사진 들어오면 실시간 처리
async def extract_user_hair_to_master(user_image):
    # 1. VARCO 호출 (이미 9단계 Stage 2에 있음)
    user_glb = await varco.image_to_3d(user_image)
    
    # 2. 정면/측면 렌더 (Stage 3)
    front_render = render_view(user_glb, yaw=0)
    side_render  = render_view(user_glb, yaw=90)
    
    # 3. BiSeNet 헤어 마스크
    hair_mask = bisenet(front_render)
    
    # 4. 3D vertex 역투영 → hair vertex group
    hair_verts = project_2d_mask_to_3d(user_glb, hair_mask, camera_front)
    
    # 5. Blender headless: hair vertex만 분리
    hair_mesh = separate_mesh_by_vertex_group(user_glb, hair_verts)
    
    # 6. Wrap deformation: 마스터의 헤어 anchor에 fitting
    fitted_hair = wrap_deform(
        source=hair_mesh,
        target=master_template.head_surface,
    )
    
    # 7. SpringBone + MToon (라이브러리 자동화 파이프라인 재사용)
    fitted_hair = add_spring_bones(fitted_hair, part_type="dynamic_user")
    fitted_hair = convert_to_mtoon(fitted_hair)
    
    return fitted_hair
```

이건 100% 안 될 가능성도 있지만 **검증 자체가 학기 후 PoC 1주 정도면 가능**.

---

## 6. 권장 — 두 사용 케이스 분리

### 케이스 A. 라이브러리 35종 사전 빌드
→ **자체 제작 (VRoid Studio + Blender MCP 자동화)** 채택
- 가장 빠르고 품질 좋고 안전
- 이전 가이드대로 4주 일정

### 케이스 B. 사용자 맞춤 헤어 (Phase 2 PoC)
→ **VARCO 출력 + 추출 + 마스터 적용** PoC 가치 있음
- MVP 출시 후 데이터 수집 (사용자가 "추천 매칭이 마음에 안 든다"고 한 케이스 100건)
- 그 100건으로 자동 추출 PoC → 70% 성공률 넘으면 Phase 3 제품화

### 케이스 C. 다양성 보강용 보조 5~10종
→ **VARCO + 텍스트 프롬프트로 실험적 헤어 시도** (선택)
- "anime fantasy elf hair", "anime ponytail with ribbon" 같은 특수 스타일
- 시도 비용 거의 0원 (무료 플랜)
- 5~10종만 채택해 라이브러리 다양성 보강

---

## 7. 즉시 실험 가능한 PoC

만약 *"VARCO가 anime 헤어 카드 룩을 얼마나 잘 만드는지 한번 보자"*고 하면:

1. VARCO 무료 플랜 가입 (10 자산 무료)
2. 텍스트 프롬프트 5~10개로 시도:
   - "anime VTuber short bob hair, hair card style, low poly"
   - "anime girl long straight black hair"
   - "VRoid style hair, side ponytail"
   - ...
3. 결과 GLB을 Blender로 import해서 마스터에 attach 시도
4. 5~10개 결과 평가 → "쓸만함" 비율 확인
5. 비율 50%+ → 케이스 C로 보조 활용 가치 있음
   비율 30%- → 라이브러리 빌드용으로 부적합 확정

**예상 시간: 1~2시간**, **비용: 0원** (무료 플랜).

---

## 8. 핵심 요약

> **VARCO API로 라이브러리 35종 사전 빌드는 자체 제작보다 시간·품질 모두 미달.** anime 카드 헤어 룩 보장이 안 되고, 단일 메시 → 카드 변환에 retopology 부담이 큼.

> **그러나 VARCO는 "사용자 사진 → 사용자 본인 헤어 추출 → 마스터 적용"이라는 Phase 2 PoC에 진짜 가치 있음**. 이건 우리 제품의 가장 큰 차별화 포인트가 될 수 있고, 이미 사용 중인 API라 추가 인프라 비용 0.

> **권장 의사결정:**
> 1. 라이브러리 35종은 자체 제작 (이전 가이드대로)
> 2. VARCO는 9단계 파이프라인 + Phase 2 PoC에 집중
> 3. (선택) VARCO 텍스트 프롬프트로 5~10종 실험적 헤어 시도해 다양성 보강

---

## 참고 자료

### VARCO 3D
- [VARCO 3D 공식](https://3d.varco.ai/)
- [VARCO API Platform](https://api.varco.ai/en)
- [NC AI 회사 페이지](https://nc-ai.com/en)
- [NC AI Launches Varco 3D (Business Korea)](https://www.businesskorea.co.kr/news/articleView.html?idxno=257715)
- [NC AI's Varco 3D Revolutionizes (PixelDojo News)](https://pixeldojo.ai/industry-news/nc-ais-varco-3d-revolutionizes-3d-asset-creation-reducing-production-time-from-weeks-to-minutes)
- [CaPa: NCSoft 4K Texture Generation (GitHub)](https://github.com/ncsoft/CaPa)

### 2025 헤어 전용 AI 도구
- [DiffLocks (2025.5, arXiv)](https://arxiv.org/abs/2505.06166)
- [TANGLED (2025.2, arXiv)](https://arxiv.org/abs/2502.06392)
- [HairStep](https://paulyzheng.github.io/research/hairstep/)
- [Im2Haircut (ICCV 2025)](https://im2haircut.is.tue.mpg.de/)
- [Hair-GAN (Original)](https://www.sciencedirect.com/science/article/pii/S2468502X18300652)

### 보조
- [The 2026 State of 3D AI Generators](https://news.futurefamiliar.com/p/the-2026-state-of-3d-ai-generators)
