import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../constants/presets';

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
