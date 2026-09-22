// Two ridges a person would pick on a map, not the highest cell in each row.
// The row-maximum jumps from the Tetons onto the southeast corner. These
// lines stay on one range each. There is no third range in this tile that
// runs the length of the view, so there is no middle guide.
export const TETON_FRAME = { west: -111, south: 43.55, east: -110.25, north: 43.95 };

export const TETON_GUIDES = {
  far: [
    { lat: 43.57, lon: -110.91 },
    { lat: 43.64, lon: -110.88 },
    { lat: 43.70, lon: -110.83 },
    { lat: 43.73, lon: -110.81 },
    { lat: 43.75, lon: -110.80 },
    { lat: 43.84, lon: -110.77 },
    { lat: 43.91, lon: -110.78 },
    { lat: 43.94, lon: -110.76 },
  ],
  near: [
    { lat: 43.62, lon: -110.31 },
    { lat: 43.67, lon: -110.30 },
    { lat: 43.71, lon: -110.37 },
    { lat: 43.75, lon: -110.28 },
    { lat: 43.87, lon: -110.35 },
    { lat: 43.93, lon: -110.32 },
  ],
};
