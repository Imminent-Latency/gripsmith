import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../../constants/presets';
import { BaseSettingsSchema, ProjectSchemaV1 } from '../../types/schemas';
import { getDefaults, defaultInlaySettings, defaultGeometrySettings } from '../schemaDefaults';
import { exportProjectBundle, importProjectBundle } from '../projectUtils';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('preset catalog', () => {
    it('contains the existing 43 presets', () => {
        expect(PRESETS).toHaveLength(43);
    });

    it('matches all 17 outline files on disk', () => {
        const files = readdirSync('public/outlines').filter(file => file.endsWith('.dxf')).sort();
        const outlines = PRESETS.filter(preset => preset.category === 'outlines');
        expect(outlines).toHaveLength(17);
        expect(outlines.map(preset => preset.file).sort()).toEqual(files);
    });

    it('has exactly the two known orphan assets', () => {
        const registered = new Set(PRESETS.map(preset => `${preset.category}/${preset.file}`));
        const files = ['outlines', 'inlays', 'patterns'].flatMap(category =>
            readdirSync(`public/${category}`).map(file => `${category}/${file}`));
        expect(files.filter(file => !registered.has(file)).sort()).toEqual([
            'inlays/bitmap2.svg',
            'patterns/cone.stl',
        ]);
    });

    it('uses category-prefixed lowercase ids for all presets', () => {
        for (const preset of PRESETS) {
            expect(preset.id).toMatch(/^(outline|pattern|inlay)\/[a-z0-9][a-z0-9-]*$/);
            expect(preset.id.split('/')[0]).toBe(preset.category.slice(0, -1));
        }
    });

    it('has 43 unique ids', () => {
        expect(new Set(PRESETS.map(preset => preset.id)).size).toBe(43);
    });

    it('preserves the frozen outline identities', () => {
        expect(PRESETS.filter(preset => preset.category === 'outlines').map(preset => preset.id)).toEqual([
            'outline/xrstock',
            'outline/xrcobraviper',
            'outline/xrkushwide',
            'outline/xrmushiesv2',
            'outline/xrpubpad',
            'outline/xrstompies',
            'outline/xrviperbitewide',
            'outline/floatwheeladv',
            'outline/floatwheelatom',
            'outline/gtstock',
            'outline/gtkushwide',
            'outline/gtmushies',
            'outline/gtfst',
            'outline/gtlowboyflared',
            'outline/pint',
            'outline/pintmatix',
            'outline/gosmilox7',
        ]);
    });
});


describe('outline identity persistence', () => {
    it('defaults the outline reference directly through getDefaults', () => {
        expect(getDefaults(BaseSettingsSchema).outlineRef).toBeNull();
    });

    it('accepts a legacy v1 project without an outline reference', () => {
        const legacyBase = { size: 300, thickness: 0.6, color: '#000000', cutoutShapes: null };
        const project = ProjectSchemaV1.parse({
            version: 1, timestamp: 0, base: legacyBase,
            inlay: defaultInlaySettings, geometry: defaultGeometrySettings,
        });
        expect(project.base.outlineRef).toBeNull();
    });

    it('round-trips the preset reference through the projectUtils ZIP bundle', async () => {
        const outlineRef = { kind: 'preset' as const, presetId: 'outline/pint', name: 'Pint' };
        const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:outline-bundle');
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        await exportProjectBundle(
            { ...getDefaults(BaseSettingsSchema), outlineRef },
            defaultInlaySettings, defaultGeometrySettings,
            { baseOutline: { name: 'pint.dxf', content: 'SECTION\nHEADER', type: 'dxf' } },
        );
        expect(createObjectURL).toHaveBeenCalledOnce();
        const blob = createObjectURL.mock.calls[0][0];
        const result = await importProjectBundle(new File([blob], 'outline.zip', { type: 'application/zip' }));
        expect(result.data.base.outlineRef).toEqual(outlineRef);
        expect(result.importedVersion).toBe(1);
        expect(result.importedAssets?.baseOutline?.content).toBe('SECTION\nHEADER');
    });
});
