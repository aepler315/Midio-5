# World identity contract

## Goal

Song adaptation may tailor a world, but it must never erase the visual rules
that let a viewer recognize that world in a single frame.

## Contract

Every registered world kind declares:

- a screen-persistent landmark;
- a signature motion and light source;
- a minimum retained stock-palette contribution;
- an explicit cast placement rule; and
- the shared spectacle effects it permits.

The contract is immutable and keyed by `world.kind`, so adapted `custom`
instances retain their selected world's policy.

## Enforcement points

1. `WorldAdaptation` reads the policy to retain at least the declared amount
   of stock palette material, and exposes the policy on the playback world.
2. Each renderer resolves that same policy from its active world before it
   draws a shared effect.
3. World draw modules may render shared deep-sky, constellation, and meteor
   effects only through a policy gate.
4. The chooser exposes the landmark and motion promise as preview metadata.
5. Tests require every registered kind to have a complete policy and pin the
   effects that are forbidden in enclosed worlds.

## Deliberate first enforcement

The highest-risk contradiction is open-sky spectacle in enclosed worlds.
Fathom, Understory, and Nave forbid deep sky, constellations, and meteors.
Understory currently reaches for all three, so this change removes that
contradiction at runtime rather than leaving the rule as documentation.
