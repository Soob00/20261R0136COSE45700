# 절차적 헤어 8종 PoC — 환경 세팅 가이드

> 목표: Claude(Blender MCP)가 직접 단순 헤어 8종을 생성·export하기 위한 모든 사전 준비
> 예상 소요: 처음 세팅 ~30분 + 8종 생성 ~1시간

---

## 0. 한눈에 — 필요한 것들

| 분류 | 항목 | 누가 |
|---|---|---|
| 1. 도구 | Blender 4.2 LTS · Claude Desktop · Blender MCP connector · VRM Add-on for Blender | **사용자** |
| 2. 자산 | 마스터 템플릿 .blend 또는 임시 baseline | **사용자** (이현지님 작업물 또는 임시) |
| 3. 디렉토리 | `hair-library/output/` 구조 + 쓰기 권한 | **사용자** |
| 4. 연결 | Blender의 BlenderMCP 패널에서 "Connect to Claude" ON | **사용자** |
| 5. 8종 결정 | 어떤 헤어를 만들지 매트릭스 | **합의 (아래 제안)** |
| 6. 실행 | bpy 코드 실행 + GLB export + screenshot 검증 | **Claude** |

---

## 1. 도구 설치 (15분)

### 1-1) Blender 4.2 LTS
- [blender.org/download](https://www.blender.org/download/) → 4.2 LTS 다운로드
- 이미 설치되어 있다면 버전 확인 (Help → About Blender)

### 1-2) VRM Add-on for Blender
- [vrm-addon-for-blender.info](https://vrm-addon-for-blender.info/) 또는 [Blender Extensions](https://extensions.blender.org/add-ons/vrm/)
- Blender → Edit → Preferences → Add-ons → "VRM" 검색 → 설치 + 활성화

### 1-3) Blender MCP Connector (공식 권장)
**공식 connector** (2026-04-28 출시):
1. Claude Desktop → Customize → Connectors → "Blender" 검색 → Add
2. [blender.org/lab/mcp-server/](https://www.blender.org/lab/mcp-server/) 페이지를 Blender 옆에 띄움
3. 페이지의 install link를 Blender 윈도우로 **드래그 (총 2번)**
   - 1번째 드롭: lab 저장소 등록
   - 2번째 드롭: 애드온 설치
4. Blender 3D Viewport에서 `N` 키 → 우측 사이드바 → **BlenderMCP** 탭 표시 확인

**대안 (커뮤니티 버전):** [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) — Cursor/VS Code에서 쓸 때

상세 가이드: [Using the Blender Connector in Claude](https://claude.com/resources/tutorials/using-the-blender-connector-in-claude)

---

## 2. 마스터 템플릿 준비 (5~30분)

### 옵션 A — 이현지님 마스터 (권장)
이현지님이 이미 만든 마스터 템플릿이 있다면:
- 파일 위치 확인: 예) `~/Desktop/project/virtual_avatar/master/master_template.blend`
- Blender에서 열기
- **head bone 이름 확인** (`N` 사이드바 → Item → Properties → 본 선택 → 이름)
  - VRM 표준이면 `J_Bip_C_Head`
  - 다른 이름이면 알려주시면 코드 조정

### 옵션 B — 임시 baseline (마스터 없으면)
PoC만 빠르게 검증하려면:
1. Blender 새 파일 → 기본 Cube 삭제
2. Add → Armature → Single Bone (이름: "Armature")
3. Edit Mode 진입 → 본 이름을 `J_Bip_C_Head`로 변경
4. Head 위치를 (0, 0, 1.62)에 두기 (사람 머리 높이)
5. Object Mode → 저장: `master/dummy_master.blend`

8종 생성 PoC가 끝나면 옵션 A로 교체하면 됩니다.

---

## 3. 디렉토리 구조 (1분)

워크스페이스 폴더 안에 만들어두기:

```bash
mkdir -p ~/Desktop/project/virtual_avatar/hair-library/output/{front,side,back,top}
mkdir -p ~/Desktop/project/virtual_avatar/hair-library/master
```

결과:
```
~/Desktop/project/virtual_avatar/hair-library/
├── master/
│   └── master_template.blend  (또는 dummy_master.blend)
└── output/
    ├── front/   ← Claude가 GLB·thumb·meta.json 출력
    ├── side/
    ├── back/
    └── top/
```

---

## 4. Blender MCP 연결 (1분)

1. Blender에서 마스터 템플릿 .blend 파일 열기
2. 3D Viewport에서 `N` → BlenderMCP 탭
3. **"Connect to Claude"** 또는 **"Start MCP Server"** 버튼 클릭
4. Claude Desktop의 입력창 옆 connector 아이콘에서 Blender가 ON 상태인지 확인

**주의:** Blender MCP는 사용자의 Blender를 직접 조작합니다. 작업 중인 다른 .blend는 닫아두거나 백업하세요.

---

## 5. 만들 8종 — 미리 결정 (제안)

| # | id | part | 길이 | 스타일 | 비고 |
|---|---|---|---|---|---|
| 1 | `front_001_short_straight_fringe` | front | short | straight | 일자 단발 앞머리 |
| 2 | `front_002_short_swept` | front | short | straight | 사이드 스윕 |
| 3 | `side_001_short_straight` | side | short | straight | 귀 위 짧은 옆머리 |
| 4 | `side_002_medium_straight` | side | medium | straight | 어깨까지 옆머리 |
| 5 | `back_001_short_straight` | back | short | straight | 짧은 뒷머리 |
| 6 | `back_002_medium_straight` | back | medium | straight | 미디엄 뒷머리 |
| 7 | `top_001_none` | top | — | — | 정수리 평탄 |
| 8 | `top_002_single_ahoge` | top | — | — | 한 가닥 아호게 |

이 8종은 모두 절차적 코드로 자연스럽게 만들 수 있는 단순 스타일입니다. **여기서 빼거나 추가하고 싶은 항목 있으면 알려주세요.**

---

## 6. 안전 장치 (Claude가 코드 실행하기 전)

- [ ] 마스터 템플릿 .blend는 **별도 사본**에서 작업 (원본 백업)
- [ ] Blender 다른 작업 닫음
- [ ] 첫 1종(`front_001`)만 만들고 **반드시 viewport screenshot으로 확인** 후 다음 진행
- [ ] 각 종마다 GLB export 완료 시점에 파일 크기·vertex 수 점검

---

## 7. 실행 순서 (Claude가 할 일)

준비가 끝나면 저(Claude)에게 *"시작해줘"* 라고만 말씀하시면 됩니다. 그러면:

1. **`get_scene_info` / `get_object_info`로 마스터 구조 확인**
   - head bone 이름·위치, 마스터 armature 이름 파악
2. **`front_001` PoC 1종 실행**
   - bpy 코드로 짧은 단발 절차적 생성
   - 마스터 head에 attach
   - SpringBone chain 좌우 각 3본 추가
   - MToon 머티리얼 적용
3. **`get_viewport_screenshot`으로 결과 확인**
   - 사용자에게 보여드림
4. **"OK" 받으면** 나머지 7종 일괄 진행
5. **각 종마다 GLB export + meta.json 생성**
6. 모두 끝나면 결과 디렉토리 위치와 통계 정리

---

## 8. 첫 PoC 실행 시 보내실 메시지 예시

```
세팅 끝났어. 마스터 템플릿은 ~/Desktop/project/virtual_avatar/hair-library/master/master_template.blend에 있어.
head bone 이름은 [J_Bip_C_Head 또는 다른 이름]이야.
출력은 ~/Desktop/project/virtual_avatar/hair-library/output/에 부탁해.
front_001부터 시작해줘.
```

---

## 9. 트러블슈팅

| 증상 | 해결 |
|---|---|
| Blender에서 BlenderMCP 탭이 안 보임 | `N` 사이드바를 한 번 닫았다 다시 열기. 또는 Add-ons에서 BlenderMCP 활성화 확인 |
| Claude Desktop의 connector에 Blender가 회색 | Blender 패널의 "Connect to Claude" 클릭 후 30초 대기 |
| `head bone not found` 에러 | 본 이름이 다름 → 사용자가 본 이름 알려주거나 마스터에서 확인 |
| GLB export가 빈 파일 | 메시 객체가 선택되지 않은 상태로 export → 코드 수정 (`use_selection=True`와 select 전 단계 점검) |
| MToon 머티리얼이 import 후 white로 보임 | VRM Add-on이 활성화되어 있어야 MToon 셰이더 인식 |
| Viewport screenshot이 어두움 | 카메라/조명 자동 설정 → 테스트용 sun light 1개 추가 코드 포함 |

---

## 10. 다음 단계 (8종 PoC 완료 후)

- 결과 8종이 "쓸만함" 수준이면 → 시나리오 E로 전환 (Claude 8종 + 이현지님 27종)
- "단조로움" 평가면 → 시나리오 D로 전환 (이현지님 35종 모두 VRoid)
- 어느 쪽이든 SpringBone·MToon·VRM export 자동화 파이프라인은 그대로 재사용

---

## 참고 자료

- [Using the Blender Connector in Claude (공식)](https://claude.com/resources/tutorials/using-the-blender-connector-in-claude)
- [Blender Lab — MCP Server](https://www.blender.org/lab/mcp-server/)
- [Claude Blender Connector — 단계별 가이드](https://mcp.directory/blog/claude-blender-connector-guide)
- [Claude + Blender MCP Setup Guide (2026)](https://blendermcp.org/setup/claude)
- [VRM Add-on for Blender](https://vrm-addon-for-blender.info/)
- [ahujasid/blender-mcp (커뮤니티)](https://github.com/ahujasid/blender-mcp)
