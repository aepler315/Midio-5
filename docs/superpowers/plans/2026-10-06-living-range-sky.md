# Living Range sky implementation

Continue the user's requested fixes inline in the isolated checkout, based on merged #394.

1. Add regression tests for readable idle/lead-less movement, causal sustained aurora and full directional sky/reflection ownership.
2. Implement independent cove movement and articulated Broshi head/tail with fixed ground contact.
3. Add shared star, constellation-art and aurora functions; integrate an owned sky pass and sample identical directions from water without a screen capture.
4. Replace the old performance-sky painters only when the new pass is active; preserve fallback paths and accessibility.
5. Inspect actual animated output and sky/water layer differences; fix visual defects, run full checks, update evidence, and open a follow-up PR.
