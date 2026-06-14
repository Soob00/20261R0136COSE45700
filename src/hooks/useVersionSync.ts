'use client';

import { useCallback } from 'react';
import { useAPI } from '@/lib/api';
import { useEditorStore } from '@/stores/editorStore';

export function useVersionSync() {
  const api = useAPI();
  const avatarId = useEditorStore((s) => s.avatarId);
  const saveVersion = useEditorStore((s) => s.saveVersion);
  const deleteVersion = useEditorStore((s) => s.deleteVersion);
  const renameVersion = useEditorStore((s) => s.renameVersion);

  const syncSaveVersion = useCallback(
    async (name?: string, thumbnailDataUrl?: string) => {
      // Save to local store first
      saveVersion(name, thumbnailDataUrl);

      if (!avatarId) return;

      // Then sync to server
      const versions = useEditorStore.getState().versions;
      const latestVersion = versions[versions.length - 1];
      if (latestVersion) {
        try {
          await api.version.saveVersion(avatarId, latestVersion);
        } catch (e) {
          console.warn('Failed to sync version to server:', e);
        }
      }
    },
    [api, avatarId, saveVersion]
  );

  const syncDeleteVersion = useCallback(
    async (versionId: string) => {
      // Delete from local store first
      deleteVersion(versionId);

      if (!avatarId) return;

      // Then sync to server
      try {
        await api.version.deleteVersion(avatarId, versionId);
      } catch (e) {
        console.warn('Failed to delete version from server:', e);
      }
    },
    [api, avatarId, deleteVersion]
  );

  const syncRenameVersion = useCallback(
    async (versionId: string, newName: string) => {
      // Rename in local store first
      renameVersion(versionId, newName);

      if (!avatarId) return;

      // Then sync to server
      try {
        await api.version.updateVersion(avatarId, versionId, {
          name: newName,
        });
      } catch (e) {
        console.warn('Failed to rename version on server:', e);
      }
    },
    [api, avatarId, renameVersion]
  );

  const loadVersionsFromServer = useCallback(async () => {
    if (!avatarId) return;

    try {
      const serverVersions = await api.version.listVersions(avatarId);
      if (serverVersions.length > 0) {
        useEditorStore.setState({ versions: serverVersions });
      }
    } catch (e) {
      // Silently fall back to localStorage
    }
  }, [api, avatarId]);

  return {
    syncSaveVersion,
    syncDeleteVersion,
    syncRenameVersion,
    loadVersionsFromServer,
  };
}
