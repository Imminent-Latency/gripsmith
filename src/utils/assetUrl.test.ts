import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from './assetUrl';

afterEach(() => vi.unstubAllEnvs());

describe('assetUrl', () => {
    it.each([
        ['/gripsmith/', '/gripsmith/outlines/pint.dxf'],
        ['/', '/outlines/pint.dxf'],
        ['./', './outlines/pint.dxf'],
        ['https://example.com/gripsmith/', 'https://example.com/gripsmith/outlines/pint.dxf'],
    ])('resolves an outline under %s', (base, expected) => {
        vi.stubEnv('BASE_URL', base);
        const url = assetUrl('outlines', 'pint.dxf');
        expect(url).toBe(expected);
        expect(url.replace(/^[a-z]+:\/\//i, '')).not.toContain('//');
    });

    it('strips surrounding slashes from each segment', () => {
        vi.stubEnv('BASE_URL', '/gripsmith/');
        expect(assetUrl('/outlines/', '/pint.dxf/')).toBe('/gripsmith/outlines/pint.dxf');
    });
});
