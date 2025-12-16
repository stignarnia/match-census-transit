export default () => ({
    now: new Date(),
    userSelectedDate: null as Date | null,
    isUserInteraction: false,
    intervalId: null as number | null,

    init() {
        this.intervalId = setInterval(() => {
            this.tick();
        }, 1000) as unknown as number;
    },

    destroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    },

    tick() {
        // Update current time
        this.now = new Date();

        // Revert if selected time is passed
        if (this.userSelectedDate && this.userSelectedDate <= this.now) {
            this.reset();
        }
    },

    get displayDate(): string {
        const date = this.isUserInteraction && this.userSelectedDate ? this.userSelectedDate : this.now;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    get displayTime(): string {
        const date = this.isUserInteraction && this.userSelectedDate ? this.userSelectedDate : this.now;
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    },

    get minDate(): string {
        const date = new Date(); // Always use strict 'now' for min restriction
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    // Date input binding
    get inputDate(): string {
        return this.displayDate;
    },

    set inputDate(val: string) {
        if (!val) return;
        this.isUserInteraction = true;
        const [y, m, d] = val.split('-').map(Number);

        // Create new date preserving time
        let target = this.userSelectedDate ? new Date(this.userSelectedDate) : new Date(this.now);
        target.setFullYear(y, m - 1, d);

        this.userSelectedDate = target;
    },

    get inputTime(): string {
        return this.displayTime;
    },

    set inputTime(val: string) {
        if (!val) return;
        this.isUserInteraction = true;
        const [h, m] = val.split(':').map(Number);

        // Create new date preserving calendar date
        let target = this.userSelectedDate ? new Date(this.userSelectedDate) : new Date(this.now);
        target.setHours(h);
        target.setMinutes(m);
        target.setSeconds(0);

        this.userSelectedDate = target;
    },

    reset() {
        this.isUserInteraction = false;
        this.userSelectedDate = null;
    }
})
