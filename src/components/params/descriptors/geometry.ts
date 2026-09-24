import type { GeometrySettings } from '../../../types/schemas';
import type { ParamContextValue, ParamDescriptor } from '../../../utils/params/types';

type GeometrySection = {
    className: string;
    fields: ParamDescriptor<GeometrySettings>[];
    visible?: (ctx: ParamContextValue) => boolean;
};
const tiled = (ctx: ParamContextValue) => ctx.geometry.isTiled;

export const geometrySections: GeometrySection[] = [
    { className: 'flex gap-4', fields: [
        { key: 'patternScale', kind: 'number', label: 'Scale X/Y', step: 0.1, regenerates: true },
        { key: 'patternScaleZ', kind: 'number', label: 'Scale Z', tooltip: 'Leave empty to match X/Y scale', min: 0.1, step: 0.05, emptyMeans: 'Auto', emptyValue: '', regenerates: true },
        { key: 'baseRotation', kind: 'slider', label: 'Rotate', tooltip: 'Base rotation in degrees', unit: 'deg', min: 0, max: 360, step: 15, regenerates: true },
    ] },
    { className: 'flex gap-4 pt-2 border-t border-gray-800', fields: [
        { key: 'patternMaxHeight', kind: 'number', label: 'Max Height', tooltip: 'Cut pattern above this height (mm)', min: 0, step: 0.1, emptyMeans: 'Auto', emptyValue: undefined, regenerates: true },
    ] },
    { className: 'flex-1 min-w-0 pt-2 border-t border-gray-800', visible: tiled, fields: [
        { key: 'tileSpacing', kind: 'number', label: 'Spacing', tooltip: 'Distance between tiled patterns', regenerates: true },
    ] },
    { className: 'flex gap-4', visible: tiled, fields: [
        { key: 'tilingDistribution', kind: 'select', label: 'Distribution', regenerates: true, options: [
            { value: 'grid', label: 'Grid' }, { value: 'offset', label: 'Offset' }, { value: 'hex', label: 'Hex' },
            { value: 'radial', label: 'Radial' }, { value: 'wave', label: 'Wave' }, { value: 'zigzag', label: 'Zigzag' },
            { value: 'warped-grid', label: 'Warped Grid' }, { value: 'random', label: 'Random' },
        ] },
        { key: 'tilingDirection', kind: 'select', label: 'Direction', regenerates: true,
            visible: ctx => ctx.geometry.tilingDistribution === 'wave' || ctx.geometry.tilingDistribution === 'zigzag',
            options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }] },
    ] },
    { className: 'flex gap-4', visible: tiled, fields: [
        { key: 'tilingOrientation', kind: 'select', label: 'Orientation', regenerates: true, options: [
            { value: 'none', label: 'None' }, { value: 'alternate', label: 'Alternate' },
            { value: 'aligned', label: 'Aligned' }, { value: 'random', label: 'Random' },
        ] },
        { key: 'rotationClamp', kind: 'number', label: 'Clamp', tooltip: 'Snap rotation increments', emptyMeans: 'None', emptyValue: undefined, regenerates: true },
    ] },
    { className: 'pt-2 border-t border-gray-800', fields: [
        { key: 'patternMargin', kind: 'number', label: 'Margin', tooltip: 'Safety margin from edge', min: 0, step: 0.5, regenerates: true },
    ] },
    { className: 'flex gap-4 pt-2', fields: [
        { key: 'clipToOutline', kind: 'toggle', label: 'Clip to Edge', tooltip: 'Trim patterns that cross the outline boundary', regenerates: true },
        { key: 'holeMode', kind: 'select', label: 'Holes', tooltip: 'Interaction with holes', regenerates: true, options: [
            { value: 'default', label: 'Default' }, { value: 'margin', label: 'Margin' }, { value: 'avoid', label: 'Avoid' },
        ] },
    ] },
];

export const geometryDescriptors = geometrySections.flatMap(section => section.fields);
