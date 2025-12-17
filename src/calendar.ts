interface CalendarData {
    now: Date;
    userSelectedDate: Date | null;
    isUserInteraction: boolean;
    intervalId: number | null;
    lastDispatchedMinute: number | null;
    showDatePicker: boolean;
    showTimePicker: boolean;
    viewDate: Date;
    init(): void;
    destroy(): void;
    tick(): void;
    readonly displayDate: string;
    readonly displayTime: string;
    readonly monthName: string;
    readonly days: { date: number; fullDate: Date; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isDisabled: boolean }[];
    prevMonth(): void;
    nextMonth(): void;
    selectDate(day: any): void;
    readonly hours: number[];
    readonly minutes: number[];
    selectHour(h: number): void;
    selectMinute(m: number): void;
    isSelectedHour(h: number): boolean;
    isSelectedMinute(m: number): boolean;
    reset(): void;
    dispatchTime(date: Date): void;
}

export default (): CalendarData => ({
    now: new Date(),
    userSelectedDate: null,
    isUserInteraction: false,
    intervalId: null,
    lastDispatchedMinute: null,

    // UI Visibility State
    showDatePicker: false,
    showTimePicker: false,

    // Calendar Navigation State
    viewDate: new Date(), // For browsing months without selecting

    init() {
        this.intervalId = window.setInterval(() => {
            this.tick();
        }, 1000);

        // Init viewDate
        this.viewDate = new Date();

        // Initial dispatch
        this.dispatchTime(this.now);
    },

    destroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    },

    tick() {
        // Update current time
        this.now = new Date();

        // If we are NOT interacting, viewDate follows real time to keep calendar fresh
        if (!this.userSelectedDate) {
            if (!this.showDatePicker) {
                this.viewDate = new Date(this.now);
            }

            // Dispatch time update if minute changed
            const currentMinute = this.now.getMinutes();
            if (this.lastDispatchedMinute !== currentMinute) {
                this.dispatchTime(this.now);
                this.lastDispatchedMinute = currentMinute;
            }
        }

        // Revert if selected time is passed
        if (this.userSelectedDate && this.userSelectedDate <= this.now) {
            this.reset();
        }
    },

    // --- Display Getters ---

    get displayDate(): string {
        const date = this.isUserInteraction && this.userSelectedDate ? this.userSelectedDate : this.now;
        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    },

    get displayTime(): string {
        const date = this.isUserInteraction && this.userSelectedDate ? this.userSelectedDate : this.now;
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    },

    // --- Calendar Logic ---

    get monthName(): string {
        return this.viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    },

    get days(): { date: number; fullDate: Date; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isDisabled: boolean }[] {
        const year = this.viewDate.getFullYear();
        const month = this.viewDate.getMonth(); // 0-indexed

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const daysInMonth = lastDayOfMonth.getDate();
        const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 (Sun) - 6 (Sat)

        const days = [];

        // Previous month padding
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            days.push({
                date: prevMonthLastDay - i,
                fullDate: new Date(year, month - 1, prevMonthLastDay - i),
                isCurrentMonth: false,
                isToday: false,
                isSelected: false,
                isDisabled: true // Disable browsing past months effectively for now, or just visuals
            });
        }

        // Current month
        const today = new Date();
        const selected = this.userSelectedDate;

        for (let i = 1; i <= daysInMonth; i++) {
            const current = new Date(year, month, i);
            const isToday = current.getDate() === today.getDate() &&
                current.getMonth() === today.getMonth() &&
                current.getFullYear() === today.getFullYear();

            const isSelected = selected ? (
                current.getDate() === selected.getDate() &&
                current.getMonth() === selected.getMonth() &&
                current.getFullYear() === selected.getFullYear()
            ) : false;

            // strict future check logic: actually we allow selecting "today" but time must be future.
            // So we technically disable PAST days.
            const isPast = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1) <= today;

            days.push({
                date: i,
                fullDate: current,
                isCurrentMonth: true,
                isToday: isToday,
                isSelected: isSelected,
                isDisabled: isPast
            });
        }

        // Next month padding to fill grid (6 rows * 7 cols = 42)
        const remaining = 42 - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push({
                date: i,
                fullDate: new Date(year, month + 1, i),
                isCurrentMonth: false,
                isToday: false,
                isSelected: false,
                isDisabled: false
            });
        }

        return days;
    },

    prevMonth() {
        this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() - 1, 1);
    },

    nextMonth() {
        this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 1);
    },

    selectDate(day: any) {
        if (day.isDisabled) return;

        this.isUserInteraction = true;
        let target = this.userSelectedDate ? new Date(this.userSelectedDate) : new Date(this.now);

        // Preserve time, set date
        target.setFullYear(day.fullDate.getFullYear());
        target.setMonth(day.fullDate.getMonth());
        target.setDate(day.fullDate.getDate());

        this.userSelectedDate = target;
        this.showDatePicker = false;
        this.dispatchTime(target);
    },

    // --- Time Logic ---

    get hours(): number[] {
        return Array.from({ length: 24 }, (_, i) => i);
    },

    get minutes(): number[] {
        return Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10... step 5 for cleaner UI
    },

    selectHour(h: number) {
        this.isUserInteraction = true;
        let target = this.userSelectedDate ? new Date(this.userSelectedDate) : new Date(this.now);
        target.setHours(h);
        this.userSelectedDate = target;
        this.dispatchTime(target);
    },

    selectMinute(m: number) {
        this.isUserInteraction = true;
        let target = this.userSelectedDate ? new Date(this.userSelectedDate) : new Date(this.now);
        target.setMinutes(m);
        this.userSelectedDate = target;
        this.showTimePicker = false;
        this.dispatchTime(target);
    },

    isSelectedHour(h: number): boolean {
        const date = this.userSelectedDate || this.now;
        return date.getHours() === h;
    },

    isSelectedMinute(m: number): boolean {
        const date = this.userSelectedDate || this.now;
        // Fuzzy match for 5-min steps
        return Math.abs(date.getMinutes() - m) < 5;
    },

    reset() {
        this.isUserInteraction = false;
        this.userSelectedDate = null;
        this.showDatePicker = false;
        this.showTimePicker = false;
        this.lastDispatchedMinute = null; // Force update on next tick or immediate
        this.dispatchTime(new Date());
    },

    dispatchTime(date: Date) {
        window.dispatchEvent(new CustomEvent('calendar-time-update', {
            detail: { date }
        }));
    }
})
