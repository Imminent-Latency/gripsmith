import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import ControlField from '../ui/ControlField';
import DebouncedInput from '../DebouncedInput';
import ToggleButton from '../ui/ToggleButton';
import SegmentedControl from '../ui/SegmentedControl';
import type { ParamContextValue, ParamDescriptor } from '../../utils/params/types';
import { clampToDescriptor, resolveDerivable } from '../../utils/params/resolve';

interface ParamFieldProps<S> {
    descriptor: ParamDescriptor<S>;
    settings: S;
    onChange: (updates: Partial<S>) => void;
    ctx: ParamContextValue;
    action?: ReactNode;
}

export default function ParamField<S>({ descriptor, settings, onChange, ctx, action }: ParamFieldProps<S>) {
    const [revision, setRevision] = useState(0);
    if (descriptor.visible && !descriptor.visible(ctx)) return null;
    const value = settings[descriptor.key];
    const commit = (next: number | string | boolean | undefined) => onChange({ [descriptor.key]: next } as Partial<S>);

    return (
        <ControlField label={descriptor.label} tooltip={descriptor.tooltip} helperText={descriptor.helperText} action={action}>
            {({ id, describedBy }) => {
                switch (descriptor.kind) {
                    case 'number':
                        return <DebouncedInput
                            id={id}
                            aria-describedby={describedBy}
                            type="number"
                            value={typeof value === 'number' || typeof value === 'string' ? value : ''}
                            revision={revision}
                            min={descriptor.min === undefined ? undefined : resolveDerivable(descriptor.min, ctx)}
                            max={descriptor.max === undefined ? undefined : resolveDerivable(descriptor.max, ctx)}
                            step={descriptor.step === undefined ? undefined : resolveDerivable(descriptor.step, ctx)}
                            placeholder={descriptor.emptyMeans}
                            onChange={raw => {
                                if (raw === '' && descriptor.emptyMeans !== undefined) {
                                    commit(descriptor.emptyValue);
                                    return;
                                }
                                const numeric = Number(raw);
                                const next = descriptor.clamp ? clampToDescriptor(numeric, descriptor, ctx) : numeric;
                                commit(next);
                                if (next !== numeric) setRevision(current => current + 1);
                            }}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />;
                    case 'select':
                        return <div className="relative">
                            <select
                                id={id}
                                aria-describedby={describedBy}
                                value={String(value ?? '')}
                                onChange={event => commit(event.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
                            >
                                {resolveDerivable(descriptor.options, ctx).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                <ChevronDown size={16} />
                            </div>
                        </div>;
                    case 'toggle':
                        return <ToggleButton id={id} label={value ? 'Enabled' : 'Disabled'} isToggled={!!value} onToggle={() => commit(!value)} />;
                    case 'segmented':
                        return <SegmentedControl id={id} value={String(value ?? '')} options={resolveDerivable(descriptor.options, ctx)} onChange={commit} />;
                    default:
                        return null;
                }
            }}
        </ControlField>
    );
}
