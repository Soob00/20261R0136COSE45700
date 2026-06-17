'use client';

import { useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { QUICK_PRESETS } from '@/data/presets';
import type { QuickPreset, QuickPresetCategory } from '@/types/preset';
import { Sparkles, Plus, Save, X, User, Palette } from 'lucide-react';

const CATEGORIES: { id: QuickPresetCategory; label: string; icon: typeof Sparkles }[] = [
  { id: 'face', label: '얼굴', icon: User },
  { id: 'style', label: '스타일', icon: Palette },
];

export function QuickPresets() {
  const setMorphTarget = useEditorStore((s) => s.setMorphTarget);
  const resetMorphTargets = useEditorStore((s) => s.resetMorphTargets);
  const setHairFront = useEditorStore((s) => s.setHairFront);
  const setHairBack = useEditorStore((s) => s.setHairBack);
  const setOutfit = useEditorStore((s) => s.setOutfit);
  const morphTargets = useEditorStore((s) => s.morphTargets);
  const hairFrontUrl = useEditorStore((s) => s.hairFrontUrl);
  const hairBackUrl = useEditorStore((s) => s.hairBackUrl);
  const outfitUrl = useEditorStore((s) => s.outfitUrl);

  const [customPresets, setCustomPresets] = useState<QuickPreset[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('avatar-editor-custom-presets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const applyPreset = (preset: QuickPreset) => {
    // Reset morph targets first so previous presets don't bleed through
    resetMorphTargets();

    // Apply morph targets
    if (preset.values.morphTargets) {
      for (const [name, value] of Object.entries(preset.values.morphTargets)) {
        setMorphTarget(name, value);
      }
    }

    // Apply hair (style presets)
    if ('hairFrontUrl' in preset.values) {
      setHairFront(preset.values.hairFrontUrl ?? null);
    }
    if ('hairBackUrl' in preset.values) {
      setHairBack(preset.values.hairBackUrl ?? null);
    }

    // Apply outfit (style presets)
    if ('outfitUrl' in preset.values) {
      setOutfit(preset.values.outfitUrl ?? null);
    }

    setActivePreset(preset.id);
  };

  const saveCustomPreset = () => {
    if (!newPresetName.trim()) return;
    const preset: QuickPreset = {
      id: `custom-${Date.now()}`,
      name: newPresetName.trim(),
      category: (hairFrontUrl || outfitUrl) ? 'style' : 'face',
      isBuiltIn: false,
      values: {
        morphTargets: { ...morphTargets },
        hairFrontUrl: hairFrontUrl,
        hairBackUrl: hairBackUrl,
        outfitUrl: outfitUrl,
      },
    };
    const updated = [...customPresets, preset];
    setCustomPresets(updated);
    try {
      localStorage.setItem('avatar-editor-custom-presets', JSON.stringify(updated));
    } catch { /* ignore */ }
    setShowSaveDialog(false);
    setNewPresetName('');
  };

  const deleteCustomPreset = (id: string) => {
    const updated = customPresets.filter((p) => p.id !== id);
    setCustomPresets(updated);
    try {
      localStorage.setItem('avatar-editor-custom-presets', JSON.stringify(updated));
    } catch { /* ignore */ }
    if (activePreset === id) setActivePreset(null);
  };

  const allPresets = [...QUICK_PRESETS, ...customPresets];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-foreground/80 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          빠른 프리셋
        </h3>
        <button
          onClick={() => setShowSaveDialog(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:text-primary border border-border rounded-full hover:border-primary/40 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          저장
        </button>
      </div>

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="flex items-center gap-1.5 p-2 bg-muted/30 rounded-md border border-border/50">
          <input
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveCustomPreset();
              if (e.key === 'Escape') setShowSaveDialog(false);
            }}
            placeholder="프리셋 이름..."
            className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded text-foreground"
            autoFocus
          />
          <button
            onClick={saveCustomPreset}
            className="p-1 text-primary hover:text-primary/80"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowSaveDialog(false)}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Preset chips by category */}
      {CATEGORIES.map(({ id: catId, label, icon: Icon }) => {
        const presets = allPresets.filter((p) => (p.category ?? 'face') === catId);
        if (presets.length === 0) return null;
        return (
          <div key={catId} className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground/70 font-medium flex items-center gap-1">
              <Icon className="w-3 h-3" />
              {label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <div key={preset.id} className="group relative">
                  <button
                    onClick={() => applyPreset(preset)}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-full transition-all border ${
                      activePreset === preset.id
                        ? 'bg-primary text-primary-foreground border-transparent shadow-soft'
                        : 'bg-card text-foreground/70 border-border hover:border-primary/40 hover:text-primary hover:-translate-y-0.5'
                    }`}
                    title={preset.description}
                  >
                    {preset.name}
                  </button>
                  {!preset.isBuiltIn && (
                    <button
                      onClick={() => deleteCustomPreset(preset.id)}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2 h-2" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
