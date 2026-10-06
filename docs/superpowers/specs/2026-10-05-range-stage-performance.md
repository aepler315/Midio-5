# Range stage performance

The user authorized the proposed 3D side-scroll with Midio, Broshi and Midasus
sharing a small foreground platform beside a lake. The first implementation
is a complete listening presentation, with the song driving the performers
and surrounding landscape. It preserves sunset → moonlight → sunrise and
the dense stars. Playback supplies the entire performance automatically.

## First presentation

- Range defaults to `performance`; `?rangeExperience=landscape` retains the
  previous scenery-only presentation. Other worlds retain their current look.
- Auto scene selection uses the approved `muncho-lake-south` view for this
  pilot. Explicit range/view selections remain respected.
- The real terrain and geographic lake remain 3D. Camera travel follows the
  existing song-indexed rail, with a steady lateral viewpoint and no section
  orbit/dolly/crane. Reduced motion freezes the scenic travel.
- A small perspective platform occupies the lower foreground. The reusable
  luminous trio meshes are continuously readable there; no reintroduction,
  departure, giants, collisions, obstacles, lives, scores or required input.
- Platform, trio and subtle water reflections draw in nominal stage space
  before post-processing and captions, so the Canvas/WebGL wrapper, recording
  and bulk export receive the same picture. They allocate no capture buffers.
- Retain the geographic water mask and terrain reflections. Musical ripples
  belong to the lake, rather than an opaque generic sea drawn over the view.
  The inland pilot does not need a second background sea.

## Musical ownership

The canonical ridge-music history owns heard-time sampling, physical silence
gating and analysis handoffs. Add dedicated trio source readings without
changing existing ridge casting: Midio uses the MIDIO lane or melodic role,
Broshi the BROSHI lane or bass role, Midasus the MIDASUS lane or melodic role.
Shared fallback sources remain explicitly identified. Authored MIDI pitch is
trusted; tracked recording pitch retains its confidence; synthetic pitches
never steer a gesture. Rhythm accents give brief readable hops and strikes,
bass supplies Broshi's weight, melodic activity shapes Midio's gestures, and
upper/melodic activity shapes Midasus's finer movement. They settle in silence.

All poses derive from immutable snapshots and heard time. Pause, backward
seek, replay and analysis adoption must reconstruct the same stage. Reduced
motion removes hops, rotations and lake ripples while retaining the figures;
reduced flash lowers transient glow without suppressing normal motion.

## Verification

Use independent rhythm/bass/melody MIDI fixtures, silent and recording-like
curves, a canonical analysis handoff, and low-quality/reduced-accessibility
paths. Test actual Renderer ownership and output—not just sampler fields.
Capture sunset, moonlight and sunrise through the real v2 compositor; compare
the same musical instant after seeking and show distinguishable responses
to contrasting sources. Verify no page/shader errors and bounded resources.

The retained legacy character classes and the proposal to retire their kit
remain separate from this feature. This design uses meshes and pure drawing,
not the removed gameplay systems.
