# Copilot Instructions — Marketplace Learn Monitor

## Build, test, and run

```powershell
npm run build          # TypeScript → dist/ (rimraf + tsc)
npm test               # builds first, then runs Node.js built-in test runner
npm start              # builds first, then starts Azure Functions host from dist/
```

Run a single test file:

```powershell
npm run build && node --test test/health.test.js
```

There is no separate linter configured.

## Architecture

This is a TypeScript Azure Functions v4 app with Bot Framework integration that monitors Microsoft Learn Marketplace/Partner Center documentation for changes and reports them into Microsoft Teams.

### Three Azure Function entry points

- **`src/functions/messages.ts`** — `POST /api/messages` receives Bot Framework activities from Teams.
- **`src/functions/health.ts`** — `GET /api/health` returns version, tracked page count, and operational status.
- **`src/functions/dailyDigest.ts`** — Timer trigger runs on a cron schedule, scans docs, and proactively messages registered Teams conversations.

### Shared singleton runtime

`src/bot/runtime.ts` creates and exports a single shared instance of config, repository, docs service, adapter, and bot. All three function entry points import from this module. Do not instantiate these objects elsewhere.

### Core pipeline flow

1. **Source discovery** — URLs are resolved from the Marketplace landing page markdown and Partner Center TOC JSON.
2. **Fetch** — Each URL is fetched as Learn markdown (`?accept=text/markdown`), and front-matter metadata is extracted via `gray-matter`.
3. **Diff** — New content is compared against stored snapshots (body hash, commit ID, timestamps, content lines).
4. **Classify** — Changes are tagged with audience (`partner`/`customer`/`both`), severity, and Marketplace categories using keyword heuristics. Azure OpenAI can optionally refine summaries.
5. **Store** — Document index, snapshots, digests, and conversation registrations are persisted through `MonitorStateRepository` → `StateStore`.
6. **Deliver** — Formatted text + Adaptive Cards are sent to Teams via direct turn replies (chat commands) or `adapter.continueConversation` (proactive digests).

### Storage abstraction

`StateStore` (`src/services/stateStore.ts`) transparently switches between Azure Blob Storage (when a real connection string is configured) and local filesystem fallback (under `.data/`). All persistence goes through `MonitorStateRepository`, which uses `StateStore` for JSON read/write operations.

### Bot command handling

`MarketplaceMonitorBot` (`src/bot/marketplaceMonitorBot.ts`) exposes a `getResponse(text)` method that returns `{ text, card? }`. The bot's `onMessage` handler calls this, then sends the result via `context.sendActivity`. Use `context.sendActivity` for normal turn replies — `adapter.continueConversation` is only for proactive messaging from the timer trigger.

## Key conventions

### Dependency injection via factory functions

Function handlers use a `createXxxHandler(dependencies)` pattern (see `createHealthHandler`, `createMessagesHandler`) where dependencies default to the real singletons but can be overridden for testing. Follow this pattern when adding new endpoints.

### Tests are plain JavaScript against dist/

Tests live in `test/` as `.test.js` files using Node.js built-in `node:test` and `node:assert/strict`. They `require()` compiled output from `dist/`. The project must be built before tests run (`npm test` handles this). When writing new tests, follow this same pattern — plain JS, import from `dist/`, use mock service objects.

### Models are centralized

All domain types (`ChangeSummary`, `MonitoredDocument`, `DigestHistoryItem`, `AppConfig`, etc.) are defined in `src/models.ts`. Add new domain interfaces there.

### Config is environment-driven and cached

`src/config.ts` reads all settings from environment variables, applies defaults, and caches the result. See `local.settings.sample.json` for the full variable list. Config is loaded once — do not read `process.env` directly in service code.

### Version is the single source of truth from package.json

`src/version.ts` reads the version from `package.json` at runtime. The same version flows to the health endpoint, bot status command, Teams manifest, and deployment metadata. When bumping the version, only change `package.json`.

### README is a maintained product surface

The README documents architecture, commands, configuration, storage, deployment, and operational guidance. It should be updated alongside any behavioral change — treat it as part of the product, not an afterthought.

### Proactive vs. turn-based messaging

Normal chat replies use `context.sendActivity()`. Proactive digest delivery (from the timer trigger) uses `adapter.continueConversation()`. Mixing these up caused a past regression — see the troubleshooting section in the README.

### Teams app packaging

`npm run package:teams` runs a PowerShell script that generates icons, injects config into the manifest template, and produces `artifacts/marketplace-learn-monitor-teams-app.zip`. The manifest template is at `teamsapp/manifest.template.json`.
