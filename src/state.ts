export const appState = {
    firstSelection: null as string | null,
    secondSelection: null as string | null,
    firstSelectionCentroid: null as { lat: number; lng: number } | null,
    secondSelectionCentroid: null as { lat: number; lng: number } | null,
    latestCalendarTime: new Date(),
    currentFillColorExpression: null as any // Holds the active fill color logic (default or density)
};
