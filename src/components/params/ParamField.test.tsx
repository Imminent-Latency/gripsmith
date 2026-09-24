import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ParamField from './ParamField';
import type { ParamContextValue, ParamDescriptor } from '../../utils/params/types';
import type { GeometrySettings, InlayItem } from '../../types/schemas';
import { defaultBaseSettings, defaultGeometrySettings, defaultInlaySettings } from '../../utils/schemaDefaults';

const ctx: ParamContextValue = {
    base: defaultBaseSettings, geometry: defaultGeometrySettings,
    inlay: defaultInlaySettings, selectedInlayItem: null,
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('T2: ParamField kinds', () => {
    it('number renders bounds and commits only after 150 ms', () => {
        const onChange = vi.fn();
        render(<ParamField descriptor={{ key: 'patternScale', kind: 'number', label: 'Scale', min: 0.1, max: current => current.base.thickness, step: 0.1, regenerates: true, helperText: 'Scale help' }} settings={defaultGeometrySettings} ctx={ctx} onChange={onChange} />);
        const input = screen.getByLabelText('Scale') as HTMLInputElement;
        expect(input.min).toBe('0.1');
        expect(input.max).toBe('0.6');
        expect(input.step).toBe('0.1');
        expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Scale help');
        fireEvent.change(input, { target: { value: '0.3' } });
        act(() => { vi.advanceTimersByTime(149); });
        expect(onChange).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ patternScale: 0.3 });
    });

    it('slider resolves bounds and commits rotation after 150 ms', () => {
        const onChange = vi.fn();
        render(<ParamField descriptor={{ key: 'baseRotation', kind: 'slider', label: 'Rotate', min: 0, max: () => 360, step: 15, unit: 'deg', regenerates: true }} settings={defaultGeometrySettings} ctx={ctx} onChange={onChange} />);
        const slider = screen.getByLabelText('Rotate') as HTMLInputElement;
        expect([slider.min, slider.max, slider.step]).toEqual(['0', '360', '15']);
        fireEvent.change(slider, { target: { value: '90' } });
        expect(slider.getAttribute('aria-valuetext')).toBe('90 deg');
        act(() => { vi.advanceTimersByTime(149); });
        expect(onChange).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(onChange).toHaveBeenCalledWith({ baseRotation: 90 });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('select commits synchronously', () => {
        const onChange = vi.fn();
        render(<ParamField descriptor={{ key: 'holeMode', kind: 'select', label: 'Holes', regenerates: true, options: [{ value: 'default', label: 'Default' }, { value: 'avoid', label: 'Avoid' }] }} settings={defaultGeometrySettings} ctx={ctx} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Holes'), { target: { value: 'avoid' } });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ holeMode: 'avoid' });
    });

    it('toggle associates its label with the existing button and commits', () => {
        const onChange = vi.fn();
        render(<ParamField descriptor={{ key: 'clipToOutline', kind: 'toggle', label: 'Clip', regenerates: true }} settings={defaultGeometrySettings} ctx={ctx} onChange={onChange} />);
        const button = screen.getByLabelText('Clip');
        expect(button.tagName).toBe('BUTTON');
        fireEvent.click(button);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ clipToOutline: false });
    });

    it('segmented labels the selected option and reuses the existing option row', () => {
        const onChange = vi.fn();
        render(<ParamField descriptor={{ key: 'tilingDirection', kind: 'segmented', label: 'Direction', regenerates: true, options: () => [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }] }} settings={defaultGeometrySettings} ctx={ctx} onChange={onChange} />);
        expect(screen.getByLabelText('Direction').textContent).toBe('Horizontal');
        fireEvent.click(screen.getByRole('button', { name: 'Vertical' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ tilingDirection: 'vertical' });
    });

    it.each([
        ['patternScaleZ', ''], ['patternMaxHeight', undefined],
    ] as const)('preserves the unset sentinel for %s', (key, emptyValue) => {
        const onChange = vi.fn();
        const descriptor: ParamDescriptor<GeometrySettings> = { key, kind: 'number', label: 'Auto value', emptyMeans: 'Auto', emptyValue, regenerates: true };
        render(<ParamField descriptor={descriptor} settings={{ ...defaultGeometrySettings, [key]: 2 }} ctx={ctx} onChange={onChange} />);
        const input = screen.getByLabelText('Auto value');
        fireEvent.change(input, { target: { value: '' } });
        act(() => { vi.advanceTimersByTime(150); });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ [key]: emptyValue });
    });

    it('re-renders a field when its derived visibility changes', () => {
        const descriptor: ParamDescriptor<GeometrySettings> = { key: 'patternScale', kind: 'number', label: 'Visible scale', regenerates: true, visible: current => current.base.thickness > 1 };
        const { rerender } = render(<ParamField descriptor={descriptor} settings={defaultGeometrySettings} ctx={ctx} onChange={() => {}} />);
        expect(screen.queryByLabelText('Visible scale')).toBeNull();
        rerender(<ParamField descriptor={descriptor} settings={defaultGeometrySettings} ctx={{ ...ctx, base: { ...ctx.base, thickness: 2 } }} onChange={() => {}} />);
        expect(screen.getByLabelText('Visible scale')).toBeTruthy();
    });
});

it('T3: echoes a clamp when the parent already holds the maximum, without losing focus or re-firing', () => {
    const committed = vi.fn();
    function Harness() {
        const [settings, setSettings] = useState<InlayItem>({ ...defaultInlaySettings.items[0], depth: 0.5 });
        return <ParamField descriptor={{ key: 'depth', kind: 'number', label: 'Depth', min: 0.1, max: 0.5, clamp: true, regenerates: true }} settings={settings} ctx={ctx} onChange={updates => { committed(updates); setSettings(current => ({ ...current, ...updates })); }} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Depth') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '9' } });
    act(() => { vi.advanceTimersByTime(150); });
    expect(input.value).toBe('0.5');
    expect(document.activeElement).toBe(input);
    act(() => { vi.advanceTimersByTime(450); });
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledWith({ depth: 0.5 });
});
