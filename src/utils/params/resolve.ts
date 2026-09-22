import type { Derivable, NumberParam, ParamContextValue } from './types';

export function resolveDerivable<T>(value: Derivable<T>, ctx: ParamContextValue): T {
    return typeof value === 'function' ? (value as (ctx: ParamContextValue) => T)(ctx) : value;
}

export function clampToDescriptor<S>(value: number, descriptor: NumberParam<S>, ctx: ParamContextValue): number {
    const min = descriptor.min === undefined ? -Infinity : resolveDerivable(descriptor.min, ctx);
    const max = descriptor.max === undefined ? Infinity : resolveDerivable(descriptor.max, ctx);
    return Math.min(max, Math.max(min, value));
}
