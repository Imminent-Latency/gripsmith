import React from 'react';
import Tooltip from './Tooltip';
import DebouncedInput from '../DebouncedInput';
import ToggleButton from './ToggleButton';
import SegmentedControl from './SegmentedControl';
import Slider from './Slider';

interface ControlFieldProps {
  label: string;
  tooltip?: string;
  helperText?: string;
  error?: string;
  children: React.ReactNode | ((props: { id: string; describedBy?: string }) => React.ReactNode);
  className?: string;
  action?: React.ReactNode;
}

const ControlField: React.FC<ControlFieldProps> = ({ 
  label, 
  tooltip, 
  helperText, 
  error, 
  children,
  className = "",
  action
}) => {
  const generatedId = React.useId();
  const isLabelControl = React.isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    && ((typeof children.type === 'string' && ['input', 'select', 'textarea', 'button'].includes(children.type))
      || children.type === DebouncedInput || children.type === ToggleButton
      || children.type === SegmentedControl || children.type === Slider);
  const id = isLabelControl ? children.props.id || generatedId : generatedId;
  const describedBy = helperText || error ? `${generatedId}-description` : undefined;
  const content = typeof children === 'function'
    ? children({ id, describedBy })
    : isLabelControl
      ? React.cloneElement(children, {
          id,
          'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        })
      : children;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between h-5 overflow-visible">
        <div className="flex items-center">
            <label htmlFor={isLabelControl || typeof children === 'function' ? id : undefined} className="text-sm font-medium text-gray-300 select-none">
            {label}
            </label>
            {tooltip && <Tooltip content={tooltip} />}
        </div>
        {action && (
            <div className="-my-1">
                {action}
            </div>
        )}
      </div>
      
      <div className="relative">
        {content}
      </div>

      {(helperText || error) && (
        <p id={describedBy} className={`text-xs ${error ? 'text-red-400' : 'text-gray-500'} px-0.5`}>
          {error || helperText}
        </p>
      )}
    </div>
  );
};

export default ControlField;
