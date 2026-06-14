import type { PresetItem, QuickPreset } from '@/types/preset';

export const PRESET_ITEMS: PresetItem[] = [
  {
    id: 'hair-none',
    name: '없음',
    category: 'hair',
    thumbnailUrl: '',
  },
  {
    id: 'hair-01',
    name: '헤어 1',
    category: 'hair',
    thumbnailUrl: '/thumbnails/hair-01.png',
    meshUrl: '/models/hair-library/N00_000_Hair_01_HAIR.glb',
    hairBackUrl: '/models/hair-library/N00_000_00_HairBack_01_HAIR.glb',
  },
  {
    id: 'hair-02',
    name: '헤어 2',
    category: 'hair',
    thumbnailUrl: '/thumbnails/hair-02.png',
    meshUrl: '/models/hair-library/N00_000_Hair_02_HAIR.glb',
    hairBackUrl: '/models/hair-library/N00_000_00_HairBack_02_HAIR.glb',
  },
  {
    id: 'hair-03',
    name: '헤어 3',
    category: 'hair',
    thumbnailUrl: '/thumbnails/hair-03.png',
    meshUrl: '/models/hair-library/N00_000_Hair_03_HAIR.glb',
    hairBackUrl: '/models/hair-library/N00_000_00_HairBack_03_HAIR.glb',
  },
  {
    id: 'hair-04',
    name: '헤어 4',
    category: 'hair',
    thumbnailUrl: '/thumbnails/hair-04.png',
    meshUrl: '/models/hair-library/N00_000_Hair_04_HAIR.glb',
    hairBackUrl: '/models/hair-library/N00_000_00_HairBack_04_HAIR.glb',
  },
  {
    id: 'hair-05',
    name: '헤어 5',
    category: 'hair',
    thumbnailUrl: '/thumbnails/hair-05.png',
    meshUrl: '/models/hair-library/N00_000_Hair_05_HAIR.glb',
    hairBackUrl: '/models/hair-library/N00_000_00_HairBack_05_HAIR.glb',
  },
  {
    id: 'outfit-none',
    name: '없음',
    category: 'outfit',
    thumbnailUrl: '',
  },
  {
    id: 'outfit-01',
    name: '의상 1',
    category: 'outfit',
    thumbnailUrl: '/thumbnails/cloth-01.png',
    meshUrl: '/models/cloth_1.vrm',
  },
  {
    id: 'outfit-02',
    name: '의상 2',
    category: 'outfit',
    thumbnailUrl: '/thumbnails/cloth-02.png',
    meshUrl: '/models/cloth_2.vrm',
  },
  {
    id: 'outfit-03',
    name: '의상 3',
    category: 'outfit',
    thumbnailUrl: '/thumbnails/cloth-03.png',
    meshUrl: '/models/cloth_3.vrm',
  },
  {
    id: 'outfit-04',
    name: '의상 4',
    category: 'outfit',
    thumbnailUrl: '/thumbnails/cloth-04.png',
    meshUrl: '/models/cloth_4.vrm',
  },
  {
    id: 'outfit-05',
    name: '의상 5',
    category: 'outfit',
    thumbnailUrl: '/thumbnails/cloth-05.png',
    meshUrl: '/models/cloth_5.vrm',
  },
  {
    id: 'accessory-none',
    name: '없음',
    category: 'accessory',
    thumbnailUrl: '',
  },
  {
    id: 'accessory-glasses',
    name: '안경',
    category: 'accessory',
    thumbnailUrl: '',
    meshUrl: '/api/accessory-render/file?path=outputs%5Cglasses_only_001%5Cglb_raw%5Cacc_001_raw.glb',
  },
  {
    id: 'accessory-hat',
    name: '모자',
    category: 'accessory',
    thumbnailUrl: '',
  },
];

// --- 얼굴 프리셋 (Fcl_* morph targets) ---

