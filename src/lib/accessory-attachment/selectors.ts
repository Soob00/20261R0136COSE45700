import type { EditorState } from '@/types/editor';
import type {
  AccessoryInstance,
  AccessoryRuntimePresetRef,
  ResolvedAccessoryAttachment,
} from './types';
import { resolveAccessoryAttachment } from './resolve';
import { resolveAccessoryRuntimePreset } from './catalog';

export function getSelectedAccessoryInstance(
  state: Pick<EditorState, 'accessoryInstances' | 'selectedAccessoryInstanceId'>,
): AccessoryInstance | null {
  if (!state.selectedAccessoryInstanceId) {
    return null;
  }

  return (
    state.accessoryInstances.find(
      (instance) => instance.instanceId === state.selectedAccessoryInstanceId
    ) ?? null
  );
}

export function getSelectedAccessoryPresetRef(
  state: Pick<EditorState, 'accessoryInstances' | 'selectedAccessoryInstanceId'>,
): AccessoryRuntimePresetRef | null {
  const instance = getSelectedAccessoryInstance(state);

  if (!instance) {
    return null;
  }

  return resolveAccessoryRuntimePreset(instance.presetId, instance.category);
}

export function getSelectedAccessoryResolved(
  state: Pick<EditorState, 'accessoryInstances' | 'selectedAccessoryInstanceId'>,
): ResolvedAccessoryAttachment | null {
  const instance = getSelectedAccessoryInstance(state);

  if (!instance) {
    return null;
  }

  const presetRef = resolveAccessoryRuntimePreset(instance.presetId, instance.category);

  if (!presetRef) {
    return null;
  }

  return resolveAccessoryAttachment(instance, presetRef.attachment);
}
