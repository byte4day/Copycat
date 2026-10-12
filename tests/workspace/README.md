# Reconstruction workspace

`pricing-rebuild/` is a reconstruction of `tests/fixtures/site/pricing.html`. It was built
by running `copycat inspect --interactions` on the fixture, then writing new markup, class
names, CSS (with tokens taken from `design-tokens.json`) and JavaScript (behavior taken from
`interaction-matrix.json`).

`tests/integration/compare.test.mjs` compares it against the fixture at desktop and mobile.
It also degrades a copy to check that the compare loop detects and prioritizes defects, and
runs the same flow on both sides to check behavior parity.

Disclosure: the same author wrote the fixture and the rebuild. The near-zero pixel
mismatch therefore shows that the pipeline is correct on a fully known reference. It is not
a fidelity claim about arbitrary third-party sites.
