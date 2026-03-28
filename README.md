# Marketplace Learn Monitor

Marketplace Learn Monitor is an Azure Functions + Microsoft Teams bot that watches Microsoft Learn Marketplace and Partner Center documentation, detects meaningful changes, stores a history of those changes, and explains why they matter to Marketplace publishers, customers, or both.

The bot supports both proactive daily digests and direct chat-based questions such as:

- `scan now`
- `what changed today`
- `partner impact`
- `customer impact`
- `history last 30 days`
- `history for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/ last 60 days`
- `customer history since 2026-03-01`
- `backfill last 30 days`
- `show diff for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/`
- `sources`
- `status`

## README maintenance note

This README is intended to be part of the product surface, not an afterthought. If commands, architecture, configuration, storage behavior, deployment flow, or operational expectations change, this file should be updated in the same change.

## Purpose

The project exists to answer a practical need:

- Monitor Microsoft Learn content related to Azure Marketplace and Partner Center.
- Detect real changes instead of reposting the same content every day.
- Explain what changed in plain language.
- Put each change in Marketplace context so readers understand whether it affects publisher workflows, customer/buyer workflows, or both.
- Make that information available inside Microsoft Teams where people already collaborate.

## What the agent does

At a high level, the agent:

1. Resolves a set of Marketplace-related Learn URLs from the landing page and Partner Center TOC.
2. Fetches Microsoft Learn markdown plus page metadata such as update timestamps and backing commit IDs.
3. Compares the latest content to previously stored snapshots.
4. Creates structured change summaries with:
   - a short summary
   - a "why it matters" explanation
   - an audience classification (`partner`, `customer`, or `both`)
   - a category classification such as `publishing`, `pricing`, `billing`, or `apis`
5. Saves those changes as digest history.
6. Sends proactive daily digests to registered Teams conversations.
7. Answers chat commands for current status, recent changes, tracked sources, and historical change summaries over time.

## Core capabilities

### 1. Real change detection

The first scan creates a baseline. After that, the bot only records actual document changes by comparing stored snapshots to newly fetched content and metadata.

### 2. Marketplace-specific relevance

Every stored change is classified for Marketplace relevance:

- **Audience**
  - `partner`: publisher or seller-side workflows
  - `customer`: buyer-side workflows
  - `both`: shared impact

- **Category**
  - `account`
  - `publishing`
  - `pricing`
  - `billing`
  - `analytics`
  - `apis`
  - `support`
  - `announcements`
  - `other`

### 3. Historical queries

The bot can summarize stored changes:

- over a time window
- for a specific URL
- for a specific audience perspective (`partner` or `customer`)

Examples:

- `history last 30 days`
- `partner history last 14 days`
- `customer history since 2026-03-01`
- `history for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/ last 60 days`
- `history for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/ between 2026-02-01 and 2026-02-29`

If no time window is provided, history queries default to the last 30 days.

### 4. Light backfill

The bot also supports a light backfill mode for recent history.

This mode does **not** reconstruct exact old diffs. Instead, it:

- inspects the current in-scope Learn pages
- reads Learn metadata such as `updated_at`
- creates clearly labeled **backfilled / inferred** history entries for pages that appear to have changed inside the requested window
- applies the same Marketplace relevance logic to explain likely partner/customer impact

Example:

- `backfill last 30 days`

### 5. Teams-first interaction

The bot supports:

- 1:1 chat
- group chat
- proactive digests into registered conversations

In group chat, users should mention the bot, for example:

```text
@Marketplace Learn Monitor history last 30 days
```

## Architecture

### High-level design

The solution is built as a TypeScript Azure Functions app with Bot Framework integration.

| Component | Responsibility | Key files |
| --- | --- | --- |
| Bot runtime | Wires config, storage, monitor service, Bot Framework adapter, and Teams bot behavior | `src\bot\runtime.ts` |
| Teams bot | Handles chat commands, registers conversations, and returns formatted responses | `src\bot\marketplaceMonitorBot.ts` |
| History query parsing | Parses natural history commands for URLs, date windows, and audience scope | `src\bot\historyQuery.ts` |
| Monitoring service | Fetches Learn content, computes diffs, classifies relevance, and builds digests | `src\services\marketplaceDocsService.ts` |
| Digest formatting | Formats scan results, recent changes, and historical summaries for Teams output | `src\services\digestFormatter.ts` |
| State repository | Persists document index, snapshots, digests, and conversation registrations | `src\services\monitorStateRepository.ts` |
| State store | Stores JSON either in Azure Blob Storage or local filesystem fallback | `src\services\stateStore.ts` |
| Health endpoint | Returns health + version information for operations and live verification | `src\functions\health.ts` |
| Messages endpoint | Receives Bot Framework activities from Teams | `src\functions\messages.ts` |
| Daily digest timer | Runs scheduled scans and proactively sends digest messages | `src\functions\dailyDigest.ts` |
| Teams packaging | Builds the Teams manifest zip and injects app IDs, hostname, and version | `scripts\package-teams-app.ps1` |
| Deployment | Creates Azure resources, publishes the Function App, and emits deployment metadata | `scripts\deploy.ps1` |

