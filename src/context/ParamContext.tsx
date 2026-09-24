import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ParamContextValue } from '../utils/params/types';

const ParamContext = createContext<Readonly<ParamContextValue> | undefined>(undefined);

export function ParamProvider({ value, children }: { value: ParamContextValue; children: ReactNode }) {
    const { base, inlay, geometry, selectedInlayItem } = value;
    const currentItem = inlay.items.find(item => item.id === selectedInlayItem?.id) ?? null;
    return <ParamContext.Provider value={{ base, inlay, geometry, selectedInlayItem: currentItem }}>
        {children}
    </ParamContext.Provider>;
}

export function useParamContext(): Readonly<ParamContextValue> {
    const value = useContext(ParamContext);
    if (value === undefined) throw new Error('useParamContext must be used within a ParamProvider');
    return value;
}
