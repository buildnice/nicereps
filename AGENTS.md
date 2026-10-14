# Agent instructions

## Source of truth

Read [PRODUCT.md](docs/PRODUCT.md), [DESIGN.md](docs/DESIGN.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md) before implementation. These files record agreed product behavior. Update them in the same PR when behavior changes. Ask about an unresolved product choice; resolve routine implementation details with the smallest working change.

Use **ponytail full** for coding: reuse project and platform capabilities, keep the diff narrow, and prove nontrivial logic. Use **caveman** only when the user asks for terse or caveman responses.

## Installed skills

The requested [Expo](https://github.com/expo/skills) and [Emil Kowalski](https://github.com/emilkowalski/skills) skill sets are vendored in `.agents/skills/` with pinned source revisions in [SOURCES.md](.agents/skills/SOURCES.md). Read `expo-overview` before Expo/EAS work, then its relevant leaf skill. Use `expo-project-structure` for initial layout, `expo-router` for navigation, and `expo-dev-client` for device delivery. The app does not use EAS Update. For interface work, read `emil-design-eng` and `animate-expo` when motion is involved. User instructions and the product contract take precedence over imported skill guidance.

## Working rules

- Keep domain rules independent of React, Expo, and screen state. App and CLI must call the same domain operations; adapters may differ for device and Node storage.
- Keep the released app functional with all radios off. No runtime API, remote media, account, analytics, or remote push dependency.
- Preserve recorded workouts when templates or catalog defaults change. Every user edit is durable before leaving its screen.
- Use CUIDs for record identity and migrations for schema changes. Treat imports as untrusted input; preview and validate before applying.
- Keep the home screen a single scrolling surface. Active logging replaces its content. Use inline expansion by default; sheets are for bounded tasks. No tab navigation.
- Use original branding, icons, and copy.
- Add no dependency, wrapper, setting, or comment without a concrete need. Use Expo-compatible package versions.
- Do not finalise a PR while it leaves open notes: every gap, question, or known bug it reports is fixed in the PR or opened as a GitHub issue.
- Finish the slice in the same PR: behavior PRODUCT.md or DESIGN.md assigns to its feature, plus related bugs and tidy-up or refactoring found while working. Do not list them as follow-ups. Ask when a gap needs a product choice, and record the answer in PRODUCT.md or DESIGN.md.

## Proof for each PR

- Run the narrowest relevant domain or CLI test, then the repository's current type, lint, and test gates.
- Demonstrate changed behavior at its real surface: CLI output for domain/CLI work; same-state screenshots from a running app for UI work; device evidence for timers, notifications, sharing, and native storage.
- Exercise offline mode, process restart, empty data, old data, and import failure when relevant. Prove that an interrupted workout resumes.
- Report the tested commit, commands, expected and observed result, and any unproven case. A green test without surface proof is insufficient for UI or native behavior.
