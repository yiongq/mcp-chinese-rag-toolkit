export type { CaptionCache, CaptionCacheLookup, CaptionCacheOptions } from './caption-cache.js';
export { openCaptionCache, resolveDefaultCaptionCacheDir, sha256Hex } from './caption-cache.js';
export { encodePng, ensureCanvasAvailable } from './png-encoder.js';
export type {
  CaptionCacheEntry,
  IndexingPlugin,
  IndexingPluginContext,
  PageCaptionOptions,
  VisionCaptionOptions,
  VisionProvider,
} from './types.js';
export { OptionalDependencyMissingError, VisionCaptionFailedError } from './types.js';
export { withPageCaption } from './with-page-caption.js';
export { DEFAULT_VISION_PROMPT, withVisionCaption } from './with-vision-caption.js';
