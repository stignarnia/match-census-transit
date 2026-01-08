import { MOBILE_BREAKPOINT } from './constants';

export interface ResponsiveData {
    expanded: boolean;
    toggle(): void;
    initResponsive(): void;
}

export const createResponsiveState = () => ({
    expanded: false,

    initResponsive() {
        let isDesktop = window.innerWidth >= MOBILE_BREAKPOINT;
        this.expanded = isDesktop;

        window.addEventListener('resize', () => {
            const newIsDesktop = window.innerWidth >= MOBILE_BREAKPOINT;
            if (newIsDesktop && !isDesktop) {
                this.expanded = true;
            } else if (!newIsDesktop && isDesktop) {
                this.expanded = false;
            }
            isDesktop = newIsDesktop;
        });
    },

    toggle() {
        if (window.innerWidth < MOBILE_BREAKPOINT) {
            this.expanded = !this.expanded;
        }
    }
});
