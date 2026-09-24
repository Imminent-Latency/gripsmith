import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Slider from './Slider';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = { id: 'rotate', label: 'Rotate', value: 0, min: 0, max: 360, step: 15, unit: 'deg' };

describe('Slider', () => {
    it('shares a live draft and one 150 ms commit across range and numeric input', () => {
        const onChange = vi.fn();
        render(<Slider {...props} onChange={onChange} />);
        fireEvent.change(screen.getByRole('slider'), { target: { value: '90' } });
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('90');
        expect(screen.getByText('90 deg')).toBeTruthy();
        act(() => { vi.advanceTimersByTime(100); });
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '120' } });
        expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('120');
        act(() => { vi.advanceTimersByTime(149); });
        expect(onChange).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(120);
    });

    it.each([-15, 450])('preserves a numeric rotation of %s without clamping or wrapping', value => {
        const onChange = vi.fn();
        render(<Slider {...props} onChange={onChange} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(value) } });
        act(() => { vi.advanceTimersByTime(150); });
        expect(onChange).toHaveBeenCalledWith(value);
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe(String(value));
    });

    it('accepts external changes and revision echoes, and cancels work on unmount', () => {
        const onChange = vi.fn();
        const { rerender, unmount } = render(<Slider {...props} onChange={onChange} />);
        fireEvent.change(screen.getByRole('slider'), { target: { value: '90' } });
        rerender(<Slider {...props} revision={1} onChange={onChange} />);
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('0');
        rerender(<Slider {...props} value={180} onChange={onChange} />);
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('180');
        fireEvent.change(screen.getByRole('slider'), { target: { value: '270' } });
        unmount();
        act(() => { vi.advanceTimersByTime(150); });
        expect(onChange).not.toHaveBeenCalled();
    });
});
