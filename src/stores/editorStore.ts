import { create } from 'zustand';
import type { EditorState, EditorActions, AvatarVersion, MaterialSlot } from '@/types/editor';
import type { AccessoryCategory } from '@/types/accessory';
import {
  createDefaultAccessoryAdjustment,
  type AccessoryInstance,
} from '@/lib/accessory-attachment';

// --- Undo/Redo History ---

interface HistoryEntry {
  morphTargets: EditorState['morphTargets'];
  boneScales: EditorState['boneScales'];
  materials: EditorState['materials'];
  hairFrontUrl: EditorState['hairFrontUrl'];
  hairBackUrl: EditorState['hairBackUrl'];
  hairColor: EditorState['hairColor'];
  outfitUrl: EditorState['outfitUrl'];
  accessoryInstances: EditorState['accessoryInstances'];
  selectedAccessoryInstanceId: EditorState['selectedAccessoryInstanceId'];
  baselineMorphTargets: EditorState['baselineMorphTargets'];
}

const MAX_HISTORY = 50;
const undoStack: HistoryEntry[] = [];
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
    accessoryInstances: state.accessoryInstances.map((instance) => ({
      ...instance,
      adjustment: {
        scaleMultiplier: Array.isArray(instance.adjustment.scaleMultiplier)
          ? ([...instance.adjustment.scaleMultiplier] as [number, number, number])
          : ([instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier] as [number, number, number]),
        rotationDelta: [...instance.adjustment.rotationDelta] as [number, number, number],
        offsetDelta: [...instance.adjustment.offsetDelta] as [number, number, number],
      },
    })),
    selectedAccessoryInstanceId: state.selectedAccessoryInstanceId,
    baselineMorphTargets: { ...state.baselineMorphTargets },
  };
}

function createAccessoryInstance(
  presetId: string,
  category: AccessoryCategory,
): AccessoryInstance {
  return {
    instanceId: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    presetId,
    category,
    enabled: true,
    adjustment: createDefaultAccessoryAdjustment(),
  };
}

