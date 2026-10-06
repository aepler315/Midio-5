import { createHash } from 'node:crypto';

export const fileHash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function defineAdapterProfile({ sourceSha, expectedHashes, patches }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Invalid adapter source SHA');
  for (const patch of patches) {
    if (!patch.anchor || !Number.isInteger(patch.count) || patch.count < 1) throw new Error('Adapter patch requires a nonempty exact anchor and count');
    if (!expectedHashes[patch.path]) throw new Error(`Adapter patch has no pinned source hash: ${patch.path}`);
  }
  return { sourceSha, expectedHashes, patches };
}

/** Only audited immutable SHAs may select compatibility patches. */
export function adaptVersion({ sourceSha, files, checkpointId, siteRootRelative = '../../', profiles = historicalProfiles, liveId = 'natural-valley' }) {
  const profile = profiles.get(sourceSha);
  if (!profile) throw new Error(`No audited adapter for source SHA ${sourceSha}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(checkpointId)) throw new Error('Invalid checkpoint id');
  if (siteRootRelative !== '../../' && siteRootRelative !== './') throw new Error('Invalid trusted site root');
  const output = new Map(files);
  const transformations = [];
  for (const [name, expected] of Object.entries(profile.expectedHashes)) {
    if (!output.has(name) || fileHash(output.get(name)) !== expected) throw new Error(`Pinned adapter source hash mismatch: ${sourceSha}:${name}`);
  }
  const replace = (patch) => {
    const before = output.get(patch.path);
    if (!before) throw new Error(`Missing adapter file ${patch.path}`);
    const original = before.toString('utf8');
    const count = original.split(patch.anchor).length - 1;
    if (count !== patch.count) throw new Error(`Adapter anchor mismatch: ${patch.name} expected ${patch.count}, got ${count}`);
    const replacement = typeof patch.replacement === 'function' ? patch.replacement({ checkpointId, siteRootRelative }) : patch.replacement;
    const after = Buffer.from(original.split(patch.anchor).join(replacement));
    output.set(patch.path, after);
    transformations.push({ path:patch.path, name:patch.name, count, sourceHash:fileHash(before), outputHash:fileHash(after) });
  };
  for (const patch of profile.patches) replace(patch);
  const html = output.get('index.html')?.toString('utf8');
  if (!html) throw new Error('Historical index.html is missing');
  const anchor = html.includes('</body>') ? '</body>' : null;
  if (!anchor) throw new Error('Historical index.html has no exact closing body anchor');
  const metadata = JSON.stringify({ currentId:checkpointId, liveId, siteRootRelative });
  replace({ path:'index.html',name:'trusted navigation bootstrap',anchor,count:1,replacement:`<link rel="stylesheet" href="./src/ui/version-navigation.css">\n<script id="midio-version-metadata" type="application/json">${metadata}</script>\n<script type="module" src="./src/ui/VersionBootstrap.js"></script>\n${anchor}` });
  return { files:output, transformations };
}

// Exact-SHA compatibility profiles. Original sources were audited in Git;
// hooks only add session/HUD navigation and isolate archived persistence.
const AUDITED_PROFILES = [
  {
    "sourceSha": "bbe0afcae722c59c774b5c7396b55cfa4342c616",
    "expectedHashes": {
      "index.html": "444214f1c31f8e6e121bc0df5a28d92c25551b81584f1ad22e3fd52f2f59ef77",
      "src/main.js": "ce2697aff6f5990f517db3cf8768701517421f2ff5f1629dccf56475b01def70",
      "src/ui/style.css": "a491c07b3e311e5c8c4f78f48d6125818939c284a190951dde1818143e7658c5",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "5a456d1900c78ddd9cda0532c28e101e73593a4131e88c0a84add9c04e07dfd6",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/net/JamendoSource.js": "a06348ef8de9e07b3260639a4f68ccf5a96145a5f9870f871a6fc973eaaa43c1",
      "src/soulseek/SoulseekSearch.js": "331780c3a931ef9d299df2c5a9a3638382185a2dc0d65df5ab11f7637c047494"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "    if (recalibration.active) endRecalibration(); else startRecalibration();\n  });\n}\n// Set per load path (true only for raw decoded audio, which already has\n// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n// (OpeningAnalysis.js), while it is still running; null otherwise.\nlet fullAnalysisPending = null;\n",
        "replacement": "    if (recalibration.active) endRecalibration(); else startRecalibration();\n  });\n}\n// Set per load path (true only for raw decoded audio, which already has\n// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\nlet versionSelectionGeneration = 0;\nconst sourceSelection = {\n  current: null,\n  begin() { this.current = {}; return this.current; },\n  isCurrent(selection) { return selection === this.current; },\n  cancel() { this.current = null; },\n};\nfunction claimSelection() {\n  const selection = sourceSelection.begin();\n  versionSelectionGeneration++;\n  versionSelectionChanged(selection);\n  return selection;\n}\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n// (OpeningAnalysis.js), while it is still running; null otherwise.\nlet fullAnalysisPending = null;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later.\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  sourceSelection.cancel();\n  versionSelectionGeneration++;\n  versionClearSource();\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later.\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) data.songIdentity = { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null };\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) data.songIdentity = { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null };\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "      return;\n    }\n    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\n",
        "replacement": "      return;\n    }\n    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    if (extra.restoreIntent) { showErrorBanner(err?.message || String(err)); return; }\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "    console.warn('[lyrics] lyrics resolution failed, continuing without it', err);\n    return { identity, lyricSections: null, syncedLyrics: null };\n  }\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  // Abort the previous decode/analysis before claiming the new generation.\n",
        "replacement": "    console.warn('[lyrics] lyrics resolution failed, continuing without it', err);\n    return { identity, lyricSections: null, syncedLyrics: null };\n  }\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { restoreIntent = null } = {}) {\n  const selection = claimSelection();\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  // Abort the previous decode/analysis before claiming the new generation.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "  // another expensive phase after a replacement selection.\n  loadAudioFiles._abortController?.abort();\n  const abortController = new AbortController();\n  loadAudioFiles._abortController = abortController;\n  const { signal } = abortController;\n  // Claim the load before the first await. Otherwise an older picker/drop\n  // stalled in bootAudio() can wake up later and overwrite the newer choice.\n  const myGen = ++loadGen;\n  const isStale = () => signal.aborted || myGen !== loadGen;\n  stopTimeline();\n  stopTitleBackdrop();\n  loadShow?.stop();\n  pendingWorldStart = null;\n  hudEl.classList.add('hidden');\n  // Freeze learned settings for both cache identity and the analysis itself.\n  const analysisGroove = new GrooveFingerprint(groove.toJSON());\n  showProgress('Reading file\u2026');\n",
        "replacement": "  // another expensive phase after a replacement selection.\n  loadAudioFiles._abortController?.abort();\n  const abortController = new AbortController();\n  loadAudioFiles._abortController = abortController;\n  const { signal } = abortController;\n  // Claim the load before the first await. Otherwise an older picker/drop\n  // stalled in bootAudio() can wake up later and overwrite the newer choice.\n  const myGen = ++loadGen;\n  const isStale = () => signal.aborted || myGen !== loadGen || !sourceSelection.isCurrent(selection);\n  stopTimeline();\n  stopTitleBackdrop();\n  loadShow?.stop();\n  pendingWorldStart = null;\n  hudEl.classList.add('hidden');\n  // Freeze learned settings for both cache identity and the analysis itself.\n  const analysisGroove = new GrooveFingerprint(groove.toJSON());\n  showProgress('Reading file\u2026');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "    rememberCustomBiome(paramBus, data.customBiome);\n    // Raw audio already has every voice baked into the decoded buffer \u2014\n    // stacking the synth's pseudo-onset voicing on top is the unwanted\n    // synthetic hi-hat/click layer, so the timeline synth stays silent here.\n    muteTimelineSynth = true;\n    lastSongName = selectedFiles[0].name || 'song';\n    lastAudioBuffer = audioBuffer;\n    fontRecommender?.clear(); // the recording is its own sound source\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    rememberCustomBiome(paramBus, data.customBiome);\n    // Raw audio already has every voice baked into the decoded buffer \u2014\n    // stacking the synth's pseudo-onset voicing on top is the unwanted\n    // synthetic hi-hat/click layer, so the timeline synth stays silent here.\n    muteTimelineSynth = true;\n    lastSongName = selectedFiles[0].name || 'song';\n    lastAudioBuffer = audioBuffer;\n    fontRecommender?.clear(); // the recording is its own sound source\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  if (!file) return;\n  handleFiles([file]);\n}\n\n/** One file plays as itself. Several files dropped together are stems of one\n *  song (their filenames cast the characters). The built-in sample is a\n *  second door into the same chooser. */\nfunction handleFiles(files) {\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n",
        "replacement": "  if (!file) return;\n  handleFiles([file]);\n}\n\n/** One file plays as itself. Several files dropped together are stems of one\n *  song (their filenames cast the characters). The built-in sample is a\n *  second door into the same chooser. */\nfunction handleFiles(files) {\n  claimSelection();\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text) versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  if (!urlLoadAbort) return;\n  urlLoadAbort.abort();\n  urlLoadAbort = null;\n  setUrlLoadBusy(false);\n}\n\n/** Starts a fresh URL operation, superseding any still in flight. */\nfunction beginUrlLoadOperation() {\n  urlLoadAbort?.abort();\n  urlLoadAbort = new AbortController();\n  setUrlLoadBusy(true);\n  return urlLoadAbort.signal;\n}\n\nfunction endUrlLoadOperation(signal) {\n  if (urlLoadAbort?.signal === signal) {\n",
        "replacement": "  if (!urlLoadAbort) return;\n  urlLoadAbort.abort();\n  urlLoadAbort = null;\n  setUrlLoadBusy(false);\n}\n\n/** Starts a fresh URL operation, superseding any still in flight. */\nfunction beginUrlLoadOperation() {\n  claimSelection();\n  urlLoadAbort?.abort();\n  urlLoadAbort = new AbortController();\n  setUrlLoadBusy(true);\n  return urlLoadAbort.signal;\n}\n\nfunction endUrlLoadOperation(signal) {\n  if (urlLoadAbort?.signal === signal) {\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "/** Opens whatever the address turns out to be: a song, or a folder to browse. */\nasync function openUrlTarget(raw) {\n  const signal = beginUrlLoadOperation();\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "/** Opens whatever the address turns out to be: a song, or a folder to browse. */\nasync function openUrlTarget(raw) {\n  const signal = beginUrlLoadOperation();\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  cancelUrlLoad(); // the sample is a choice too, and outranks an older fetch\n  try {\n    await bootAudio();\n  } catch (err) {\n    showErrorBanner(err?.message || 'Audio is blocked. Click the page, then try again.');\n    return;\n  }\n  muteTimelineSynth = false;\n  lastAudioBuffer = null;\n  lastSongName = 'Proof';\n  fontRecommender?.clear();\n  const song = buildDemoSong();\n  const energyCurves = synthesizeEnergyCurves(song.timeline, song.durationMs);\n  const barMs = (60000 / song.bpm) * 4;\n  const boundariesMs = song.sections.map((s) => s.bar0 * barMs);\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  const selection = claimSelection();\n  cancelUrlLoad(); // the sample is a choice too, and outranks an older fetch\n  try {\n    await bootAudio();\n  } catch (err) {\n    showErrorBanner(err?.message || 'Audio is blocked. Click the page, then try again.');\n    return;\n  }\n  if (!sourceSelection.isCurrent(selection)) return;\n  muteTimelineSynth = false;\n  lastAudioBuffer = null;\n  lastSongName = 'Proof';\n  fontRecommender?.clear();\n  const song = buildDemoSong();\n  const energyCurves = synthesizeEnergyCurves(song.timeline, song.durationMs);\n  const barMs = (60000 / song.bpm) * 4;\n  const boundariesMs = song.sections.map((s) => s.bar0 * barMs);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = (renderer.canvasRenderer || renderer).composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = (renderer.canvasRenderer || renderer).composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 20",
        "anchor": "// The keys a player unfamiliar with the autoplay premise reaches for\n// expecting direct control -- see the keydown handler below.\nconst INERT_KEYS = new Set([\n  ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',\n  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  if (e.defaultPrevented) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n",
        "replacement": "// The keys a player unfamiliar with the autoplay premise reaches for\n// expecting direct control -- see the keydown handler below.\nconst INERT_KEYS = new Set([\n  ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',\n  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  if (e.target?.closest?.('[data-version-navigation]')) return;\n  if (e.defaultPrevented) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 21",
        "anchor": "  autoTagAbort = null;\n}\n\n/** Turn a stored track back into the drop that the whole load path already\n *  understands, so a library play and a dropped file are the same thing\n *  from here on. */\nasync function playLibraryTrack(track) {\n  if (!track) return;\n  unlockAudio();\n  // A remembered library with no live handle: one click gets it back rather\n  // than making the player hunt for the folder button.\n  if (!musicLibrary.playable && musicLibrary.root?.handle) {\n    if (!await musicLibrary.grantAccess()) {\n      showErrorBanner('Allow access to your music folder to play from the library.');\n      return;\n    }\n  }\n  const file = await musicLibrary.openFile(track);\n  if (!file) {\n    showErrorBanner(musicLibrary.playable\n      ? `\u201c${displayTitle(track)}\u201d isn\u2019t where the library remembers it. Rescan the folder to catch up.`\n      : 'Pick your music folder again to play from the library.');\n    return;\n  }\n  playingFromLibrary = track;\n  // The scan keeps running: playing the first track you recognise is the\n",
        "replacement": "  autoTagAbort = null;\n}\n\n/** Turn a stored track back into the drop that the whole load path already\n *  understands, so a library play and a dropped file are the same thing\n *  from here on. */\nasync function playLibraryTrack(track) {\n  if (!track) return;\n  const selection = claimSelection();\n  unlockAudio();\n  // A remembered library with no live handle: one click gets it back rather\n  // than making the player hunt for the folder button.\n  if (!musicLibrary.playable && musicLibrary.root?.handle) {\n    const granted = await musicLibrary.grantAccess();\n    if (!sourceSelection.isCurrent(selection)) return;\n    if (!granted) {\n      showErrorBanner('Allow access to your music folder to play from the library.');\n      return;\n    }\n  }\n  const file = await musicLibrary.openFile(track);\n  if (!sourceSelection.isCurrent(selection)) return;\n  if (!file) {\n    showErrorBanner(musicLibrary.playable\n      ? `\u201c${displayTitle(track)}\u201d isn\u2019t where the library remembers it. Rescan the folder to catch up.`\n      : 'Pick your music folder again to play from the library.');\n    return;\n  }\n  playingFromLibrary = track;\n  // The scan keeps running: playing the first track you recognise is the\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 22",
        "anchor": "  pendingExportPresetId = presetId;\n  setExportNote('Recording\u2026 the song is replaying in real time. It saves itself when it finishes.');\n  // Same seed, so the file is the show that was just watched and not a\n  // different roll of the same song.\n  replaySong({ songSeed: lastSongSeed });\n});\n\nsyncRecordUI();\n",
        "replacement": "  pendingExportPresetId = presetId;\n  setExportNote('Recording\u2026 the song is replaying in real time. It saves itself when it finishes.');\n  // Same seed, so the file is the show that was just watched and not a\n  // different roll of the same song.\n  replaySong({ songSeed: lastSongSeed });\n});\n\nsyncRecordUI();\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: versionSelectionGeneration, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: rangeMode.forcedViewId || null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId && restoreIntent.rangeViewId !== rangeMode.forcedViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/net/JamendoSource.js",
        "name": "isolate archive persistent store smw:jamendoClientId",
        "anchor": "'smw:jamendoClientId'",
        "replacement": "'smw:jamendoClientId:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/soulseek/SoulseekSearch.js",
        "name": "isolate archive persistent store midio.soulseek.config",
        "anchor": "'midio.soulseek.config'",
        "replacement": "'midio.soulseek.config:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "7383b3b34c4f5e1f3cf062fb6078178aaa24a0b6",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "1178c6ff3545e9522bce4d5ca81132ec232f1c5d88b6de7a2865c45f011bd3e8",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "70c9cb8f8fa1aae40a51060b1d2f132af9ee5ca4",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "11f0eeec93d3db3393ac7e02f61380c9221c6bf50de94115da18815949631c2d",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "316e50ea1db66c185d194f511a8a1cc62bb7a936",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "be8d0c4c0bd33e3839ba2a8b6f154a9e38e0ebef",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "7557f85bae8e4f7d61f5fd9d8d628d52c052565c",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "4c61f72d4cb782822fcabf5d2b1c8e785cc13e16",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  },
  {
    "sourceSha": "a901332676557d33536d2cbbd1e1a4da9de4a4ca",
    "expectedHashes": {
      "index.html": "08ddc508d1da356ff9c316b7e61467b681d148937998a82e45aa0fa5948f6874",
      "src/main.js": "95e4f887a54bb91e19ee804ee5798dafa37e7f388eab85997cbc63c22fb668d9",
      "src/ui/style.css": "cd47437e1a6cb8a4cb3a3cd13fc55a152feeec5bc69f87953074ee9fdd58bf14",
      "src/audio/AnalysisCache.js": "147405df096e4c71d4d4dfc6e13b5c6d343a8367ff86455838736d22f55b1aed",
      "src/library/LibraryDB.js": "aa5e819e35c2cc3ab70d035deeb0b5474ffb31198cdc9ca7bf0789cf2a92f7cd",
      "src/ui/Accessibility.js": "6dfc8e357cef1f328f28708f0551bd9bfa288610319195a78bfaf168a1d8c17d",
      "src/ui/TitleWorldChoice.js": "3c8424678d5ac1e9c27b3a4b8503b6a1a01731c555bc9a3fb7974e026b3e6ff9",
      "src/ui/LibraryPanel.js": "ec276facbd5256fecfed46d8d46aed682dd23c6acf705d0f3d16674c4e767910",
      "src/ui/FileChooserProbe.js": "b44c3a81d1f18a06e19e6859baab31399f723463a87d76ab7677e918163b8e52",
      "src/world/terrain/RangeHistory.js": "8b268601752284ef8f77fe7bd01349fbd1e76ae16bc2043b0cae63f773499135",
      "src/world/dna/PaletteSynth.js": "42f83172f6a97b7d407378378a3a187f576d45f744fc4714a374b4cff17a92d2",
      "src/vision/config.js": "75cb346c976b220d2652cae068a1af04727d16e8917ac32a174a4116c17312df",
      "src/lyrics/LyricsClient.js": "f4f65b131e07d0b23c76ce79057712b3495e4e03cdd6b5c40c7d061f35a98e8d",
      "src/render/DisplayProfile.js": "4c89db06408a34154d869654e44becaec787e51e652852172e556595e22c13f2",
      "src/ui/SceneChoice.js": "d933cb55cfb3a849b7ca286f33bbccdd4cef6c8358b7bf516e5aea9d3771a4cb"
    },
    "patches": [
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 1",
        "anchor": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "replacement": "const errorBannerCloseEl = document.getElementById('errorBannerClose');\nlet errorBannerTimer = null;\n/** The one user-facing failure surface for this whole app -- replaces the\n *  five native alert() calls that used to dump raw exception text into a\n *  browser dialog. Auto-dismisses after a while but stays reachable via\n *  the close button; a second failure just restarts the timer/text rather\n *  than stacking banners. */\nfunction showErrorBanner(message) {\n  if (typeof versionLoadFailed === 'function') versionLoadFailed(message);\n  if (!errorBannerEl || !errorBannerTextEl) { window.alert(message); return; } // defensive: markup missing\n  errorBannerTextEl.textContent = message;\n  errorBannerEl.classList.remove('hidden');\n  clearTimeout(errorBannerTimer);\n  errorBannerTimer = setTimeout(() => errorBannerEl.classList.add('hidden'), 9000);\n}\nerrorBannerCloseEl?.addEventListener('click', () => {\n  clearTimeout(errorBannerTimer);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 2",
        "anchor": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "replacement": "// every voice baked into the buffer) and read by applySynthMutePolicy().\nlet muteTimelineSynth = false;\nlet loadShow = null; // percussion loading show, created in bootAudio\nlet loadGen = 0;     // a newer load cancels a stale audition gate's start\n// The recording the player chose most recently (SourceSelection.js). Every\n// public way of choosing a song claims one synchronously, in the gesture;\n// asynchronous work publishes only while its selection is still current.\nconst sourceSelection = new SourceSelection();\nlet versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\nconst versionListeners = new Set();\nlet versionNotifyTimer = null;\n\nfunction versionEmit() {\n  for (const listener of versionListeners) listener(versionAdapterState());\n}\n\nfunction versionSelectionChanged(selection) {\n  versionSession.reject?.(new Error('The selected song has changed.'));\n  let resolve, reject;\n  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });\n  // Ordinary player loads have no consumer; still retain rejection for adapter callers.\n  completion.catch(() => {});\n  versionSession = { phase: 'loading', sourceId: null, source: null, selection, completion, resolve, reject };\n  versionEmit();\n}\n\nfunction versionLoadFailed(message) {\n  if (versionSession.phase !== 'loading') return;\n  const error = new Error(String(message));\n  if (/audio.*(blocked|start)|blocked.*audio/i.test(error.message)) error.code = 'AUDIO_GESTURE_REQUIRED';\n  versionSession.phase = 'error';\n  versionSession.reject?.(error);\n  versionEmit();\n}\n\nfunction versionClearSource() {\n  versionSession.reject?.(new Error('The song was stopped.'));\n  versionSession = { phase: 'title', sourceId: null, source: null, selection: null, completion: null };\n  versionEmit();\n}\n\nfunction versionSourceStarted(selection, source, restoreIntent = null) {\n  if (!sourceSelection.isCurrent(selection) || versionSession.selection !== selection) return;\n  versionSession.phase = source ? 'ready' : 'error';\n  versionSession.heldPositionMs = restoreIntent ? Math.max(0, Math.min(Number(restoreIntent.positionMs) || 0, Math.max(0, (conductor?.durationMs || 0) - 1))) : null;\n  versionSession.source = source || null;\n  versionSession.sourceId = source ? (versionSession.restoreSourceId || crypto.randomUUID()) : null;\n  versionSession.resolve?.(versionAdapterState());\n  versionSession.resolve = versionSession.reject = null;\n  versionEmit();\n}\n\n/** A player chose a song: abort the previous choice and start a new load\n *  generation. Only public actions call this -- code that finishes work for\n *  a selection passes that selection on instead of claiming a newer one. */\nfunction claimSelection(opts) {\n  const selection = sourceSelection.begin(opts);\n  loadGen++;\n  if (typeof versionSelectionChanged === 'function') versionSelectionChanged(selection);\n  return selection;\n}\n\n// Retained so \"Replay seed\" can restart the same song without a page reload\n// (sim is fully seeded + autoplay-driven). `lastAudioBuffer` is only set on\n// the raw-audio-file path (MIDI/demo regenerate sound from the timeline).\nlet lastTimelineData = null;\n// The whole-song analysis of a song started on its opening\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 3",
        "anchor": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  if (paused) audioEngine.ctx.suspend();\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "replacement": "/** Suspends/resumes the AudioContext itself -- since every clock in the\n *  sim (jump timing, note dispatch, ChoreoClock) reads straight off\n *  ctx.currentTime, freezing the context freezes the whole performance\n *  in place with nothing extra to track, and resuming picks up exactly\n *  where it left off. */\nfunction togglePause() {\n  if (!running || !sim || !audioEngine) return;\n  paused = !paused;\n  versionSession.heldPositionMs = null;\n  if (paused) audioEngine.ctx.suspend().then(() => {\n    if (paused) versionSession.heldPositionMs = Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n  });\n  else { audioEngine.ctx.resume(); lastRafMs = null; }\n  updatePauseButtonUI();\n}\n\n/** Leave the native top layer on every teardown path, not just hide its pixels. */\nfunction closeWorldChooser() {\n  if (worldSelectEl?.open) worldSelectEl.close();\n  worldSelectEl?.classList.add('hidden');\n}\n\n/** Back to the title/drop screen so a different song can be chosen. */\nfunction backToTitle() {\n  // Any in-flight analysis belongs to the discarded song. Its progress or\n  // failure must not redraw this title screen later, and its work stops.\n  sourceSelection.cancel();\n  loadGen++;\n  versionClearSource();\n  stopTimeline();\n  completePanelEl.classList.add('hidden');\n  hudEl.classList.add('hidden');\n  closeWorldChooser();\n  stopWorldPreview();\n  pendingWorldStart = null;\n  progressEl.classList.add('hidden');\n  loaderEl.classList.remove('hidden');\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 4",
        "anchor": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "replacement": "      structure: data.structure,\n      timeline: data.timeline,\n      barGrid: data.barGrid,\n    }));\n    const features = profile.watch;\n    const autoSeed = Number.isFinite(identity?.seed)\n      ? identity.seed >>> 0\n      : resolveSongSeed({ timeline: data.timeline, durationMs: data.durationMs }, null);\n    const pinnedSeed = extra.restoreIntent?.seed ?? readPinnedSeed();\n    const seed = pinnedSeed != null && Number.isFinite(pinnedSeed) ? pinnedSeed >>> 0 : autoSeed;\n    if (!identity) offerIdentity(data, { seed: autoSeed, songProfile: profile, customBiome: data.customBiome || null });\n    pendingWorldStart = { data, extra, features, seed, profile };\n    // The song's real mountain range (RangeLibrary): matched and loaded in\n    // the background while the picker is up. One small module, normally\n    // ready long before a card is clicked. Kept on the song's data so it\n    // survives the rebuilds a song goes through (seek, replay, export).\n    const pendingForRange = pendingWorldStart;\n    // The player's range/biome pick as it stands now; replays keep it.\n    pendingForRange.data.sceneChoice = { ...sceneChoice };\n    pendingForRange.terrainReady = prepareSongTerrain(profile, seed, undefined, { biome: sceneChoice.biome }).then((terrain) => {\n      pendingForRange.data.terrain = terrain;\n      return terrain;\n    });\n    if (extra.restoreIntent) {\n      const mine = pendingWorldStart;\n      const generation = loadGen;\n      const isCurrent = () => generation === loadGen && (!extra.versionSelection || sourceSelection.isCurrent(extra.versionSelection));\n      mine.terrainReady.then(() => {\n        if (pendingWorldStart !== mine || !isCurrent()) return;\n        confirmWorld(versionRestoreWorldId(mine, extra.restoreIntent));\n      }).catch(err => { if (isCurrent()) showErrorBanner(err?.message || String(err)); });\n      return;\n    }\n    lastFitDiagnostic = recordFitDiagnostic(features, profile);\n    if (!ALL_WORLDS) {\n      // One world: start in it. The home biome's ranges have to be there\n      // first -- there is no picker to cover the load -- and an export waits\n      // for every biome, so its frames never depend on load timing.\n      const mine = pendingWorldStart;\n      const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n      const ready = mine.terrainReady.then((t) => (exporting && t?.whenAll ? t.whenAll.then(() => t) : t));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 5",
        "anchor": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "replacement": "    const hasLabels = Array.isArray(data.structure?.labels) && data.structure.labels.length > 1;\n    renderWorldGrid(null, features, { hasLabels });\n    worldSelectEl?.classList.remove('hidden');\n    if (worldSelectEl && !worldSelectEl.open) worldSelectEl.showModal();\n    startChooserPreviews();\n  } catch (err) {\n    // The grid is a convenience; analysis failing must still start a song.\n    console.error('[world chooser]', err);\n    if (extra.restoreIntent) { showErrorBanner('This version could not restore the selected song world: ' + (err?.message || err)); return; }\n    pendingWorldStart = { data, extra };\n    lastFitDiagnostic = null;\n    confirmWorld(data.worldId || lastWorldId || DEFAULT_WORLD_ID);\n  }\n}\n\nfunction startChooserPreviews() {\n  stopWorldPreview();\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 6",
        "anchor": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id);\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id);\n}\n\nfunction startConfirmedWorld(pending, id) {\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, 0);\n  }\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "replacement": "  pendingWorldStart = null;\n  if (!pending) return;\n  const lyricsReady = pending.extra?.lyricsReady;\n  if (lyricsReady && !lyricsReady.settled) {\n    const gen = loadGen;\n    Promise.race([lyricsReady, new Promise((r) => setTimeout(r, LYRICS_START_WAIT_MS))]).then(() => {\n      // A newer song chosen while waiting wins.\n      if (gen !== loadGen) return;\n      startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n    });\n    return;\n  }\n  startConfirmedWorld(pending, id).catch(err => showErrorBanner(err?.message || String(err)));\n}\n\nfunction versionRestoreWorldId(pending, restoreIntent) {\n  const requested = restoreIntent.worldId;\n  if (requested !== 'custom') {\n    if (requested && !listWorlds().some(world => world.id === requested)) throw new Error('This version cannot restore the selected world.');\n    return requested || pending.data.worldId || lastWorldId || DEFAULT_WORLD_ID;\n  }\n  const baseId = restoreIntent.settings?.worldBaseId;\n  if (!baseId || !listWorlds().some(world => world.id === baseId)) throw new Error('This version cannot restore the selected song world.');\n  const { world } = buildWorldVariant(baseId, pending.features, { ...pending.data, profile: pending.profile });\n  if (world?.id !== 'custom' || (world.registeredId || world.baseId) !== baseId) throw new Error('This version could not regenerate the selected song world.');\n  setCustomWorld(world);\n  return world.id;\n}\n\nasync function startConfirmedWorld(pending, id) {\n  const selection = pending.extra?.versionSelection;\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  id = resolveWorldId(id);\n  stopWorldPreview();\n  lastWorldId = id;\n  pending.data.worldId = id;\n  closeWorldChooser();\n  // World select can sit for a while; a suspended context would start a\n  // silent, frozen first frame that reads as \"upload did nothing.\"\n  // Bulk export keeps the context suspended: the file's audio is the\n  // source track, muxed later, and a live play would fight the stepped clock.\n  const extra = { ...(pending.extra || {}) };\n  if (pending.seed != null && extra.songSeed === undefined) extra.songSeed = pending.seed;\n  const exporting = !!(extra.exportMode || readBulkExportFromUrl());\n  const restore = extra.restoreIntent;\n  if (restore) {\n    await audioEngine.ctx.suspend();\n    if (selection && !sourceSelection.isCurrent(selection)) return;\n    extra.songSeed = restore.seed;\n    extra.startAtMs = Math.max(0, Math.min(Number(restore.positionMs) || 0, Math.max(0, pending.data.durationMs - 1)));\n    extra.startAtWallMs = 0;\n    extra.preservePause = true;\n    extra.restorePaused = true;\n  } else if (!exporting) audioEngine?.resume?.();\n  // A recording already has every voice. The timeline synth (oscillator\n  // \"keyboard\" tones + hat/kick clicks) must not sit on top of it.\n  if (extra.playBuffer) muteTimelineSynth = true;\n  startTimeline(pending.data, extra);\n  if (running) canvas.focus({ preventScroll: true });\n  if (extra.playBuffer) {\n    lastAudioBuffer = extra.playBuffer;\n    if (!exporting) audioEngine.playBuffer(extra.playBuffer, (extra.startAtMs || 0) / 1000);\n  }\n  if (restore && running && sim) {\n    const generation = loadGen;\n    // A paused frame cannot advance the renderer's asynchronous preparation.\n    // Wait for this version's own presentation, then paint it at the held\n    // transport offset before advertising readiness to the navigator.\n    try {\n      if (rangePresentation) await rangePresentation.whenReady();\n    } catch (error) {\n      if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection))) return;\n      throw error;\n    }\n    if (generation !== loadGen || (selection && !sourceSelection.isCurrent(selection)) || !running || !sim) return;\n    renderer.draw(sim, 1);\n  }\n  if (selection && running && sim) versionSourceStarted(selection, extra.versionSource, restore);\n}\n\n/** Name the real ranges behind The Range (RangeCaption.js): one caption per\n *  biome the song travels through, or one for the song's single range. */\nfunction applyRangeCaptions(timelineData, exportMode) {\n  const terrain = timelineData.terrain || null;\n  const kind = getWorld(sim.worldId)?.kind;\n  const lengthOf = (p) => (p?.spacingM > 0 && p.angles?.length > 1 ? p.spacingM * (p.angles.length - 1) : 0);\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 7",
        "anchor": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "replacement": "  // Bulk export is a full capture on a stepped clock: the same zero lead and\n  // frame-0 prime as captureMode, so it rides that path (and CaptureClock's\n  // zero-latency choreography) rather than keeping a parallel special case.\n  const captureMode = captureModeFlag || exportMode;\n  // An export rebuild must not resume the context on the way through\n  // stopTimeline: that resume is asynchronous and would land after the\n  // suspend below, leaving the song playing under a stepped clock.\n  stopTimeline({ preservePause: preservePause || exportMode, keepAudio });\n  versionSession.heldPositionMs = null;\n  if (extra.restorePaused) { paused = true; updatePauseButtonUI(); }\n  fitCanvas();\n  // Any path that is about to play a decoded recording (confirmWorld,\n  // replay) mutes the timeline synth. Live listening mutes it for the same\n  // reason from the other direction: the song is already in the room. MIDI\n  // and the procedural demo pass neither and keep it.\n  if (playBuffer || live) muteTimelineSynth = true;\n  applySynthMutePolicy();\n  // Guard a degenerate declared duration (<=0): without it, FractureEngine's\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 8",
        "anchor": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null } = {}) {\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "replacement": "  const adopted = !!sim.biomes?.adoptLyricEvidence?.(evidence, sim.heardTimeMs);\n  if (adopted) console.info('[lyrics] adopted late lyrics into the running performance');\n  return adopted;\n}\n\n/** One audio file plays as itself; SEVERAL dropped together are treated as\n *  stems of one song -- summed into a mix for analysis/playback, with each\n *  file's NAME casting its notes to a character (see Casting.js). */\nasync function loadAudioFiles(files, { selection = null, restoreIntent = null } = {}) {\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let selectedFiles;\n  try {\n    selectedFiles = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    if (!selection || sourceSelection.isCurrent(selection)) {\n      showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    }\n    return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 9",
        "anchor": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "replacement": "    // goes back to the library here, as the song is handed to the player --\n    // for the track this selection was made from, and only while it is still\n    // the player's choice (isStale was checked above, with no await since).\n    // A failed, cancelled or replaced library play reports nothing.\n    // Fire-and-forget: a storage failure must not delay the song by a frame.\n    if (selection.kind === 'library' && selection.libraryTrack) {\n      musicLibrary.notePlayed(selection.libraryTrack, audioBuffer.duration).catch(() => {});\n    }\n    offerWorldsThenStart(data, { playBuffer: audioBuffer, lyricsReady, versionSelection: selection, versionSource: { kind: 'audio-files', files: [...selectedFiles] }, restoreIntent });\n  } catch (err) {\n    if (isStale() || err?.name === 'AbortError') return;\n    console.error('[audio load failed]', err);\n    auditionPanelEl?.classList.add('hidden');\n    lyricsRowEl?.classList.add('hidden');\n    hudEl.classList.add('hidden');\n    loaderEl.classList.remove('hidden');\n    showErrorBanner('Could not load audio file: ' + (err?.message || err));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 10",
        "anchor": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "replacement": "  // A library row or a URL hands over the selection it claimed when the\n  // player acted; anything else (a pick, a drop) is a new choice right now.\n  if (selection && !sourceSelection.isCurrent(selection)) return;\n  // Whatever this is, it is the source the player chose most recently, so\n  // an in-flight URL fetch must not be allowed to land afterwards and take\n  // the playback back. The URL path releases its own operation before\n  // calling in here, so this never cancels the load that invoked it.\n  cancelUrlLoad();\n  if (!selection) selection = claimSelection({ kind: 'file', name: files?.[0]?.name || '' });\n  let list;\n  try {\n    list = validateAudioFiles(files, AUDIO_LOAD_LIMITS);\n  } catch (err) {\n    showErrorBanner(err?.message || 'The selected audio cannot be loaded.');\n    return;\n  }\n  if (!list.length) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 11",
        "anchor": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "replacement": "  bindUrlLoad();\n  // Scrolling it into view matters on a head unit, where the panel can open\n  // below the fold and look as if nothing happened.\n  try { urlLoadEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* older WebView */ }\n  if (focus) urlLoadInputEl?.focus();\n}\n\nfunction setUrlLoadStatus(text, isError = false) {\n  if (isError && text && typeof versionLoadFailed === 'function') versionLoadFailed(text);\n  if (!urlLoadStatusEl) return;\n  urlLoadStatusEl.textContent = text || '';\n  urlLoadStatusEl.classList.toggle('isError', Boolean(isError) && Boolean(text));\n}\n\nfunction setUrlLoadBusy(busy) {\n  if (urlLoadBtnEl) urlLoadBtnEl.disabled = busy;\n}\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 12",
        "anchor": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "replacement": "async function openUrlTarget(raw) {\n  const selection = claimSelection({ kind: 'url', name: String(raw || '') });\n  const signal = beginUrlLoadOperation(selection);\n  setUrlLoadStatus('Opening\\u2026');\n  try {\n    const result = await openAudioUrl(raw, { pageUrl: location.href, signal });\n    if (signal.aborted) return;\n    if (result.kind === 'listing') {\n      if (typeof versionLoadFailed === 'function') versionLoadFailed('Choose a song from this folder before changing versions.');\n      renderUrlListing(result);\n      const count = result.entries.length;\n      setUrlLoadStatus(count\n        ? `${count} song${count === 1 ? '' : 's'} here. Tap one to play it.`\n        : 'No songs in this folder \\u2014 open a subfolder.');\n      if (urlLoadInputEl) urlLoadInputEl.value = result.url;\n      return;\n    }\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 13",
        "anchor": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample() {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "replacement": "  }\n});\nworldSelectEl?.addEventListener('cancel', (e) => {\n  e.preventDefault();\n  backToTitle(); // also stops preview audio and discards the pending song\n});\n\n/** Authored sample (Proof) so a visitor can see the worlds without a file. */\nasync function startDemoSample(restoreIntent = null) {\n  // The sample is a choice too: it outranks an older fetch, an upload still\n  // decoding or analysing, and a library permission prompt still open.\n  const selection = claimSelection({ kind: 'sample', name: 'Proof' });\n  cancelUrlLoad();\n  try {\n    await bootAudio();\n  } catch (err) {\n    if (!sourceSelection.isCurrent(selection)) return;\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 14",
        "anchor": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "replacement": "    barGrid: song.barGrid,\n    energyCurves,\n    conductor: song.conductor,\n    structure: {\n      labels: song.sections.map((s) => s.id),\n      boundariesMs,\n      confidence: 1,\n    },\n  }, { versionSelection: selection, versionSource: { kind: 'demo' }, restoreIntent });\n}\ndemoBtnEl?.addEventListener('click', (e) => {\n  e.stopPropagation();\n  startDemoSample();\n});\n\n// Unlock the AudioContext on the gesture that opens the picker, not on\n// the later `change` event -- browsers often don't treat file-picker\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 15",
        "anchor": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "replacement": "  startTimeline(lastTimelineData, { songSeed: seed, startAtMs: t, keepUserCamera: true,\n    playBuffer: buffer || undefined, preservePause: wasPaused, fitDiagnostic: sim.fitDiagnostic });\n  if (!running || !sim) return;\n  renderer.hudInFrame = hudInFrame;\n  sim.showSectionLabels = showSectionLabels;\n  if (buffer) audioEngine.playBuffer(buffer, t / 1000);\n  if (wasPaused) {\n    paused = true;\n    if (typeof versionSession !== 'undefined') versionSession.heldPositionMs = t;\n    audioEngine.ctx.suspend();\n    updatePauseButtonUI();\n  }\n  renderer.draw(sim, 1);\n  const composer = renderer.composer;\n  if (composer && selectedSection != null) composer.selectedSection = selectedSection;\n}\n\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 16",
        "anchor": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "replacement": "// it never also acts as a gameplay tap or a seek/section click, exactly the\n// same \"tap to unlock\" beat a phone screen uses. Buttons themselves can't be\n// hit while faded at all (CSS pointer-events:none on .hud-faded), so only\n// the canvas path needs an explicit gate.\nconst HUD_FADE_MS = 3000;\nlet hudAwake = true;\nlet hudSleepAtMs = 0;\nfunction wakeHud() {\n  for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = false; el.classList.remove('hud-faded'); }\n  hudSleepAtMs = performance.now() + HUD_FADE_MS;\n  if (hudAwake) return;\n  hudAwake = true;\n  hudRightEl?.classList.remove('hud-faded');\n  hudLeftEl?.classList.remove('hud-faded');\n}\nfunction hudIdleTick(nowRafMs) {\n  if (document.activeElement?.closest?.('[data-version-navigation]')) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A recording holds the HUD open. The stop control is in there, and a\n  // faded HUD sits under the canvas -- so letting it fade would mean the\n  // only way to end a recording is to tap the stage first, and that tap is\n  // deliberately absorbed by the wake-up handler (see car-mode.md). The\n  // player would press twice and wonder why the first did nothing. The\n  // live elapsed/size readout wants to stay on screen anyway.\n  if (songRecorder?.recording) { hudSleepAtMs = nowRafMs + HUD_FADE_MS; return; }\n  // A Sync pass holds it open too: the Sync button is how the pass ends,\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 17",
        "anchor": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "replacement": "  // complaint that kept this cluster pinned open in the first place; the\n  // answer is to hold it while the popover is up, not to never fade it.\n  if (btLatencyPopoverEl && !btLatencyPopoverEl.classList.contains('hidden')) {\n    hudSleepAtMs = nowRafMs + HUD_FADE_MS;\n    return;\n  }\n  if (hudAwake && nowRafMs >= hudSleepAtMs) {\n    hudAwake = false;\n    for (const el of document.querySelectorAll('[data-version-navigation]')) { el.inert = true; el.classList.add('hud-faded'); }\n    hudRightEl?.classList.add('hud-faded');\n    hudLeftEl?.classList.add('hud-faded');\n  }\n}\nhudRightEl?.addEventListener('pointerdown', wakeHud);\nhudLeftEl?.addEventListener('pointerdown', wakeHud);\n\n// Mountain seekbar: click to seek; click a section to open its debug detail.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 18",
        "anchor": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e)) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "replacement": "  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D',\n]);\n\nwindow.addEventListener('keydown', (e) => {\n  // A focused text field, an IME composition, an already-handled event and\n  // a Ctrl/Meta/Alt chord all belong to the browser. Decide that before any\n  // branch below can toggle a setting, open an overlay, tap the beat or\n  // preventDefault a letter out of a URL (KeyboardOwnership.js).\n  if (ownsNativeKeyboard(e) || e.target?.closest?.('[data-version-navigation]')) return;\n  // A modal chooser owns keyboard input. R stays available for accessibility;\n  // all other keys retain native dialog/button behavior, including Escape.\n  if (worldSelectEl?.open) {\n    if (e.key === 'r' || e.key === 'R') toggleReducedFlash();\n    return;\n  }\n  // Native controls must receive their Enter/Space default actions before\n  // the gameplay handler's inert-key guard can suppress them.\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "session/HUD compatibility hook 19",
        "anchor": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n",
        "replacement": "\nsyncRecordUI();\n\n// The title has a presentation owner before there is a song simulation.\nif (!window.__SMW) window.__SMW = {\n  get presentationDiagnostics() { return titlePresentation?.diagnostics; },\n  get displayPrefs() { return { ...displayPrefs }; },\n};\n\n\n// Narrow production API: ownership comes from the actual selection and start,\n// never from an old debug object or a non-null decoded buffer.\nfunction versionAdapterState() {\n  let blockedReason = null;\n  if (songRecorder?.recording || pendingCapturePresetId) blockedReason = 'Finish recording before changing versions.';\n  else if (songRecorder?.finalizing || pendingExportPresetId || bulkExportArmed) blockedReason = 'Finish exporting before changing versions.';\n  else if (recalibration.active) blockedReason = 'Finish calibration before changing versions.';\n  else if (versionSession.phase === 'loading') blockedReason = 'The selected song is still loading.';\n  else if (running && !versionSession.source) blockedReason = 'This source cannot be carried to another version.';\n  const durationMs = conductor?.durationMs || 0;\n  return { phase: versionSession.phase, generation: loadGen, sourceId: versionSession.sourceId, source: versionSession.source,\n    positionMs: Math.max(0, Math.min(paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : (audioEngine ? audioEngine.nowMs - choreographyOutputLatencyMs() : 0), durationMs)), durationMs,\n    seed: sim?.songSeed ?? lastSongSeed, paused, worldId: sim?.worldId || lastWorldId,\n    rangeViewId: sceneChoice?.viewId ?? null, settings: { reducedFlash, reducedMotion, stageRes: stageResEl?.value, stageFps: stageFpsEl?.value, worldBaseId: sim?.worldId === 'custom' ? (getCustomWorld()?.registeredId || getCustomWorld()?.baseId || null) : null }, blockedReason };\n}\n\nasync function versionSetPaused(value) {\n  if (!audioEngine || !running || !sim) throw new Error('There is no ready song.');\n  if (value) {\n    await audioEngine.ctx.suspend();\n    versionSession.heldPositionMs = paused && versionSession.heldPositionMs != null ? versionSession.heldPositionMs : Math.max(0, audioEngine.nowMs - choreographyOutputLatencyMs());\n    paused = true;\n  } else {\n    const resumed = await audioEngine.resume();\n    if (!resumed) { const error = new Error('Tap Resume to enable audio.'); error.code = 'AUDIO_GESTURE_REQUIRED'; throw error; }\n    paused = false;\n    versionSession.heldPositionMs = null;\n    lastRafMs = null;\n  }\n  updatePauseButtonUI();\n  versionEmit();\n}\n\nfunction versionLoadSource(source, restoreIntent = {}) {\n  if (!['audio-files', 'demo'].includes(source?.kind)) return Promise.reject(new Error('This source cannot be carried to another version.'));\n  const settings = restoreIntent.settings || {};\n  if (typeof settings.reducedFlash === 'boolean') { reducedFlash = settings.reducedFlash; setReducedFlash(reducedFlash); }\n  if (typeof settings.reducedMotion === 'boolean') { reducedMotion = settings.reducedMotion; setReducedMotion(reducedMotion); syncMotionButton(); }\n  for (const [control, value] of [[stageResEl, settings.stageRes], [stageFpsEl, settings.stageFps]]) {\n    if (control && value != null && [...control.options].some(option => option.value === String(value))) control.value = String(value);\n  }\n  const restoreBaseId = restoreIntent.worldId === 'custom' ? settings.worldBaseId : restoreIntent.worldId;\n  if (restoreIntent.worldId && (!restoreBaseId || !listWorlds().some(world => world.id === restoreBaseId))) return Promise.reject(new Error('This version cannot restore the selected world.'));\n  if (restoreIntent.rangeViewId) {\n    const restoredChoice = resolveSceneChoice({ search: searchWithSceneChoice('', { viewId: restoreIntent.rangeViewId }), catalog: SCENE_CATALOG, biomeNames: PICKABLE_BIOMES.map(b => b.name) });\n    if (restoredChoice.viewId !== restoreIntent.rangeViewId) return Promise.reject(new Error('This version cannot restore the selected range view.'));\n    sceneChoice = restoredChoice;\n  }\n  fpsCapMs = 1000 / readFpsCap();\n  const loading = source.kind === 'demo' ? startDemoSample(restoreIntent) : loadAudioFiles(source.files, { restoreIntent });\n  const session = versionSession;\n  session.restoreSourceId = restoreIntent.sourceId || null;\n  loading.catch(error => { if (versionSession === session) versionLoadFailed(error?.message || String(error)); });\n  if (!session.completion || session.phase !== 'loading') return Promise.reject(new Error('The original audio source could not be loaded.'));\n  return session.completion;\n}\n\nconst versionSessionAdapter = {\n  getState: versionAdapterState,\n  subscribe(listener) {\n    versionListeners.add(listener);\n    if (!versionNotifyTimer) versionNotifyTimer = setInterval(versionEmit, 250);\n    return () => { versionListeners.delete(listener); if (!versionListeners.size) { clearInterval(versionNotifyTimer); versionNotifyTimer = null; } };\n  },\n  pause: () => versionSetPaused(true),\n  loadSource: versionLoadSource,\n  async seek(ms) { seekSong(ms); versionSession.heldPositionMs = paused ? audioEngine.nowMs : null; versionEmit(); },\n  setPaused: versionSetPaused,\n  wakeHud,\n};\nwindow.__MIDIO_VERSION_ADAPTER = versionSessionAdapter;\nwindow.dispatchEvent(new CustomEvent('midio-version-adapter', { detail: versionSessionAdapter }));\n",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store midio.export.preset",
        "anchor": "'midio.export.preset'",
        "replacement": "'midio.export.preset:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageFps",
        "anchor": "'smw:stageFps'",
        "replacement": "'smw:stageFps:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/main.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/audio/AnalysisCache.js",
        "name": "isolate archive persistent store midio-analysis",
        "anchor": "'midio-analysis'",
        "replacement": "'midio-analysis:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/library/LibraryDB.js",
        "name": "isolate archive persistent store midio-library",
        "anchor": "'midio-library'",
        "replacement": "'midio-library:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrim",
        "anchor": "'smw:btLatencyTrim'",
        "replacement": "'smw:btLatencyTrim:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:btLatencyTrimMs",
        "anchor": "'smw:btLatencyTrimMs'",
        "replacement": "'smw:btLatencyTrimMs:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:groove",
        "anchor": "'smw:groove'",
        "replacement": "'smw:groove:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:noLyrics",
        "anchor": "'smw:noLyrics'",
        "replacement": "'smw:noLyrics:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedFlash",
        "anchor": "'smw:reducedFlash'",
        "replacement": "'smw:reducedFlash:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/Accessibility.js",
        "name": "isolate archive persistent store smw:reducedMotion",
        "anchor": "'smw:reducedMotion'",
        "replacement": "'smw:reducedMotion:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/TitleWorldChoice.js",
        "name": "isolate archive persistent store smw:titleWorld",
        "anchor": "'smw:titleWorld'",
        "replacement": "'smw:titleWorld:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/LibraryPanel.js",
        "name": "isolate archive persistent store midio.library.view",
        "anchor": "'midio.library.view'",
        "replacement": "'midio.library.view:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/FileChooserProbe.js",
        "name": "isolate archive persistent store smw:fileChooser",
        "anchor": "'smw:fileChooser'",
        "replacement": "'smw:fileChooser:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRanges",
        "anchor": "'smw:recentRanges'",
        "replacement": "'smw:recentRanges:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentRegions",
        "anchor": "'smw:recentRegions'",
        "replacement": "'smw:recentRegions:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/terrain/RangeHistory.js",
        "name": "isolate archive persistent store smw:recentViews",
        "anchor": "'smw:recentViews'",
        "replacement": "'smw:recentViews:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/world/dna/PaletteSynth.js",
        "name": "isolate archive persistent store midio.worldDnaHistory",
        "anchor": "'midio.worldDnaHistory'",
        "replacement": "'midio.worldDnaHistory:__CHECKPOINT__'",
        "count": 3
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionApiKey",
        "anchor": "'smw:visionApiKey'",
        "replacement": "'smw:visionApiKey:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionEndpoint",
        "anchor": "'smw:visionEndpoint'",
        "replacement": "'smw:visionEndpoint:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionModel",
        "anchor": "'smw:visionModel'",
        "replacement": "'smw:visionModel:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/vision/config.js",
        "name": "isolate archive persistent store smw:visionProvider",
        "anchor": "'smw:visionProvider'",
        "replacement": "'smw:visionProvider:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/lyrics/LyricsClient.js",
        "name": "isolate archive persistent store smw:lyrics:v2:",
        "anchor": "`smw:lyrics:v2:",
        "replacement": "`smw:lyrics:v2:__CHECKPOINT__:",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:display:v1",
        "anchor": "'smw:display:v1'",
        "replacement": "'smw:display:v1:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/render/DisplayProfile.js",
        "name": "isolate archive persistent store smw:stageRes",
        "anchor": "'smw:stageRes'",
        "replacement": "'smw:stageRes:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneBiome",
        "anchor": "'smw:sceneBiome'",
        "replacement": "'smw:sceneBiome:__CHECKPOINT__'",
        "count": 1
      },
      {
        "path": "src/ui/SceneChoice.js",
        "name": "isolate archive persistent store smw:sceneRange",
        "anchor": "'smw:sceneRange'",
        "replacement": "'smw:sceneRange:__CHECKPOINT__'",
        "count": 1
      }
    ]
  }
];
export const historicalProfiles = new Map(AUDITED_PROFILES.map(profile => [profile.sourceSha, defineAdapterProfile({ ...profile, patches: profile.patches.map(patch => ({ ...patch, replacement: ({ checkpointId }) => patch.replacement.replaceAll('__CHECKPOINT__', checkpointId) })) })]));
