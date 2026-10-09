import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Shape } from 'three';
import BaseControls from './BaseControls';
import type { BaseSettings } from '../../types/schemas';
import type { PatternPreset } from '../PatternLibraryModal';
import { AlertProvider } from '../../context/AlertContext';
import { defaultBaseSettings } from '../../utils/schemaDefaults';

vi.mock('../../utils/outline/outlineCache', () => ({
    loadOutline: vi.fn(async () => {
        const shape = new Shape();
        shape.moveTo(0, 0); shape.lineTo(10, 0); shape.lineTo(10, 10);
        return { shapes: [shape], text: 'outline asset' };
    }),
}));

// Keep the actual panel, input and parent setters; only asset loading/picker
// presentation are replaced so the reset/debounce boundary uses fake timers.
vi.mock('../PatternLibraryModal', () => ({
    default: ({ isOpen, onSelect }: { isOpen: boolean; onSelect: (preset: PatternPreset) => void }) => isOpen
        ? <div>{['Pint', 'GT Stock'].map(name => <button key={name} onClick={() => onSelect({
            id: name === 'Pint' ? 'outline/pint' : 'outline/gtstock', name,
            file: name === 'Pint' ? 'pint.dxf' : 'gtstock.dxf', type: 'dxf', category: 'outlines',
        })}>Pick {name}</button>)}</div> : null,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

function rotationInput() {
    return screen.getByText('Rotation (deg)').parentElement!.parentElement!.parentElement!
        .querySelector('input') as HTMLInputElement;
}

function setup() {
    const updates = vi.fn();
    const shape = new Shape();
    shape.moveTo(0, 0); shape.lineTo(10, 0); shape.lineTo(10, 10);
    function Parent() {
        const [settings, setSettings] = useState<BaseSettings>({ ...defaultBaseSettings,
            cutoutShapes: [shape], outlineRef: { kind: 'preset', presetId: 'outline/pint', name: 'Pint' },
        });
        return <AlertProvider>
            <BaseControls settings={settings} updateSettings={next => {
                updates(next); setSettings(current => ({ ...current, ...next }));
            }} onOutlineLoaded={shapes => setSettings(current => ({ ...current, cutoutShapes: shapes }))} />
            <output data-testid="parent-state">{JSON.stringify({ rotation: settings.baseOutlineRotation, ref: settings.outlineRef })}</output>
        </AlertProvider>;
    }
    render(<Parent />);
    return { updates, state: () => JSON.parse(screen.getByTestId('parent-state').textContent!) };
}

async function pick(name: string) {
    fireEvent.click(screen.getByTitle('Open Outline Library'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Pick ${name}` })); });
}

it.each([0, 149, 150, 450])('outline reset discards a rotation edit after %s ms without replaying it', async elapsed => {
    const { updates, state } = setup();
    fireEvent.change(rotationInput(), { target: { value: '30' } });
    act(() => { vi.advanceTimersByTime(elapsed); });
    expect(state().rotation).toBe(elapsed < 150 ? 0 : 30);
    await pick('GT Stock');
    expect(rotationInput().value).toBe('0');
    const callsAfterReset = updates.mock.calls.length;
    act(() => { vi.advanceTimersByTime(2500); });
    expect(rotationInput().value).toBe('0');
    expect(state()).toEqual({ rotation: 0, ref: { kind: 'preset', presetId: 'outline/gtstock', name: 'GT Stock' } });
    expect(updates).toHaveBeenCalledTimes(callsAfterReset);
});

it('resets repeated and same-preset selections while keeping ordinary 150 ms edits and focus', async () => {
    const { state } = setup();
    for (const name of ['GT Stock', 'Pint', 'GT Stock', 'GT Stock']) {
        const input = rotationInput();
        input.focus();
        fireEvent.change(input, { target: { value: '45' } });
        act(() => { vi.advanceTimersByTime(149); });
        expect(state().rotation).toBe(0);
        expect(document.activeElement).toBe(input);
        act(() => { vi.advanceTimersByTime(1); });
        expect(state().rotation).toBe(45);
        expect(document.activeElement).toBe(input);
        await pick(name);
        act(() => { vi.advanceTimersByTime(2500); });
        expect(rotationInput().value).toBe('0');
        expect(state().rotation).toBe(0);
        expect(state().ref.name).toBe(name);
    }
});
