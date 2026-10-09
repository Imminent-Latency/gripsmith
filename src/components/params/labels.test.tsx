import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Shape } from 'three';
import BaseControls from '../controls/BaseControls';
import GeometryControls from '../controls/GeometryControls';
import InlayControls from '../controls/InlayControls';
import ControlField from '../ui/ControlField';
import DebouncedInput from '../DebouncedInput';
import ToggleButton from '../ui/ToggleButton';
import SegmentedControl from '../ui/SegmentedControl';
import Slider from '../ui/Slider';
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

const labelCensus = {
    'BaseControls empty': ['Upload Outline', 'Size (mm)', 'Thickness (mm)'],
    'BaseControls loaded': ['Upload Outline', 'Thickness (mm)', 'Rotation (deg)', 'Mirror'],
    'GeometryControls empty': ['Grip Geometry'],
    'GeometryControls place': ['Grip Geometry', 'Scale X/Y', 'Scale Z', 'Rotate', 'Max Height', 'Margin', 'Clip to Edge', 'Holes'],
    'GeometryControls wave': ['Grip Geometry', 'Scale X/Y', 'Scale Z', 'Rotate', 'Max Height', 'Spacing', 'Distribution', 'Direction', 'Orientation', 'Clamp', 'Margin', 'Clip to Edge', 'Holes'],
    'InlayControls single': ['Inlay Pattern', 'Scale', 'Modifier', 'Position', 'X (mm)', 'Y (mm)', 'Rotation (deg)', 'Mirror', 'Inlay Depth (mm)', 'Inlay Extend (mm)'],
    'InlayControls tile': ['Inlay Pattern', 'Scale', 'Modifier', 'Spacing (mm)', 'Distribution', 'X (mm)', 'Y (mm)', 'Rotation (deg)', 'Mirror', 'Inlay Depth (mm)', 'Inlay Extend (mm)'],
};

// Only wrapper groups remain excluded. Known id-forwarding primitives associate
// their labels through ControlField; the four T5b groups retain their own names.
const exclusions = {
    'BaseControls empty': {
        div: ['Upload Outline'], // ShapeUploader x1
    },
    'BaseControls loaded': {
        div: ['Upload Outline'], // ShapeUploader x1
    },
    'GeometryControls empty': {
        div: ['Grip Geometry'], // ShapeUploader x1
    },
    'GeometryControls place': {
        div: ['Grip Geometry'], // ShapeUploader x1; every panel control now resolves
    },
    'GeometryControls wave': {
        div: ['Grip Geometry'], // ShapeUploader x1; every panel control now resolves
    },
    'InlayControls single': {
        div: ['Inlay Pattern', 'Modifier', 'Position'], // ShapeUploader x1, InlayControls x2
    },
    'InlayControls tile': {
        div: ['Inlay Pattern', 'Modifier', 'Distribution'], // ShapeUploader x1, InlayControls x2
    },
};