export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: 'big-eyes-small-mouth',
    name: '큰 눈 + 작은 입',
    description: '초롱초롱한 큰 눈과 작은 입 조합',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Spread: 0.6,
        Fcl_MTH_Small: 0.7,
      },
    },
  },
  {
    id: 'gentle-smile',
    name: '부드러운 미소',
    description: '살짝 웃는 자연스러운 표정',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Joy: 0.3,
        Fcl_MTH_Fun: 0.4,
      },
    },
  },
  {
    id: 'chic-look',
    name: '시크한 표정',
    description: '차분하고 쿨한 인상',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Natural: 0.7,
        Fcl_BRW_Angry: 0.15,
        Fcl_MTH_Close: 0.3,
      },
    },
  },
  {
    id: 'bright-joy',
    name: '밝은 웃음',
    description: '활기찬 웃는 표정',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Joy: 0.6,
        Fcl_BRW_Joy: 0.4,
        Fcl_MTH_Joy: 0.5,
      },
    },
  },
  {
    id: 'surprised',
    name: '놀란 표정',
    description: '눈이 커지고 입이 벌어진 놀란 표정',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Surprised: 0.5,
        Fcl_BRW_Surprised: 0.6,
        Fcl_MTH_O: 0.4,
      },
    },
  },
  {
    id: 'sad-look',
    name: '슬픈 표정',
    description: '가라앉은 분위기의 표정',
    category: 'face',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Sorrow: 0.5,
        Fcl_BRW_Sorrow: 0.6,
        Fcl_MTH_Down: 0.3,
      },
    },
  },

  // --- 스타일 프리셋 (헤어 + 의상 + 얼굴 조합) ---

  {
    id: 'style-casual-cute',
    name: '캐주얼 큐트',
    description: '귀여운 헤어 + 캐주얼 의상 + 미소',
    category: 'style',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Joy: 0.3,
        Fcl_MTH_Fun: 0.35,
      },
      hairFrontUrl: '/models/hair-library/N00_000_Hair_01_HAIR.glb',
      hairBackUrl: '/models/hair-library/N00_000_00_HairBack_01_HAIR.glb',
      outfitUrl: '/models/cloth_1.vrm',
    },
  },
  {
    id: 'style-chic-modern',
    name: '시크 모던',
    description: '날카로운 헤어 + 모던 의상 + 쿨한 표정',
    category: 'style',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Natural: 0.7,
        Fcl_BRW_Angry: 0.15,
        Fcl_MTH_Close: 0.3,
      },
      hairFrontUrl: '/models/hair-library/N00_000_Hair_03_HAIR.glb',
      hairBackUrl: '/models/hair-library/N00_000_00_HairBack_03_HAIR.glb',
      outfitUrl: '/models/cloth_2.vrm',
    },
  },
  {
    id: 'style-natural-classic',
    name: '내추럴 클래식',
    description: '자연스러운 헤어 + 클래식 의상 + 차분한 표정',
    category: 'style',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Natural: 0.4,
        Fcl_MTH_Small: 0.3,
      },
      hairFrontUrl: '/models/hair-library/N00_000_Hair_02_HAIR.glb',
      hairBackUrl: '/models/hair-library/N00_000_00_HairBack_02_HAIR.glb',
      outfitUrl: '/models/cloth_3.vrm',
    },
  },
  {
    id: 'style-energetic-sporty',
    name: '활기찬 스포티',
    description: '짧은 헤어 + 스포티 의상 + 밝은 웃음',
    category: 'style',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Joy: 0.5,
        Fcl_BRW_Joy: 0.3,
        Fcl_MTH_Joy: 0.4,
      },
      hairFrontUrl: '/models/hair-library/N00_000_Hair_04_HAIR.glb',
      hairBackUrl: '/models/hair-library/N00_000_00_HairBack_04_HAIR.glb',
      outfitUrl: '/models/cloth_4.vrm',
    },
  },
  {
    id: 'style-elegant-feminine',
    name: '우아한 페미닌',
    description: '긴 헤어 + 우아한 의상 + 부드러운 미소',
    category: 'style',
    isBuiltIn: true,
    values: {
      morphTargets: {
        Fcl_EYE_Joy: 0.2,
        Fcl_MTH_Fun: 0.3,
        Fcl_EYE_Spread: 0.2,
      },
      hairFrontUrl: '/models/hair-library/N00_000_Hair_05_HAIR.glb',
      hairBackUrl: '/models/hair-library/N00_000_00_HairBack_05_HAIR.glb',
      outfitUrl: '/models/cloth_5.vrm',
    },
  },
];

export function getPresetsByCategory(category: PresetItem['category']): PresetItem[] {
  return PRESET_ITEMS.filter((p) => p.category === category);
}
