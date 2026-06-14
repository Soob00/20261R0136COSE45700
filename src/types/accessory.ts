export type AccessoryCategory =
  | 'glasses'
  | 'hairpin'
  | 'hair_clip'
  | 'hair_bow';

export type HeadAccessorySubtype =
  | 'headband'
  | 'small_crown'
  | 'mini_hat';

export type AccessorySlot =
  | 'face_center'
  | 'head_side_left'
  | 'head_side_right'
  | 'head_top';

export type AttachRegion =
  | 'face_center'
  | 'head_side_upper_left'
  | 'head_side_upper_right'
  | 'head_top';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type AccessoryPipelineStage =
  | 'detect'
  | 'crop'
  | 'isolate'
  | 'isolation_validate'
  | 'varco_submit'
  | 'varco_poll'
  | 'download_glb'
  | 'validate_glb'
  | 'postprocess'
  | 'review'
  | 'register_preset';

export type FailureReason =
  | 'detect_no_accessory'
  | 'detect_invalid_category'
  | 'crop_bbox_invalid'
  | 'isolate_object_not_isolated'
  | 'isolate_object_too_small'
  | 'isolation_validate_failed'
  | 'varco_submit_failed'
  | 'varco_timeout'
  | 'download_glb_failed'
  | 'validate_glb_failed'
  | 'postprocess_failed'
  | 'review_rejected'
  | 'review_needs_fix'
  | 'register_requires_approved';

export type AccessorySymmetry = 'single' | 'paired';
export type AccessorySizeHint = 'small' | 'medium' | 'large';
export type RiskLevel = 'low' | 'medium' | 'high';
export type GenerationPriority = 'low' | 'medium' | 'high';
export type PivotPolicy = 'object_center' | 'contact_point_back_center';

export interface AccessoryPreset {
  presetId: string;
  name: string;
  category: AccessoryCategory;
  slot: AccessorySlot;
  assetPath: string;
  thumbnailPath: string;
  anchorBone: string;
  attachRegion: AttachRegion;
  pivotPolicy: PivotPolicy;
  defaultScale: number;
  defaultRotation: [number, number, number];
  defaultOffset: [number, number, number];
  reviewStatus: ReviewStatus;
  qualityScore: number;
  tags: string[];
  dominantColorHex: string | null;
  paletteHexes: string[];
  symmetry: AccessorySymmetry;
  compatibleAvatarTemplates?: string[];
  sourceImagePath?: string;
  cropImagePath?: string;
  isolatedImagePath?: string;
  varcoRequestId?: string;
  varcoParams?: Record<string, unknown>;
  faceCount?: number;
  hasTexture?: boolean;
  bbox?: [number, number, number, number];
  sizeHint?: AccessorySizeHint;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessoryPresetFile {
  preset_id: string;
  name: string;
  category: AccessoryCategory;
  slot: AccessorySlot;
  asset_path: string;
  thumbnail_path: string;
  anchor_bone: string;
  attach_region: AttachRegion;
  pivot_policy: PivotPolicy;
  default_scale: number;
  default_rotation: [number, number, number];
  default_offset: [number, number, number];
  review_status: ReviewStatus;
  quality_score: number;
  tags: string[];
  dominant_color_hex: string | null;
  palette_hexes: string[];
  symmetry: AccessorySymmetry;
  compatible_avatar_templates?: string[];
  source_image_path?: string;
  crop_image_path?: string;
  isolated_image_path?: string;
  varco_request_id?: string;
  varco_params?: Record<string, unknown>;
  face_count?: number;
  has_texture?: boolean;
  bbox?: [number, number, number, number];
  size_hint?: AccessorySizeHint;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AppliedAccessory {
  presetId: string;
  slot: AccessorySlot;
  colorOverride?: string | null;
}

export interface DetectedAccessoryCandidate {
  id: string;
  category: AccessoryCategory | 'unknown' | 'unsupported';
  bbox: [number, number, number, number];
  attachRegion: AttachRegion;
  confidence: number;
  rawColors: string[];
  normalizedColors: string[];
  sizeHint?: AccessorySizeHint;
  occlusionRisk: RiskLevel;
  isolationDifficulty: RiskLevel;
  generationPriority: GenerationPriority;
  shapeDescription: string;
}
