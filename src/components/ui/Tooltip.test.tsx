import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Tooltip from './Tooltip';

afterEach(cleanup);

describe('persistent tooltip descriptions', () => {
    it('keeps real description text while hidden, focused, clicked and blurred', () => {
        render(<><Tooltip content="First help" /><Tooltip content="Second help" /></>);
        const [trigger, other] = screen.getAllByRole('button', { name: 'More information' });
        const id = trigger.getAttribute('aria-describedby')!;
        expect(id).toBeTruthy();
        expect(id).not.toBe(other.getAttribute('aria-describedby'));
        const description = document.getElementById(id)!;
        expect(description?.textContent).toBe('First help');
        expect(description.classList.contains('sr-only')).toBe(true);
        act(() => trigger.focus());
        expect(document.activeElement).toBe(trigger);
        expect(description.classList.contains('sr-only')).toBe(false);
        fireEvent.mouseLeave(trigger);
        expect(description.classList.contains('sr-only')).toBe(false);
        fireEvent.click(trigger);
        expect(description.classList.contains('sr-only')).toBe(true);
        act(() => trigger.blur());
        expect(document.getElementById(id)).toBe(description);
        expect(trigger.getAttribute('aria-describedby')).toBe(id);
        fireEvent.mouseEnter(trigger);
        expect(description.classList.contains('sr-only')).toBe(false);
        fireEvent.mouseLeave(trigger);
        expect(description.classList.contains('sr-only')).toBe(true);
    });

    it('updates the same description when its content changes', () => {
        const { rerender } = render(<Tooltip content="Before" />);
        const trigger = screen.getByRole('button', { name: 'More information' });
        const id = trigger.getAttribute('aria-describedby')!;
        rerender(<Tooltip content="After" />);
        expect(document.getElementById(id)?.textContent).toBe('After');
    });
});
