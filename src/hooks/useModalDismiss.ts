import { useEffect, useRef, type RefObject } from 'react';

export function useModalDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, isOpen = true) {
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);

    useEffect(() => {
        const modal = ref.current;
        if (!isOpen || !modal) return;
        const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex]'
        )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
            !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
            getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
        const focusFirst = () => (focusable()[0] ?? modal).focus();
        const handleFocus = (event: FocusEvent) => {
            if (event.target instanceof Node && !modal.contains(event.target)) focusFirst();
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close.current();
            } else if (event.key === 'Tab') {
                const elements = focusable();
                const first = elements[0];
                const last = elements[elements.length - 1];
                if (!first) {
                    event.preventDefault();
                    modal.focus();
                } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        focusFirst();
        document.addEventListener('keydown', handleKey);
        document.addEventListener('focusin', handleFocus);
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.removeEventListener('focusin', handleFocus);
            if (trigger?.isConnected) trigger.focus();
        };
    }, [ref, isOpen]);
}
