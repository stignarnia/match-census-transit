import type { ExpressionSpecification } from 'mapbox-gl';

interface AppState {
    firstSelection: string | null;
    secondSelection: string | null;
    firstSelectionCentroid: { lat: number; lng: number } | null;
    secondSelectionCentroid: { lat: number; lng: number } | null;
    firstSelectionProperties: any | null;
    secondSelectionProperties: any | null;
    latestCalendarTime: Date;
    currentFillColorExpression: ExpressionSpecification | string | null;
}

export const appState: AppState = {
    firstSelection: null,
    secondSelection: null,
    firstSelectionCentroid: null,
    secondSelectionCentroid: null,
    firstSelectionProperties: null,
    secondSelectionProperties: null,
    latestCalendarTime: new Date(),
    currentFillColorExpression: null, // Holds the active fill color logic (default or density)
};
