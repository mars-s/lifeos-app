export type Shortcut = { label: string; keys: readonly string[]; joiner?: "or" | "then"; only?: "app" | "browser" };

export const GLOBAL_CAPTURE_KEYS = "ctrl+shift+space";

export const SHORTCUT_GROUPS: readonly { title: string; shortcuts: readonly Shortcut[] }[] = [
  {
    title: "Capture",
    shortcuts: [
      { label: "Quick capture to the Inbox", keys: ["q"] },
      { label: "Quick capture from any app", keys: [GLOBAL_CAPTURE_KEYS], only: "app" },
      { label: "New Task here", keys: ["mod+n", "n"], only: "app" },
      { label: "New Task here", keys: ["n"], only: "browser" },
      { label: "New Task in Today", keys: ["t"] },
    ],
  },
  {
    title: "Find and do",
    shortcuts: [
      { label: "Command bar", keys: ["mod+k"] },
      { label: "Complete the selected Tasks", keys: ["mod+k", "enter"], joiner: "then" },
      { label: "Undo", keys: ["mod+z"] },
      { label: "This sheet", keys: ["?"] },
    ],
  },
  {
    title: "Move around",
    shortcuts: [
      { label: "Inbox to Trash", keys: ["mod+1–7", "1–7"], only: "app" },
      { label: "Inbox to Trash", keys: ["1–7"], only: "browser" },
      { label: "Planner or Upcoming", keys: ["8", "3"], joiner: "or" },
      { label: "Next or previous Task", keys: ["down", "up"], joiner: "or" },
      { label: "Settings", keys: ["mod+,"] },
      { label: "Open a Task", keys: ["space", "enter"] },
      { label: "Close a Task", keys: ["esc", "mod+enter"] },
    ],
  },
  {
    title: "Selected Tasks",
    shortcuts: [
      { label: "When: Today", keys: ["mod+t"], only: "app" },
      { label: "When: This Evening", keys: ["mod+e"] },
      { label: "Start Focus Session", keys: ["f"] },
      { label: "Add Work Block (Planner)", keys: ["b"] },
      { label: "Move up or down", keys: ["mod+up", "mod+down"], joiner: "or" },
      { label: "Select all", keys: ["mod+a"] },
      { label: "Move to Trash", keys: ["backspace"] },
    ],
  },
];
