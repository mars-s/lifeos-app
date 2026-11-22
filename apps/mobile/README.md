# LifeOS for iPhone

The iPhone app. It reads and writes the same hosted Convex backend as the web and Mac apps, so every list shows the same Tasks.

## Run it

The app uses native modules that Expo Go does not ship (Gesture Handler 3, Reanimated 4, the keyboard controller, SecureStore), so it runs as a development build.

Run every command below inside the repo's devenv (see the root README): install devenv, run `direnv allow` once, and `cd` into the repo. It gives Node, pnpm and CocoaPods, sets a UTF-8 locale for `pod install`, and leaves the compilers and SDK to Xcode. `devenv up metro` starts the dev server (step 3) on port 8081, or on `LIFEOS_METRO_PORT`. `devenv up` on its own starts only the web app. After a Node update or `nix-collect-garbage`, run `pod install` again: `ios/.xcode.env.local` holds the path to Node in the Nix store.

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
| Tabs | Today, Upcoming and Lists in the iOS 26 Liquid Glass tab bar, with Search as its own round tab. The bar shrinks as you scroll |
| Today and Inbox | One tab, two pages. The segmented switch at the top (it shows the Inbox count) or a sideways swipe moves between them, and the large title follows. The app reopens on the page you left |
| Lists | Anytime, Someday, Logbook, then Areas with their Projects, like the Things home |
| Search | Open Tasks by title, notes or Label, and Projects and Areas by name |
| A list | Live Tasks with a large title that turns to glass on scroll. Swipe a Task right to complete it, left to pick its When. Tap it to open the card |
| Task card | A sheet with the title, notes and Checklist Items (drag the handle to reorder, swipe left to delete), then When, Deadline, Estimate, Labels, Repeat (presets, Custom, After I finish it, Skip Next) and Move to (a searchable list of Areas and Projects, plus Inbox). Below them: Duplicate, Convert to Project and Move to Trash. With the AI Feature on, the Estimate sheet shows Smart Estimate guesses and the card offers Break into steps |
| Quick capture | The glass + button above the tab bar (a plain blue button when Reduce Transparency is on). One line with the same shortcuts as the web: `tomorrow 30m #label !fri @list`. A tap on the Today page makes the Task for today; anywhere else it lands in the Inbox |
| Settings | The gear on Lists. Your GitHub account and Sign out, the Features with the same switches as the web, the version and build, and a link to the web app (set `EXPO_PUBLIC_WEB_URL` in `.env.local`) |
| Offline | Every list you have seen is saved on the phone (`expo-sqlite` key-value store, never the sign-in tokens, which stay in the Keychain). The app opens on those lists at once, even with no network, and swaps in live data when Convex connects. Changes made offline show at once, can be undone, and send when the network is back, as long as the app stays open |
| Drag the + | Drag the + button into a list and a gap opens where the new Task will go. Let go to name it, and it lands exactly there, in every list. Drag back to the button to cancel |
| Hold and drag | Hold a Task still for a moment and it lifts. Drag it and the other rows move aside; let go to drop it there. In Today it can move into This Evening, and in Upcoming to another day. Moving sideways before the hold swipes instead, and moving up or down scrolls. VoiceOver has Move up and Move down |
| Focus pill | A glass pill beside the + button while a Focus Session runs, on every tab. It shows the Task, the round and the time left on a dot ring. Its button pauses, resumes, starts the break or skips it. Tap the pill for the Focus sheet |
| Focus sheet | A large dial, Stop, Pause or Resume, and +5 minutes. Switch between Stopwatch and Pomodoro and pick focus, Break and Long Break lengths, or type one (`40`, `1h 30m`). The plan is the same row the web and Mac use |
| Start a Focus Session | Hold a Task and let go without moving it for its menu (in Search and the Logbook a plain press and hold), or use Focus in the Task card. Rows and the card show Actual Time against the Estimate as dots |
| Time is up | Starting a Pomodoro schedules a local notification for when it ends, so it rings on the lock screen even with the app closed. iOS asks for permission at the first Pomodoro. In the app, a Success haptic plays instead |

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
