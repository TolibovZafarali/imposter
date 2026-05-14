# Imposter — Project Instructions for Claude Code

## 1. Project Overview

**Imposter** is a mobile party game built with Expo and React Native.
Players pass one phone around the table. Most players receive a secret word. One player is the Imposter — they receive no word, or a vague related clue. Players give hints in turn, then vote on who they think the Imposter is.

The Expo app lives in the `imposter-game/` subdirectory of this repo.
All `npm` / `expo` commands must be run from `imposter-game/`.

```
imposter/                  ← git repo root (this file lives here)
└── imposter-game/         ← Expo app root
    ├── app/               ← Expo Router screens
    ├── components/        ← reusable UI components
    ├── constants/         ← theme, design tokens
    ├── hooks/             ← custom hooks
    └── ...
```

---

## 2. Product Goals

- Minimal, smooth, modern, dark-first mobile UI.
- Pass-and-play: one phone, multiple players, no accounts.
- Multi-language from day one: UI strings and translated words must support any language.
- Stable category word data is currently empty and should be rebuilt from a clean source before static rounds are used.
- Movies and celebrities remain AI-generated server-side so they match the selected language and culture.

---

## 3. Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Framework | Expo ~54.0.33 | New Architecture enabled |
| UI runtime | React Native 0.81.5 | |
| Language | TypeScript ~5.9.2 | strict mode, `@/*` path alias |
| Navigation | Expo Router ~6.0.23 | already configured; `main` = `expo-router/entry` |
| State | React Context + useReducer | MVP only; no external state library |
| Styling | React Native StyleSheet | custom reusable components only; no UI library |
| Animations | react-native-reanimated ~4.1.1 | already installed |
| Gestures | react-native-gesture-handler ~2.28.0 | already installed |
| Haptics | expo-haptics ~15.0.8 | already installed |
| React | 19.1.0 | React Compiler enabled |
| Lint | eslint-config-expo | run with `npm run lint` |

**Not in scope for MVP:** database, auth, payments, ads, analytics, direct external AI API calls from the app.

**Backend:** Vercel Functions (or similar serverless). AI generation happens server-side only.

---

## 4. Development Rules

1. **Read before editing.** Always inspect the current file content before making any change.
2. **Explain the plan first.** Before touching code, describe what you intend to change and why.
3. **Small, focused changes.** One concern per edit. Do not refactor unrelated code while fixing a bug.
4. **No scope creep.** Do not add features, abstractions, or error handling beyond what the task requires.
5. **No comments explaining what the code does.** Only add a comment when the *why* is non-obvious (hidden constraint, workaround, subtle invariant).
6. **Prefer simple TypeScript.** No clever generics or abstractions unless they eliminate real repetition.
7. **No UI library.** Build components from `View`, `Text`, `Pressable`, and `StyleSheet` only.
8. **No new packages** without explicit user approval.
9. **No backend, AI, auth, database, ads, payments, or analytics** code unless explicitly approved.
10. **Do not expose API keys** in the Expo app under any circumstances.
11. **Portrait orientation is locked.** Do not change `app.json` orientation.
12. **After every edit**, list the changed files and briefly explain what changed (one sentence each).
13. **Run available checks** (`npm run lint`, TypeScript compiler) when appropriate after editing.

---

## 5. Architecture Principles

### Navigation
- Expo Router file-based routing. All screens live under `imposter-game/app/`.
- The current `(tabs)` template is starter code — it will be replaced in Phase 2.
- Game flow is a linear stack, not a tab bar.
- Recommended screen structure (Phase 2 and beyond):
  ```
  app/
  ├── _layout.tsx          ← root layout, GameProvider wraps everything
  ├── index.tsx            ← home / lobby
  ├── setup.tsx            ← player count, language, category
  ├── reveal/
  │   └── [playerIndex].tsx ← word reveal per player (pass phone)
  ├── hints.tsx            ← hint-giving phase
  ├── vote.tsx             ← voting phase
  └── result.tsx           ← round result / imposter reveal
  ```

### State
- Single `GameContext` with `useReducer` at the root layout.
- Game state shape (to be defined in Phase 4):
  - players, current player index, secret word, imposter index, phase, votes, round config.
- Keep game *logic* (reducers, selectors, types) in `imposter-game/game/` — separate from UI.
- Keep AI generation logic in `imposter-game/services/` — separate from local game logic.

### Styling
- Design tokens live in `imposter-game/constants/theme.ts`. Extend this file; do not scatter raw values.
- Dark-first palette. Light mode is optional for MVP.
- Use `StyleSheet.create` for all styles. No inline style objects outside of dynamic values.
- Reusable primitives (Button, Card, etc.) live in `imposter-game/components/`.

### Separation of concerns
```
game/          ← pure logic: types, reducers, round generation, validation
services/      ← async side effects: AI round client
components/    ← dumb UI primitives (no game logic)
app/           ← screen-level composition (thin: orchestrate context + components)
constants/     ← tokens only
hooks/         ← derived UI state, device utilities
```

---

## 6. MVP Phase Plan

