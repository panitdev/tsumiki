# Tsumiki

Use the Beads tracker for implementation work. Run `bd prime` when you need the tracker workflow, and `bd ready` to find open work.

Run `npm run typecheck`, `npm test` and `npm run build` before publishing application changes. The production integration check is `node tests/smoke.mjs` against a running test server with Postgres, a Minecraft 26.3 client jar and Mesa/Xvfb.