### Runtime flow

#### Chat request flow

1. Teams sends an activity to `POST /api/messages`.
2. The Bot Framework adapter hands the activity to the Teams bot.
3. The bot captures the conversation reference so it can receive future digests.
4. The bot interprets the incoming command.
5. The monitoring service or history formatter returns the requested result.
6. The bot posts a human-readable response back to Teams.

#### Scheduled digest flow

1. Azure Functions timer trigger fires on the configured cron schedule.
2. The monitoring service scans all tracked Learn pages.
3. New changes are summarized and stored in digest history.
4. The bot uses stored conversation references to proactively message Teams chats.

## Change detection pipeline

### Source discovery

Tracked pages come from:

- the Marketplace landing page markdown
- links extracted from that page
- recent announcement pages discovered from the Partner Center TOC

### Fetching

Each tracked URL is requested as Learn markdown using:

```text
?accept=text/markdown
```

Relevant metadata is read from the markdown front matter, including:

- page title
- summary/description
- `source_path`
- `git_commit_id`
- `updated_at`

### Diffing

For each page, the service compares the newly fetched document against the previously stored snapshot and looks for:

- body hash changes
- backing commit changes
- published timestamp changes
- title changes
- added or removed content lines

### Relevance classification

The service classifies changes using Marketplace-oriented keyword rules. The result is turned into:

- a short summary
- a "why it matters" explanation
- an audience classification
- one or more Marketplace activity categories

If Azure OpenAI is configured, the project can refine the deterministic summary with a model-generated summary while keeping the same structured output shape.

## Historical summaries

Historical summaries are built from stored digest history, not from re-fetching content at query time.

That means:

- the bot can explain changes over time quickly
- the same relevance classification is reused for both daily digests and history lookups
- history is limited to what the monitor has stored since the baseline was first created

Current digest retention is up to **180** stored digest items.

Backfilled entries are stored in the same digest history, but they are explicitly labeled as inferred because they come from Learn metadata rather than exact historical diffs.

## Storage model

The app supports two storage modes:

### Azure Blob Storage

Used automatically when `AzureWebJobsStorage` is set to a real storage account connection string.

### Local filesystem fallback

Used when storage is unset or `UseDevelopmentStorage=true`. Data is written under the configured `STATE_DIRECTORY` (default: `.data`).

### Stored data structure

| Path | Purpose |
| --- | --- |
| `state/documents.json` | Current document index and latest known metadata per tracked page |
| `state/conversations.json` | Registered Teams conversation references for proactive digests |
| `state/digests.json` | Stored digest history for recent and historical summaries |
| `snapshots/<docId>/latest.json` | Latest snapshot for a tracked document |
| `snapshots/<docId>/<timestamp>.json` | Historical snapshots per document fetch |

## Command reference

### `scan now`

Runs the monitor immediately. If no baseline exists yet, the first scan creates the baseline instead of reporting a flood of initial differences.

### `what changed today`

Shows recently stored Marketplace documentation changes from digest history.

### `partner impact`

Shows recent changes relevant to partner or publisher-side Marketplace activity.

### `customer impact`

Shows recent changes relevant to buyer or customer-side Marketplace activity.

### `history ...`

Shows stored changes over time, optionally scoped by:

- date range
- audience
- specific URL

Supported patterns include:

- `history last 30 days`
- `history today`
- `history yesterday`
- `history between 2026-03-01 and 2026-03-15`
- `history since 2026-03-01`
- `partner history last 14 days`
- `customer history since 2026-03-01`
- `history for <url> last 60 days`

### `backfill ...`

Creates inferred historical entries from current Learn metadata for the requested time window.

Supported examples:

- `backfill last 30 days`
- `backfill last 90 days`
- `backfill for <url> last 30 days`

Backfilled entries are marked as such because they are based on Learn metadata and current page scope, not exact historical diffs.

### `show diff ...`

Shows the latest **observed** old/new text for a tracked URL by comparing stored snapshots.

Supported examples:

