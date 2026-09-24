import { useId } from 'react';
import { COLORS } from '../../constants/colors';

interface SwatchGridProps {
    id?: string;
    label?: string;
    value: string;
    onChange: (value: string) => void;
    className?: string;
    showLabel?: boolean;
}

export default function SwatchGrid({ id, label = 'Color', value, onChange, className = '', showLabel = true }: SwatchGridProps) {
    const labelId = useId();
    return <div id={id} role="group" aria-labelledby={showLabel ? labelId : undefined} aria-label={showLabel ? undefined : label} className={`space-y-2 ${className}`}>
        {showLabel && <label id={labelId} className="text-sm font-medium text-gray-300">{label}</label>}
        <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
            {Object.entries(COLORS).map(([name, color]) => (
                <button type="button" key={color} onClick={() => onChange(color)}
                    aria-pressed={value === color}
                    className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${value === color ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50'}`}
                    style={{ backgroundColor: color }} title={name} />
            ))}
        </div>
    </div>;
}