describe('T5a: ControlField label associations', () => {
    it.each(scenarios)('%s', (name, panel) => {
        render(<AlertProvider><ParamProvider value={{ base: defaultBaseSettings, inlay: defaultInlaySettings, geometry: name.startsWith('GeometryControls') ? panel.props.settings : defaultGeometrySettings, selectedInlayItem: defaultInlaySettings.items.find(item => item.id === inlayProps.selectedInlayId) ?? null }}>{panel}</ParamProvider></AlertProvider>);
        const fields = screen.getAllByTestId('control-field');
        expect(fields.map(field => field.querySelector('label')!.textContent!.trim())).toEqual(labelCensus[name]);
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
        expect(resolved).toBe(labelCensus[name].length - excludedCount);
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

    it.each([
        ['DebouncedInput', <DebouncedInput value={1} onChange={noop} />],
        ['ToggleButton', <ToggleButton label="Disabled" isToggled={false} onToggle={noop} />],
        ['SegmentedControl', <SegmentedControl value="single" options={[{ value: 'single', label: 'Single' }]} onChange={noop} />],
        ['Slider', <Slider id="slider-existing" label="Rotation" value={0} onChange={noop} />],
    ] as const)('associates a known %s primitive and forwards help', (_, child) => {
        render(<ControlField label="Known control" helperText="Known help">{child}</ControlField>);
        const control = screen.getByLabelText('Known control');
        expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe('Known help');
    });

    it('does not inject into an arbitrary custom component or a wrapper div', () => {
        const Custom = (props: { id?: string }) => <button id={props.id}>Custom</button>;
        render(<><ControlField label="Unknown"><Custom /></ControlField><ControlField label="Wrapper"><div><input /></div></ControlField></>);
        for (const label of screen.getAllByTestId('control-field').map(field => field.querySelector('label')!)) {
            expect(label.htmlFor).toBe('');
        }
        expect(screen.getByRole('button', { name: 'Custom' }).id).toBe('');
    });

    it('exposes the loaded Base Mirror pressed state and preserves both toggle callbacks', () => {
        const updateSettings = vi.fn();
        const Panel = () => {
            const [settings, setSettings] = React.useState<React.ComponentProps<typeof BaseControls>['settings']>({ ...defaultBaseSettings, cutoutShapes: [shape], baseOutlineMirror: false });
            return <BaseControls {...baseProps} settings={settings} updateSettings={updates => {
                updateSettings(updates);
                setSettings(current => ({ ...current, ...updates }));
            }} />;
        };
        render(<AlertProvider><Panel /></AlertProvider>);
        const toggle = screen.getByLabelText('Mirror');
        expect(screen.getByRole('button', { name: 'Mirror', pressed: false })).toBe(toggle);
        act(() => toggle.focus());
        expect(document.activeElement).toBe(toggle);
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'Mirror', pressed: true })).toBe(toggle);
        expect(toggle.textContent).toBe('Enabled');
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'Mirror', pressed: false })).toBe(toggle);
        expect(toggle.textContent).toBe('Disabled');
        expect(document.activeElement).toBe(toggle);
        expect(updateSettings).toHaveBeenCalledTimes(2);
        expect(updateSettings).toHaveBeenNthCalledWith(1, { baseOutlineMirror: true });
        expect(updateSettings).toHaveBeenNthCalledWith(2, { baseOutlineMirror: false });
    });

    it('exposes the selected Inlay Mirror pressed state and preserves both item updates', () => {
        const updateSettings = vi.fn();
        const initial = { items: defaultInlaySettings.items.map(item => ({ ...item, mirror: false })) };
        const Panel = () => {
            const [settings, setSettings] = React.useState(initial);
            return <ParamProvider value={{ base: defaultBaseSettings, inlay: settings, geometry: defaultGeometrySettings, selectedInlayItem: settings.items[0] }}>
                <InlayControls {...inlayProps} settings={settings} updateSettings={updates => {
                    updateSettings(updates);
                    setSettings(current => ({ ...current, ...updates }));
                }} />
            </ParamProvider>;
        };
        render(<AlertProvider><Panel /></AlertProvider>);
        const toggle = screen.getByLabelText('Mirror');
        expect(screen.getByRole('button', { name: 'Mirror', pressed: false })).toBe(toggle);
        act(() => toggle.focus());
        expect(document.activeElement).toBe(toggle);
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'Mirror', pressed: true })).toBe(toggle);
        expect(toggle.textContent).toBe('Enabled');
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'Mirror', pressed: false })).toBe(toggle);
        expect(toggle.textContent).toBe('Disabled');
        expect(document.activeElement).toBe(toggle);
        expect(updateSettings).toHaveBeenCalledTimes(2);
        expect(updateSettings).toHaveBeenNthCalledWith(1, {
            items: initial.items.map(item => item.id === inlayProps.selectedInlayId ? { ...item, mirror: true } : item),
        });
        expect(updateSettings).toHaveBeenNthCalledWith(2, initial);
    });

    it('describes the resolved depth maximum through context changes, even when the legacy prop differs', () => {
        const settings = defaultInlaySettings;
        const panel = (thickness: number) => <AlertProvider><ParamProvider value={{ base: { ...defaultBaseSettings, thickness }, inlay: settings, geometry: defaultGeometrySettings, selectedInlayItem: settings.items[0] }}><InlayControls {...inlayProps} baseThickness={0.6} settings={settings} /></ParamProvider></AlertProvider>;
        const { rerender } = render(panel(1.2));
        for (const [thickness, expected] of [[1.2, '1.1'], [0.8, '0.7'], [0.1, '0.1']] as const) {
            rerender(panel(thickness));
            const depth = screen.getByLabelText('Inlay Depth (mm)') as HTMLInputElement;
            expect(depth.max).toBe(expected);
            const field = depth.closest('[data-testid="control-field"]')!;
            const trigger = field.querySelector('button[aria-describedby]')!;
            const help = document.getElementById(trigger.getAttribute('aria-describedby')!)!;
            expect(help.textContent).toBe(`How deep this inlay cuts into the base (max ${expected}mm)`);
            fireEvent.focus(trigger);
            expect(help.classList.contains('sr-only')).toBe(false);
            fireEvent.blur(trigger);
            expect(help.classList.contains('sr-only')).toBe(true);
        }
    });
});

describe('T5b: bare labels name control groups', () => {
    it.each(scenarios)('%s', (name, panel) => {
        const { container } = render(<AlertProvider><ParamProvider value={{ base: defaultBaseSettings, inlay: defaultInlaySettings, geometry: name.startsWith('GeometryControls') ? panel.props.settings : defaultGeometrySettings, selectedInlayItem: defaultInlaySettings.items.find(item => item.id === inlayProps.selectedInlayId) ?? null }}>{panel}</ParamProvider></AlertProvider>);
        const fieldLabels = new Set(screen.getAllByTestId('control-field').map(field => field.querySelector('label')));
        const groupLabels = Array.from(container.querySelectorAll('label')).filter(label => {
            if (fieldLabels.has(label)) return false;
            // The dropzone is a native label/input pair, expressly outside A7.
            if (label.htmlFor) {
                expect(document.getElementById(label.htmlFor)).not.toBeNull();
                return false;
            }
            return true;
        });
        const expected = name.startsWith('BaseControls') ? ['Color']
            : name.startsWith('InlayControls') ? ['Layout Mode']
            : name === 'GeometryControls empty' ? [] : ['Layout Mode', 'Color'];
        expect(groupLabels.map(label => label.textContent!.trim())).toEqual(expected);
        for (const label of groupLabels) {
            const group = label.closest('[role="group"]');
            expect(group).not.toBeNull();
            expect(screen.getAllByRole('group', { name: label.textContent!.trim() })).toContain(group);
        }
    });
});
