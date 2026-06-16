'use client';

import { useMemo } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';
import { AccessoryTransformSlider } from './AccessoryTransformSlider';
import {
  getSelectedAccessoryInstance,
  getSelectedAccessoryPresetRef,
  getSelectedAccessoryResolved,
} from '@/lib/accessory-attachment';
import { useEditorStore } from '@/stores/editorStore';

const OFFSET_RANGE = { min: -0.1, max: 0.1, step: 0.005 };
const ROTATION_RANGE = { min: -45, max: 45, step: 1 };
const SCALE_RANGE = { min: 0.5, max: 1.5, step: 0.01 };

export function AccessoryFitPanel() {
  const accessoryInstances = useEditorStore((s) => s.accessoryInstances);
  const selectedAccessoryInstanceId = useEditorStore((s) => s.selectedAccessoryInstanceId);
  const setAccessoryOffsetDelta = useEditorStore((s) => s.setAccessoryOffsetDelta);
  const setAccessoryRotationDelta = useEditorStore((s) => s.setAccessoryRotationDelta);
  const setAccessoryScaleMultiplier = useEditorStore((s) => s.setAccessoryScaleMultiplier);
  const resetAccessoryAdjustment = useEditorStore((s) => s.resetAccessoryAdjustment);

  const selectionState = useMemo(
    () => ({
      accessoryInstances,
      selectedAccessoryInstanceId,
    }),
    [accessoryInstances, selectedAccessoryInstanceId]
  );

  const selectedInstance = useMemo(
    () => getSelectedAccessoryInstance(selectionState),
    [selectionState]
  );
  const selectedPresetRef = useMemo(
    () => getSelectedAccessoryPresetRef(selectionState),
    [selectionState]
  );
  const selectedResolved = useMemo(
    () => getSelectedAccessoryResolved(selectionState),
    [selectionState]
  );

  if (!selectedInstance) {
    return (
      <div className="rounded-xl border border-border/30 bg-accent/20 p-4">
        <p className="text-xs text-muted-foreground">먼저 액세서리를 선택하세요.</p>
      </div>
    );
  }

  if (!selectedPresetRef || !selectedResolved) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-100/80">현재 액세서리 메타를 불러올 수 없음</p>
        </div>
      </div>
    );
  }

  const { adjustment } = selectedInstance;
  const { attachment } = selectedPresetRef;
  const isAnyModified =
    adjustment.scaleMultiplier.some((value) => Math.abs(value - 1) > 0.0001) ||
    adjustment.offsetDelta.some((value) => Math.abs(value) > 0.0001) ||
    adjustment.rotationDelta.some((value) => Math.abs(value) > 0.0001);

  const updateOffset = (index: 0 | 1 | 2, value: number) => {
    const next = [...adjustment.offsetDelta] as [number, number, number];
    next[index] = value;
    setAccessoryOffsetDelta(selectedInstance.instanceId, next, { pushHistory: false });
  };

  const updateRotation = (index: 0 | 1 | 2, value: number) => {
    const next = [...adjustment.rotationDelta] as [number, number, number];
    next[index] = value;
    setAccessoryRotationDelta(selectedInstance.instanceId, next, { pushHistory: false });
  };

  const updateScale = (index: 0 | 1 | 2, value: number) => {
    const next = [...adjustment.scaleMultiplier] as [number, number, number];
    next[index] = value;
    setAccessoryScaleMultiplier(selectedInstance.instanceId, next, { pushHistory: false });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/30 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Accessory Fit</h3>
          <div className="space-y-0.5 text-[11px] text-muted-foreground">
            <p>{selectedInstance.category} / {selectedInstance.presetId}</p>
            <p>{attachment.anchorBone} / {attachment.attachRegion}</p>
          </div>
        </div>
        <button
          onClick={() => resetAccessoryAdjustment(selectedInstance.instanceId)}
          disabled={!isAnyModified}
          className="inline-flex items-center gap-1 rounded-md border border-border/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Reset All
        </button>
      </div>

      <div className="rounded-lg border border-border/20 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
        <p>Final scale: X {selectedResolved.finalTransform.scale[0].toFixed(2)} / Y {selectedResolved.finalTransform.scale[1].toFixed(2)} / Z {selectedResolved.finalTransform.scale[2].toFixed(2)}</p>
      </div>

      <CollapsibleSection title="Position" count={3}>
        <AccessoryTransformSlider
          label="Position Y"
          value={adjustment.offsetDelta[1]}
          isModified={Math.abs(adjustment.offsetDelta[1]) > 0.0001}
          onChange={(value) => updateOffset(1, value)}
          onCommit={(value) =>
            setAccessoryOffsetDelta(
              selectedInstance.instanceId,
              [adjustment.offsetDelta[0], value, adjustment.offsetDelta[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateOffset(1, 0)}
          {...OFFSET_RANGE}
        />
        <AccessoryTransformSlider
          label="Position Z"
          value={adjustment.offsetDelta[2]}
          isModified={Math.abs(adjustment.offsetDelta[2]) > 0.0001}
          onChange={(value) => updateOffset(2, value)}
          onCommit={(value) =>
            setAccessoryOffsetDelta(
              selectedInstance.instanceId,
              [adjustment.offsetDelta[0], adjustment.offsetDelta[1], value],
              { pushHistory: true }
            )
          }
          onReset={() => updateOffset(2, 0)}
          {...OFFSET_RANGE}
        />
        <AccessoryTransformSlider
          label="Position X"
          value={adjustment.offsetDelta[0]}
          isModified={Math.abs(adjustment.offsetDelta[0]) > 0.0001}
          onChange={(value) => updateOffset(0, value)}
          onCommit={(value) =>
            setAccessoryOffsetDelta(
              selectedInstance.instanceId,
              [value, adjustment.offsetDelta[1], adjustment.offsetDelta[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateOffset(0, 0)}
          {...OFFSET_RANGE}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Scale" count={3}>
        <AccessoryTransformSlider
          label="Scale X (너비)"
          value={adjustment.scaleMultiplier[0]}
          isModified={Math.abs(adjustment.scaleMultiplier[0] - 1) > 0.0001}
          onChange={(value) => updateScale(0, value)}
          onCommit={(value) =>
            setAccessoryScaleMultiplier(
              selectedInstance.instanceId,
              [value, adjustment.scaleMultiplier[1], adjustment.scaleMultiplier[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateScale(0, 1)}
          {...SCALE_RANGE}
        />
        <AccessoryTransformSlider
          label="Scale Y (높이)"
          value={adjustment.scaleMultiplier[1]}
          isModified={Math.abs(adjustment.scaleMultiplier[1] - 1) > 0.0001}
          onChange={(value) => updateScale(1, value)}
          onCommit={(value) =>
            setAccessoryScaleMultiplier(
              selectedInstance.instanceId,
              [adjustment.scaleMultiplier[0], value, adjustment.scaleMultiplier[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateScale(1, 1)}
          {...SCALE_RANGE}
        />
        <AccessoryTransformSlider
          label="Scale Z (깊이)"
          value={adjustment.scaleMultiplier[2]}
          isModified={Math.abs(adjustment.scaleMultiplier[2] - 1) > 0.0001}
          onChange={(value) => updateScale(2, value)}
          onCommit={(value) =>
            setAccessoryScaleMultiplier(
              selectedInstance.instanceId,
              [adjustment.scaleMultiplier[0], adjustment.scaleMultiplier[1], value],
              { pushHistory: true }
            )
          }
          onReset={() => updateScale(2, 1)}
          {...SCALE_RANGE}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Rotation" count={3}>
        <AccessoryTransformSlider
          label="Rotation Z"
          value={adjustment.rotationDelta[2]}
          isModified={Math.abs(adjustment.rotationDelta[2]) > 0.0001}
          onChange={(value) => updateRotation(2, value)}
          onCommit={(value) =>
            setAccessoryRotationDelta(
              selectedInstance.instanceId,
              [adjustment.rotationDelta[0], adjustment.rotationDelta[1], value],
              { pushHistory: true }
            )
          }
          onReset={() => updateRotation(2, 0)}
          {...ROTATION_RANGE}
        />
        <AccessoryTransformSlider
          label="Rotation Y"
          value={adjustment.rotationDelta[1]}
          isModified={Math.abs(adjustment.rotationDelta[1]) > 0.0001}
          onChange={(value) => updateRotation(1, value)}
          onCommit={(value) =>
            setAccessoryRotationDelta(
              selectedInstance.instanceId,
              [adjustment.rotationDelta[0], value, adjustment.rotationDelta[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateRotation(1, 0)}
          {...ROTATION_RANGE}
        />
        <AccessoryTransformSlider
          label="Rotation X"
          value={adjustment.rotationDelta[0]}
          isModified={Math.abs(adjustment.rotationDelta[0]) > 0.0001}
          onChange={(value) => updateRotation(0, value)}
          onCommit={(value) =>
            setAccessoryRotationDelta(
              selectedInstance.instanceId,
              [value, adjustment.rotationDelta[1], adjustment.rotationDelta[2]],
              { pushHistory: true }
            )
          }
          onReset={() => updateRotation(0, 0)}
          {...ROTATION_RANGE}
        />
      </CollapsibleSection>
    </div>
  );
}
