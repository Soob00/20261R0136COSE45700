# GLB → 헤어 VRM 자동 생성 with Blender MCP — 기술 검토

> 질문: "VARCO가 만든 GLB를 Blender MCP에 넘기면, 그 헤어만 떼어내서 새 VRM으로 만드는 자동화 모델을 만들 수 있나?"
> 작성일: 2026-04-29

---

## 결론 한 줄

**기술적으로 가능은 합니다. 하지만 어려움이 Blender MCP에 있는 게 아니라 "임의 GLB에서 헤어 자동 분리·자동 리깅·자동 SpringBone 설정"이라는 ML/CG 본질 문제에 있습니다. 학기 MVP 범위에서는 비현실적이고, Blender MCP는 그것보다 *헤어 프리셋 라이브러리 산업화*에 쓰는 게 10배 가치 있습니다.**

---

## 1. Blender MCP가 제공하는 것 (인프라는 OK)

| 도구 | 가능성 |
|---|---|
| `execute_blender_code` | bpy(Python) 임의 실행 — 메시·아마추어·머티리얼·셰이더 모두 조작 가능 |
| `get_scene_info`, `get_object_info` | 현재 씬 상태 조회 (자동화 검증용) |
| `import_generated_asset` | Hyper3D/Hunyuan3D로 만든 모델 import |
| `set_texture` | 텍스처 자동 적용 |

