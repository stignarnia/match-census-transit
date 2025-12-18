export interface PlacesData {
    selected: string;
    options: string[];
    select(option: string): void;
    init(): void;
}

export default (): PlacesData => ({
    selected: 'Nothing',
    options: ['Nothing', 'Hospitals', 'Schools'],

    init() {
        // Placeholder for future initialization logic
    },

    select(option: string) {
        this.selected = option;

        switch (option) {
            case 'Nothing':
                // Do nothing for now
                break;
            case 'Hospitals':
                // Do nothing for now
                break;
            case 'Schools':
                // Do nothing for now
                break;
            default:
                break;
        }
    }
});
