import { useEffect, useState } from 'react';

interface SliderProps {
    id: string;
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    revision?: number;
    'aria-describedby'?: string;
}

export default function Slider({ id, label, value, onChange, min, max, step, unit, revision, 'aria-describedby': describedBy }: SliderProps) {
    const [draft, setDraft] = useState<number | string>(value);
    useEffect(() => { setDraft(value); }, [value, revision]);
    // Match DebouncedInput's 150 ms commit behavior, sharing one draft/timer
    // between the range and number inputs so they cannot race each other.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (draft !== value) onChange(Number(draft));
        }, 150);
        return () => clearTimeout(timer);
    }, [draft, value, onChange]);

    return <div className="space-y-2">
        <div className="flex justify-between items-center gap-2 text-sm text-gray-300">
            <input type="number" aria-label={`${label} value`} aria-describedby={describedBy}
                value={draft} step={step} onChange={event => setDraft(event.target.value)}
                className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none" />
            <span className="text-gray-400">{draft}{unit ? ` ${unit}` : ''}</span>
        </div>
        <input id={id} type="range" min={min} max={max} step={step} value={draft}
            aria-describedby={describedBy} aria-valuetext={`${draft}${unit ? ` ${unit}` : ''}`}
            onChange={event => setDraft(event.target.value)}
            className="w-full accent-purple-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer" />
    </div>;
}
