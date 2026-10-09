import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESETS } from '../../constants/presets';
import { BaseSettingsSchema, ProjectSchemaV1 } from '../../types/schemas';
import { getDefaults, defaultInlaySettings, defaultGeometrySettings } from '../schemaDefaults';
import { exportProjectBundle, importProjectBundle } from '../projectUtils';

const historicalCatalog = JSON.parse(readFileSync('src/utils/outline/fixtures/catalog-60b66c2.json', 'utf8'));
let restoreObjectURLs: (() => void) | undefined;

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    restoreObjectURLs?.();
    restoreObjectURLs = undefined;
});

describe('preset catalog', () => {
    it('contains the existing 43 presets', () => {
        expect(PRESETS).toHaveLength(43);
    });

    it('preserves every name, format, category and id from the historical 43-row census', () => {
        // Frozen from the stable-ID commit, independently checked against upstream's catalog.
        expect(historicalCatalog.rows).toHaveLength(43);
        expect(PRESETS.map(({ file, name, type, category, id }) => ({ file, name, type, category, id })))
            .toEqual(historicalCatalog.rows);
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
        const nativeURL = URL;
        const methods = { createObjectURL, revokeObjectURL: vi.fn() };
        const originals = Object.keys(methods).map(key => [key, Object.getOwnPropertyDescriptor(URL, key)] as const);
        restoreObjectURLs = () => originals.forEach(([key, descriptor]) => {
            if (descriptor) Object.defineProperty(nativeURL, key, descriptor);
            else Reflect.deleteProperty(nativeURL, key);
        });
        for (const [key, value] of Object.entries(methods)) {
            Object.defineProperty(URL, key, { configurable: true, writable: true, value });
        }
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        await exportProjectBundle(
            { ...getDefaults(BaseSettingsSchema), outlineRef },
            defaultInlaySettings, defaultGeometrySettings,
            { baseOutline: { name: 'pint.dxf', content: 'SECTION\nHEADER', type: 'dxf' } },
        );
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(URL).toBe(nativeURL);
        expect(new URL('outlines/pint.dxf', 'https://example.test/gripsmith/').pathname)
            .toBe('/gripsmith/outlines/pint.dxf');
        const blob = createObjectURL.mock.calls[0][0];
        const result = await importProjectBundle(new File([blob], 'outline.zip', { type: 'application/zip' }));
        expect(result.data.base.outlineRef).toEqual(outlineRef);
        expect(result.importedVersion).toBe(1);
        expect(result.importedAssets?.baseOutline?.content).toBe('SECTION\nHEADER');
    });
});


describe('bundled asset provenance', () => {
    it('records an explicit provenance decision for every outline', () => {
        for (const preset of PRESETS.filter(preset => preset.category === 'outlines')) {
            expect(['verified', 'unverified']).toContain(preset.provenance);
        }
    });

    it('requires attribution and a specific source for any verified preset', () => {
        for (const preset of PRESETS.filter(preset => preset.provenance === 'verified')) {
            expect(preset.credit?.trim()).toBeTruthy();
            expect(preset.license?.trim()).toBeTruthy();
            expect(preset.infoUrl?.trim()).toBeTruthy();
            expect(preset.infoUrl).not.toBe('https://www.printables.com/model/968803');
        }
    });

    it('lists every bundled filename in NOTICE exactly once, including orphans', () => {
        const notice = readFileSync('NOTICE', 'utf8');
        expect(notice).toContain('Bundled outlines: UNVERIFIED provenance.');
        const files = ['outlines', 'inlays', 'patterns'].flatMap(category =>
            readdirSync(`public/${category}`).map(file => `public/${category}/${file}`)).sort();
        const listed = notice.split('\n').filter(line => line.startsWith('public/')).map(line => line.split(' | ')[0]).sort();
        expect(listed).toEqual(files);
        for (const file of files) expect(listed.filter(entry => entry === file)).toHaveLength(1);
    });
});
