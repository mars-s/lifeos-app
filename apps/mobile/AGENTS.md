# LifeOS mobile

Expo SDK 58 app, iPhone first. The root `AGENTS.md` rules apply here too.

## Expo changes every SDK

APIs you remember may be renamed, moved or removed. Before touching an Expo, EAS or React Native API:

1. Read the `expo` major version in `package.json`.
2. Read the matching docs at `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, start from https://docs.expo.dev/llms.txt and follow its links.

## Commands

```bash
npx expo install <package>   # always use this instead of pnpm add, so versions match the SDK
pnpm start                   # dev server, press i for the iOS Simulator
pnpm typecheck
pnpm export:ios              # bundle check without a device
npx expo-doctor              # dependency and config checks
```

## Rules

- Routes live in `src/app/` (Expo Router). Each route file stays thin and re-exports a screen from `src/components/`.
- UI comes from ExpoKit first (https://expokit.in). Add items with `npx @expokit/cli@latest add <name>`. Do not hand-edit `src/lib/kit.tsx` or `src/components/ui/*` unless you mean to fork them; `npx @expokit/cli@latest diff` shows local changes.
- Colours, radius and font come from `useKit()`. The calm palette is set once in `src/lib/kit-theme.tsx`. Never hard-code a colour in a screen.
- `ios/` and `android/` are generated (Continuous Native Generation). Configure native behaviour in `app.json` and config plugins, never by hand.
- Expo Go only bundles its own native modules. A library with other native code needs a development build: `npx expo run:ios` or `eas build --profile development`.
