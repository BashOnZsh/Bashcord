# Project Guidelines

## Code Style
- Use TypeScript/TSX patterns already in the repo; follow plugin and component conventions in [src/Vencord.ts](src/Vencord.ts) and [src/plugins/_core/settings.tsx](src/plugins/_core/settings.tsx).
- Keep imports aligned with existing aliases like `@api`, `@components`, `@utils` used throughout [src](src).

## Architecture
- Desktop build entry points are `src/main/index.ts`, `src/Vencord.ts`, and `src/preload.ts`, wired in [scripts/build/build.mjs](scripts/build/build.mjs).
- Web build entry point is `browser/Vencord.ts`, bundled in [scripts/build/buildWeb.mjs](scripts/build/buildWeb.mjs).
- Plugin roots are `src/plugins`, `src/bashplugins`, and `src/equicordplugins`, discovered via `globPlugins` in [scripts/build/common.mjs](scripts/build/common.mjs).

## Build and Test
- Install: `pnpm install --frozen-lockfile`
- Build desktop: `pnpm build`
- Build web: `pnpm buildWeb`
- Build standalone: `pnpm buildStandalone`
- Watch/dev: `pnpm watch` or `pnpm dev`
- Tests/lint: `pnpm test`, `pnpm testWeb`, `pnpm testTsc`, `pnpm lint`, `pnpm lint-styles` (see [package.json](package.json))

## Project Conventions
- Desktop artifacts are emitted under `dist/desktop` and `dist/bashbop`, and packaged to `.asar` in [scripts/build/build.mjs](scripts/build/build.mjs).
- Web outputs include `dist/browser/*` and a userscript currently named `dist/Equicord.user.js` per [scripts/build/buildWeb.mjs](scripts/build/buildWeb.mjs).
- Plugin targeting is controlled by `globPlugins("web"|"discordDesktop"|"vesktop"|"equibop")` and `IS_EQUIBOP` flags in [scripts/build/common.mjs](scripts/build/common.mjs) and [scripts/build/build.mjs](scripts/build/build.mjs).

## Integration Points
- Desktop injection flows through `scripts/runInstaller.mjs` via `pnpm inject` / `pnpm uninject` in [package.json](package.json).
- Browser extension bundles and zips are built in [scripts/build/buildWeb.mjs](scripts/build/buildWeb.mjs).

## Security
- Avoid running dev commands in an admin/root terminal; the installer touches the Discord client (see [README.md](README.md)).

## Agent State Sync
- When changing output names, target folders, or plugin roots, update this file so other agents on other machines stay in sync.
