import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PatternLibraryModal from './PatternLibraryModal';
import { PRESETS, type PatternPreset } from '../constants/presets';

vi.mock('./DXFThumbnail', () => ({ default: () => null }));
vi.mock('./STLThumbnail', () => ({ default: () => null }));
vi.mock('./ThumbnailGenerator', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('library attribution', () => {
    it.each(['patterns', 'inlays', 'outlines'] as const)('has exactly one link for each attributed %s tile', category => {
        const preset: PatternPreset = {
            ...PRESETS.find(p => p.category === category)!,
            infoUrl: 'https://example.test/source', provenance: 'unverified',
        };
        vi.spyOn(PRESETS, 'filter').mockReturnValue([preset]);
        const onSelect = vi.fn();
        const { container, queryByTitle } = render(<PatternLibraryModal
            isOpen onClose={vi.fn()} onSelect={onSelect} category={category}
        />);
        const links = container.querySelectorAll('a[title="View Info"]');
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute('href')).toBe(preset.infoUrl);
        expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
        expect(links[0].getAttribute('target')).toBe('_blank');
        fireEvent.click(links[0]);
        expect(onSelect).not.toHaveBeenCalled();
        const marker = queryByTitle('Source not verified');
        if (category === 'outlines') {
            expect(marker?.parentElement).toBe(links[0].parentElement);
            expect(marker?.classList.contains('right-10')).toBe(true);
        } else expect(marker).toBeNull();
    });

    it.each(['patterns', 'inlays', 'outlines'] as const)('matches attribution counts on every bundled %s tile', category => {
        const { container } = render(<PatternLibraryModal
            isOpen onClose={vi.fn()} onSelect={vi.fn()} category={category}
        />);
        for (const preset of PRESETS.filter(p => p.category === category)) {
            const tile = screen.getByRole('button', { name: preset.name }).parentElement!;
            expect(tile.querySelectorAll('a[title="View Info"]')).toHaveLength(preset.infoUrl ? 1 : 0);
            expect(tile.querySelectorAll('[title="Source not verified"]')).toHaveLength(
                category === 'outlines' && preset.provenance !== 'verified' ? 1 : 0,
            );
        }
        expect(container.querySelectorAll('a[title="View Info"]'))
            .toHaveLength(PRESETS.filter(p => p.category === category && p.infoUrl).length);
    });
});
