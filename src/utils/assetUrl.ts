export const assetUrl = (...segments: string[]): string =>
    import.meta.env.BASE_URL + segments.map(segment => segment.replace(/^\/+|\/+$/g, '')).join('/');
