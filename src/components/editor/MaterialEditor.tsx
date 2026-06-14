'use client';

import { useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { ColorPicker } from './ColorPicker';
import { CollapsibleSection } from './CollapsibleSection';
import { useEditorStore } from '@/stores/editorStore';
import { COLOR_PRESETS } from '@/lib/vrm/materials';
import type { DetectedMaterial } from '@/lib/vrm/materials';

interface MaterialEditorProps {
  detectedMaterials: DetectedMaterial[];
}

function MaterialSlotEditor({ mat }: { mat: DetectedMaterial }) {
  const setMaterial = useEditorStore((s) => s.setMaterial);
  const storedColor = useEditorStore((s) => s.materials[mat.slotName]?.color);
  const storedShadingToony = useEditorStore((s) => s.materials[mat.slotName]?.shadingToony);
  const storedShadingShift = useEditorStore((s) => s.materials[mat.slotName]?.shadingShift);
  const storedRimLightingMix = useEditorStore((s) => s.materials[mat.slotName]?.rimLightingMix);

  const color = (storedColor as string) ?? mat.color;
  const shadingToony = (storedShadingToony as number) ?? mat.shadingToony;
  const shadingShift = (storedShadingShift as number) ?? mat.shadingShift;
  const rimLightingMix = (storedRimLightingMix as number) ?? mat.rimLightingMix;

  const presets = mat.category === 'skin' ? COLOR_PRESETS.skin
    : mat.category === 'eye' ? COLOR_PRESETS.eye
    : mat.category === 'hair' ? COLOR_PRESETS.hair
    : undefined;

  // Sync a property change to linked materials too (e.g. face + neck + body skin all change together)
  const setLinkedMaterial = useCallback(
    (property: 'color' | 'shadingToony' | 'shadingShift' | 'rimLightingMix', value: string | number) => {
      setMaterial(mat.slotName, property, value);
      if (mat.linkedSlots) {
        for (const linked of mat.linkedSlots) {
          setMaterial(linked, property, value);
        }
      }
    },
    [mat.slotName, mat.linkedSlots, setMaterial]
  );

  return (
    <div className="space-y-2.5">
      <ColorPicker
        color={color}
        onChange={(c) => setLinkedMaterial('color', c)}
        presets={presets}
        label="색상"
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">카툰감</span>
          <span className="font-mono text-[11px] text-muted-foreground/60 w-10 text-right tabular-nums">
            {shadingToony.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[shadingToony]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(v) => setLinkedMaterial('shadingToony', Array.isArray(v) ? v[0] : v)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">셰이딩 시프트</span>
          <span className="font-mono text-[11px] text-muted-foreground/60 w-10 text-right tabular-nums">
            {shadingShift.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[shadingShift]}
          min={-1}
          max={1}
          step={0.01}
          onValueChange={(v) => setLinkedMaterial('shadingShift', Array.isArray(v) ? v[0] : v)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">림 라이트</span>
          <span className="font-mono text-[11px] text-muted-foreground/60 w-10 text-right tabular-nums">
            {rimLightingMix.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[rimLightingMix]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(v) => setLinkedMaterial('rimLightingMix', Array.isArray(v) ? v[0] : v)}
        />
      </div>
    </div>
  );
}

function HairMeshColorEditor() {
  const hairFrontUrl = useEditorStore((s) => s.hairFrontUrl);
  const hairBackUrl = useEditorStore((s) => s.hairBackUrl);
  const hairColor = useEditorStore((s) => s.hairColor);
  const setHairColor = useEditorStore((s) => s.setHairColor);

  if (!hairFrontUrl && !hairBackUrl) return null;

  return (
    <CollapsibleSection title="헤어 메시" count={1}>
      <div className="space-y-2.5">
        <ColorPicker
          color={hairColor ?? '#71635A'}
          onChange={setHairColor}
          presets={COLOR_PRESETS.hair}
          label="헤어 색상"
        />
      </div>
    </CollapsibleSection>
  );
}

export function MaterialEditor({ detectedMaterials }: MaterialEditorProps) {
  const resetMaterials = useEditorStore((s) => s.resetMaterials);

  if (detectedMaterials.length === 0) {
    return (
      <div className="space-y-4">
        <HairMeshColorEditor />
        {!useEditorStore.getState().hairFrontUrl && !useEditorStore.getState().hairBackUrl && (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              모델에서 편집 가능한 재질이 감지되지 않았습니다.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Group by category
  const grouped = detectedMaterials.reduce(
    (acc, mat) => {
      const key = mat.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(mat);
      return acc;
    },
    {} as Record<string, DetectedMaterial[]>
  );

  const categoryLabels: Record<string, string> = {
    skin: '피부',
    hair: '머리카락',
    eye: '눈동자',
    cloth: '의상',
    other: '기타 재질',
  };

  const categoryOrder = ['skin', 'hair', 'eye', 'cloth', 'other'];

  return (
    <div className="space-y-4">
      <button
        onClick={resetMaterials}
        className="w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
      >
        재질 초기화
      </button>
      <HairMeshColorEditor />
      {categoryOrder.map((cat) => {
        const mats = grouped[cat];
        if (!mats || mats.length === 0) return null;

        // For skin: show one unified editor (since they're all linked)
        if (cat === 'skin' && mats.length > 1 && mats[0].linkedSlots) {
          return (
            <CollapsibleSection
              key={cat}
              title={categoryLabels[cat] ?? cat}
              count={mats.length}
            >
              <div className="space-y-2 pb-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <h4 className="text-[11px] font-medium text-foreground/70">
                    전체 피부색
                  </h4>
                  <span className="text-[10px] text-primary/60 bg-primary/10 px-1.5 py-0.5 rounded">
                    {mats.length}개 연동
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mb-2">
                  {mats.map((m) => m.slotName).join(', ')}
                </p>
                <MaterialSlotEditor mat={mats[0]} />
              </div>
            </CollapsibleSection>
          );
        }

        return (
          <CollapsibleSection
            key={cat}
            title={categoryLabels[cat] ?? cat}
            count={mats.length}
          >
            {mats.map((mat) => (
              <div key={mat.slotName} className="space-y-2 pb-3 border-b border-border/30 last:border-0 last:pb-0">
                <h4 className="text-[11px] font-medium text-foreground/70 truncate" title={mat.slotName}>
                  {mat.label}
                </h4>
                <MaterialSlotEditor mat={mat} />
              </div>
            ))}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
