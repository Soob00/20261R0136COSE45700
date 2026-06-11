import type { TemplateMetadata } from '@/types/template';
import { assetUrl } from '@/lib/assetUrl';

export const TEMPLATES: TemplateMetadata[] = [
  {
    id: 'customizable-default',
    name: 'Default',
    description: '기본 커스터마이징 캐릭터',
    thumbnailUrl: assetUrl('/models/CustomizableCharacter.vrm'),
    vrmUrl: assetUrl('/models/CustomizableCharacter.vrm'),
    tags: ['default', 'basic'],
  },
  // 추후 템플릿팀 에셋 도착 시 추가
  // {
  //   id: 'cute',
  //   name: 'Cute',
  //   description: '귀여운 스타일 캐릭터',
  //   thumbnailUrl: '/models/cute-template-thumb.png',
  //   vrmUrl: '/models/CuteCharacter.vrm',
  //   tags: ['cute', 'round'],
  // },
  // {
  //   id: 'slim',
  //   name: 'Slim',
  //   description: '슬림한 스타일 캐릭터',
  //   thumbnailUrl: '/models/slim-template-thumb.png',
  //   vrmUrl: '/models/SlimCharacter.vrm',
  //   tags: ['slim', 'tall'],
  // },
  // {
  //   id: 'mature',
  //   name: 'Mature',
  //   description: '성숙한 스타일 캐릭터',
  //   thumbnailUrl: '/models/mature-template-thumb.png',
  //   vrmUrl: '/models/MatureCharacter.vrm',
  //   tags: ['mature', 'adult'],
  // },
];

export function getTemplateById(id: string): TemplateMetadata | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
