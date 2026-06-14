'use client';

import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import type { Slider as SliderPrimitive } from '@base-ui/react/slider';

interface AccessoryTransformSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onReset: () => void;
  isModified: boolean;
}

export function AccessoryTransformSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  onReset,
  isModified,
}: AccessoryTransformSliderProps) {
  const handleReset = useCallback(() => {
    onReset();
  }, [onReset]);

  return (
    <div className="group space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span
          className={`truncate max-w-[160px] transition-colors ${
            isModified ? 'text-foreground font-medium' : 'text-muted-foreground'
          }`}
        >
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`font-mono text-[11px] w-12 text-right tabular-nums transition-colors ${
              isModified ? 'text-primary' : 'text-muted-foreground/60'
            }`}
          >
            {value.toFixed(2)}
          </span>
          {isModified && (
            <button
              onClick={handleReset}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
              title="초기화"
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
        step={step}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        onValueCommitted={(next: SliderPrimitive.Root.Props['value']) =>
          onCommit?.(Array.isArray(next) ? next[0] : next)
        }
      />
    </div>
  );
}