- `show diff for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/`
- `show last change for https://learn.microsoft.com/en-us/partner-center/marketplace-offers/`
- Pasting a Learn URL from the browser (the bot resolves links by page title)

Change cards also include a **Show Diff** button that triggers this command automatically for the relevant page.

This command only works for **observed changes** captured after monitoring started. It does not produce exact old/new text for metadata-only backfill entries.

### `sources`

Lists tracked Marketplace-related source URLs.

### `status`

Shows operational status including:

- current app version
- tracked page count
- latest stored digest timestamp

## HTTP and function surfaces

### `GET /api/health`

Returns live operational status, including:

- `ok`
- `version`
- `versionScheme`
- `trackedPages`
- `registeredConversations`
- `lastDigestAt`
- `botConfigured`

Use this endpoint to verify which version is live.

### `POST /api/messages`

Receives Bot Framework activities from Teams.

If the payload is not a valid Bot Framework activity shape, the function returns `400`.

### `dailyDigest` timer trigger

Runs on the configured cron schedule and sends proactive digest messages to registered conversations.

## Versioning

The project uses Semantic Versioning (`MAJOR.MINOR.PATCH`).

- Increment `MAJOR` for breaking changes.
- Increment `MINOR` for backward-compatible features.
- Increment `PATCH` for backward-compatible fixes.

The live version is exposed by:

- `package.json`
- `GET /api/health`
- the bot's `status` command
- `teamsapp\manifest.template.json` via Teams packaging
- `artifacts\deployment-output.json`

## Configuration

