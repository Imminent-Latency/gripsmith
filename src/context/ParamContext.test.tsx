import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ParamProvider, useParamContext } from './ParamContext';
import { BaseSettingsSchema, GeometrySettingsSchema, InlaySettingsSchema } from '../types/schemas';
import { getDefaults } from '../utils/schemaDefaults';
import type { ParamContextValue } from '../utils/params/types';
import InlayControls from '../components/controls/InlayControls';
import { AlertProvider } from './AlertContext';

afterEach(cleanup);
const defaults: ParamContextValue = {
    base: getDefaults(BaseSettingsSchema), inlay: getDefaults(InlaySettingsSchema),
    geometry: getDefaults(GeometrySettingsSchema), selectedInlayItem: null,
};
function Probe() {
    const value = useParamContext();
    return <output data-keys={Object.keys(value).sort().join(',')}>{JSON.stringify(value)}</output>;
}
function readValue() {
    return JSON.parse(screen.getByRole('status').textContent!);
}

describe('ParamProvider', () => {
    it('throws a clear error without a provider', () => {
        expect(() => render(<Probe />)).toThrow('useParamContext must be used within a ParamProvider');
    });

    it('exposes the read-only design view with no setters or extra channels', () => {
        render(<ParamProvider value={defaults}><Probe /></ParamProvider>);
        const value = readValue();
        expect(value).toEqual(JSON.parse(JSON.stringify(defaults)));
        expect(screen.getByRole('status').getAttribute('data-keys')).toBe('base,geometry,inlay,selectedInlayItem');
    });

    it('derives the selected item from the current inlay items and updates on rerender', () => {
        const selected = defaults.inlay.items[0];
        const initial = { ...defaults, selectedInlayItem: selected };
        const { rerender } = render(<ParamProvider value={initial}><Probe /></ParamProvider>);
        expect(readValue().selectedInlayItem).toEqual(selected);
        const updated = { ...selected, depth: 0.2 };
        rerender(<ParamProvider value={{ ...initial, inlay: { items: [updated] } }}><Probe /></ParamProvider>);
        expect(readValue().selectedInlayItem).toEqual(updated);
        rerender(<ParamProvider value={{ ...initial, inlay: { items: [] } }}><Probe /></ParamProvider>);
        expect(readValue().selectedInlayItem).toBeNull();
    });

    it('resolves the Inlay depth bound from the provider on first paint and subsequent changes', () => {
        const renderPanel = (thickness: number) => <AlertProvider>
            <ParamProvider value={{ ...defaults, base: { ...defaults.base, thickness }, selectedInlayItem: defaults.inlay.items[0] }}>
                <InlayControls settings={defaults.inlay} updateSettings={() => {}} cutoutShapes={null} baseSize={300} baseThickness={0.6} baseColor="#ffffff" selectedInlayId={defaults.inlay.items[0].id} setSelectedInlayId={() => {}} />
            </ParamProvider>
        </AlertProvider>;
        const { rerender } = render(renderPanel(1.2));
        expect((screen.getByLabelText('Inlay Depth (mm)') as HTMLInputElement).max).toBe('1.1');
        rerender(renderPanel(0.4));
        expect((screen.getByLabelText('Inlay Depth (mm)') as HTMLInputElement).max).toBe('0.3');
    });
});