| Phase | Goal | Status |
|---|---|---|
| 1 | Documentation and project rules | ✅ Done |
| 2 | App shell and navigation | Not started |
| 3 | Reusable UI components | Not started |
| 4 | Local game state and types | Not started |
| 5 | Playable game loop with static and AI-assisted rounds | Not started |
| 6 | Voting and results logic | Not started |
| 7 | AI round service integration | Not started |
| 8 | Real backend AI generation (Vercel Function) | Not started |
| 9 | Connect frontend to backend | Not started |
| 10 | Polish: animations, haptics, TestFlight / App Store prep | Not started |

---

## 7. Game Flow

```
Home Screen
  └─► Setup Screen (players, language, category, rounds)
        └─► Reveal Screen × N players (each player taps to see their word / "You are the Imposter")
              └─► Hints Screen (each player gives one hint aloud; app tracks turn order)
                    └─► Vote Screen (each player secretly votes for who they think the Imposter is)
                          └─► Result Screen (reveal Imposter, show votes, win/lose outcome)
                                ├─► Play Again (same settings)
                                └─► Home Screen
```

### Imposter Assignment Rules
- Exactly one player is the Imposter per round.
- All other players receive the **same** secret word.
- The Imposter receives either: no word at all, or a vague related clue (configurable).
- The Imposter assignment is random and must not be predictable from reveal order.

### Reveal Screen Rules
- One screen per player, navigated sequentially.
- Each player taps "Show my word", sees it, then taps "Done" to hand the phone to the next player.
- No player should be able to see another player's word by navigating back.
- Disable back navigation during the reveal phase.

---

## 8. AI Generation Rules

- **AI calls happen server-side only.** The Expo app never calls an AI API directly.
- Stable English categories are selected from `imposter-game/data/wordBank.ts` once static word data exists.
- For non-English stable categories, the backend translates the selected English word and one-word clue once static word data exists.
- For movies and celebrities, the backend generates the word and clue directly in the selected language.
- The backend returns a validated object: `{ word: string, clue: string }`.
- Validate all AI output against a strict Zod schema before returning it to the client.
- If the AI response is invalid or the request fails, return an error and let the UI ask the user to retry.
- Do not add mock round generators or hardcoded fallback rounds.
- The frontend service layer (`services/roundGenerator.ts`) chooses local static, translated static, or AI generation.
- Never log or expose the raw AI prompt or response in the mobile app.

---

## 9. Safety Rules for Future Edits

- **Ask before changing architecture.** If a proposed change affects folder structure, state design, navigation patterns, or adds a new dependency, stop and ask first.
- **Do not rewrite files that are not part of the task.** If you notice an unrelated issue, mention it — do not fix it silently.
- **Do not install packages** without explicit approval. State the package name and reason before adding it.
- **Do not change `app.json`** (orientation, scheme, bundle ID, icons) without explicit approval.
- **Do not touch `scripts/reset-project.js`** — it is a destructive utility, not part of the game.
- **Do not add light-mode-specific styles** in early phases. Keep the palette dark-first.
- **Do not add loading spinners or skeletons** until async data actually exists.
- **Keep TypeScript strict.** Do not use `any`, `as unknown`, or disable strict checks.
- **Keep stable category data explicit.** Do not reintroduce mock or fallback round data.

---

## 10. Prompting Rules for Claude Code

When starting a new session on this project:

1. Read `CLAUDE.md` first (this file).
2. Read the files relevant to the task before proposing changes.
3. State the plan in plain English before writing any code.
4. Make the smallest change that accomplishes the goal.
5. After editing, list every changed file with a one-sentence summary of what changed.
6. If a task seems larger than one focused change, break it into steps and confirm before proceeding.
7. If something is unclear, ask — do not guess and implement.
8. Do not leave placeholder comments like `// TODO: implement later` unless the user explicitly asks for a stub.
9. Prefer explicit over implicit — readable beats clever.
10. Run `npm run lint` from `imposter-game/` after editing TypeScript or TSX files when appropriate.

### Quick-reference commands (run from `imposter-game/`)

```bash
npm run start          # start Expo dev server
npm run ios            # open iOS simulator
npm run android        # open Android emulator
npm run lint           # run ESLint
npx tsc --noEmit       # type-check without compiling
```

---

## 11. Git Commit and Push Rules

Claude Code may only commit or push when the user explicitly asks.

When the user says "commit", "commit this", or similar:

1. Inspect `git status`.
2. Review the changed files.
3. Run appropriate checks when relevant:
   - `npm run lint`
   - `npx tsc --noEmit`
4. Stage only files related to the completed task.
5. Create one focused commit using Conventional Commit format.
6. After committing, show:
   - commit hash
   - commit message
   - files included

When the user says "commit and push":

1. Follow all commit rules above.
2. Push the current branch to its configured remote.
3. Never force push unless the user explicitly says "force push".
4. Never amend a commit unless the user explicitly says "amend".
5. Never include unrelated files in the commit.

### Commit Message Format

Use Conventional Commits:

```bash
type(scope): short imperative summary

---

## Notes on Current State (Phase 1 complete)

- The app is still in the **default Expo template state** with a `(tabs)` layout (Home + Explore).
- This template code will be **fully replaced** in Phase 2.
- `constants/theme.ts` exists with light/dark color tokens and platform font maps — extend it rather than replacing it.
- `expo-haptics`, `react-native-reanimated`, and `react-native-gesture-handler` are already installed.
- Expo Router is already configured (`main: "expo-router/entry"`, typed routes enabled).
- New React Architecture (`newArchEnabled: true`) and React Compiler (`reactCompiler: true`) are both enabled.
