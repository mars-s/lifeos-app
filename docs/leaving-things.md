# Leaving Things

LifeOS is now the home of your Tasks. Things 3 only feeds LifeOS until you are ready to stop using it. That day is switch day. Nothing is ever written back to Things.

## Until switch day

LifeOS copies what is in Things into LifeOS:

- every few minutes while the LifeOS Mac app is open, and
- whenever you run `pnpm sync:things` in this repo.

Each copy is called an import. An import:

- brings in anything new you added in Things,
- brings in a change you made in Things, but only when you have not changed that same field in LifeOS since the last import. **LifeOS wins.** If you renamed a Task in LifeOS, a later rename in Things is ignored,
- never deletes anything from LifeOS. If you delete something in Things, it stays in LifeOS,
- changes nothing when nothing changed in Things. Running it twice in a row is safe.

So you can keep using Things for a while and LifeOS follows. Edits you make in LifeOS stay in LifeOS.

## What comes across

| From Things | In LifeOS |
| --- | --- |
| Areas | Areas, each with a colour |
| Projects (open, someday, completed, canceled) | Projects with the same status |
| Headings | Headings inside their Project |
| To-dos in Inbox, Today, This Evening, Upcoming, Anytime and Someday | Tasks with the same When (This Evening included) |
| Logbook | Completed and canceled Tasks, with the date you finished them |
| Trash | Tasks in LifeOS's Trash |
| Checklists | Checklist Items, ticked or not |
| Notes, Deadlines, start dates | The same fields |
| Tags | Labels |

Every imported record keeps its Things id, so "Open in Things" links keep working while Things is installed.

What does not come across:

- **Repeating to-dos.** Things keeps a hidden template for each one. LifeOS has no Recurrence Rules yet, so templates are skipped and the import lists them. The copies that already appeared in your lists come across as normal Tasks. You had none on 18 November 2026.
- **Tags on Areas, tag groups, reminders and contacts.** LifeOS has nowhere to put them yet. You had none on 18 November 2026.

## How it reads Things

The import copies Things' database files to a temporary folder, reads the copy, and deletes the copy. It never opens or changes Things' own files, and it does not need Things to be running.

macOS may ask once whether the app (your terminal, or LifeOS) may "access data from other apps". Say yes. If it never asks and the import says it cannot read the Things folder, give that app Full Disk Access in System Settings, Privacy and Security.

The import signs in to LifeOS with the Things sync token in your Keychain (`lifeos-app-things-sync`).

## Switch day

When you are ready to stop using Things, run this once in the repo:

```sh
pnpm things:switch
```

It does three things:

1. Runs one last import, so nothing you did in Things is left behind.
2. Marks Things as retired in LifeOS, with the date.
3. Turns the import off everywhere. The Mac app stops importing, the "Synced from Things" note in the sidebar goes away, and `pnpm sync:things` politely refuses from then on.

After that you can delete Things. Your Tasks keep their Things ids for reference. Nothing else changes.

There is no button to undo switch day. If you really need the import back, delete `retiredAt` from the one row in the `thingsSync` table in the Convex dashboard.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm sync:things` | One import now, with a short report |
| `pnpm sync:things -- --dry-run` | Reads Things and prints how many items sit in each list, without sending anything |
| `pnpm sync:things:watch` | An import every 5 minutes while the terminal stays open |
| `pnpm things:switch` | Switch day: last import, then retire Things |
