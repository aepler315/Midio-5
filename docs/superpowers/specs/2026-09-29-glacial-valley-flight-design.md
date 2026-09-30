# Glacial valley flight

## Approved intent
Create a gradual aerial discovery of a valley initially occupied by thick ice, inspired by the Pend Oreille River lobe. Keep the mountain scale of Range v2, remove the seekbar from the picture, improve clustered stars, restore reliable sea visibility, and reduce the distracting walking foreground. The user approved proceeding with this direction on September 29, 2026.

## Scope
One real Pend Oreille valley pilot, using the existing DEM pipeline and terrain renderer. The glacier is an artistic compressed interpretation of regional deglaciation, not a dated reconstruction. Source: Carrara, Kiver and Stradling (1996), https://www.usgs.gov/publications/southern-limit-cordilleran-ice-colville-and-pend-oreille-valleys-northeastern (southern limit near Newport, retreat toward Ione). Forest regrowth is an explicitly compressed later stage. Existing scenes retain their geography.

## Glacier
A terrain-aligned ice surface fills the valley with finite thickness and a north-south retreating terminus. It has a rounded cross section, blue crevasses, debris streaks, and a dark wet margin. Bedrock emerges as thickness decreases. Buried foliage is hidden; recovery follows local exposure. Existing hydro receivers remain level and are revealed when ice clears them. Ordinary scenes have no glacier displacement.

Retreat is monotonic in heard song time. Whole-song progress and integrated sustained energy shape its pacing; individual accents affect only bounded surface light/detail. No quiet passage or repeated chorus refreezes previously exposed land. Unknown duration yields a stable preview. Pause, seeking in either direction, export, quality and DPR cannot change the state at a given song time.

## Flight
Extend optional camera rails with independently curved eye and target paths, keeping existing straight rails compatible. Curves are bounded within the baked frustum corridor; validate them during authoring and approval. Keep world-up and gradual turns. Physical travel provides depth-dependent parallax rather than increasing screen shake. Protect visible summits and prevent terrain holes during the full route.

## Presentation
Restore ordinary ocean drawing in Range, with proper terrain occlusion. Inland pilot water remains inland lake/river water. Improve sky structure with dense faint points, correlated clusters, fractional brightness and coherent slow drift; replace blanket 80% star rejection with localized brightness attenuation. Restore granular galactic structure without large bright haze blobs. Preserve the luminous ridge's readability. Minimize glyph-like sky scatter where it competes with stars.

Hide the seekbar and remove its invisible pointer targets. Keep playback controls, beat tapping and debug data working. Reduce the walking stage's screen occupation and replace its hard horizontal edge with an irregular dark ledge; preserve character support physics and reflection registration.

## Runtime and acceptance
No new runtime dependencies. Respect existing residency ownership, quality subsets and context restoration. Asset build outputs include hashes and provenance. A candidate pilot can be accessed with `?rangeView=pend-oreille-valley`; only evidence-backed catalog approval enables normal matching.

Verify monotonic retreat, ice thickness, shoreline stability, buried-tree exclusion, unchanged ordinary views, curved-rail bounds, pause/seek repeatability and hidden seek hit targets. Render Trains at 150–159 seconds plus opening and closing samples. Inspect actual shader compilation and visual output; report hardware/FPS acceptance separately from software rendering. Keep the changes on a separate branch and open a reviewable PR; do not merge or deploy.
