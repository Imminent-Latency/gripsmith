import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SwatchGrid from './SwatchGrid';
import { COLORS } from '../../constants/colors';

afterEach(cleanup);

describe('swatch names and selection', () => {
    it('explicitly names every swatch in a named group and changes selection', () => {
        const onChange = vi.fn();
        const entries = Object.entries(COLORS);
        const { rerender } = render(<SwatchGrid label="Base color" value={entries[0][1]} onChange={onChange} />);
        expect(screen.getByRole('group', { name: 'Base color' })).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(entries.length);
        for (const [name, color] of entries) {
            const button = screen.getByRole('button', { name });
            expect(button.getAttribute('aria-label')).toBe(name);
            expect(button.getAttribute('aria-pressed')).toBe(String(color === entries[0][1]));
        }
        const next = screen.getByRole('button', { name: entries[1][0] });
        act(() => next.focus());
        expect(document.activeElement).toBe(next);
        fireEvent.click(next);
        expect(onChange).toHaveBeenCalledWith(entries[1][1]);
        rerender(<SwatchGrid label="Base color" value={entries[1][1]} onChange={onChange} showLabel={false} />);
        expect(screen.getByRole('group', { name: 'Base color' })).toBeTruthy();
        expect(next.getAttribute('aria-pressed')).toBe('true');
    });
});
