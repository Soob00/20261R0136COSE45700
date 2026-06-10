import { create } from 'zustand';
import type { EditorState, EditorActions, AvatarVersion, MaterialSlot, HairRecommendation, ProposedStampItem } from '@/types/editor';

// --- Undo/Redo History ---

interface HistoryEntry {
  morphTargets: EditorState['morphTargets'];
  boneScales: EditorState['boneScales'];
  materials: EditorState['materials'];
  hairFrontUrl: EditorState['hairFrontUrl'];
  hairBackUrl: EditorState['hairBackUrl'];
  hairColor: EditorState['hairColor'];
  outfitUrl: EditorState['outfitUrl'];
}

const MAX_HISTORY = 50;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];

function snapshot(state: EditorState): HistoryEntry {
  return {
    morphTargets: { ...state.morphTargets },
    boneScales: Object.fromEntries(
      Object.entries(state.boneScales).map(([k, v]) => [k, { ...v }])
    ),
    materials: Object.fromEntries(
      Object.entries(state.materials).map(([k, v]) => [k, { ...v }])
    ),
    hairFrontUrl: state.hairFrontUrl,
    hairBackUrl: state.hairBackUrl,
    hairColor: state.hairColor,
    outfitUrl: state.outfitUrl,
  };
}

function pushUndo(state: EditorState) {
  undoStack.push(snapshot(state));
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

// --- Version persistence ---

const VERSIONS_KEY_PREFIX = 'avatar-editor-versions';
const MAX_VERSIONS = 5;

function loadVersionsFromStorage(avatarId: string | null): AvatarVersion[] {
  if (typeof window === 'undefined' || !avatarId) return [];
  try {
    const raw = localStorage.getItem(`${VERSIONS_KEY_PREFIX}-${avatarId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveVersionsToStorage(avatarId: string | null, versions: AvatarVersion[]) {
  if (typeof window === 'undefined' || !avatarId) return;
  try {
    localStorage.setItem(`${VERSIONS_KEY_PREFIX}-${avatarId}`, JSON.stringify(versions));
  } catch (e) {
    console.warn('Failed to save versions:', e);
  }
}

// --- Store ---

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  avatarId: 'default',
  templateId: null,
  morphTargets: {},
  boneScales: {},
  materials: {},
  hairFrontUrl: null,
  hairBackUrl: null,
  hairColor: null,
  hairRecommendation: null,
  outfitUrl: null,
  versions: [],
  isLoading: false,
  error: null,
  proposedStamps: null,
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialState,

  // --- Morph Targets ---
  setMorphTarget: (name, value) => {
    pushUndo(get());
    set((state) => ({
      morphTargets: { ...state.morphTargets, [name]: value },
    }));
  },

  resetMorphTargets: () => {
    pushUndo(get());
    set({ morphTargets: {} });
  },

  // --- Bone Scales ---
  setBoneScale: (boneName, axis, value) => {
    pushUndo(get());
    set((state) => {
      const prev = state.boneScales[boneName] ?? { x: 1, y: 1, z: 1 };
      return {
        boneScales: {
          ...state.boneScales,
          [boneName]: { ...prev, [axis]: value },
        },
      };
    });
  },

  resetBoneScales: () => {
    pushUndo(get());
    set({ boneScales: {} });
  },

  // --- Materials ---
  setMaterial: (slotName, property, value) => {
    pushUndo(get());
    set((state) => {
      const prev = state.materials[slotName] ?? { name: slotName };
      return {
        materials: {
          ...state.materials,
          [slotName]: { ...prev, [property]: value } as MaterialSlot,
        },
      };
    });
  },

  resetMaterials: () => {
    pushUndo(get());
    set({ materials: {} });
  },

  // --- Versions ---
  saveVersion: (name, thumbnailDataUrl) => {
    const state = get();
    const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const version: AvatarVersion = {
      id,
      name: name ?? `버전 ${state.versions.length + 1}`,
      parameters: {
        morphTargets: { ...state.morphTargets },
        boneScales: Object.fromEntries(
          Object.entries(state.boneScales).map(([k, v]) => [k, { ...v }])
        ),
        materials: Object.fromEntries(
          Object.entries(state.materials).map(([k, v]) => [k, { ...v }])
        ),
      },
      thumbnailDataUrl,
      createdAt: new Date().toISOString(),
    };
    const versions = [...state.versions, version];
    while (versions.length > MAX_VERSIONS) versions.shift();
    set({ versions });
    saveVersionsToStorage(state.avatarId, versions);
  },

  restoreVersion: (versionId) => {
    const state = get();
    const version = state.versions.find((v) => v.id === versionId);
    if (!version) return;
    pushUndo(state);
    set({
      morphTargets: { ...version.parameters.morphTargets },
      boneScales: Object.fromEntries(
        Object.entries(version.parameters.boneScales).map(([k, v]) => [k, { ...v }])
      ),
      materials: Object.fromEntries(
        Object.entries(version.parameters.materials).map(([k, v]) => [k, { ...v }])
      ),
    });
  },

  deleteVersion: (versionId) => {
    const state = get();
    const versions = state.versions.filter((v) => v.id !== versionId);
    set({ versions });
    saveVersionsToStorage(state.avatarId, versions);
  },

  renameVersion: (versionId, name) => {
    const state = get();
    const versions = state.versions.map((v) =>
      v.id === versionId ? { ...v, name } : v
    );
    set({ versions });
    saveVersionsToStorage(state.avatarId, versions);
  },

  // --- Hair ---
  setHairFront: (url) => {
    pushUndo(get());
    set({ hairFrontUrl: url });
  },

  setHairBack: (url) => {
    pushUndo(get());
    set({ hairBackUrl: url });
  },

  setHairColor: (color) => {
    pushUndo(get());
    set({ hairColor: color });
  },

  setHairRecommendation: (rec) => {
    set({ hairRecommendation: rec });
  },

  // --- Outfit ---
  setOutfit: (url) => {
    pushUndo(get());
    set({ outfitUrl: url });
  },

  // --- Undo / Redo ---
  undo: () => {
    if (undoStack.length === 0) return;
    const current = snapshot(get());
    redoStack.push(current);
    const prev = undoStack.pop()!;
    set({
      morphTargets: prev.morphTargets,
      boneScales: prev.boneScales,
      materials: prev.materials,
      hairFrontUrl: prev.hairFrontUrl,
      hairBackUrl: prev.hairBackUrl,
      hairColor: prev.hairColor,
      outfitUrl: prev.outfitUrl,
    });
  },

  redo: () => {
    if (redoStack.length === 0) return;
    const current = snapshot(get());
    undoStack.push(current);
    const next = redoStack.pop()!;
    set({
      morphTargets: next.morphTargets,
      boneScales: next.boneScales,
      materials: next.materials,
      hairFrontUrl: next.hairFrontUrl,
      hairBackUrl: next.hairBackUrl,
      hairColor: next.hairColor,
      outfitUrl: next.outfitUrl,
    });
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,

  // --- Pipeline ---
  applyPipelineResult: (params) => {
    pushUndo(get());
    set((state) => ({
      morphTargets: { ...state.morphTargets, ...params },
    }));
  },

  applyTextureResult: (textures) => {
    pushUndo(get());
    set((state) => {
      const updated = { ...state.materials };
      for (const [slotName, dataUrl] of Object.entries(textures)) {
        const prev = updated[slotName] ?? { name: slotName };
        updated[slotName] = { ...prev, textureUrl: dataUrl };
      }
      return { materials: updated };
    });
  },

  setProposedStamps: (stamps) => set({ proposedStamps: stamps }),

  setSlotTextureUrl: (slotId, url) => set((state) => ({
    materials: {
      ...state.materials,
      [slotId]: { ...(state.materials[slotId] ?? { name: slotId }), textureUrl: url },
    },
  })),

  // --- Reset All ---
  resetAll: () => {
    pushUndo(get());
    set({
      morphTargets: {},
      boneScales: {},
      materials: {},
      hairFrontUrl: null,
      hairBackUrl: null,
      hairColor: null,
      outfitUrl: null,
    });
  },

  // --- Utility ---
  setAvatarId: (id) => {
    const versions = loadVersionsFromStorage(id);
    set({ avatarId: id, versions });
  },
  setTemplateId: (id) => set({ templateId: id }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}));
