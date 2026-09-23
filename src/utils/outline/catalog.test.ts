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
});
