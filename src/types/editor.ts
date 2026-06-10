// PRD EditorStore 인터페이스 정의
// Sprint 1: morphTargets, boneScales, materials, versions, undo/redo

export interface MorphTargetMap {
  [name: string]: number; // -1.0 ~ 1.0
}

export interface BoneScaleMap {
  [boneName: string]: {
    x: number;
    y: number;
    z: number;
  };
}

export interface MaterialSlot {
  name: string;
  color?: string;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  textureUrl?: string;
}

export interface MaterialMap {
  [slotName: string]: MaterialSlot;
}

export interface AvatarVersion {
  id: string;
  name: string;
  parameters: AvatarParameters;
  thumbnailDataUrl?: string;
  createdAt: string;
}

export interface AvatarParameters {
  morphTargets: MorphTargetMap;
  boneScales: BoneScaleMap;
  materials: MaterialMap;
}

export interface HairMatchResult {
  presetId: string;
  score: number;
  colorScore: number;
  geometryScore: number;
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface HairRecommendation {
  bestMatch: HairMatchResult;
  allResults: HairMatchResult[];
  confidence: MatchConfidence;
  extractedColor: string;
}

export interface EditorState {
  // Avatar identification
  avatarId: string | null;
  templateId: string | null;

  // Editing parameters
  morphTargets: MorphTargetMap;
  boneScales: BoneScaleMap;
  materials: MaterialMap;

  // Hair attachments
  hairFrontUrl: string | null;
  hairBackUrl: string | null;
  hairColor: string | null;

  // Hair recommendation
  hairRecommendation: HairRecommendation | null;

  // Outfit attachment
  outfitUrl: string | null;

  // Version management
  versions: AvatarVersion[];

  // UI state
  isLoading: boolean;
  error: string | null;

  // Stamps proposed by the texture pipeline (markings + highlights)
  // keyed by texture slot ID; cleared once consumed by TextureStampEditor
  proposedStamps: Record<string, ProposedStampItem[]> | null;
}

export interface ProposedStampItem {
  shape: 'circle' | 'oval' | 'star' | 'heart' | 'diamond';
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  rotation: number;
}

export interface EditorActions {
  // Morph targets
  setMorphTarget: (name: string, value: number) => void;
  resetMorphTargets: () => void;

  // Bone scales
  setBoneScale: (boneName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  resetBoneScales: () => void;

  // Materials
  setMaterial: (slotName: string, property: keyof MaterialSlot, value: string | number) => void;
  resetMaterials: () => void;

  // Versions
  saveVersion: (name?: string, thumbnailDataUrl?: string) => void;
  restoreVersion: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;
  renameVersion: (versionId: string, name: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Hair
  setHairFront: (url: string | null) => void;
  setHairBack: (url: string | null) => void;
  setHairColor: (color: string | null) => void;
  setHairRecommendation: (rec: HairRecommendation | null) => void;

  // Outfit
  setOutfit: (url: string | null) => void;

  // Pipeline
  applyPipelineResult: (params: Record<string, number>) => void;
  applyTextureResult: (textures: Record<string, string>) => void;
  setProposedStamps: (stamps: Record<string, ProposedStampItem[]> | null) => void;
  /** Update a single slot's textureUrl without undo — used by stamp editor after render */
  setSlotTextureUrl: (slotId: string, url: string) => void;

  // Reset all
  resetAll: () => void;

  // Utility
  setAvatarId: (id: string) => void;
  setTemplateId: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export type EditorStore = EditorState & EditorActions;
