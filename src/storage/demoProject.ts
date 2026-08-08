import demoManifest from '../../assets/demo/manifest.json';
import bassAsset from '../../assets/demo/bass.wav';
import keysAsset from '../../assets/demo/keys.wav';
import guideAsset from '../../assets/demo/guide.wav';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest } from '@/types/project';
import type { ProjectSource } from './types';

const DEMO_ASSETS: Record<string, number> = {
  'bass.wav': bassAsset,
  'keys.wav': keysAsset,
  'guide.wav': guideAsset,
};

/**
 * The bundled demo project used to validate sample-locked sync on first
 * launch, with no filesystem or picker interaction required. Stems are
 * `require()`d so Metro bundles them as native asset modules; the engine's
 * decoder resolves those module ids via `Image.resolveAssetSource`.
 */
export function getDemoProjectSource(): ProjectSource {
  return {
    manifest: demoManifest as ProjectManifest,
    resolveFile: (file) => {
      const asset = DEMO_ASSETS[file];
      if (asset === undefined) {
        throw new Error(`Unknown demo project asset: ${file}`);
      }
      return asset;
    },
  };
}

/** The Library screen's entry for the bundled demo project. */
export function getDemoLibraryEntry(): LibraryProjectEntry {
  return { ...(demoManifest as ProjectManifest), origin: 'bundled' };
}
