'use client';

import { useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { useEditorStore } from '@/stores/editorStore';
import { RotateCcw } from 'lucide-react';

interface MorphTargetSliderProps {
  name: string;
  label?: string;
  min?: number;
  max?: number;
}

export function MorphTargetSlider({ name, label, min = 0, max = 1 }: MorphTargetSliderProps) {
  const value = useEditorStore((s) => s.morphTargets[name] ?? 0);
  const setMorphTarget = useEditorStore((s) => s.setMorphTarget);

  const isModified = value !== 0;

  const handleReset = useCallback(() => {
    setMorphTarget(name, 0);
  }, [name, setMorphTarget]);

  return (
    <div className="group space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span
          className={`truncate max-w-[160px] transition-colors ${
            isModified ? 'text-foreground font-medium' : 'text-muted-foreground'
          }`}
          title={name}
        >
          {label || name}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`font-mono text-[11px] w-10 text-right tabular-nums transition-colors ${
              isModified ? 'text-primary' : 'text-muted-foreground/60'
            }`}
          >
            {value.toFixed(2)}
          </span>
          {isModified && (
            <button
              onClick={handleReset}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 -m-1 rounded-md hover:bg-accent"
              title="초기화"
              aria-label={`${label || name} 초기화`}
            >
              <RotateCcw className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={0.01}
        onValueChange={(val) => setMorphTarget(name, Array.isArray(val) ? val[0] : val)}
      />
    </div>
  );
}
