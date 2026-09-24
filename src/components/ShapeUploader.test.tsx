import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Shape } from 'three';
import ShapeUploader from './ShapeUploader';

afterEach(cleanup);
const shape = new Shape();
shape.moveTo(0, 0); shape.lineTo(10, 0); shape.lineTo(10, 10);

it.each([false, true])('keeps a labelled, focusable file input when loaded=%s', loaded => {
    render(<ShapeUploader label="Upload Outline" shapes={loaded ? [shape] : null}
        fileName={loaded ? 'outline.dxf' : null} onClear={vi.fn()} allowedTypes={['dxf']} />);
    const input = screen.getByLabelText(loaded ? 'outline.dxf' : /Click to upload/, { selector: 'input' }) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.dxf');
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.classList.contains('hidden')).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(input.closest('label')?.classList.contains('focus-within:ring-purple-500')).toBe(true);
});

it('preserves the same input across empty, loaded and cleared states', () => {
    const props = { label: 'Upload Outline', onClear: vi.fn() };
    const { rerender } = render(<ShapeUploader {...props} shapes={null} fileName={null} />);
    const input = screen.getByLabelText(/Click to upload/);
    rerender(<ShapeUploader {...props} shapes={[shape]} fileName="outline.dxf" />);
    expect(screen.getByLabelText('outline.dxf', { selector: 'input' })).toBe(input);
    rerender(<ShapeUploader {...props} shapes={null} fileName={null} />);
    expect(screen.getByLabelText(/Click to upload/)).toBe(input);
});
