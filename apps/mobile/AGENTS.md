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

- There is no router yet. Add Expo Router when the app needs a second screen, with routes in `src/app/`.
- `ios/` and `android/` are generated (Continuous Native Generation). Configure native behaviour in `app.json` and config plugins, never by hand.
- Expo Go only bundles its own native modules. A library with other native code needs a development build: `npx expo run:ios` or `eas build --profile development`.
