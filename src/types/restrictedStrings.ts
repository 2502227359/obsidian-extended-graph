export type Feature = 'auto-enabled' | 'tags' | 'properties' | 'property-key' | 'links' | 'folders' | 'imagesFromProperty' | 'imagesForAttachments' | 'imagesFromEmbeds' | 'focus' | 'shapes' | 'elements-stats' | 'names' | 'icons' | 'arrows' | 'layers' | 'linksSameColorAsNode';
export type GraphType = 'graph' | 'localgraph';

/** i18n keys, to be wrapped in t() at the call site (avoids a circular import on internal). */
export const graphTypeLabels: Record<GraphType, string> = {
    'graph': "plugin.global",
    'localgraph': "plugin.local"
}