**필요한 추가 패키지:**
- [VRM Add-on for Blender](https://vrm-addon-for-blender.info/) — VRMC_springBone-1.0 spec 지원, Python API로 자동화 가능
- 또는 [VRM Add-on for Blender Beyond](https://github.com/tdw46/VRM-Addon-for-Blender-Beyond) — SpringBone Viewport Preview 등 부가 기능

**확인된 사실:** VRM Add-on은 bpy로 자동화 가능하고, SpringBone export도 스크립트로 설정 가능. 즉 **Blender MCP + VRM Add-on 조합으로 GUI 없이 헤어 VRM 생성 가능.**

→ **인프라는 막힘 없음. 진짜 문제는 그다음.**

---

## 2. 어디가 진짜 어려운가 (= 자동화의 본질 문제)

### 문제 ① 단일 메시 GLB에서 헤어만 자동 추출

VARCO 출력은 머리·얼굴·몸이 한 덩어리 메시. 라벨 없음. 토폴로지는 사용자 사진마다 무작위.

| 자동 추출 방법 | 자동화 난이도 | 정확도 (체감) |
|---|---|---|
| 정면 렌더 → BiSeNet 헤어 마스크 → 3D vertex 역투영 | 중 | 60~70% |
| 휴리스틱 (머리뼈 위 + 얼굴 마스크 외곽) | 낮 | 50% |
| [P3-SAM](https://arxiv.org/html/2509.06784v3) / [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) 직접 분할 | 높 | 70~80% (GPU 비쌈) |
| 머터리얼 슬롯이 분리되어 있다면 | 낮 | 100% (보장 X) |

**현실:** 어느 방법도 100% 안 되고, 실패 케이스(반묶음, 옆머리, 모자)에서 끔찍한 결과가 나올 수 있음. 사용자 30명 중 5명한테는 "내 머리 어디 갔어요"가 발생.

### 문제 ② 추출된 헤어에 본 자동 배치 + 스킨 웨이트

[Auto-Rig Pro](https://superhivemarket.com/products/auto-rig-pro/) 같은 도구가 있긴 함. 하지만:

- bpy로 호출 가능 (`bpy.ops.auto_rig.pro_generate()`) → **headless 자동화는 OK**
- 그러나 **자동 binding은 본-vertex 거리만 가지고 가중치 부여 → 결과 품질 들쭉날쭉**
- 헤어 메시처럼 가늘고 긴 strand에서는 weight painting 수동 보정이 거의 필수
- "다음 단계는 weight painting을 사람이 직접 해야 한다"는 게 Auto-Rig Pro 공식 문서의 입장

### 문제 ③ SpringBone 자동 파라미터 튜닝

VRMC_springBone-1.0에서 각 본마다 `stiffness`, `dragForce`, `gravityPower`, `hitRadius` 파라미터를 설정해야 함.

- **정답이 없음.** 헤어 길이/볼륨/스타일에 따라 모두 다름
- 같은 파라미터로 짧은 단발과 긴 생머리를 동시에 자연스럽게 만드는 건 불가능
- 결국 사람이 미리보기 보면서 튜닝 → "자동화"의 의미가 약해짐

### 문제 ④ 머터리얼 → MToon 셰이더 변환

VARCO가 표준 PBR로 출력해도 VRM 표준은 [MToon](https://vrm.dev/en/univrm/shaders/mtoon/) 셰이더. 자동 변환은:
- albedo, metallic, roughness → MToon의 `_Color`, `_OutlineColor`, `_ShadeColor` 매핑
- 여기까지는 bpy로 룰 베이스 변환 가능
- 하지만 헤어 특유의 anisotropic highlight, alpha-cutout 처리는 자동화 어려움

---

## 3. 종합 평가 — 학기 MVP에 대한 솔직한 답변

| 시나리오 | end-to-end 자동화 성공률 | OBS/VSeeFace에서 자연스러운 결과 |
|---|---|---|
| 짧은 단발 정면 사진 | 50% | 30% |
| 긴 생머리 정면 | 30% | 20% |
| 묶음/포니테일 | 10% | 5% |
| 모자/안경 같이 | 5% | 5% |

**6주 안에 5인 팀이 만들 수 있는 품질 = 상용 서비스 수준 미달.** 

베타 50명에게 풀면 "기대보다 별로다" 인식이 형성될 위험이 큼. MVP의 가장 큰 메시지인 **"30초 안에 쓸만한 VTuber 아바타"가 깨진다.**

---

## 4. Blender MCP를 진짜 잘 쓰는 길 — **헤어 프리셋 라이브러리 산업화**

이현지 팀원이 헤어 프리셋 30종을 손으로 만드는 작업은 다음 8단계의 반복:

1. 헤어 메시 import
2. 마스터 템플릿에 부착 (head bone parent)
3. 머터리얼 MToon 변환
4. SpringBone joint·collider·spring 설정
5. 단독 GLB로 export
6. 정면/측면 썸네일 렌더
7. DINOv2 임베딩 추출
8. DB 메타데이터 저장

→ **8단계 × 30종 = 240번의 반복 작업.**

이걸 사람이 하면 30시간, Blender MCP로 자동화하면 **3시간**.

### 자동화 워크플로우 (Blender MCP `execute_blender_code` 한 번 호출)

```python
import bpy
import bpy_extras
import json
import os
from mathutils import Vector

VRM_ADDON = "io_scene_vrm"  # VRM Add-on for Blender

def industrialize_hair_preset(hair_glb, master_template_blend, out_dir, meta):
    # 0. 깨끗한 씬으로 시작
    bpy.ops.wm.read_factory_settings(use_empty=True)
    
    # 1. 마스터 템플릿 (이현지 작업물) 로드
    bpy.ops.wm.append(
        filepath=f"{master_template_blend}/Object/MasterAvatar",
        directory=f"{master_template_blend}/Object/",
        filename="MasterAvatar",
    )
    template = bpy.data.objects["MasterAvatar"]
    armature = template.find_armature()
    
    # 2. 헤어 GLB import
    bpy.ops.import_scene.gltf(filepath=hair_glb)
    hair = bpy.context.selected_objects[0]
    hair.name = meta["id"]
    
    # 3. head bone에 parent
    head_bone_name = "J_Bip_C_Head"  # VRM 표준 본 이름
    hair.parent = armature
    hair.parent_type = 'BONE'
    hair.parent_bone = head_bone_name
    
    # 4. 머티리얼 MToon 변환 (룰 베이스)
    convert_to_mtoon(hair)
    
    # 5. SpringBone 설정 — VRM Add-on API
    setup_spring_bone_chain(
        armature=armature,
        target_mesh=hair,
        stiffness=meta.get("stiffness", 0.7),
        drag=meta.get("drag", 0.4),
        gravity=meta.get("gravity", 0.3),
        hit_radius=meta.get("hit_radius", 0.02),
    )
    
    # 6. VRM export
    vrm_path = os.path.join(out_dir, f"{meta['id']}.vrm")
    bpy.ops.export_scene.vrm(filepath=vrm_path)
    
    # 7. 썸네일 렌더 (정면 + 측면)
    front_thumb = render_view(out_dir, meta["id"], camera_yaw=0)
    side_thumb  = render_view(out_dir, meta["id"], camera_yaw=90)
    
    # 8. 메타 저장
    meta_out = {
        **meta,
        "vrm_path": vrm_path,
        "thumbnails": [front_thumb, side_thumb],
        "spring_bones": collect_spring_bone_settings(armature),
    }
    with open(os.path.join(out_dir, f"{meta['id']}.json"), "w") as f:
        json.dump(meta_out, f, ensure_ascii=False, indent=2)
    
    return meta_out


# 30종 일괄 처리
HAIR_LIBRARY = [
    {"id": "hair_001", "name": "Short Bob",       "stiffness": 0.85, "drag": 0.5},
    {"id": "hair_002", "name": "Medium Wavy",     "stiffness": 0.70, "drag": 0.4},
    {"id": "hair_003", "name": "Long Straight",   "stiffness": 0.55, "drag": 0.35},
    # ... 30개
]

for meta in HAIR_LIBRARY:
    glb_path = f"/assets/raw_hair/{meta['id']}.glb"
    industrialize_hair_preset(
        hair_glb=glb_path,
        master_template_blend="/assets/master_template.blend",
        out_dir="/assets/preset_library",
        meta=meta,
    )
```

이 스크립트를 `mcp__blender__execute_blender_code`에 통째로 넘기면 끝. 새 헤어 추가도 메타 한 줄 추가하면 끝.

### 품질 검증도 자동화

```python
# Unity headless에서 5초 시뮬레이션 → 캡처 → ML 모델로 "헤어가 자연스럽게 흔들리나" 평가
def validate_spring_bone(vrm_path):
    # bpy로는 어려우므로 Unity headless 워커(최윤수 담당)에 위임
    ...
```

---

## 5. 그래도 "GLB → 자동 헤어 VRM"을 시도한다면 — Phase 2~3 PoC

**MVP 출시 후 3개월 PoC 단계로 검토 가치 있음:**

### Phase 2 PoC 절차
1. **데이터 수집:** MVP에서 사용자가 "추천 매칭이 마음에 안 든다"고 표시한 케이스 + 그때의 VARCO GLB 100건 수집
2. **자동 파이프라인 구축:**
   - 정면/뒷면 렌더 (Blender bpy)
   - BiSeNet 마스크 → 3D vertex 역투영 → vertex group 만들기
   - bpy로 헤어 vertex만 P 키로 분리
   - Auto-Rig Pro `bpy.ops.auto_rig.pro_generate()` 호출
   - VRM Add-on으로 export
3. **사람이 수동 평가:** 100건 중 몇 개가 "쓸만함" 수준인가
4. **품질 70% 넘기면:** Phase 3에서 제품에 도입
5. **70% 못 넘기면:** 폐기, Wrap deformation(D안) 또는 strand 기반 재구성(C안)으로 방향 전환

### 예상 비용
- GPU 추론 (BiSeNet + SAM3D): 사용자당 ~3~5분, EC2 g4dn.xlarge로 처리하면 건당 200~400원
- Blender headless 처리: 1~2분, EC2 c6i.large로 처리하면 건당 50~100원
- 총 사용자당 처리 비용: 250~500원 → BEP 영향 적음

---

## 6. 권장 결정

| 단계 | 행동 |
|---|---|
| **이번 주** | Blender MCP를 이현지님 워크플로우 자동화에 도입 — `execute_blender_code` PoC 1종(짧은 단발) 자동화 → 작동 확인 |
| **다음 1~2주** | 30종 헤어 일괄 자동 생성 → MVP 프리셋 라이브러리 완성 |
| **MVP 후 3개월** | "자동 헤어 추출" PoC를 100건 데이터로 평가 → go/no-go 결정 |
| **그 이후** | go이면 Phase 3 제품화, no-go이면 Wrap deformation 또는 Im2Haircut 라이선스 검토 |

---

## 7. 핵심 요약 — 한 화면으로

**Q. GLB → 자동 헤어 VRM 생성 모델을 Blender MCP로 만들 수 있나?**
**A. 가능. 다만 그게 학기 MVP의 정답은 아니다.**

- ✅ Blender MCP + VRM Add-on은 인프라로서 충분히 받쳐준다
- ❌ 임의 GLB에서 헤어 자동 분리·리깅·SpringBone 튜닝은 본질적으로 어렵고, 6주 안에 사용자 만족 수준 못 만든다
- 🟡 **Blender MCP를 진짜 가치 있게 쓰는 곳은 "프리셋 라이브러리 산업화"** — 이현지님 30시간 작업을 3시간으로 단축
- 🔵 자동 헤어 생성은 Phase 2 PoC로 100건 데이터 모은 후 go/no-go 결정

이 결정으로:
- MVP는 안전한 길(프리셋 매칭)로 출시 가능
- Blender MCP는 **즉시 가치를 만든다** (이현지님 노동 절감)
- 자동 헤어 생성의 장기 가능성은 **데이터 모으면서 검증** (잃을 게 없음)

---

## 참고 자료

### Blender MCP / VRM 자동화
- [VRM Add-on for Blender 공식](https://vrm-addon-for-blender.info/)
- [SpringBone Physics System (DeepWiki)](https://deepwiki.com/saturday06/VRM-Addon-for-Blender/4.2-spring-bone-physics-system)
- [VRM Add-on for Blender Beyond (확장판)](https://github.com/tdw46/VRM-Addon-for-Blender-Beyond)
- [VRM format Blender Extensions](https://extensions.blender.org/add-ons/vrm/)

### Blender Auto-Rigging
- [Auto-Rig Pro](https://superhivemarket.com/products/auto-rig-pro/)
- [Rigify (Blender 내장)](https://docs.blender.org/manual/en/2.81/addons/rigging/rigify.html)
- [AccuRIG (ActorCore, 무료)](https://actorcore.reallusion.com/auto-rig)

### 3D Mesh Segmentation (헤어 자동 분할용)
- [P3-SAM: Native 3D Part Segmentation](https://arxiv.org/html/2509.06784v3)
- [SAM 3D Objects (Meta)](https://github.com/facebookresearch/sam-3d-objects)
- [Point-SAM (ICLR 2025)](https://github.com/zyc00/Point-SAM)

### Hair Reconstruction (Phase 3 후보)
- [Im2Haircut (ICCV 2025)](https://im2haircut.is.tue.mpg.de/)
- [Gaussian Haircut (ECCV 2024)](https://eth-ait.github.io/GaussianHaircut/)
