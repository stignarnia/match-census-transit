export interface PeopleData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export default (): PeopleData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Population density'],

    init() {
        // Init logic if needed
    },

    select(option: string) {
        this.selected = option;

        // Dispatch event for main.ts to pick up
        window.dispatchEvent(new CustomEvent('people-selection-change', {
            detail: { selection: option }
        }));
    }
});
