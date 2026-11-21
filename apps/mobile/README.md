# LifeOS for iPhone

The iPhone app. It reads and writes the same hosted Convex backend as the web and Mac apps, so every list shows the same Tasks.

## Run it

The app uses native modules that Expo Go does not ship (Gesture Handler 3, Reanimated 4, the keyboard controller, SecureStore), so it runs as a development build.

1. Write the deployment URL to `apps/mobile/.env.local`:

   ```sh
   EXPO_PUBLIC_CONVEX_URL=https://curious-pigeon-412.ap-southeast-2.convex.cloud
   ```

2. Build and install it on the iOS Simulator. The first build takes about ten minutes. Later builds take one or two.

   ```sh
   cd apps/mobile
   npx expo run:ios
   ```

3. From then on, start only the dev server and open the installed app:

   ```sh
   pnpm dev:mobile
   ```

Rebuild with `npx expo run:ios` after adding a package with native code or changing `app.json`. To put it on a real iPhone, plug it in and run `npx expo run:ios --device`.

## Put it on your iPhone with Sideloadly

This makes a release `.ipa` with the JavaScript built in, so it runs without a dev server. It is unsigned: Sideloadly signs it with your Apple ID.

1. Check `apps/mobile/.env.local` holds `EXPO_PUBLIC_CONVEX_URL` (step 1 above).
2. Build it. It takes about ten minutes.

   ```sh
   sh apps/mobile/scripts/build-ipa.sh
   ```

   The file lands at `apps/mobile/build/LifeOS.ipa`.

3. Open Sideloadly, plug in the iPhone, drag `LifeOS.ipa` in, type your Apple ID and press Start.
4. On the iPhone, open Settings, General, VPN & Device Management, and trust your Apple ID. Developer Mode must be on (Settings, Privacy & Security, Developer Mode).

With a free Apple ID the app stops opening after 7 days. Run Sideloadly again to refresh it; your Tasks live in Convex, so nothing is lost. A free Apple ID can only keep 3 sideloaded apps at once.

## Sign in

Tap **Sign in with GitHub**. iOS asks to open github.com, then GitHub asks for your login. The sheet closes on its own and the app opens. The session is kept in the Keychain, so the app stays signed in after it is closed. Any GitHub account other than the owner sees "This is not your LifeOS". `docs/auth.md` explains the flow.

## What is here

| Screen | What it does |
| --- | --- |
| Tabs | Today, Upcoming, Inbox and Lists in the iOS 26 Liquid Glass tab bar, with Search as its own round tab. The bar shrinks as you scroll |
| Lists | Anytime, Someday, Logbook, then Areas with their Projects, like the Things home |
| Search | Open Tasks by title, notes or Label, and Projects and Areas by name |
| A list | Live Tasks with a large title that turns to glass on scroll. Swipe a Task right to complete it, left to pick its When. Tap it to open the card |
| Task card | A sheet with the title, notes, Checklist Items, When, Deadline, Estimate, Labels and Repeat |
| Quick capture | The glass + button above the tab bar (a plain blue button when Reduce Transparency is on). One line with the same shortcuts as the web: `tomorrow 30m #label !fri @list` |
| Drag the + | Drag the + button into a list and a gap opens where the new Task will go. Let go to name it. In Inbox, Anytime, Someday, Areas and Projects it lands exactly there. Today and Upcoming have no hand-set order yet, so the gap opens at the end of a section (Today, This Evening, a day). Drag back to the button to cancel |

Every change shows in the same frame and raises an Undo toast. Shaking the phone undoes the newest change.

## Where things live

| What | Where |
| --- | --- |
| Routes (thin, one line each) | `src/app` |
| Screens | `src/components` |
| ExpoKit components | `src/components/ui` (add with `npx @expokit/cli@latest add <name>`) |
| Live views, the change engine, toasts, haptics, motion values | `src/lib` |
| Optimistic updates, undo, Task actions, the capture parser and date words | `packages/backend/shared/client`, shared with the web app |

## Check screens with sample data

`scripts/dev-local.sh` points a development build at a throwaway local backend, so swipes and edits never touch real Tasks.

```sh
SCRATCH=/tmp/lifeos-mobile CONVEX_PORTS="--local-cloud-port 3510 --local-site-port 3511" sh apps/web/scripts/local-backend.sh
(cd /tmp/lifeos-mobile && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable --local-cloud-port 3510 --local-site-port 3511) &
SESSION=/tmp/lifeos-mobile/session.json CONVEX_URL=http://127.0.0.1:3510 PORT=8082 sh apps/mobile/scripts/dev-local.sh
```

Then open the app against port 8082. The script signs the app in with the session the local backend made. It only works in a development build and only with the local URL.

## Checks

```sh
pnpm --filter @lifeos/mobile typecheck
cd apps/mobile && npx expo-doctor
pnpm check
```
