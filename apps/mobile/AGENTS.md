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
npx expo run:ios             # build and install the development build (needed once, and after native changes)
pnpm start                   # dev server for the installed development build
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

## Things that bite

- Read data with `useView` from `src/lib/views.ts` and change it with `change` from `src/lib/change.ts`, so every screen gets optimistic updates, reverted views and the Undo toast. The logic itself is shared with the web app in `packages/backend/shared/client`.
- Hermes has no `toSorted`, `toReversed`, `findLast` or `findLastIndex`. `src/lib/array-methods.ts` adds them at startup because the shared code uses them.
- `api.x.y` is a new object on every read. Never put it in a hook dependency list. Use `getFunctionName` and depend on the name.
- A `formSheet` route needs a root `View` with `collapsable={false}`, or its content renders blank. A `fitToContents` sheet cannot use `flex: 1`.
- `Link asChild` drops a `style` function on its child. Use `Pressable` with `router.push`.
- `.env.local` wins over shell variables in Expo. That is why the local backend uses `EXPO_PUBLIC_DEV_CONVEX_URL` (see `scripts/dev-local.sh`).
- A JS overlay at the root sits under native sheets. Each sheet screen renders its own `Toaster`.
