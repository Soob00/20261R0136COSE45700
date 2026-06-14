'use client';

import { useMemo } from 'react';
import { getPresetsByCategory, PRESET_ITEMS } from '@/data/presets';
import { useEditorStore } from '@/stores/editorStore';
import { CollapsibleSection } from './CollapsibleSection';
import { Check, Sparkles } from 'lucide-react';
import type { PresetCategory } from '@/types/preset';
import type { AccessoryCategory } from '@/types/accessory';

interface PresetGridProps {
  selectedPresets?: Record<string, string>; // category → presetId
  onSelectPreset?: (category: PresetCategory, presetId: string) => void;
}

const CATEGORIES: { id: PresetCategory; label: string }[] = [
  { id: 'hair', label: '헤어스타일' },
  { id: 'outfit', label: '의상' },
  { id: 'accessory', label: '악세서리' },
];

export function PresetGrid({ selectedPresets = {}, onSelectPreset }: PresetGridProps) {
  const setHairFront = useEditorStore((s) => s.setHairFront);
  const setHairBack = useEditorStore((s) => s.setHairBack);
  const setOutfit = useEditorStore((s) => s.setOutfit);
  const clearAccessories = useEditorStore((s) => s.clearAccessories);
  const replaceSingleAccessory = useEditorStore((s) => s.replaceSingleAccessory);
  const hairFrontUrl = useEditorStore((s) => s.hairFrontUrl);
  const hairBackUrl = useEditorStore((s) => s.hairBackUrl);
  const outfitUrl = useEditorStore((s) => s.outfitUrl);
  const accessoryInstances = useEditorStore((s) => s.accessoryInstances);
  const hairRecommendation = useEditorStore((s) => s.hairRecommendation);
  const customPresets = useEditorStore((s) => s.customPresets);

  const selected = useMemo<Record<string, string>>(() => {
    const selectedHair =
      PRESET_ITEMS.find(
        (item) =>
          item.category === 'hair' &&
          item.meshUrl === hairFrontUrl &&
          (item.hairBackUrl ?? null) === hairBackUrl
      )?.id ?? selectedPresets.hair;

    const selectedOutfit =
      PRESET_ITEMS.find(
        (item) => item.category === 'outfit' && item.meshUrl === outfitUrl
      )?.id ?? selectedPresets.outfit;

    const selectedAccessory = accessoryInstances[0]?.presetId ?? 'accessory-none';

    return {
      ...selectedPresets,
      hair: selectedHair,
      outfit: selectedOutfit,
      accessory: selectedAccessory,
    };
  }, [accessoryInstances, hairBackUrl, hairFrontUrl, outfitUrl, selectedPresets]);

  const resolveAccessoryCategory = (presetId: string): AccessoryCategory | null => {
    if (presetId === 'accessory-glasses') return 'glasses';
    if (customPresets.some((p) => p.id === presetId)) return 'glasses';
    if (presetId.startsWith('http') || presetId.startsWith('/api/')) return 'glasses';
    return null;
  };

  const handleSelect = (category: PresetCategory, presetId: string) => {
    onSelectPreset?.(category, presetId);

    const builtInPreset = PRESET_ITEMS.find((p) => p.id === presetId);
    const customPreset = customPresets.find((p) => p.id === presetId);
    const preset = builtInPreset || customPreset;
    
    if (category === 'hair') {
      setHairFront(preset?.meshUrl ?? null);
      setHairBack(preset?.hairBackUrl ?? null);
    } else if (category === 'outfit') {
      setOutfit(preset?.meshUrl ?? null);
    } else if (category === 'accessory') {
      if (presetId === 'accessory-none') {
        clearAccessories();
        return;
      }
      const accessoryCategory = resolveAccessoryCategory(presetId);
      if (!accessoryCategory) {
        console.warn(`[PresetGrid] unsupported accessory preset: ${presetId}`);
        return;
      }
      replaceSingleAccessory({ presetId, category: accessoryCategory });
    }
  };

  // Determine if a preset is the recommended one
  const bestMatchId = hairRecommendation?.confidence !== 'low' ? hairRecommendation?.bestMatch.presetId : null;
  const matchResultMap = hairRecommendation?.allResults.reduce<Record<string, number>>((acc, r) => {
    acc[r.presetId] = Math.round(r.colorScore * 100);
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-4">
      {/* Extracted color indicator */}
      {hairRecommendation && hairRecommendation.confidence !== 'low' && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-accent/30 border border-border/30">
          <div
            className="w-4 h-4 rounded-full border border-border/50 shrink-0"
            style={{ backgroundColor: hairRecommendation.extractedColor }}
            title={`VRM 헤어 색상: ${hairRecommendation.extractedColor}`}
          />
          <span className="text-[10px] text-muted-foreground">
            감지된 헤어 색상으로 자동 추천
          </span>
        </div>
      )}

      {CATEGORIES.map(({ id, label }) => {
        let presets = getPresetsByCategory(id);
        const customForCategory = customPresets.filter((p) => p.category === id);
        if (customForCategory.length > 0) {
          presets = [...presets, ...customForCategory];
        }

        if (presets.length === 0) return null;
        
        return (
          <CollapsibleSection key={id} title={label} count={presets.length}>
            <div className="grid grid-cols-3 gap-1.5">
              {presets.map((preset) => {
                const isSelected = selected[id] === preset.id;
                const isRecommended = id === 'hair' && preset.id === bestMatchId;
                const colorPercent = id === 'hair' ? matchResultMap[preset.id] : undefined;
                return (
                  <div key={preset.id} className="relative group">
                    <button
                      onClick={() => handleSelect(id, preset.id)}
                      className={`relative rounded-md border p-2 text-center transition-all w-full h-full ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : isRecommended
                          ? 'border-amber-400/60 bg-amber-400/5 ring-1 ring-amber-400/40'
                          : 'border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40'
                      }`}
                      title={colorPercent !== undefined ? `색상 유사도: ${colorPercent}%` : undefined}
                    >
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center z-10">
                          <Check className="w-2 h-2 text-primary-foreground" />
                        </div>
                      )}
                      {isRecommended && !isSelected && (
                        <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-amber-400/90 text-[8px] font-bold text-amber-950 z-10">
                          <Sparkles className="w-2 h-2" />
                          추천
                        </div>
                      )}
                      <div className="w-full aspect-square rounded bg-muted/50 border border-border/30 mb-1 flex items-center justify-center overflow-hidden">
                        {preset.thumbnailUrl ? (
                          <img
                            src={preset.thumbnailUrl}
                            alt={preset.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-lg opacity-40">
                            {id === 'hair' ? '💇' : id === 'outfit' ? '👕' : '👓'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground line-clamp-1">{preset.name}</span>
                    </button>
                    {customPresets.some(p => p.id === preset.id) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          useEditorStore.getState().removeCustomPreset(preset.id);
                        }}
                        className="absolute top-1 left-1 w-5 h-5 bg-destructive/90 text-destructive-foreground rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-destructive shadow-sm"
                        title="삭제"
                      >
                        <span className="text-[10px] font-bold">X</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
