// Per-biome physics personality: the five phenomena systems run the same
// mathematics everywhere, but each biome tunes their dials so places feel
// different, not just look different. All fields optional; omitted dials
// keep the system's global default.
//
//   cymaticModes: indices into CymaticField's MODES pool -- which Chladni
//                 figures this place is allowed to form
//   swarmBand:    [lo, hi] vertical band (fraction of canvas height) the
//                 Kuramoto motes drift toward
//   mandalaRate:  rotation-rate multiplier for the spirograph
//   ribbonScale:  size multiplier for the chaos ribbon
//   rdBias:       shifts the Gray-Scott regime sweep along the energy
//                 axis (positive -> waves-ward, negative -> mitosis-ward)
//   turbulence:   multiplier on the global wind field's gust strength
//                 (Atmosphere.js) -- omitted means 1 (the global default)
//   haze:         multiplier on the aerial-perspective depth wash
//                 (DepthHaze.js) -- omitted means 1 (the global default)
export const PERSONALITY = {
  TWILIGHT: { swarmBand: [0.15, 0.50], mandalaRate: 0.9 },
  EMBER: { rdBias: 0.25, ribbonScale: 1.15, swarmBand: [0.30, 0.60], turbulence: 1.15, haze: 1.35 },
  ARCTIC: { swarmBand: [0.04, 0.22], mandalaRate: 0.65, cymaticModes: [3, 5, 7], turbulence: 1.4, haze: 0.65 }, // motes ride at aurora height, figures stay hexagonal-fine; a blizzard wind, but proverbially long, clear sightlines
  JADE: { swarmBand: [0.25, 0.60], mandalaRate: 0.8, haze: 1.15 },
  VOID: { ribbonScale: 1.5, cymaticModes: [4, 6, 7], mandalaRate: 1.15, turbulence: 1.2, haze: 0.85 }, // chaos temple: the attractor looms
  SAKURA: { swarmBand: [0.20, 0.55], mandalaRate: 0.75, rdBias: -0.1, turbulence: 0.65, haze: 1.2 }, // a gentle breeze for the petals, a soft misty lift
  SOLAR: { rdBias: 0.15, ribbonScale: 1.1, mandalaRate: 1.2, turbulence: 0.85, haze: 1.6 }, // desert heat bakes the horizon
  CYBER: { cymaticModes: [1, 4, 6], ribbonScale: 1.2, swarmBand: [0.35, 0.60], mandalaRate: 1.1, turbulence: 0.4, haze: 0.3 }, // still, filtered air -- crisp sightlines
  STORM: { ribbonScale: 1.3, rdBias: 0.2, swarmBand: [0.10, 0.35], mandalaRate: 1.05, turbulence: 1.8, haze: 1.4 }, // rain thickens the air
  MIRROR: { haze: 1.1 }, // lake-morning mist
};
