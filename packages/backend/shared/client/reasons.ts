const REASONS: Record<string, string> = {
  empty_title: "It needs a title.",
  not_found: "It was removed somewhere else.",
  invalid_estimate: "An Estimate is between one minute and a day.",
  invalid_date: "That date does not exist.",
  changed_since: "It was changed again after that.",
  already_undone: "It was already undone.",
  invalid_icon: "That icon is not one LifeOS knows.",
  name_taken: "Another Label already has that name.",
  not_trashed: "It is no longer in Trash.",
  not_undoable: "That change is permanent.",
  invalid_focus: "That Focus Session has already changed.",
  invalid_block: "A Work Block needs a real time and length.",
  invalid_plan: "That day could not be planned.",
  selection_too_large: "That is too many Tasks at once. Try 500 or fewer.",
  invalid_schedule: "That repeat cannot happen. Check its days and when it ends.",
  stale_occurrence: "That repeat has already moved on.",
  invalid_template: "That Template is not valid.",
};

export const reasonFor = (kind: string | undefined) => (kind && REASONS[kind]) || "LifeOS could not save it. Try again.";
