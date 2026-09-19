# Sync: setting the Bluetooth delay by tapping

**Sync** (the HUD button, or `C`) starts an eight-measure tap pass. Tap along
with what you *hear*, and the Bluetooth delay follows your taps — updated
after every one, not at the end.

## The premise: the taps are canon

If someone tapping along with what they hear lands consistently after the
song's kicks, the sound is reaching them late by that much. That is the
number. It is not adjusted toward published Bluetooth round-trip figures,
and it is not corrected for the well-documented human tendency to anticipate
a metronome by 20–50ms. Whatever they tap is what they hear, and a
correction that argues with the player is a correction they will turn off.

## The closed loop, and why raw offsets cannot be pooled

A tap is timestamped on the clock the ear is on (`visualNow`), which already
has the current trim subtracted from it. So the offset measured while a trim
of *T* is in force is the **residual** against *T*, not the absolute error.

Once the trim moves after every tap — which is the whole point — successive
offsets are each measured against a different trim. Pooling them directly
mixes incompatible quantities and converges on the wrong number.

So each tap is stored as what it implies the trim *should* be,
`trimInForce + offset`, and the estimate is the robust middle of those. Every
entry is then in the same units whatever the trim was doing while they were
collected. `SyncCalibrator` keeps the last 16 and takes a trimmed median, so
one stray tap during a real pass cannot drag the delay.

Both signs work through the same formula even though they act on different
sides of the loop: a positive trim delays the visuals (it is added to the lag
handed to `visualNow`), a negative one delays the audio through a DelayNode.
The algebra cancels either way.

## Two things measurement found

**The trim could run away.** A positive trim is added to the lag `visualNow`
clamps at `MAX_LATENCY_MS` (350ms), while the stored preference and the
manual input allow ±500ms. Past the clamp the number rises and the picture
does not — so a loop measuring its own residual never closes the error and
keeps pushing. Observed climbing through 376ms in a browser. The calibrator
now takes the ceiling that will actually take effect
(`MAX_LATENCY_MS − outputLatency`) and says so when it reaches it, rather
than letting someone tap harder at a number that has stopped moving.

**Onset lists are not a grid.** A real one, off a 120bpm fixture, ran
`1010, 81, 917, 81` — the kicks arrive in flammed pairs. Matching a tap
against the raw list picks whichever half is nearer, which does not average
out: it pulls every tap in the pair's neighbourhood toward zero, and was
measured reading 16ms where 78ms was true. Clusters are collapsed to their
first onset before matching, because a player tapping the beat taps where
the cluster *starts* — the flam is an ornament on that beat, not a second
beat. Collapsing keeps the data; rejecting those taps would have thrown it
away for a problem the onset list could fix about itself.

## What is not a measurement

- **A tap with no kick near it.** Further than half a beat (capped at 400ms)
  from any onset, and it is a tap during a rest or a fill. Feeding it in as
  a zero would drag the estimate toward "no correction needed" — the one
  answer it cannot have earned.
- **A tap outside a Sync pass.** Taps are the beat anchor's the rest of the
  time. Having an ordinary tap silently move an audio setting is a surprise
  nobody asked for.

A consequence worth knowing: a single pass cannot discover an error larger
than half a beat, because past that the tap is nearer the next kick. At
120bpm that is 250ms, comfortably past the 100–200ms a Bluetooth speaker
usually costs.

## The HUD

Both button clusters now fade on the same timer. The Bluetooth chip used to
be pinned open on the grounds that losing it mid-edit would be annoying;
that concern is answered where it arises instead — the fade is held off
entirely while the chip's popover is open — so the chrome can behave as one
thing. A recording holds the HUD open for the same class of reason: its stop
control is in there.

## Testing

* `test/syncCalibrator.test.js` — the matching, the flam collapse, the
  closed loop under a moving trim, the ceiling and the runaway it prevents,
  session gaps, and the readout's wording.
* A browser probe drove a real pass end to end: a simulated player hearing
  the beat late settled the chip at +105ms against a modelled 108ms, an
  anticipating player at −84ms against a modelled −91ms, taps outside a pass
  left the trim untouched, both HUD clusters faded together, and an open
  popover held the fade off.
