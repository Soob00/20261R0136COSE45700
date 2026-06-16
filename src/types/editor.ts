// PRD EditorStore 인터페이스 정의
// Sprint 1: morphTargets, boneScales, materials, versions, undo/redo

import type { AccessoryCategory } from './accessory';
import type { AccessoryInstance } from '@/lib/accessory-attachment';

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
  accessories?: AccessoryInstance[];
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

  // Accessory attachments
  accessoryInstances: AccessoryInstance[];
  selectedAccessoryInstanceId: string | null;

  // Version management
  versions: AvatarVersion[];

  // UI state
  isLoading: boolean;
  error: string | null;

  // Custom user uploaded/generated presets
  customPresets: import('./preset').PresetItem[];

  // Background Tasks
  backgroundTasks: AccessoryTask[];
}

export interface AccessoryTask {
  id: string;
  filename: string;
  category: AccessoryCategory;
  status: 'uploading' | 'processing' | 'success' | 'error';
  errorMessage?: string;
  resultUrl?: string;
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
  applyTextureResult: (textures: Record<string, string>) => void;

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

  // Accessories
  addAccessory: (payload: { presetId: string; category: AccessoryCategory }) => void;
  removeAccessory: (instanceId: string) => void;
  clearAccessories: () => void;
  replaceSingleAccessory: (payload: { presetId: string; category: AccessoryCategory }) => void;
  selectAccessory: (instanceId: string | null) => void;
  setAccessoryEnabled: (instanceId: string, enabled: boolean) => void;
  
  // Background Tasks
  addBackgroundTask: (task: AccessoryTask) => void;
  updateBackgroundTask: (id: string, updates: Partial<AccessoryTask>) => void;
  removeBackgroundTask: (id: string) => void;
  
  setAccessoryOffsetDelta: (
    instanceId: string,
    value: [number, number, number],
    options?: { pushHistory?: boolean }
  ) => void;
  setAccessoryRotationDelta: (
    instanceId: string,
    value: [number, number, number],
    options?: { pushHistory?: boolean }
  ) => void;
  setAccessoryScaleMultiplier: (
    instanceId: string,
    value: [number, number, number],
    options?: { pushHistory?: boolean }
  ) => void;

  // Custom Presets
  addCustomPreset: (preset: import('./preset').PresetItem) => void;
  removeCustomPreset: (presetId: string) => void;
  resetAccessoryAdjustment: (instanceId: string) => void;

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
