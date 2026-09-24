import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Shape } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dxfUtils from '../dxfUtils';
import { loadOutline, clearOutlineCache } from './outlineCache';
import { PRESETS } from '../../constants/presets';
import PatternLibraryModal from '../../components/PatternLibraryModal';
import DXFThumbnail from '../../components/DXFThumbnail';

vi.mock('../../components/STLThumbnail', () => ({ default: () => null }));
vi.mock('../../components/ThumbnailGenerator', () => ({ default: () => null }));

const text = 'SECTION\nHEADER';
const response = () => ({ ok: true, text: async () => text }) as Response;

beforeEach(() => clearOutlineCache());
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearOutlineCache();
});

const stubOutline = () => {
    const shape = new Shape();
    shape.moveTo(10, 20);
    shape.lineTo(30, 20);
    shape.lineTo(30, 30);
    shape.lineTo(10, 30);
    const parse = vi.spyOn(dxfUtils, 'parseDxfToShapes').mockReturnValue([shape]);
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    return { parse, fetch };
};

describe('outline cache', () => {
    it('shares sequential loads, including source bytes and viewBox coordinates', async () => {
        const { fetch, parse } = stubOutline();
        const first = await loadOutline('/outlines/pint.dxf');
        expect(await loadOutline('/outlines/pint.dxf')).toBe(first);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(parse).toHaveBeenCalledTimes(1);
        expect(first.text).toBe(text);
        expect(first.viewBox).toBe('8 -32 24 14');
        expect(first.pathData).toBe(dxfUtils.generateSVGPath(first.shapes));
    });

    it('shares the pending promise for concurrent loads', async () => {
        const { fetch } = stubOutline();
        const first = loadOutline('/outlines/pint.dxf');
        const second = loadOutline('/outlines/pint.dxf');
        expect(second).toBe(first);
        const [a, b] = await Promise.all([first, second]);
        expect(a).toBe(b);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('evicts a rejected concurrent load so the third call retries', async () => {
        const { fetch } = stubOutline();
        fetch.mockRejectedValueOnce(new Error('offline'));
        const first = loadOutline('/outlines/pint.dxf');
        const second = loadOutline('/outlines/pint.dxf');
        const results = await Promise.allSettled([first, second]);
        expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
        await loadOutline('/outlines/pint.dxf');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('evicts unsuccessful HTTP responses', async () => {
        const { fetch } = stubOutline();
        fetch.mockResolvedValueOnce({ ok: false });
        await expect(loadOutline('/outlines/pint.dxf')).rejects.toThrow('Failed to fetch DXF');
        await loadOutline('/outlines/pint.dxf');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects and evicts successful fetches that parse to zero shapes', async () => {
        const { fetch, parse } = stubOutline();
        parse.mockReturnValueOnce([]);
        await expect(loadOutline('/outlines/pint.dxf')).rejects.toThrow('zero shapes');
        await expect(loadOutline('/outlines/pint.dxf')).resolves.toHaveProperty('text', text);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('restores cold loading after clearing the cache', async () => {
        const { fetch, parse } = stubOutline();
        await loadOutline('/outlines/pint.dxf');
        clearOutlineCache();
        await loadOutline('/outlines/pint.dxf');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(parse).toHaveBeenCalledTimes(2);
    });

    it('keeps the Failed thumbnail for zero-shape results', async () => {
        const { parse } = stubOutline();
        parse.mockReturnValueOnce([]);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { findByText } = render(createElement(DXFThumbnail, { url: '/empty.dxf', alt: 'Empty' }));
        expect(await findByText('Failed')).toBeTruthy();
    });

    it('parses each bundled DXF only once across two modal opens', async () => {
        const parse = vi.spyOn(dxfUtils, 'parseDxfToShapes');
        const fetch = vi.fn(async (url: string) => ({
            ok: true,
            text: async () => readFileSync(`public/outlines/${url.split('/').pop()}`, 'utf8'),
        }) as Response);
        vi.stubGlobal('fetch', fetch);
        const props = { isOpen: true, onClose: vi.fn(), onSelect: vi.fn(), category: 'outlines' as const };
        const { container, rerender } = render(createElement(PatternLibraryModal, props));
        await waitFor(() => expect(container.querySelectorAll('svg[viewBox] path[transform]')).toHaveLength(17));
        rerender(createElement(PatternLibraryModal, { ...props, isOpen: false }));
        expect(container.querySelectorAll('path[transform]')).toHaveLength(0);
        await act(async () => rerender(createElement(PatternLibraryModal, props)));
        await waitFor(() => expect(container.querySelectorAll('svg[viewBox] path[transform]')).toHaveLength(17));
        expect(PRESETS.filter(preset => preset.category === 'outlines')).toHaveLength(17);
        expect(container.querySelectorAll('[title="Source not verified"]')).toHaveLength(17);
        expect(fetch).toHaveBeenCalledTimes(17);
        expect(parse).toHaveBeenCalledTimes(17);
    });
});
