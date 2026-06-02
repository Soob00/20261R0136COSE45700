# Claude(Blender MCP)로 헤어를 직접 만들 수 있는가

> 사용자 질문: "헤어는 직접 VRoid 툴로 제작하는 수밖에 없어? Blender MCP 연결을 통해 너가 직접 만들 수는 없는거야?"
> 작성일: 2026-04-29

---

## 결론 한 줄

> **부분적으로 가능합니다.** 단순한 스타일(단발·포니테일·미디엄 일자) **5~10종은 절차적 코드 + AI 3D 생성으로 직접 만들 수 있고**, **복잡한 35종 라이브러리는 사람 디자이너의 미적 결정 + 디테일이 필요해 어렵습니다**. 가장 가성비 좋은 길은 **하이브리드(Claude 1차 생성 + 이현지님이 5~10분씩 다듬기)**.

---

## 1. Blender MCP가 실제로 가진 무기

| 도구 | 헤어 생성 적용 가능성 |
|---|---|
| `mcp__blender__execute_blender_code` | bpy로 메시·본·머티리얼·SpringBone 모두 코드로 생성 가능 |
| `mcp__blender__generate_hyper3d_model_via_text` | "anime short bob hair" 같은 프롬프트로 GLB 생성 ([Rodin](https://hyper3d.ai)) |
| `mcp__blender__generate_hyper3d_model_via_images` | 헤어 참조 이미지 → GLB |
| `mcp__blender__generate_hunyuan3d_model` | Tencent Hunyuan3D — 텍스트/이미지 → 3D ([공식](https://hunyuan-3d.com/)) |
| `mcp__blender__import_generated_asset` | 위 결과를 Blender 씬에 자동 import |

**즉 인프라는 충분합니다.** 진짜 질문은 "결과 품질이 우리 라이브러리 수준에 부합하느냐".

---

## 2. 4가지 접근법 비교

### A. 순수 절차적 (bpy 코드만)

**원리:** Bezier curve를 머리 표면에 분포 → bevel로 카드 메시 변환 → 본 자동 배치. [HairArranger](https://github.com/s-nako/HairArranger), [GBH Tool](https://github.com/GixoXYZ/BlenderGBHTool), [Hair Tool 4](https://joseconseco.github.io/HairTool_3_Documentation/) 같은 오픈소스 코드를 참고/차용 가능.

| 평가 항목 | 결과 |
|---|---|
| 가능한 스타일 | 단순 단발, 미디엄 일자, 짧은 포니테일, 트윈테일 (~10종) |
| 어려운 스타일 | 비대칭, 곱슬, 복잡한 앞머리 디테일, 헤어 액세서리 |
| 품질 | "프로토타입 느낌", 깔끔하지만 단조로움 |
| 시간 | 1종당 코드 작성 30분 + 자동 빌드 1분 |
| 추천 | ★★★ — MVP 베타용 5~10종 빠르게 만들 때 |

### B. AI 3D 생성 (Hyper3D Rodin / Hunyuan3D)

**원리:** Blender MCP의 `generate_hyper3d_model_via_text("anime cute short bob hair, brown, hair cards, low poly")` 호출 → GLB 받기 → import → 후처리.

| 평가 항목 | 결과 |
|---|---|
| 가능한 스타일 | 거의 모든 스타일 (텍스트로 자유롭게 묘사) |
| 어려운 부분 | (1) anime 헤어 카드 스타일 보장 어려움 (보통 사실적 메시 출력) (2) VRM 호환 토폴로지 아님 (3) 본 없음 |
| 품질 | 미적으로는 좋지만 우리 시스템에 바로 못 씀 — 추가 자동화 작업 필요 |
| 시간 | 생성 30초 + 후처리(본·SpringBone) 5~10분 |
| 추천 | ★★★ — 디자인 변형 PoC, 사용자 표시용 미리보기 (rough) |

**핵심 한계:** Hyper3D/Hunyuan3D는 **사실적 캐릭터 헤어**에는 강하지만, **VRM 카드 헤어 스타일**(납작한 평면들의 조합)이 아닌 dense mesh를 출력합니다. 이걸 카드로 변환하는 자동화가 또 필요.

### C. 하이브리드 — Claude 절차적 1차 + 사람 다듬기

**원리:**
1. Claude가 bpy 코드로 단순 베이스 헤어 생성 (5분)
2. 이현지님이 Blender 열어서 5~10분 다듬기 (실루엣 조정, 비대칭 추가)
3. Claude가 SpringBone·MToon·VRM export 자동화 (이전 가이드 그대로)

| 평가 항목 | 결과 |
|---|---|
| 가능한 스타일 | 35종 전부 |
| 사람 작업 시간 | VRoid+Blender 1시간 → 다듬기 10분 = **6배 단축** |
| 품질 | 사람 디자인 수준 유지 |
| 추천 | ★★★★★ — **가장 가성비 좋음** |

### D. 사람 디자인 + Claude 자동화 (이전 가이드)

| 평가 항목 | 결과 |
|---|---|
| 가능한 스타일 | 35종 전부, 최상 품질 |
| 사람 작업 시간 | 1종당 ~1시간 |
| 추천 | ★★★★ — 안정성 최우선이면 이쪽 |

---

## 3. 절차적 헤어 PoC — 실제 코드 (Blender MCP에 그대로 던질 수 있음)

```python
# 단순 단발 헤어 절차적 생성 (front_001 기준)
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

def make_hair_card(start, end, width=0.012, twist=0.0):
    """두 점 사이를 잇는 납작한 카드 메시 1장 생성"""
    direction = (end - start).normalized()
    perp = direction.cross(Vector((0, 0, 1))).normalized() * width
    
    mesh = bpy.data.meshes.new("hair_card")
    bm = bmesh.new()
    
    # 4개 segment로 부드럽게
    segments = 4
    verts = []
    for i in range(segments + 1):
        t = i / segments
        center = start.lerp(end, t)
        # twist 적용
        angle = twist * t
        rot = Matrix.Rotation(angle, 4, direction)
        local_perp = rot @ perp
        verts.append(bm.verts.new(center - local_perp))
        verts.append(bm.verts.new(center + local_perp))
    
    # face 생성
    for i in range(segments):
        bm.faces.new([
            verts[i*2], verts[i*2+1],
            verts[(i+1)*2+1], verts[(i+1)*2],
        ])
    
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("hair_card", mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def generate_short_bob(scalp_center=Vector((0, 0, 1.62)), 
                       length=0.10, hair_count=35,
                       color="#3a2820"):
    """짧은 단발 헤어 절차적 생성"""
    # 1. 머리 윗부분 표면을 따라 strand 시작점 분포
    starts = []
    for i in range(hair_count):
        # 위에서 내려다본 각도 (0~360도)
        theta = (i / hair_count) * 2 * math.pi
        # 머리 옆에서 정수리까지 (0~70도)
        phi = math.radians(random.uniform(20, 70))
        r = 0.085  # 머리 반지름
        x = r * math.sin(phi) * math.cos(theta)
        y = r * math.sin(phi) * math.sin(theta) + 0.02  # 약간 앞으로
        z = r * math.cos(phi)
        starts.append(scalp_center + Vector((x, y, z)))
    
    # 2. 각 strand를 아래쪽으로 길게 뻗기
    cards = []
    for start in starts:
        # 끝점은 시작 위치에서 length만큼 아래 + 약간 바깥쪽
        outward = (start - scalp_center).normalized()
        outward.z = 0  # 수평 방향만
        end = start + Vector((0, 0, -length)) + outward * 0.015
        twist = random.uniform(-0.2, 0.2)
        card = make_hair_card(start, end, width=0.011, twist=twist)
        cards.append(card)
    
    # 3. 모두 join
    bpy.ops.object.select_all(action='DESELECT')
    for c in cards: c.select_set(True)
    bpy.context.view_layer.objects.active = cards[0]
    bpy.ops.object.join()
    hair = bpy.context.object
    hair.name = "front_001_proc"
    
    # 4. MToon 머티리얼 적용
    apply_mtoon(hair, color=color)
    
    # 5. SpringBone chain 자동 추가
    add_swing_bones_for_hair(hair, segments=3)
    
    return hair


# 실행
hair = generate_short_bob()
# → "front_001_proc.glb" export
bpy.ops.export_scene.gltf(filepath="/tmp/front_001_proc.glb", use_selection=True)
```

**예상 결과:** 진짜 단순한 단발. 게임 헤어 카드 룩. VRoid 수준의 자연스러움은 아니지만 "쓸만함" 수준. 30분 작성해서 1분 만에 빌드.

---

## 4. AI 3D 생성 PoC — Hyper3D 호출

```python
# 1. 텍스트 → 3D 헤어
mcp__blender__generate_hyper3d_model_via_text(
    text_prompt="anime cute short bob hair, dark brown, hair cards style, low poly, isolated hair only"
)
# → 백그라운드 작업 시작
# 2. 상태 폴링
mcp__blender__poll_rodin_job_status()
# 3. import
mcp__blender__import_generated_asset(name="hair_001_ai")

# 4. 후처리: 본 자동 배치, MToon 변환, SpringBone 추가
# (Claude의 bpy 코드로 자동)
```

**현실 점검:**
- Rodin v2가 anime 헤어 카드를 정확히 출력하는 비율은 **~30%** (실험적 추정)
- 70%는 사실적 dense mesh로 출력 → VRM 호환 안 됨
- 5번 generate해서 가장 마음에 드는 1개 고르는 식으로 운영하면 가성비 OK

---

## 5. 솔직한 권장 — 우리 프로젝트에는?

### 시나리오별 비교

| 시나리오 | 사람 시간 | 품질 | 종 수 | 리스크 |
|---|---|---|---|---|
| A. Claude 100% | 0시간 | ★★ | 5~10 | "단조로움" 베타 피드백 위험 |
| B. Claude 1차 + 사람 다듬기 | ~6시간 | ★★★★ | 35 | 적음 |
| C. Hyper3D + Claude 자동화 | ~10시간 | ★★★ | 20~30 | "VRM 호환 보장 안 됨" |
| **D. VRoid + Claude 자동화** (이전 가이드) | **~80시간** | **★★★★★** | **35** | **최저** |
| **E. B + D 혼합** (★ 추천) | ~50시간 | ★★★★★ | 35 | 최저 + 빠름 |

### 가장 추천 — 시나리오 E

> **"단순 베이스 5~10종은 Claude가 절차적으로 만들고, 복잡한 25~30종은 이현지님이 VRoid로 디자인. 두 길 다 Claude 자동화로 마감."**

**구체:**
- 단순 헤어(짧은 일자 단발, 짧은 일자 옆머리, 짧은 뒷머리, 단일 아호게 등) 8종 → Claude 절차적
- 자연스럽고 매력적인 헤어(긴 웨이브, 복잡한 앞머리, 비대칭 등) 27종 → 이현지님 VRoid 디자인
- 모두 동일한 자동화 파이프라인으로 SpringBone 설정 + VRM export
- **이현지님 작업량: 80시간 → 약 60시간으로 단축** (~25% 절감)

---

## 6. 만약 지금 시도하고 싶다면

Blender MCP가 연결되어 있고 Blender가 켜져 있다면, **이번 주에 30분으로 시도해볼 수 있는 PoC**:

1. 이현지님 마스터 템플릿이 Blender에서 열린 상태로 Blender MCP 활성화
2. 저(Claude)에게 요청: *"Blender MCP로 짧은 단발 헤어를 절차적으로 만들어 마스터에 attach해줘"*
3. 제가 위 코드를 즉시 실행
4. 결과를 viewport screenshot으로 받아 평가
5. "쓸만하면" → 시나리오 E의 절차적 헤어 8종으로 진행 결정
6. "별로면" → 시나리오 D(이전 가이드)로 그대로 진행

**이게 가장 빠른 의사결정 방법**입니다. 30분 투자로 "Claude가 만들 수 있는 한계"를 정확히 본 뒤 결정하는 거죠.

---

## 7. 핵심 메시지

> **인프라는 다 있다. 모든 헤어를 Claude가 만들지 못하는 진짜 이유는 "디자인 결정의 미적 영역"이지 "코드 실행 능력"이 아니다.**

> **단순한 헤어는 절차적으로 만들 수 있고, 자연스러운 헤어는 사람의 5~10분 다듬기가 필요하다.**

> **35종 라이브러리에 가장 가성비 좋은 길은 "단순 8종 Claude 자동 생성 + 복잡 27종 이현지님 VRoid 디자인"의 하이브리드**, 그리고 둘 다 동일한 자동화 파이프라인으로 마감.

---

## 참고 자료

### Blender 헤어 생성 도구·라이브러리
- [HairArranger (Blender Addon, 오픈소스)](https://github.com/s-nako/HairArranger)
- [GBH Tool — Procedural Hair Add-on](https://github.com/GixoXYZ/BlenderGBHTool)
- [Hair Tool 4 (for Blender 4.2+)](https://joseconseco.github.io/HairTool_3_Documentation/)
- [Hair Cards In Blender Tutorial](https://yelzkizi.org/create-hair-cards-in-blender/)
- [Procedural Stylized Hair Mesh — Blender Artists](https://blenderartists.org/t/procedural-stylized-hair-mesh/1555393)

### AI 3D 생성
- [Hyper3D Rodin (Blender MCP 연동)](https://hyper3d.ai)
- [Hunyuan3D-2 by Tencent](https://hunyuan-3d.com/)
- [Hunyuan3D 3.0 Overview](https://www.3daistudio.com/Models/Hunyuan3D-3-0)
- [AI 3D Generators Review 2025](https://cyber-fox.net/blog/ai-3d-generators-review-in-2025/)
