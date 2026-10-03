# FanZuP

Direct-to-fan funding for independent artists. *Fund the culture. Own the future.*

This app consolidates three Figma Make prototypes into one routed React app built to the FanZuP Brand v2.0 guidelines and PRDs 01–03. See:

- `docs/CONSOLIDATION.md` — what came from which mockup, and what changed to match the docs
- `docs/BUILD_CONVENTIONS.md` — how pages are built (tokens, components, copy rules)
- `docs/brand/` — brand guidelines and design-system tokens (copied from the FanzUp doc set)

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build
pnpm lint:copy    # regulated-language guard (Brand §7.4)
```

## Feature flags

| Flag | What it gates | Default |
|---|---|---|
| `layer2` | Reg CF investing: investor KYC, Pools, holdings, investment flow | off |
| `postBeta` | Soft transfers (Mechanism 07 P1), holder votes | off |

Set `VITE_FLAG_LAYER2=true` / `VITE_FLAG_POSTBETA=true`, or append `?flags=layer2,postBeta` to any URL for review. In dev, a **Flags** toggle sits bottom-right in the app shell.

## Routes

Routes are generated from `scripts/routes.manifest.json` → `node scripts/gen-routes.mjs` → `src/app/routes.tsx`.
