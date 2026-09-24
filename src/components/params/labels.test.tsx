import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Shape } from 'three';
import BaseControls from '../controls/BaseControls';
import GeometryControls from '../controls/GeometryControls';
import InlayControls from '../controls/InlayControls';
import ControlField from '../ui/ControlField';
import { AlertProvider } from '../../context/AlertContext';
import { ParamProvider } from '../../context/ParamContext';
import { defaultBaseSettings, defaultGeometrySettings, defaultInlaySettings } from '../../utils/schemaDefaults';

vi.mock('../ui/ControlField', async importOriginal => {
    const actual = await importOriginal<typeof import('../ui/ControlField')>();
    return {
        default: (props: React.ComponentProps<typeof actual.default>) => {
            const child = props.children;
            const kind = React.isValidElement(child)
                ? typeof child.type === 'string' ? child.type : (child.type as { name?: string }).name
                : typeof child;
            return <div data-testid="control-field" data-child-kind={kind}>
                {React.createElement(actual.default, props)}
            </div>;
        },
    };
});

afterEach(cleanup);
const noop = () => {};
const shape = new Shape();
shape.moveTo(0, 0); shape.lineTo(10, 0); shape.lineTo(10, 10); shape.lineTo(0, 10);
const baseProps = { updateSettings: noop, onOutlineLoaded: noop };
const inlayProps = {
    updateSettings: noop, cutoutShapes: null, baseSize: 300, baseThickness: 0.6,
    baseColor: '#ffffff', selectedInlayId: 'default-layer', setSelectedInlayId: noop,
};
const scenarios = [
    ['BaseControls empty', <BaseControls {...baseProps} settings={defaultBaseSettings} />],
    ['BaseControls loaded', <BaseControls {...baseProps} settings={{ ...defaultBaseSettings, cutoutShapes: [shape] }} />],
    ['GeometryControls empty', <GeometryControls updateSettings={noop} baseSize={300} settings={defaultGeometrySettings} />],
    ['GeometryControls place', <GeometryControls updateSettings={noop} baseSize={300} settings={{ ...defaultGeometrySettings, patternShapes: [shape], isTiled: false }} />],
    ['GeometryControls wave', <GeometryControls updateSettings={noop} baseSize={300} settings={{ ...defaultGeometrySettings, patternShapes: [shape], tilingDistribution: 'wave' }} />],
    ['InlayControls single', <InlayControls {...inlayProps} settings={{ items: [{ ...defaultInlaySettings.items[0], mode: 'single', positionPreset: 'manual' }] }} />],
    ['InlayControls tile', <InlayControls {...inlayProps} settings={{ items: [{ ...defaultInlaySettings.items[0], mode: 'tile', positionPreset: 'manual' }] }} />],
] as const;

// Enumerated exclusions per doc04 :248 (guarded injection) and :627 (real-control
// children), as narrowed by the orchestrator to native input/select/textarea/button.
// ShapeUploader contributes one wrapper field in EACH panel. Custom components,
// including DebouncedInput and ToggleButton, are deliberately not cloned.
// Tighten each inventory and the resolved-label bound when a site is migrated.
const exclusions = {
    'BaseControls empty': {
        div: ['Upload Outline'], // ShapeUploader x1
        DebouncedInput: ['Size (mm)', 'Thickness (mm)'], // BaseControls x2
    },
    'BaseControls loaded': {
        div: ['Upload Outline'], // ShapeUploader x1
        DebouncedInput: ['Thickness (mm)', 'Rotation (deg)'], // BaseControls x2
        ToggleButton: ['Mirror'], // BaseControls x1 (:132)
    },
    'GeometryControls empty': {
        div: ['Grip Geometry'], // ShapeUploader x1
    },
    'GeometryControls place': {
        div: ['Grip Geometry', 'Holes'], // ShapeUploader x1, GeometryControls x1
        DebouncedInput: ['Scale X/Y', 'Scale Z', 'Max Height', 'Margin'], // GeometryControls x4
        ToggleButton: ['Clip to Edge'], // GeometryControls x1 (:511)
    },
    'GeometryControls wave': {
        div: ['Grip Geometry', 'Distribution', 'Direction', 'Orientation', 'Holes'], // ShapeUploader x1, GeometryControls x4
        DebouncedInput: ['Scale X/Y', 'Scale Z', 'Max Height', 'Spacing', 'Clamp', 'Margin'], // GeometryControls x6
        ToggleButton: ['Clip to Edge'], // GeometryControls x1 (:511)
    },
    'InlayControls single': {
        div: ['Inlay Pattern', 'Modifier', 'Position'], // ShapeUploader x1, InlayControls x2
        DebouncedInput: ['Scale', 'X (mm)', 'Y (mm)', 'Rotation (deg)', 'Inlay Extend (mm)'], // InlayControls x5
        ToggleButton: ['Mirror'], // InlayControls x1 (:635)
    },
    'InlayControls tile': {
        div: ['Inlay Pattern', 'Modifier', 'Distribution'], // ShapeUploader x1, InlayControls x2
        DebouncedInput: ['Scale', 'Spacing (mm)', 'X (mm)', 'Y (mm)', 'Rotation (deg)', 'Inlay Extend (mm)'], // InlayControls x6
        ToggleButton: ['Mirror'], // InlayControls x1 (:635)
    },
};

describe('T5a: ControlField label associations', () => {
    it.each(scenarios)('%s', (name, panel) => {
        render(<AlertProvider><ParamProvider value={{ base: defaultBaseSettings, inlay: defaultInlaySettings, geometry: defaultGeometrySettings, selectedInlayItem: defaultInlaySettings.items.find(item => item.id === inlayProps.selectedInlayId) ?? null }}>{panel}</ParamProvider></AlertProvider>);
        const fields = screen.getAllByTestId('control-field');
        const unresolved: Record<string, string[]> = {};
        let resolved = 0;
        for (const field of fields) {
            const label = field.querySelector('label')!;
            if (label.htmlFor) {
                expect(document.getElementById(label.htmlFor)).not.toBeNull();
                resolved++;
            } else {
                const kind = field.dataset.childKind!;
                (unresolved[kind] ??= []).push(label.textContent!.trim());
            }
        }
        expect(unresolved).toEqual(exclusions[name]);
        const excludedCount = Object.values(exclusions[name]).reduce((count, labels) => count + labels.length, 0);
        expect(resolved).toBeGreaterThanOrEqual(fields.length - excludedCount);
    });

    it.each(['input', 'select', 'textarea', 'button'])('associates a native %s child', tag => {
        render(React.createElement(ControlField, {
            label: 'Native control', children: React.createElement(tag), helperText: 'Help text',
        }));
        const control = screen.getByLabelText('Native control');
        expect(control.tagName.toLowerCase()).toBe(tag);
        expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe('Help text');
    });

    it('preserves an existing native control id and description', () => {
        render(React.createElement(ControlField, {
            label: 'Existing id', helperText: 'Additional help',
            children: <input id="existing" aria-describedby="prior" />,
        }));
        const control = screen.getByLabelText('Existing id');
        expect(control.id).toBe('existing');
        expect(control.getAttribute('aria-describedby')?.split(' ')[0]).toBe('prior');
    });

    it('passes a unique id and error description to render-function children', () => {
        const field = () => React.createElement(ControlField, {
            label: 'Rendered control', error: 'Invalid value',
            children: ({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />,
        });
        render(<>{field()}{field()}</>);
        const controls = screen.getAllByLabelText('Rendered control');
        expect(controls[0].id).not.toBe(controls[1].id);
        for (const control of controls) {
            expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe('Invalid value');
        }
    });
});
