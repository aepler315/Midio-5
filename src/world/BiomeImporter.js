export class BiomeImporter {
  async handleDrop(e, conductor, paramBus) {
    e.preventDefault(); // crucial for drag to work
    const file = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (!file || !file.name.endsWith('.mid')) {
      console.warn('Not a MIDI file');
      return;
    }
    console.log('📥 MIDI file detected — loading original + custom biome...');
    const events = await window.MidiAdapter.parse(file); // your original working parser
    conductor.injectTimelineSlice(events); // restore original MIDI load
    const custom = this.generateBiome(events);
    paramBus.set('customBiomes', [...(paramBus.get('customBiomes') || []), custom]);
    console.log('✅ MIDI loaded + custom biome created successfully!');
  }
  generateBiome(events) {
    return {
      id: 'custom-' + Date.now(),
      name: 'Your MIDI Biome',
      energyCurve: 0.8,
      parallaxLayers: 6,
      fractureThreshold: 0.65,
      colorPalette: ['#ffaa00', '#00ffcc', '#aa00ff']
    };
  }
}
export default new BiomeImporter();
