import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PatternLibraryModal from '../components/PatternLibraryModal';
import { useModalDismiss } from './useModalDismiss';

vi.mock('../components/STLThumbnail', () => ({ default: () => <span>STL preview</span> }));
vi.mock('../components/DXFThumbnail', () => ({ default: () => <span>DXF preview</span> }));
vi.mock('../components/ThumbnailGenerator', () => ({ default: () => null }));
afterEach(cleanup);

const categories = [
    ['patterns', 'Pattern Library', 'Pyramid', 'pyramid.stl'],
    ['inlays', 'Inlay Library', 'GrippySheet', 'grippysheet.svg'],
    ['outlines', 'Outline Library', 'XR Stock', 'xrstock.dxf'],
] as const;

describe('T6: picker dismissal and keyboard focus', () => {
    it.each(categories)('%s: traps Tab, selects, dismisses and restores the trigger', (category, title, name, file) => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        function Picker() {
            const [open, setOpen] = useState(false);
            return <>
                <button onClick={() => setOpen(true)}>Open library</button>
                <PatternLibraryModal isOpen={open} category={category}
                    onClose={() => { onClose(); setOpen(false); }}
                    onSelect={preset => { onSelect(preset); setOpen(false); }} />
            </>;
        }
        render(<Picker />);
        const trigger = screen.getByRole('button', { name: 'Open library' });
        trigger.focus();
        // jsdom does not perform native Enter-to-click or intermediate Tab default
        // actions: dispatch their browser click/focus results explicitly.
        fireEvent.click(trigger, { detail: 0 });
        const dialog = screen.getByRole('dialog', { name: title });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const first = within(dialog).getByRole('button', { name: 'Close library' });
        expect(document.activeElement).toBe(first);
        const stops = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]'));
        expect(stops.every(element => element.tabIndex === 0)).toBe(true);
        const last = stops[stops.length - 1];
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
        for (const stop of stops) {
            stop.focus();
            expect(document.activeElement).toBe(stop);
        }
        trigger.focus();
        expect(document.activeElement).toBe(first);
        const tile = within(dialog).getByRole('button', { name });
        expect(tile.getAttribute('type')).toBe('button');
        expect(tile.querySelector('button, a')).toBeNull();
        tile.focus();
        fireEvent.click(tile, { detail: 0 });
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ file, category }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        fireEvent.click(trigger, { detail: 0 });
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it.each(categories)('%s: selection is exclusively prop-driven', (category, title, name, file) => {
        const props = { isOpen: true, category, onClose: vi.fn(), onSelect: vi.fn() };
        const { rerender } = render(<PatternLibraryModal {...props} />);
        const dialog = screen.getByRole('dialog', { name: title });
        expect(dialog.querySelectorAll('[aria-pressed]')).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole('button', { name }));
        expect(dialog.querySelectorAll('[aria-pressed]')).toHaveLength(0);
        rerender(<PatternLibraryModal {...props} selectedFile={file} />);
        const markers = Array.from(dialog.querySelectorAll('[aria-pressed]'));
        expect(markers.length).toBeGreaterThan(1);
        expect(markers.filter(tile => tile.getAttribute('aria-pressed') === 'true')).toEqual([
            within(dialog).getByRole('button', { name }),
        ]);
        expect(markers.every(tile => tile.getAttribute('aria-pressed') === (tile.getAttribute('aria-label') === name ? 'true' : 'false'))).toBe(true);
        rerender(<PatternLibraryModal {...props} />);
        expect(dialog.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    });

    it('keeps 3D preview independent of selection and accepts keyboard clicks after dragging', () => {
        const onSelect = vi.fn();
        render(<PatternLibraryModal isOpen onClose={() => {}} onSelect={onSelect} />);
        fireEvent.click(screen.getAllByTitle('View in 3D')[0]);
        expect(screen.getByRole('dialog').querySelectorAll('[aria-pressed]')).toHaveLength(0);
        const tile = screen.getByRole('button', { name: 'Pyramid' });
        fireEvent.click(tile, { detail: 1, clientX: 100, clientY: 100 });
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.click(tile, { detail: 0 });
        expect(onSelect).toHaveBeenCalledOnce();
    });

    it('focuses an empty shell, traps Tab, and uses the latest close callback', () => {
        function Empty({ onClose }: { onClose: () => void }) {
            const ref = useRef<HTMLDivElement>(null);
            useModalDismiss(ref, onClose);
            return <div ref={ref} role="dialog" tabIndex={-1} />;
        }
        const first = vi.fn(), latest = vi.fn();
        const { rerender } = render(<Empty onClose={first} />);
        const shell = screen.getByRole('dialog');
        expect(document.activeElement).toBe(shell);
        fireEvent.keyDown(shell, { key: 'Tab' });
        expect(document.activeElement).toBe(shell);
        rerender(<Empty onClose={latest} />);
        fireEvent.keyDown(shell, { key: 'Escape' });
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledOnce();
    });
});
