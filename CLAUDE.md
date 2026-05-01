# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Dev server at localhost:3000 with HMR
npm run build      # Production build to dist/
npm run preview    # Preview production build
npm run lint       # Type-check only (tsc --noEmit) — no linter configured
npm run clean      # Remove dist/
```

No test framework is configured. There are no unit or integration tests.

## Environment

Requires `GEMINI_API_KEY` in `.env.local` (see `.env.example`). Vite injects it at build time via `process.env.GEMINI_API_KEY` in `vite.config.ts`.

## Architecture

**Dispersion Lab** is a single-page React 19 golf analytics app with 6 interactive drills and an AI coach. Built with Vite + TypeScript + Tailwind CSS 4.

### Single-file app

The entire application lives in `src/App.tsx` (~1130 lines). It is organized into sections separated by comment banners:

1. **Core Data Models & Math** (lines 5–57) — Golf dispersion/carry formulas, handicap estimation, proximity calculation. All scaling uses the 16-club `CLUBS` constant.
2. **UI Components** (lines 59–126) — Reusable `DrillHeader`, `InputField`, `StatBox`, `GoldButton` components.
3. **Drill Components** (lines 128–1030) — Six drills plus AI Coach and Bag Setup, each a standalone function component:
   - `DispersionDrill` — 20-shot scatter plot (SVG) with dispersion ellipse overlay
   - `CombineDrill` — 7-iron 10-shot proximity scoring (100 pts/shot, -3.5/yard)
   - `WedgeMatrixDrill` — 50/75/100 yard distance control, letter grades
   - `ScrambleDrill` — Chip proximity → expected scramble %
   - `ImpactDrill` — Ball flight "Big 3" (spin/launch/smash) with manual and sim modes
   - `DecadeDrill` — DECADE Tiger 5 error counting
   - `AICoachView` — Image upload → Gemini AI extracts metrics, generates markdown insights
   - `TargetTables` — Override default carry distances per club
4. **Main App Shell** (lines 1035–1132) — Header, handicap slider (0–25), sticky tab navigation (8 tabs), content routing.

### State & persistence

- Component-level `useState` only — no context, no state library.
- Session history persists in `localStorage` under key `golf_dispersion_history` as a JSON array of `{ id, date, drill, data }` objects.
- `saveSession(drillName, data)` appends to history and writes to localStorage.

### Styling

All styling is inline `style={{}}` objects (not Tailwind utility classes, despite Tailwind being installed). "Quiet luxury" theme: dark background `#1A1A1A`, gold accent `#D4AF37`, serif headers (Cormorant Garamond), sans body (Montserrat). Google Fonts loaded via `<link>` in the render output.

### Gemini AI integration

`AICoachView` uses `@google/genai` (`GoogleGenAI`) to:
- Accept image uploads (scorecards, trackman screenshots) with text context
- Extract drill name and metrics from the image
- Generate markdown analysis of full session history via `react-markdown`

### Path alias

`@/*` maps to project root in both `tsconfig.json` and `vite.config.ts`.

## Adding a new drill

1. Create a component function following the existing pattern (accept `saveSession` prop, use `DrillHeader`/`InputField`/`StatBox`).
2. Add an entry to the `tabs` array in the main `App` component.
3. Add a conditional render in the main content area (`{activeTab === "yourId" && <YourDrill ... />}`).