function resolveSelectedAccessoryId(instances: AccessoryInstance[]): string | null {
  return instances.length === 1 ? instances[0].instanceId : null;
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

const CUSTOM_PRESETS_KEY = 'avatar-editor-custom-presets';

function loadCustomPresetsFromStorage(): import('@/types/preset').PresetItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomPresetsToStorage(presets: import('@/types/preset').PresetItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('Failed to save custom presets:', e);
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
  accessoryInstances: [],
  selectedAccessoryInstanceId: null,
  versions: [],
  isLoading: false,
  error: null,
  customPresets: loadCustomPresetsFromStorage(),
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
    const baseline = get().baselineMorphTargets;
    set({ morphTargets: { ...baseline } });
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
        accessories: state.accessoryInstances.map((instance) => ({
          ...instance,
          adjustment: {
            scaleMultiplier: Array.isArray(instance.adjustment.scaleMultiplier)
              ? ([...instance.adjustment.scaleMultiplier] as [number, number, number])
              : ([instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier] as [number, number, number]),
            rotationDelta: [...instance.adjustment.rotationDelta] as [number, number, number],
            offsetDelta: [...instance.adjustment.offsetDelta] as [number, number, number],
          },
        })),
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
    const restoredAccessories = (version.parameters.accessories ?? []).map((instance) => ({
      ...instance,
      adjustment: {
        scaleMultiplier: Array.isArray(instance.adjustment.scaleMultiplier)
          ? ([...instance.adjustment.scaleMultiplier] as [number, number, number])
          : ([instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier, instance.adjustment.scaleMultiplier] as [number, number, number]),
        rotationDelta: [...instance.adjustment.rotationDelta] as [number, number, number],
        offsetDelta: [...instance.adjustment.offsetDelta] as [number, number, number],
      },
    }));
    set({
      morphTargets: { ...version.parameters.morphTargets },
      boneScales: Object.fromEntries(
        Object.entries(version.parameters.boneScales).map(([k, v]) => [k, { ...v }])
      ),
      materials: Object.fromEntries(
        Object.entries(version.parameters.materials).map(([k, v]) => [k, { ...v }])
      ),
      accessoryInstances: restoredAccessories,
      selectedAccessoryInstanceId: resolveSelectedAccessoryId(restoredAccessories),
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

  // --- Accessories ---
  addAccessory: ({ presetId, category }) => {
    pushUndo(get());
    const nextInstance = createAccessoryInstance(presetId, category);
    set((state) => ({
      accessoryInstances: [...state.accessoryInstances, nextInstance],
      selectedAccessoryInstanceId: nextInstance.instanceId,
    }));
  },

  removeAccessory: (instanceId) => {
    pushUndo(get());
    set((state) => {
      const accessoryInstances = state.accessoryInstances.filter(
        (instance) => instance.instanceId !== instanceId
      );
      const selectedAccessoryInstanceId = accessoryInstances.some(
        (instance) => instance.instanceId === state.selectedAccessoryInstanceId
      )
        ? state.selectedAccessoryInstanceId
        : resolveSelectedAccessoryId(accessoryInstances);
      return {
        accessoryInstances,
        selectedAccessoryInstanceId,
      };
    });
  },

  clearAccessories: () => {
    pushUndo(get());
    set({
      accessoryInstances: [],
      selectedAccessoryInstanceId: null,
    });
  },

  replaceSingleAccessory: ({ presetId, category }) => {
    pushUndo(get());
    const nextInstance = createAccessoryInstance(presetId, category);
    set((state) => {
      const filtered = state.accessoryInstances.filter(
        (inst) => inst.category !== category
      );
      return {
        accessoryInstances: [...filtered, nextInstance],
        selectedAccessoryInstanceId: nextInstance.instanceId,
      };
    });
  },

  selectAccessory: (instanceId) => {
    set({ selectedAccessoryInstanceId: instanceId });
  },

  // --- Background Tasks ---
  addBackgroundTask: (task) => {
    set((state) => ({
      backgroundTasks: [...state.backgroundTasks, task],
    }));
  },

  updateBackgroundTask: (id, updates) => {
    set((state) => ({
      backgroundTasks: state.backgroundTasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },

  removeBackgroundTask: (id) => {
    set((state) => ({
      backgroundTasks: state.backgroundTasks.filter((t) => t.id !== id),
    }));
  },

  setAccessoryEnabled: (instanceId, enabled) => {
    pushUndo(get());
    set((state) => ({
      accessoryInstances: state.accessoryInstances.map((instance) =>
        instance.instanceId === instanceId ? { ...instance, enabled } : instance
      ),
    }));
  },

  setAccessoryOffsetDelta: (instanceId, value, options) => {
    if (options?.pushHistory !== false) {
      pushUndo(get());
    }
    set((state) => ({
      accessoryInstances: state.accessoryInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              adjustment: {
                ...instance.adjustment,
                offsetDelta: [...value] as [number, number, number],
              },
            }
          : instance
      ),
    }));
  },

  setAccessoryRotationDelta: (instanceId, value, options) => {
    if (options?.pushHistory !== false) {
      pushUndo(get());
    }
    set((state) => ({
      accessoryInstances: state.accessoryInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              adjustment: {
                ...instance.adjustment,
                rotationDelta: [...value] as [number, number, number],
              },
            }
          : instance
      ),
    }));
  },

  setAccessoryScaleMultiplier: (instanceId, value, options) => {
    if (options?.pushHistory !== false) {
      pushUndo(get());
    }
    set((state) => ({
      accessoryInstances: state.accessoryInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              adjustment: {
                ...instance.adjustment,
                scaleMultiplier: [...value] as [number, number, number],
              },
            }
          : instance
      ),
    }));
  },

  resetAccessoryAdjustment: (instanceId) => {
    pushUndo(get());
    set((state) => ({
      accessoryInstances: state.accessoryInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              adjustment: createDefaultAccessoryAdjustment(),
            }
          : instance
      ),
    }));
  },

  // --- Custom Presets ---
  addCustomPreset: (preset) => {
    set((state) => {
      const customPresets = [...state.customPresets, preset];
      saveCustomPresetsToStorage(customPresets);
      return { customPresets };
    });
  },
  removeCustomPreset: (presetId) => {
    set((state) => {
      const customPresets = state.customPresets.filter((p) => p.id !== presetId);
      saveCustomPresetsToStorage(customPresets);
      return { customPresets };
    });
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
      accessoryInstances: prev.accessoryInstances,
      selectedAccessoryInstanceId: prev.selectedAccessoryInstanceId,
      baselineMorphTargets: prev.baselineMorphTargets,
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
      accessoryInstances: next.accessoryInstances,
      selectedAccessoryInstanceId: next.selectedAccessoryInstanceId,
      baselineMorphTargets: next.baselineMorphTargets,
    });
  },

  canUndo: () => undoStack.length > 0,
  canRedo: () => redoStack.length > 0,

  // --- Pipeline ---


  applyPipelineResult: (params) => {
    pushUndo(get());
    set((state) => ({
      morphTargets: { ...state.morphTargets, ...params },
      baselineMorphTargets: { ...state.baselineMorphTargets, ...params },
    }));
  },

  applyTextureResult: (textures: Record<string, string>) => {
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
      accessoryInstances: [],
      selectedAccessoryInstanceId: null,
      baselineMorphTargets: {},
      proposedStamps: null,
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

export async function runAccessoryGenerationTask(
  taskId: string,
  file: File,
  category: import('@/types/accessory').AccessoryCategory,
  accessoryName: string
) {
  const store = useEditorStore.getState();
  
  try {
    store.updateBackgroundTask(taskId, { status: 'processing' });
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'image');

    const res = await fetch('/api/accessory-generate', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to process accessory');
    }

    const data = await res.json();
    
    // Convert file to base64 so thumbnail persists across reloads
    const getBase64 = (f: File): Promise<string> => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });

    const isGlb = file.name.toLowerCase().endsWith('.glb');
    const thumbnailUrl = isGlb ? '/placeholder.png' : await getBase64(file);
    
    // Add custom preset
    store.addCustomPreset({
      id: data.url, // Using url as ID for now
      name: accessoryName.trim() || '커스텀 악세사리',
      category: category as any, // Using preset category widening
      thumbnailUrl,
      meshUrl: data.url,
    });

    // Update task status to success and save the result URL
    store.updateBackgroundTask(taskId, { status: 'success', resultUrl: data.url });

    // Wait a brief moment for toast to appear, then equip it
    setTimeout(() => {
      useEditorStore.getState().replaceSingleAccessory({
        presetId: data.url,
        category: category,
      });
      // Optionally remove task after a few seconds
      setTimeout(() => useEditorStore.getState().removeBackgroundTask(taskId), 5000);
    }, 500);

  } catch (err: any) {
    store.updateBackgroundTask(taskId, { status: 'error', errorMessage: err.message });
    // Remove error task after a while
    setTimeout(() => useEditorStore.getState().removeBackgroundTask(taskId), 10000);
  }
}
