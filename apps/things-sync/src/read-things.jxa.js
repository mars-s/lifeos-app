function run() {
  const app = Application("com.culturedcode.ThingsMac");
  if (!app.running()) throw new Error("Things is not running");
  const pad = (n) => String(n).padStart(2, "0");
  const civil = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);
  const idOf = (ref) => (ref ? ref.id() : null);
  const column = (items) => ({
    ids: items.id(),
    titles: items.name(),
    notes: items.notes(),
    statuses: items.status(),
    starts: items.activationDate().map(civil),
    deadlines: items.dueDate().map(civil),
    tags: items.tagNames(),
    areas: items.area().map(idOf),
    modified: items.modificationDate().map((d) => d.getTime()),
  });
  const list = (id) => {
    const items = app.lists.byId(id).toDos;
    return { ...column(items), projects: items.project().map(idOf) };
  };
  return JSON.stringify({
    lists: {
      today: list("TMTodayListSource"),
      inbox: list("TMInboxListSource"),
      upcoming: list("TMCalendarListSource"),
      someday: list("TMSomedayListSource"),
      anytime: list("TMNextListSource"),
    },
    projects: column(app.projects),
    areas: { ids: app.areas.id(), titles: app.areas.name() },
    trash: app.lists.byId("TMTrashListSource").toDos.id(),
  });
}