Configuration is loaded from environment variables. A sample file is provided at `local.settings.sample.json`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AzureWebJobsStorage` | Yes for Azure; optional locally | `UseDevelopmentStorage=true` in sample | Azure Functions storage and monitor state storage |
| `FUNCTIONS_WORKER_RUNTIME` | Yes | `node` | Azure Functions worker runtime |
| `MicrosoftAppType` | Yes for bot auth | `SingleTenant` | Bot authentication mode |
| `MicrosoftAppId` | Yes for Teams bot | none | Bot / Entra app ID |
| `MicrosoftAppPassword` | Yes for Teams bot | none | Bot client secret |
| `MicrosoftAppTenantId` | Yes for Teams bot | none | Entra tenant ID |
| `MARKETPLACE_LANDING_URL` | No | Learn Marketplace offers markdown URL | Starting point for tracked docs |
| `PARTNER_CENTER_TOC_URL` | No | Partner Center TOC JSON | Source for announcement discovery |
| `ALLOWED_DOC_PREFIXES` | No | `https://learn.microsoft.com/en-us/partner-center/` | Allowed tracked URL prefixes |
| `DIGEST_SCHEDULE` | No | `0 0 14 * * *` | Daily digest cron schedule (UTC) |
| `SEND_EMPTY_DIGESTS` | No | `false` | Whether to send a digest when nothing changed |
| `MAX_ANNOUNCEMENT_PAGES` | No | `6` | Max recent announcement pages to track |
| `MAX_CHANGES_PER_DIGEST` | No | `15` | Circuit breaker: suppress digest if change count exceeds this |
| `DIGEST_COOLDOWN_HOURS` | No | `6` | Min hours between proactive digests per conversation |
| `MONITOR_STORAGE_CONTAINER` | No | `marketplace-monitor` | Azure Blob container name |
| `STATE_DIRECTORY` | No | `.data` | Local filesystem fallback directory |
| `AZURE_OPENAI_ENDPOINT` | Optional | empty | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` | Optional | empty | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | Optional | empty | Azure OpenAI deployment name |
| `AZURE_OPENAI_API_VERSION` | Optional | `2024-10-21` | Azure OpenAI API version |

## Local development

### Prerequisites

- Node.js 20.x, 21.x, or 22.x compatible with the repo's engine range
- npm
- Azure Functions Core Tools if you want to run the Functions host locally
- Azure CLI if you want to deploy from this repo

### Local setup

1. Copy `local.settings.sample.json` to `local.settings.json`.
2. Fill in the bot identity values if you want end-to-end Teams behavior locally.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Build the project:

   ```powershell
   npm run build
   ```

5. Start the Functions host:

   ```powershell
   npm start
   ```

### Tests

Run:

```powershell
npm test
```

Current automated coverage includes:

- health endpoint version/status behavior
- invalid message payload handling
- bot help/status behavior
- history query parsing
- history filtering/formatting behavior
- metadata-based backfill behavior
- observed old/new diff retrieval
- Teams manifest validation surfaces

## Teams packaging

Run:

```powershell
npm run package:teams
```

The packaging script:

- regenerates Teams icons
- injects the bot app ID, Teams app ID, function hostname, and current SemVer version
- writes the built manifest to `teamsapp\build`
- creates `artifacts\marketplace-learn-monitor-teams-app.zip`

The Teams app currently supports:

- `personal` scope
- `groupChat` scope

### Current package location in this workspace

The latest packaged Teams app currently checked into or generated in this workspace is:

`artifacts\marketplace-learn-monitor-teams-app.zip`

The unpacked manifest and icons used to build that package are under:

`teamsapp\build`

If you only need to refresh the Teams app package after manifest or asset changes, run `npm run package:teams`.

## Deployment

Run:

```powershell
npm run deploy
```

The deployment script is designed to:

- create the Azure resource group if needed
- create storage, Function App, Entra app registration, and Azure Bot resources
- apply required app settings
- publish the Function App
- package the Teams app
- write deployment metadata to `artifacts\deployment-output.json`

### Deployment metadata

`artifacts\deployment-output.json` is the local summary of the current deployment workflow and includes:

- app version
- version scheme
- subscription ID
- tenant ID
- resource group
- function app name
- bot name
- bot app ID
- Teams package path
- health URL

### Current deployment snapshot

After deploying, check `artifacts\deployment-output.json` for your specific resource names, endpoints, and app IDs.

If runtime code changes, redeploy the Function App with `npm run redeploy`. If only the Teams manifest or app package changes, regenerate and re-upload the Teams package with `npm run package:teams`.

## Operational guidance

### How the bot learns which chats to notify

The bot stores conversation references whenever it is added to a conversation or receives a message. Those stored references are then used for proactive daily digests.

### How to verify a live deployment

Check:

1. `GET /api/health`
2. the bot's `status` command
3. `artifacts\deployment-output.json`

### Recent troubleshooting note: Teams default prompts

We hit a regression where the Teams app's default command prompts stopped working after a bot update.

Root cause:

- `src\bot\marketplaceMonitorBot.ts` had switched normal incoming-message replies to `adapter.continueConversation(...)`.
- `continueConversation(...)` is appropriate for proactive messaging, but standard command replies during an active turn should use `context.sendActivity(...)`.

Resolution:

- Restored direct turn replies in `src\bot\marketplaceMonitorBot.ts`.
- Kept proactive delivery in `src\functions\dailyDigest.ts`.
- Changed the fallback Teams message chunk size from `38` to `3800` so help and command text are not fragmented into tiny messages.
- Added regression coverage in `test\bot.test.js`.

If default prompts or normal bot commands stop responding again, inspect `src\bot\marketplaceMonitorBot.ts` first and run `npm test`.

### What history queries can and cannot do

History queries can summarize any stored changes the monitor has already captured.

History queries cannot reconstruct changes from before the monitor started tracking or from periods where no scan data was stored.

## Known limitations

- Change classification uses content-aware heuristics (retirement, deprecation, pricing, deadlines) and can be further refined with Azure OpenAI.
- Historical summaries depend on stored digest history, not the full lifetime of Microsoft Learn content.
- Backfill is approximate by design because it uses published Learn metadata instead of full historical page diffs.
- The bot focuses on Marketplace/Partner Center Learn content that matches the configured URL prefixes.
- Teams app upload and tenant distribution are still a tenant-admin concern outside this repo.

## Important files

| File | Why it matters |
| --- | --- |
| `src\bot\marketplaceMonitorBot.ts` | Main command handling and chat behavior |
| `src\bot\historyQuery.ts` | History query parsing for URL/date/audience filters |
| `src\services\marketplaceDocsService.ts` | Core monitoring, diffing, classification, and history retrieval |
| `src\services\digestFormatter.ts` | Teams-friendly formatting for scans, recents, and history |
| `src\services\monitorStateRepository.ts` | Persistence for documents, digests, snapshots, and conversations |
| `src\functions\health.ts` | Health and live version endpoint |
| `src\functions\messages.ts` | Teams activity ingress |
| `src\functions\dailyDigest.ts` | Scheduled proactive digest sender |
| `scripts\deploy.ps1` | Azure deployment automation |
| `scripts\package-teams-app.ps1` | Teams app packaging |
| `teamsapp\manifest.template.json` | Teams app manifest template |

## Keeping the project current

When behavior changes, update at least these surfaces together:

- runtime code
- tests
- Teams manifest/package behavior if applicable
- this README

That keeps the agent understandable for operators, maintainers, and future contributors rather than forcing people to rediscover architecture from the source every time.
