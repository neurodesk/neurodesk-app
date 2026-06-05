# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Neurodesk App is a cross-platform Electron desktop application that bundles JupyterLab (Neurodesk front-end) with Docker/Podman/TinyRange as backend for neuroscience computing. It supports macOS (Intel & Apple Silicon), Linux (deb/rpm), and Windows.

## Build & Development Commands

```bash
yarn                  # Install dependencies
yarn build            # TypeScript compile + webpack preload bundle + asset extraction
yarn start            # Launch Electron app
yarn dev              # Build then start (typical dev workflow)
yarn watch            # Watch mode for TypeScript and assets (live recompilation)
yarn clean            # Remove build/ and dist/ directories
```

### Linting & Formatting

```bash
yarn lint             # Run all: prettier + eslint + stylelint (with auto-fix)
yarn lint:check       # Check all without fixing
yarn eslint           # ESLint with auto-fix
yarn eslint:check     # ESLint check only
yarn prettier         # Prettier with auto-fix
yarn prettier:check   # Prettier check only
yarn stylelint        # StyleLint with auto-fix
```

### Distribution Builds

```bash
yarn dist:mac         # macOS DMG
yarn dist:linux-64    # Linux x64 deb/rpm
yarn dist:linux-arm64 # Linux ARM64
yarn dist:win         # Windows NSIS installer
```

## Architecture

### Electron Process Model

The app uses Electron's main/renderer process split:

- **Main process** (`src/main/`): Node.js backend — app lifecycle, container management, IPC routing
- **Renderer processes**: Each view/dialog runs in its own BrowserWindow with a preload script for IPC bridging

### Key Main Process Files

| File                                 | Purpose                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`                            | Entry point, CLI arg parsing, app startup                                                                                                                                                                  |
| `app.ts`                             | `JupyterApplication` — core app orchestration                                                                                                                                                              |
| `server.ts`                          | `JupyterServerFactory` — Docker/Podman/TinyRange container lifecycle                                                                                                                                       |
| `registry.ts`                        | Python environment detection (conda, venv, system) which was reused from previous codebase because this project is a fork from Jupyter Desktop and not yet cleaned up                                      |
| `eventmanager.ts`                    | IPC event routing between main and renderer                                                                                                                                                                |
| `eventtypes.ts`                      | `EventTypeMain` / `EventTypeRenderer` enums (60+ event types)                                                                                                                                              |
| `config/settings.ts`                 | `UserSettings` (global) and `WorkspaceSettings` (per working dir)                                                                                                                                          |
| `config/sessionconfig.ts`            | Session persistence (working dir, python path, server opts)                                                                                                                                                |
| `.github/workflows/e2e-app-test.yml` | Unified E2E test: builds and launches the Electron app, which starts the container via server.ts, then runs all tests (FSL BET, notebook, file CRUD, MRICron, shutdown) against the app-launched container |
| `neurodesk.yml`                      | Options to start a container that would be controlled by selected parameters                                                                                                                               |

### View/Dialog Pattern

Each UI component lives in its own directory under `src/main/` with a consistent structure:

- `<name>.ts` — Component logic
- `preload.ts` — Electron IPC bridge (exposed via `contextBridge`)
- `index.html` — HTML template (EJS)
- `<name>.css` — Styling

Key views: `sessionwindow/`, `labview/`, `welcomeview/`, `progressview/`, `settingsdialog/`, `aboutdialog/`, `authdialog/`

### Container Engine Support

Three backend engines managed in `server.ts`:

- **Docker** (primary)
- **Podman** (Linux alternative)
- **TinyRange** (lightweight QEMU-based VM, cross-platform)

Container naming: `neurodeskapp-<port>` for auto-started containers.

### Configuration Files

- `neurodesktop.toml` — Docker image version (`jupyter_neurodesk_version`) and launch parameters
- `package.json` — App version, tinyrange version, electron-builder config

## Code Conventions

- **Interface naming**: Must use `I` prefix (e.g., `IRegistry`, `IApplication`) — enforced by ESLint
- **Prettier**: Single quotes, no trailing commas, no arrow parens for single args
- **Imports**: Sort members alphabetically (ESLint `sort-imports`)
- **Modules**: CommonJS (`require`/`module.exports`), target ES2020
- **camelCase**: Enforced with exceptions for Jupyter protocol fields (snake_case allowed list in `.eslintrc.js`)

## Testing

No test suite is currently configured (`yarn test` exits with error). Verify changes by building and running the app (`yarn dev`).

## gstack

Use the /browse skill from gstack for all web browsing, never use mcp**claude-in-chrome**\* tools, and lists the available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade

## systematic-debugging

When debugging any bug, test failure, or unexpected behavior, follow the systematic debugging process in `.agents/skills/systematic-debugging/SKILL.md`.

Key rules:
- NO fixes without root cause investigation first (Phase 1)
- Complete all four phases: Root Cause Investigation -> Pattern Analysis -> Hypothesis Testing -> Implementation
- If 3+ fix attempts fail, stop and question the architecture
- For multi-component systems, add diagnostic instrumentation before proposing fixes
- Supporting techniques available in `.agents/skills/systematic-debugging/`: root-cause-tracing, defense-in-depth, condition-based-waiting
