const GLYPHS = {
  0: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ":": [".", ".", "#", ".", "#", ".", "."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  "+": ["...", "...", ".#.", "###", ".#.", "...", "..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
};

const SERIES = ["var(--ink)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
const SVG = "http://www.w3.org/2000/svg";
const BINDING = /\{([^{}]*)\}/g;
const TEXT = "#text";

const el = (tag, className, children = []) => {
  const made = document.createElement(tag);
  if (className) made.className = className;
  made.append(...children);
  return made;
};

const shape = (tag, attrs = {}, children = []) => {
  const made = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) made.setAttribute(key, String(value));
  made.append(...children);
  return made;
};

const tidy = (value) => {
  if (typeof value !== "number") return String(value ?? "");
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
};

const cell = (value) => {
  const trimmed = value.trim();
  return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed;
};

export const readCsv = (text) => {
  const [head = "", ...lines] = text.split("\n").filter((line) => line.trim() !== "");
  const keys = head.split(",").map((key) => key.trim());
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(keys.map((key, index) => [key, cell(cells[index] ?? "")]));
  });
};

const FOLDS = {
  count: (column) => column.length,
  sum: (column) => column.reduce((total, value) => total + (Number(value) || 0), 0),
  avg: (column) => (column.length === 0 ? 0 : column.reduce((total, value) => total + (Number(value) || 0), 0) / column.length),
  min: (column) => Math.min(...column.map(Number)),
  max: (column) => Math.max(...column.map(Number)),
  first: (column) => column[0],
  last: (column) => column.at(-1),
};

const lookup = (store, scope, path) => {
  const [head = "", field, fold] = path.trim().split(".");
  if (scope && field === undefined && Object.hasOwn(scope, head)) return scope[head];
  if (field === undefined && Object.hasOwn(store.values, head)) return store.values[head];
  const rows = store.tables[head];
  if (rows === undefined) return store.waiting.has(head) ? undefined : "-";
  if (field === undefined || field === "count") return rows.length;
  const column = rows.map((row) => row[field]);
  if (fold !== undefined && Object.hasOwn(FOLDS, fold)) return FOLDS[fold](column);
  return column[0];
};

const makeReader = (store, scope) => (template) => {
  if (template === undefined) return undefined;
  let pending = false;
  const text = template.replace(BINDING, (_, path) => {
    const value = lookup(store, scope, path);
    if (value === undefined) pending = true;
    return tidy(value);
  });
  return pending ? null : text;
};

const inline = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

const markdown = (text) => {
  const blocks = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const bullet = /^[-*] (.*)$/.exec(trimmed);
    const head = /^#{1,3} (.*)$/.exec(trimmed);
    const last = blocks.at(-1);
    if (trimmed === "") blocks.push({ kind: "gap" });
    else if (bullet && last?.kind === "list") last.items.push(bullet[1]);
    else if (bullet) blocks.push({ kind: "list", items: [bullet[1]] });
    else if (head) blocks.push({ kind: "head", text: head[1] });
    else if (last?.kind === "para") last.text += ` ${trimmed}`;
    else blocks.push({ kind: "para", text: trimmed });
  }
  return blocks
    .map((block) => {
      if (block.kind === "list") return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
      if (block.kind === "head") return `<p class="gu-head">${inline(block.text)}</p>`;
      return block.kind === "para" ? `<p>${inline(block.text)}</p>` : "";
    })
    .join("");
};

const isPlain = (text) => !/[*`[\n#]|^- /.test(text);

const ghost = (width, height = 12) => {
  const bar = el("span", "gu-ghost");
  bar.style.width = width;
  bar.style.height = `${height}px`;
  return bar;
};

const dotFigure = () => {
  const svg = shape("svg", { class: "gu-dots", role: "img" });
  let shown = "";
  const draw = (value) => {
    if (value === shown) return;
    shown = value;
    const pitch = 5.5;
    const radius = pitch * 0.37;
    const lit = new Set();
    let column = 0;
    for (const character of value) {
      const rows = GLYPHS[character];
      rows.forEach((row, y) => [...row].forEach((mark, x) => mark === "#" && lit.add(`${column + x}:${y}`)));
      column += rows[0].length + 1;
    }
    const columns = Math.max(1, column - 1);
    const width = (columns - 1) * pitch + radius * 2;
    const height = 6 * pitch + radius * 2;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-label", value);
    const wanted = columns * 7;
    while (svg.childElementCount > wanted) svg.lastElementChild.remove();
    while (svg.childElementCount < wanted) svg.append(shape("circle", { r: radius }));
    [...svg.children].forEach((dot, index) => {
      const x = Math.floor(index / 7);
      const y = index % 7;
      dot.setAttribute("cx", String(x * pitch + radius));
      dot.setAttribute("cy", String(y * pitch + radius));
      dot.style.transitionDelay = `${x * 6}ms`;
      dot.style.opacity = lit.has(`${x}:${y}`) ? "1" : "0";
    });
  };
  return { svg, draw };
};

const canDot = (value) => value !== "" && value.length <= 9 && [...value].every((character) => Object.hasOwn(GLYPHS, character));

const renderNum = (node, cx) => {
  const label = el("p", "gu-num-label");
  const state = el("p", "gu-num-state");
  const figure = dotFigure();
  const plain = el("p", "gu-num-plain");
  const unit = el("span", "gu-unit");
  const value = el("div", "gu-num-value", [figure.svg, plain, unit]);
  const box = el("div", `gu-num${node.attrs.size === "small" ? " gu-num-small" : ""}`, [el("div", "gu-num-top", [label, state]), value]);
  if (node.attrs.tone) box.dataset.tone = node.attrs.tone;
  const wait = ghost("4.5rem", 28);
  return {
    el: box,
    update: () => {
      const read = cx.read(node.attrs.value);
      const text = read ?? "";
      const trailing = node.attrs.unit === undefined && text.endsWith("%") ? "%" : "";
      const shownUnit = cx.read(node.attrs.unit) ?? trailing;
      const body = trailing ? text.slice(0, -1) : text;
      const dotted = node.attrs.size !== "small" && canDot(body);
      cx.say(label, cx.read(node.attrs.label) ?? "");
      cx.say(state, cx.read(node.attrs.state) ?? "");
      label.hidden = node.attrs.label === undefined;
      state.hidden = node.attrs.state === undefined;
      unit.textContent = shownUnit;
      unit.hidden = shownUnit === "";
      figure.svg.style.display = dotted && read !== null ? "" : "none";
      plain.hidden = dotted || read === null;
      if (read === null) value.prepend(wait);
      else wait.remove();
      if (dotted) figure.draw(body);
      else cx.say(plain, body);
    },
  };
};

const share = (value, max) => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0);

const METER = {
  ring: (box) => {
    const total = 48;
    const size = 104;
    const dots = Array.from({ length: total }, (_, index) => {
      const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
      return shape("circle", { cx: size / 2 + Math.cos(angle) * 46, cy: size / 2 + Math.sin(angle) * 46, r: 2.1 });
    });
    const figure = el("span", "gu-ring-value");
    const ring = el("div", "gu-ring", [shape("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, "aria-hidden": "true" }, dots), el("span", "gu-ring-text", [figure])]);
    box.prepend(ring);
    return (part, value, max, unitText, cx) => {
      const lit = Math.round(part * total);
      dots.forEach((dot, index) => dot.classList.toggle("gu-on", index < lit));
      cx.say(figure, max === 100 ? `${tidy(value)}%` : tidy(value));
    };
  },
  bar: (box) => {
    const fill = el("span", "gu-bar-fill");
    box.append(el("div", "gu-bar", [fill]));
    return (part) => {
      fill.style.transform = `scaleX(${part})`;
    };
  },
  ticks: (box) => {
    const ticks = Array.from({ length: 36 }, () => el("span", "gu-tick"));
    box.append(el("div", "gu-ticks", ticks));
    return (part) => {
      const lit = Math.round(part * ticks.length);
      ticks.forEach((tick, index) => tick.classList.toggle("gu-on", index < lit));
    };
  },
  dots: (box) => {
    const row = el("div", "gu-capdots");
    box.append(row);
    return (part, value, max) => {
      const total = Math.max(1, Math.min(40, Math.round(max)));
      const lit = Math.round(part * total);
      while (row.childElementCount > total) row.lastElementChild.remove();
      while (row.childElementCount < total) row.append(el("span", "gu-capdot"));
      [...row.children].forEach((dot, index) => dot.classList.toggle("gu-on", index < lit));
    };
  },
};

const renderMeter = (node, cx) => {
  const kind = Object.hasOwn(METER, node.attrs.kind ?? "") ? node.attrs.kind : "bar";
  const label = el("span", "gu-meter-label");
  const figure = el("span", "gu-meter-value");
  const line = el("div", "gu-meter-line", [label, figure]);
  const box = el("div", `gu-meter gu-meter-${kind}`, [line]);
  box.setAttribute("role", "meter");
  const draw = METER[kind](box);
  return {
    el: box,
    update: () => {
      const read = cx.read(node.attrs.value);
      const max = Number(cx.read(node.attrs.max) ?? 100) || 100;
      const value = Number(read ?? 0) || 0;
      const unit = cx.read(node.attrs.unit) ?? "";
      const name = cx.read(node.attrs.label) ?? "";
      box.classList.toggle("gu-wait", read === null);
      box.setAttribute("aria-valuenow", String(value));
      box.setAttribute("aria-valuemax", String(max));
      box.setAttribute("aria-label", name || "Progress");
      cx.say(label, name);
      cx.say(figure, read === null ? "" : `${tidy(value)} of ${tidy(max)}${unit ? ` ${unit}` : ""}`);
      draw(share(value, max), value, max, unit, cx);
    },
  };
};

const nice = (value) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
};

const tally = (rows, x, y, series) => {
  const xs = [];
  const names = [];
  const totals = new Map();
  rows.forEach((row, index) => {
    const at = x === undefined ? String(index + 1) : tidy(row[x]);
    const name = series === undefined ? "" : tidy(row[series]);
    if (!xs.includes(at)) xs.push(at);
    if (!names.includes(name)) names.push(name);
    const key = `${name}\u0000${at}`;
    totals.set(key, (totals.get(key) ?? 0) + (y === "count" ? 1 : Number(row[y]) || 0));
  });
  return { xs, names, at: (name, x1) => totals.get(`${name}\u0000${x1}`) ?? 0 };
};

const renderChart = (node, cx) => {
  const mark = node.attrs.mark ?? "bar";
  const spark = mark === "spark";
  const readout = el("span", "gu-chart-readout");
  const top = el("div", "gu-chart-top", [el("span", "gu-chart-max"), readout]);
  const plot = el("div", "gu-plot");
  const legend = el("div", "gu-legend");
  const box = el("div", `gu-chart${spark ? " gu-chart-spark" : ""}`, spark ? [plot] : [top, plot, legend]);
  box.tabIndex = spark ? -1 : 0;
  let model;
  let focus = -1;

  const paint = () => {
    const rows = cx.store.tables[node.attrs.data];
    box.classList.toggle("gu-wait", rows === undefined);
    plot.replaceChildren();
    if (rows === undefined) {
      plot.append(...[0.5, 0.8, 0.6, 0.95, 0.7, 0.4, 0.75].map((height) => ghost("100%", Math.round(height * (spark ? 28 : 120)))));
      return;
    }
    if (rows.length === 0) {
      plot.append(el("p", "gu-empty", ["No data yet"]));
      return;
    }
    const { xs, names, at } = tally(rows, node.attrs.x, node.attrs.y, node.attrs.series);
    const stacked = mark === "bar" || mark === "area";
    const totals = xs.map((x1) => names.reduce((sum, name) => sum + at(name, x1), 0));
    const every = xs.flatMap((x1) => names.map((name) => at(name, x1)));
    const high = nice(Math.max(...(stacked ? totals : every), 0));
    const lowest = Math.min(...every);
    const low = stacked || lowest <= 0 || (high - lowest) / high > 0.5 ? 0 : Math.floor(lowest * 0.9);
    const width = Math.max(120, plot.clientWidth || 320);
    const height = spark ? 32 : Number(node.attrs.h) || 132;
    const foot = spark ? 0 : 18;
    const inner = height - foot - 4;
    const band = width / xs.length;
    const px = (index) => (mark === "bar" ? band * (index + 0.5) : xs.length === 1 ? width / 2 : 4 + ((width - 8) * index) / (xs.length - 1));
    const py = (value) => 4 + inner - ((value - low) / (high - low || 1)) * inner;
    const svg = shape("svg", { viewBox: `0 0 ${width} ${height}`, width, height, "aria-hidden": "true" });
    if (!spark) svg.append(shape("line", { x1: 0, x2: width, y1: py(low) + 0.5, y2: py(low) + 0.5, class: "gu-axis" }), shape("line", { x1: 0, x2: width, y1: py(high), y2: py(high), class: "gu-gridline" }));
    const bases = xs.map(() => low);
    names.forEach((name, order) => {
      const ink = SERIES[order % SERIES.length];
      const values = xs.map((x1) => at(name, x1));
      if (mark === "bar") {
        const wide = Math.max(3, Math.min(band * 0.62, 30));
        values.forEach((value, index) => {
          const from = bases[index];
          bases[index] += value;
          const tall = Math.max(0, py(from) - py(from + value));
          svg.append(shape("rect", { x: px(index) - wide / 2, y: py(from + value), width: wide, height: tall, rx: Math.min(3, tall / 2), fill: ink, class: "gu-bar-mark", "data-i": index }));
        });
        return;
      }
      const points = values.map((value, index) => [px(index), py(value)]);
      const path = points.map(([x1, y1], index) => `${index === 0 ? "M" : "L"}${x1.toFixed(1)},${y1.toFixed(1)}`).join("");
      if (mark === "area") svg.append(shape("path", { d: `${path}L${px(xs.length - 1)},${py(low)}L${px(0)},${py(low)}Z`, fill: ink, class: "gu-area-mark" }));
      if (mark !== "point") svg.append(shape("path", { d: path, stroke: ink, class: "gu-line-mark" }));
      const dots = mark === "point" ? points : points.slice(-1);
      svg.append(...dots.map(([x1, y1]) => shape("circle", { cx: x1, cy: y1, r: mark === "point" ? 3 : 2.5, fill: ink })));
    });
    const cursor = shape("line", { y1: 2, y2: py(low), class: "gu-cursor" });
    svg.append(cursor);
    if (!spark) {
      const room = Math.max(1, Math.floor(width / 44));
      const stride = Math.ceil(xs.length / room);
      xs.forEach((x1, index) => {
        if (index % stride !== 0 && index !== xs.length - 1) return;
        if (index === xs.length - 1 && index % stride !== 0 && stride > 1 && xs.length - 1 - Math.floor((xs.length - 1) / stride) * stride < stride / 2) return;
        const label = shape("text", { x: px(index), y: height - 4, class: "gu-x", "text-anchor": mark === "bar" ? "middle" : index === 0 ? "start" : index === xs.length - 1 ? "end" : "middle" });
        label.textContent = x1.length > 6 ? `${x1.slice(0, 5)}…` : x1;
        svg.append(label);
      });
    }
    plot.append(svg);
    top.firstElementChild.textContent = tidy(high);
    legend.replaceChildren(...(names.length > 1 ? names.map((name, order) => el("span", "gu-key", [Object.assign(el("i"), { style: `background:${SERIES[order % SERIES.length]}` }), name])) : []));
    legend.hidden = names.length < 2;
    const what = node.attrs.y === "count" ? "count" : node.attrs.y;
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `${mark === "spark" ? "Line" : mark} chart of ${what}${node.attrs.x ? ` by ${node.attrs.x}` : ""}, ${xs.length} values, ${tidy(Math.min(...totals))} to ${tidy(Math.max(...totals))}`);
    model = { xs, totals, px, cursor, band, width };
    point(focus);
  };

  const point = (index) => {
    if (!model) return;
    focus = index;
    const on = index >= 0 && index < model.xs.length;
    model.cursor.style.opacity = on ? "1" : "0";
    if (on) {
      model.cursor.setAttribute("x1", String(model.px(index)));
      model.cursor.setAttribute("x2", String(model.px(index)));
    }
    plot.querySelectorAll(".gu-bar-mark").forEach((bar) => bar.classList.toggle("gu-dim", on && Number(bar.dataset.i) !== index));
    cx.say(readout, on ? `${model.xs[index]}  ${tidy(model.totals[index])}` : "");
  };

  const nearest = (event) => {
    if (!model) return -1;
    const left = plot.getBoundingClientRect().left;
    const spots = model.xs.map((_, index) => Math.abs(model.px(index) - (event.clientX - left)));
    return spots.indexOf(Math.min(...spots));
  };

  if (!spark) {
    plot.addEventListener("pointermove", (event) => {
      const index = nearest(event);
      if (index !== focus) {
        point(index);
        if (event.pointerType === "touch") cx.host.haptic("snap");
      }
    });
    plot.addEventListener("pointerleave", () => point(-1));
    box.addEventListener("keydown", (event) => {
      if (!model || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      point(Math.max(0, Math.min(model.xs.length - 1, focus < 0 ? (step > 0 ? 0 : model.xs.length - 1) : focus + step)));
    });
    box.addEventListener("blur", () => point(-1));
  }
  const watch = new ResizeObserver(() => paint());
  watch.observe(plot);
  return { el: box, update: paint, stop: () => watch.disconnect() };
};

const columnsOf = (spec, rows) => {
  if (spec) {
    return spec.split(",").map((part) => {
      const [field = "", head] = part.split(":").map((piece) => piece.trim());
      return { field, head: head ?? field.charAt(0).toUpperCase() + field.slice(1) };
    });
  }
  return Object.keys(rows[0] ?? {}).map((field) => ({ field, head: field.charAt(0).toUpperCase() + field.slice(1) }));
};

const renderTable = (node, cx) => {
  const table = el("table", "gu-table");
  const box = el("div", "gu-table-box", [table]);
  return {
    el: box,
    update: () => {
      const rows = cx.store.tables[node.attrs.data];
      if (rows === undefined) {
        table.replaceChildren(el("tbody", "", [0, 1, 2].map((index) => el("tr", "", [el("td", "", [ghost(`${70 - index * 14}%`)])]))));
        return;
      }
      if (rows.length === 0) {
        table.replaceChildren(el("tbody", "", [el("tr", "", [el("td", "gu-empty", ["Nothing here"])])]));
        return;
      }
      const group = node.attrs.group;
      const columns = columnsOf(node.attrs.cols, rows).filter((column) => column.field !== group);
      const numeric = columns.map((column) => rows.every((row) => row[column.field] === "" || row[column.field] === undefined || typeof row[column.field] === "number"));
      const head = el("thead", "", [el("tr", "", columns.map((column, index) => Object.assign(el("th", numeric[index] ? "gu-n" : "", [column.head]), { scope: "col" })))]);
      const line = (row) => el("tr", "", columns.map((column, index) => el("td", numeric[index] ? "gu-n" : "", [tidy(row[column.field])])));
      const names = group === undefined ? [""] : [...new Set(rows.map((row) => tidy(row[group])))];
      const bodies = names.map((name) => {
        const mine = group === undefined ? rows : rows.filter((row) => tidy(row[group]) === name);
        const title = group === undefined ? [] : [el("tr", "gu-group", [Object.assign(el("th", "", [name, el("span", "gu-count", [String(mine.length)])]), { colSpan: columns.length, scope: "rowgroup" })])];
        return el("tbody", "", [...title, ...mine.map(line)]);
      });
      table.replaceChildren(head, ...bodies);
    },
  };
};

const renderText = (node, cx) => {
  const box = el("div", `gu-text gu-${node.attrs.size ?? "body"}`);
  if (node.attrs.tone) box.dataset.tone = node.attrs.tone;
  const source = node.tag === TEXT ? node.text : node.children.map((child) => child.text).join(" ");
  let plain;
  return {
    el: box,
    update: () => {
      const text = cx.read(source);
      if (text === null) {
        box.replaceChildren(ghost("62%"));
        plain = undefined;
        return;
      }
      if (isPlain(text)) {
        if (!plain) {
          plain = el("p");
          box.replaceChildren(plain);
        }
        cx.say(plain, text);
        return;
      }
      plain = undefined;
      box.innerHTML = markdown(text);
    },
  };
};

const renderTag = (node, cx) => {
  const tag = el("span", "gu-tag");
  if (node.attrs.tone) tag.dataset.tone = node.attrs.tone;
  const source = node.children.map((child) => child.text).join(" ");
  return { el: tag, update: () => cx.say(tag, cx.read(source) ?? "") };
};

const renderItem = (node, cx) => {
  const title = el("span", "gu-item-title");
  const detail = el("span", "gu-item-detail");
  const value = el("span", "gu-item-value");
  if (node.attrs.tone) value.dataset.tone = node.attrs.tone;
  const row = el("div", "gu-item", [el("span", "gu-item-main", [title, detail]), value]);
  return {
    el: row,
    update: () => {
      const read = cx.read(node.attrs.title);
      if (read === null) title.replaceChildren(ghost("9rem"));
      else cx.say(title, read ?? "");
      cx.say(detail, cx.read(node.attrs.detail) ?? "");
      cx.say(value, cx.read(node.attrs.value) ?? "");
      detail.hidden = node.attrs.detail === undefined;
    },
  };
};

const renderImage = (node, cx) => {
  const box = el("div", "gu-image");
  box.style.aspectRatio = /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(node.attrs.ratio ?? "") ? node.attrs.ratio : "16 / 9";
  let shown;
  return {
    el: box,
    update: () => {
      const src = cx.read(node.attrs.src);
      const alt = cx.read(node.attrs.alt) ?? "";
      if (src === shown) return;
      shown = src;
      if (!src || !/^(data:|blob:|https:|\/)/.test(src)) {
        box.replaceChildren(el("span", "gu-image-wait", [alt || "Image"]));
        return;
      }
      box.replaceChildren(Object.assign(el("img"), { src, alt, draggable: false }));
    },
  };
};

const renderMedia = (node, cx) => {
  const audio = node.attrs.kind === "audio";
  const box = el("div", audio ? "gu-audio" : "gu-image");
  return {
    el: box,
    update: () => {
      const src = cx.read(node.attrs.src);
      if (!src || !/^(data:|blob:|https:|\/)/.test(src)) {
        box.replaceChildren(el("span", "gu-image-wait", [audio ? "Audio" : "Video"]));
        return;
      }
      box.replaceChildren(Object.assign(el(audio ? "audio" : "video"), { src, controls: true, playsInline: true }));
    },
  };
};

const renderPart = (node, cx) => {
  const box = el("div", `gu-part gu-part-${node.attrs.is}`);
  return {
    el: box,
    update: () => {
      const made = cx.host.part?.(node.attrs.is, cx.read(node.attrs.id) ?? cx.read(node.attrs.date) ?? "");
      box.replaceChildren(made ?? el("span", "gu-image-wait", [`LifeOS ${node.attrs.is}`]));
    },
  };
};

const RESERVED = new Set(["label", "tool", "set", "to", "tone"]);

const renderButton = (node, cx) => {
  const label = el("span");
  const button = el("button", "gu-btn", [label]);
  button.type = "button";
  button.dataset.tone = node.attrs.tone ?? "plain";
  let busy = false;
  button.addEventListener("click", () => {
    if (busy) return;
    cx.host.haptic(node.attrs.tool ? "drop" : "toggle");
    if (node.attrs.set !== undefined) cx.store.set(node.attrs.set, cell(cx.read(node.attrs.to ?? "true") ?? ""));
    if (node.attrs.tool === undefined) return;
    const args = Object.fromEntries(Object.entries(node.attrs).flatMap(([key, value]) => (RESERVED.has(key) ? [] : [[key, cell(cx.read(value) ?? "")]])));
    busy = true;
    button.setAttribute("aria-busy", "true");
    Promise.resolve(cx.host.call(node.attrs.tool, args)).then((answer) => {
      busy = false;
      button.removeAttribute("aria-busy");
      cx.host.haptic(answer === false ? "error" : "complete");
    });
  });
  return { el: button, update: () => cx.say(label, cx.read(node.attrs.label) ?? "") };
};

const seed = (cx, name, value) => {
  if (!Object.hasOwn(cx.store.values, name)) cx.store.values[name] = value;
};

const field = (className, label, control, cx, source) => {
  const text = el("span", "gu-field-label");
  const box = el("label", `gu-field ${className}`, [text, control]);
  return { box, name: () => {
    const read = cx.read(source) ?? "";
    cx.say(text, read);
    text.hidden = read === "";
  } };
};

const renderSlider = (node, cx) => {
  const { bind } = node.attrs;
  const input = Object.assign(el("input", "gu-range"), { type: "range", name: bind });
  const figure = el("span", "gu-field-value");
  const made = field("gu-slider", node.attrs.label, el("span", "gu-range-row", [input, figure]), cx, node.attrs.label);
  input.addEventListener("input", () => {
    cx.host.haptic("snap");
    cx.store.set(bind, Number(input.value));
  });
  return {
    el: made.box,
    update: () => {
      const min = Number(cx.read(node.attrs.min) ?? 0);
      const max = Number(cx.read(node.attrs.max) ?? 100);
      input.min = String(min);
      input.max = String(max);
      input.step = cx.read(node.attrs.step) ?? "1";
      seed(cx, bind, Number(cx.read(node.attrs.value) ?? min));
      const value = Number(cx.store.values[bind]);
      if (Number(input.value) !== value) input.value = String(value);
      input.style.setProperty("--part", String(share(value - min, max - min)));
      made.name();
      const unit = cx.read(node.attrs.unit) ?? "";
      cx.say(figure, `${tidy(value)}${unit ? ` ${unit}` : ""}`);
    },
  };
};

let groups = 0;

const renderPick = (node, cx) => {
  const { bind } = node.attrs;
  const kind = node.attrs.kind ?? "segment";
  const group = `gu-pick-${(groups += 1)}`;
  const text = el("span", "gu-field-label");
  if (kind === "menu") {
    const select = el("select", "gu-select");
    select.addEventListener("change", () => {
      cx.host.haptic("toggle");
      cx.store.set(bind, cell(select.value));
    });
    return {
      el: el("label", "gu-field", [text, select]),
      update: () => {
        const options = (cx.read(node.attrs.options) ?? "").split(",").map((option) => option.trim()).filter(Boolean);
        seed(cx, bind, cell(cx.read(node.attrs.value) ?? options[0] ?? ""));
        if (select.childElementCount !== options.length) select.replaceChildren(...options.map((option) => Object.assign(el("option", "", [option]), { value: option })));
        select.value = tidy(cx.store.values[bind]);
        cx.say(text, cx.read(node.attrs.label) ?? "");
      },
    };
  }
  const row = el("span", `gu-pick gu-pick-${kind}`);
  const box = el("fieldset", "gu-field", [el("legend", "", [text]), row]);
  let built = "";
  return {
    el: box,
    update: () => {
      const options = (cx.read(node.attrs.options) ?? "").split(",").map((option) => option.trim()).filter(Boolean);
      seed(cx, bind, cell(cx.read(node.attrs.value) ?? options[0] ?? ""));
      const name = cx.read(node.attrs.label) ?? "";
      cx.say(text, name);
      text.hidden = name === "";
      if (built !== options.join()) {
        built = options.join();
        row.replaceChildren(
          ...options.map((option) => {
            const radio = Object.assign(el("input"), { type: "radio", name: group, value: option });
            radio.addEventListener("change", () => {
              cx.host.haptic("toggle");
              cx.store.set(bind, cell(option));
            });
            const face = kind === "swatch" ? Object.assign(el("i"), { style: `background:${/^[#\w(),.\s%-]+$/.test(option) ? option : "var(--track)"}` }) : el("span", "", [option]);
            const choice = el("label", "gu-choice", [radio, face]);
            if (kind === "swatch") radio.setAttribute("aria-label", option);
            return choice;
          }),
        );
      }
      for (const radio of row.querySelectorAll("input")) radio.checked = radio.value === tidy(cx.store.values[bind]);
    },
  };
};

const renderToggle = (node, cx) => {
  const { bind } = node.attrs;
  const input = Object.assign(el("input", "gu-switch"), { type: "checkbox" });
  input.setAttribute("role", "switch");
  const text = el("span", "gu-field-label");
  input.addEventListener("change", () => {
    cx.host.haptic("toggle");
    cx.store.set(bind, input.checked);
  });
  return {
    el: el("label", "gu-field gu-toggle", [text, input]),
    update: () => {
      seed(cx, bind, node.attrs.value === "true");
      input.checked = cx.store.values[bind] === true;
      cx.say(text, cx.read(node.attrs.label) ?? "");
    },
  };
};

const renderInput = (node, cx) => {
  const { bind } = node.attrs;
  const input = Object.assign(el("input", "gu-input"), { type: "text", name: bind, autocomplete: "off", spellcheck: false });
  const text = el("span", "gu-field-label");
  input.addEventListener("input", () => cx.store.set(bind, input.value));
  return {
    el: el("label", "gu-field", [text, input]),
    update: () => {
      seed(cx, bind, cx.read(node.attrs.value) ?? "");
      if (document.activeElement !== input) input.value = tidy(cx.store.values[bind]);
      input.placeholder = cx.read(node.attrs.placeholder) ?? "";
      const name = cx.read(node.attrs.label) ?? "";
      cx.say(text, name);
      text.hidden = name === "";
      if (name === "") input.setAttribute("aria-label", node.attrs.placeholder ?? bind);
    },
  };
};

const container = (className) => (node, cx) => {
  const box = el("div", className(node));
  if (node.tag === "Grid") box.style.setProperty("--cols", String(Math.max(1, Math.min(6, Number(node.attrs.cols) || 2))));
  const title = node.tag === "Card" && node.attrs.title !== undefined ? el("p", "gu-card-title") : undefined;
  const inner = title ? el("div", "gu-card-body") : box;
  if (title) box.append(title, inner);
  return { el: box, inner, update: () => title && cx.say(title, cx.read(node.attrs.title) ?? "") };
};

const renderList = (node, cx) => {
  const box = el("div", "gu-list");
  let records = [];
  let seen;
  return {
    el: box,
    update: () => {
      const rows = cx.store.tables[node.attrs.data];
      if (rows === undefined) {
        box.replaceChildren(ghost("70%"), ghost("54%"), ghost("62%"));
        return;
      }
      if (rows !== seen) {
        seen = rows;
        records.forEach(stop);
        records = rows.flatMap((row) => node.children.map((child) => build(child, { ...cx, read: makeReader(cx.store, row) })));
        box.replaceChildren(...(rows.length === 0 ? [el("p", "gu-empty", ["Nothing here"])] : records.map((record) => record.el)));
      }
      records.forEach(refresh);
    },
    stop: () => records.forEach(stop),
  };
};

const RENDER = {
  Col: container((node) => `gu-col${node.attrs.gap ? ` gu-gap-${node.attrs.gap}` : ""}`),
  Row: container((node) => `gu-row${node.attrs.gap ? ` gu-gap-${node.attrs.gap}` : ""}${node.attrs.align ? ` gu-align-${node.attrs.align}` : ""}`),
  Grid: container(() => "gu-grid"),
  Card: container(() => "gu-card"),
  Text: renderText,
  [TEXT]: renderText,
  Tag: renderTag,
  Num: renderNum,
  Meter: renderMeter,
  Chart: renderChart,
  Table: renderTable,
  List: renderList,
  Item: renderItem,
  Image: renderImage,
  Media: renderMedia,
  Part: renderPart,
  Button: renderButton,
  Slider: renderSlider,
  Pick: renderPick,
  Toggle: renderToggle,
  Input: renderInput,
};

const CONTAINERS = new Set(["Col", "Row", "Grid", "Card"]);

const signature = (node) => `${node.tag}\u0000${JSON.stringify(node.attrs)}\u0000${node.text}\u0000${CONTAINERS.has(node.tag) ? "" : JSON.stringify(node.children)}`;

const build = (node, cx) => {
  const render = RENDER[node.tag];
  if (!render) return { node, sig: signature(node), el: el("span", "gu-skip"), kids: [] };
  const made = render(node, cx);
  const record = { node, sig: signature(node), el: made.el, inner: made.inner, update: made.update, stop: made.stop, kids: [], cx };
  if (made.inner) sync(record, node.children, cx);
  return record;
};

const stop = (record) => {
  record.stop?.();
  record.kids.forEach(stop);
};

const refresh = (record) => {
  record.update?.();
  record.kids.forEach(refresh);
};

const sync = (parent, nodes, cx) => {
  const shown = nodes.filter((node) => node.tag !== "Data" && node.tag !== "Frame");
  const next = shown.map((node, index) => {
    const old = parent.kids[index];
    if (old && old.sig === signature(node)) {
      if (old.inner) sync(old, node.children, cx);
      return old;
    }
    return build(node, cx);
  });
  parent.kids.filter((old) => !next.includes(old)).forEach((old) => {
    stop(old);
    old.el.remove();
  });
  next.forEach((record, index) => {
    const at = parent.inner.children[index];
    if (at !== record.el) parent.inner.insertBefore(record.el, at ?? null);
  });
  parent.kids = next;
};

const ingest = (nodes, store, host, seen) => {
  for (const node of nodes) {
    if (node.tag === "Data" && node.attrs.name) {
      const sig = signature(node);
      if (seen.get(node.attrs.name) !== sig) {
        seen.set(node.attrs.name, sig);
        if (node.attrs.from === undefined) store.tables[node.attrs.name] = readCsv(node.text);
        else if (store.tables[node.attrs.name] === undefined) store.waiting.add(node.attrs.name);
        if (node.attrs.from !== undefined) host.read?.(node.attrs.name, node.attrs.from, Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== "name" && key !== "from")));
      }
    }
    if (node.tag !== "Frame") ingest(node.children, store, host, seen);
  }
};

const morphs = new WeakMap();
let Morph;

export const setMorph = (maker) => {
  Morph = maker;
};

const say = (target, text) => {
  if (target.dataset.said === text) return;
  const first = target.dataset.said === undefined;
  target.dataset.said = text;
  if (!Morph || first || text === "" || target.offsetParent === null) {
    morphs.delete(target);
    target.textContent = text;
    return;
  }
  let morph = morphs.get(target);
  if (!morph) {
    morph = new Morph({ element: target, duration: 280, ease: "cubic-bezier(0.23, 1, 0.32, 1)" });
    morphs.set(target, morph);
  }
  morph.update(text);
};

export const mount = (target, host) => {
  const store = {
    tables: { ...host.tables },
    values: { ...host.values },
    waiting: new Set(host.waiting),
    set: (name, value) => {
      if (store.values[name] === value) return;
      store.values[name] = value;
      host.out?.(name, value);
      queue();
    },
  };
  const root = { kids: [], inner: target };
  const seen = new Map();
  const cx = { store, host, say, read: makeReader(store, undefined) };
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      root.kids.forEach(refresh);
    });
  };
  target.classList.add("gu");
  return {
    store,
    cx,
    render: (nodes) => {
      ingest(nodes, store, host, seen);
      sync(root, nodes, cx);
      root.kids.forEach(refresh);
      queue();
    },
    setTable: (name, rows) => {
      store.tables[name] = Array.isArray(rows) ? rows : [rows];
      queue();
    },
    setValue: (name, value) => {
      store.values[name] = value;
      queue();
    },
    build: (node) => {
      ingest([node], store, host, seen);
      const record = build(node, cx);
      refresh(record);
      root.kids.push(record);
      return record.el;
    },
    stop: () => root.kids.forEach(stop),
  };
};

const send = (message) => parent.postMessage({ gu: 1, ...message }, "*");

const size = () => send({ type: "size", height: Math.ceil(document.documentElement.getBoundingClientRect().height) });

export const bootFrame = (payload) => {
  const waiting = new Map();
  const listeners = new Set();
  let calls = 0;
  const host = {
    tables: payload.tables,
    values: payload.values,
    waiting: payload.waiting,
    haptic: (kind) => send({ type: "haptic", kind }),
    out: (name, value) => send({ type: "set", name, value }),
    read: (name, from, args) => send({ type: "read", name, from, args }),
    call: (tool, args) =>
      new Promise((resolve) => {
        calls += 1;
        waiting.set(calls, resolve);
        send({ type: "call", id: calls, tool, args });
      }),
  };
  const view = mount(document.body, host);
  document.body.classList.add("gu-frame");
  const tell = () => listeners.forEach((listener) => listener());
  customElements.define(
    "gu-slot",
    class extends HTMLElement {
      connectedCallback() {
        const node = payload.slots[Number(this.dataset.slot)];
        if (node) this.replaceWith(view.build(node));
      }
    },
  );
  addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.gu !== 1) return;
    const message = event.data;
    if (message.type === "theme") {
      document.documentElement.style.colorScheme = message.theme;
      tell();
    }
    if (message.type === "table") view.setTable(message.name, message.rows);
    if (message.type === "value") view.setValue(message.name, message.value);
    if (message.type === "result") {
      waiting.get(message.id)?.(message.ok);
      waiting.delete(message.id);
    }
    if (message.type === "table" || message.type === "value") tell();
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") send({ type: "escape" });
  });
  addEventListener("error", (event) => send({ type: "error", words: String(event.message) }));
  new ResizeObserver(size).observe(document.documentElement);
  addEventListener("DOMContentLoaded", () => {
    size();
    send({ type: "ready" });
    setTimeout(size, 60);
  });
  if (payload.morph) import(/* @vite-ignore */ payload.morph).then((module) => setMorph(module.TextMorph)).catch(() => undefined);
  return {
    rows: (name) => view.store.tables[name] ?? [],
    get: (name) => view.store.values[name],
    set: (name, value) => {
      view.store.set(name, value);
      tell();
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: host.call,
    haptic: host.haptic,
    el: (tag, attrs = {}, text = "") => view.build({ tag, attrs: Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, String(value)])), children: text ? [{ tag: TEXT, attrs: {}, children: [], text }] : [], text }),
    color: (name) => {
      const probe = el("i");
      probe.style.color = `var(--${name})`;
      document.body.append(probe);
      const made = getComputedStyle(probe).color;
      probe.remove();
      return made;
    },
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
};

export const GU_CSS = `
.gu{--ink:var(--foreground);--dim:var(--muted-foreground);--faint:var(--faint-foreground);--paper:var(--popover);--track:color-mix(in oklab,var(--foreground) 11%,transparent);--well:color-mix(in oklab,var(--foreground) 4.5%,transparent);--line:var(--border);--good:var(--positive);--warn:var(--deadline);--bad:var(--negative);--s2:var(--area-teal);--s3:var(--area-rose);--s4:var(--area-orange);--s5:var(--area-violet);--s6:var(--area-green);--font:"Inter Variable",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono Variable",ui-monospace,"SF Mono",monospace;--r:10px;--out:cubic-bezier(0.23,1,0.32,1);
display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--ink);font:400 13px/20px var(--font);font-feature-settings:"cv11","ss01","calt";font-optical-sizing:auto;-webkit-font-smoothing:antialiased;text-align:left;-webkit-tap-highlight-color:transparent}
.gu *,.gu *::before,.gu *::after{box-sizing:border-box}
.gu p,.gu ul,.gu h1,.gu h2,.gu h3,.gu figure,.gu fieldset,.gu legend{margin:0;padding:0;border:0;min-width:0}
.gu [hidden]{display:none!important}
.gu :focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.gu>*,.gu-col>*,.gu-card-body>*{animation:gu-in 220ms var(--out) both}
@keyframes gu-in{from{opacity:0;transform:translateY(4px)}}
.gu-col,.gu-card-body,.gu-list{display:flex;flex-direction:column;gap:12px;min-width:0}
.gu-row{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;min-width:0}
.gu-row>*{flex:1 1 0;min-width:min(100%,7.5rem)}
.gu-row>.gu-btn,.gu-row>.gu-tag,.gu-row>button{flex:0 0 auto;min-width:0}
.gu-align-center{align-items:center}.gu-align-end{align-items:flex-end}.gu-align-start{align-items:flex-start}.gu-align-between{justify-content:space-between}
.gu-grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:12px}
@container (max-width:22rem){.gu-grid{grid-template-columns:repeat(min(var(--cols),2),minmax(0,1fr))}}
.gu>button,.gu-col>button,.gu-card-body>button,.gu>.gu-tag{align-self:flex-start}
.gu-gap-tight{gap:6px}.gu-gap-loose{gap:20px}
.gu-card{border-radius:14px;background:var(--well);padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.gu-card-title{font-size:11px;line-height:16px;font-weight:500;color:var(--dim)}
.gu-card-body{gap:8px}
.gu-text{min-width:0;text-wrap:pretty;display:flex;flex-direction:column;gap:6px}
.gu-text ul{display:flex;flex-direction:column;gap:2px;padding-left:16px;list-style:none}
.gu-text li{position:relative}
.gu-text li::before{content:"";position:absolute;left:-12px;top:8px;width:4px;height:4px;border-radius:99px;background:var(--faint)}
.gu-text b,.gu b,.gu strong{font-weight:600}
.gu code{font:11.5px/16px var(--mono);background:var(--well);border-radius:4px;padding:1px 4px}
.gu a{color:inherit;text-decoration:underline;text-decoration-color:var(--faint);text-underline-offset:2px}
.gu-small{font-size:11px;line-height:16px}
.gu-heading,.gu-head,.gu h2,.gu h3{font-size:15px;line-height:22px;font-weight:600;letter-spacing:-0.01em}
.gu-title,.gu h1{font-size:20px;line-height:26px;font-weight:600;letter-spacing:-0.02em;text-wrap:balance}
.gu [data-tone=muted]{color:var(--dim)}.gu [data-tone=faint]{color:var(--faint)}.gu [data-tone=good]{color:var(--good)}.gu [data-tone=warn]{color:var(--warn)}.gu [data-tone=bad]{color:var(--bad)}
.gu-tag{display:inline-flex;align-self:flex-start;align-items:center;height:20px;padding:0 8px;border-radius:99px;background:var(--track);font-size:11px;line-height:16px;font-weight:500;white-space:nowrap}
.gu-tag[data-tone=good]{background:color-mix(in oklab,var(--good) 14%,transparent)}.gu-tag[data-tone=warn]{background:color-mix(in oklab,var(--warn) 16%,transparent)}.gu-tag[data-tone=bad]{background:color-mix(in oklab,var(--bad) 14%,transparent)}
.gu-ghost{display:block;max-width:100%;border-radius:6px;background:linear-gradient(100deg,var(--track) 40%,color-mix(in oklab,var(--ink) 5%,transparent) 50%,var(--track) 60%) 0 0/300% 100%;animation:gu-shimmer 1.6s linear infinite}
@keyframes gu-shimmer{from{background-position:100% 0}to{background-position:0 0}}
.gu-empty{color:var(--faint);font-size:11px;line-height:16px;padding:8px 0}
.gu-num{border-radius:14px;background:var(--well);padding:12px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;min-width:0}
.gu-num-top{min-height:16px}
.gu-num-label{font-size:13px;line-height:18px;font-weight:500;letter-spacing:-0.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gu-num-state{font-size:11px;line-height:16px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gu-num-value{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px}
.gu-dots{display:block;max-width:100%;height:auto;fill:currentColor;flex:0 1 auto;min-width:0}
.gu-dots circle{transition:opacity 260ms var(--out)}
.gu-num-plain{font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.025em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gu-unit{flex:none;border-radius:7px;background:var(--track);padding:2px 6px;font-size:10px;line-height:14px;font-weight:500;max-width:6.5rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gu-num-small{flex-direction:row;align-items:center;gap:8px;padding:8px 12px}
.gu-num-small .gu-num-top{flex:1;min-width:0}
.gu-num-small .gu-num-value{min-height:0}.gu-num-small .gu-num-plain{font-size:15px;line-height:22px}
.gu-num[data-tone=good] .gu-dots,.gu-num[data-tone=good] .gu-num-plain{color:var(--good)}.gu-num[data-tone=warn] .gu-dots,.gu-num[data-tone=warn] .gu-num-plain{color:var(--warn)}.gu-num[data-tone=bad] .gu-dots,.gu-num[data-tone=bad] .gu-num-plain{color:var(--bad)}
.gu-num[data-tone] {color:var(--ink)}
.gu-meter{display:flex;flex-direction:column;gap:6px;min-width:0}
.gu-meter-line{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.gu-meter-label{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gu-meter-value,.gu-field-value,.gu-chart-readout,.gu-chart-max,.gu-item-value,.gu-ring-unit,.gu-count{font:11px/16px var(--mono);font-variant-numeric:tabular-nums;color:var(--dim);white-space:nowrap}
.gu-bar{height:6px;border-radius:99px;background:var(--track);overflow:hidden}
.gu-bar-fill{display:block;height:100%;border-radius:99px;background:var(--ink);transform-origin:left;transition:transform 320ms var(--out)}
.gu-ticks{display:flex;align-items:flex-end;gap:2px;height:14px}
.gu-tick{flex:1;max-width:3px;height:6px;border-radius:99px;background:var(--track);transition:background-color 160ms var(--out)}
.gu-tick:nth-child(6n+1){height:100%}
.gu-tick.gu-on{background:var(--ink)}
.gu-capdots{display:flex;flex-wrap:wrap;gap:3px}
.gu-capdot{width:6px;height:6px;border-radius:99px;background:var(--track);transition:background-color 160ms var(--out)}
.gu-capdot:nth-child(4n){margin-right:4px}
.gu-capdot.gu-on{background:var(--ink)}
.gu-meter-ring{align-items:center;gap:8px}
.gu-meter-ring .gu-meter-line{flex-direction:column;align-items:center;gap:0;order:2}
.gu-ring{position:relative;width:104px;height:104px;flex:none}
.gu-ring svg{display:block}
.gu-ring circle{fill:var(--track);transition:fill 160ms var(--out)}
.gu-ring circle.gu-on{fill:var(--ink)}
.gu-ring-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gu-ring-value{font-size:22px;line-height:26px;font-weight:600;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.gu-wait .gu-ring-value,.gu-wait .gu-meter-value{opacity:0}
.gu-chart{display:flex;flex-direction:column;gap:2px;min-width:0;border-radius:var(--r);outline-offset:4px}
.gu-chart-top{display:flex;justify-content:space-between;height:16px}
.gu-chart-readout{color:var(--ink);white-space:pre}
.gu-plot{position:relative;min-width:0;touch-action:pan-y}
.gu-plot svg{display:block;overflow:visible}
.gu-wait .gu-plot{display:flex;align-items:flex-end;gap:8px}
.gu-wait .gu-plot .gu-ghost{flex:1}
.gu-axis{stroke:var(--faint);stroke-width:1}
.gu-gridline{stroke:var(--track);stroke-width:1;stroke-dasharray:1 4;stroke-linecap:round}
.gu-bar-mark{transition:opacity 160ms var(--out)}
.gu-bar-mark.gu-dim{opacity:0.35}
.gu-line-mark{fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.gu-area-mark{opacity:0.12}
.gu-cursor{stroke:var(--ink);stroke-width:1;stroke-dasharray:1 3;stroke-linecap:round;opacity:0;pointer-events:none}
.gu-x{font:10px/12px var(--mono);fill:var(--dim)}
.gu-legend{display:flex;flex-wrap:wrap;gap:4px 12px;padding-top:4px}
.gu-key{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dim)}
.gu-key i{width:6px;height:6px;border-radius:99px}
.gu-row>.gu-chart-spark{flex:0 1 7rem;min-width:4rem;align-self:center}
.gu-table-box{overflow-x:auto;min-width:0;margin:0 -4px;padding:0 4px}
.gu table{width:100%;border-collapse:collapse;font-size:13px;line-height:20px}
.gu th{font-size:11px;line-height:16px;font-weight:500;color:var(--dim);text-align:left;padding:0 12px 4px 0;white-space:nowrap}
.gu td{padding:6px 12px 6px 0;border-top:1px solid var(--line);vertical-align:top;max-width:16rem;overflow:hidden;text-overflow:ellipsis}
.gu th:last-child,.gu td:last-child{padding-right:0}
.gu .gu-n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.gu td.gu-n{font-family:var(--mono);font-size:12px}
.gu .gu-group th{padding:14px 0 4px;font-size:13px;line-height:20px;font-weight:600;color:var(--ink)}
.gu tbody:first-of-type .gu-group th{padding-top:6px}
.gu-count{margin-left:8px;font-weight:400}
.gu-item{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}
.gu-item+.gu-item{border-top:1px solid var(--line);padding-top:8px}
.gu-item-main{display:flex;flex-direction:column;min-width:0}
.gu-item-title{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.gu-item-detail{font-size:11px;line-height:16px;color:var(--dim)}
.gu-item-value{color:var(--ink);font-size:12px}
.gu-image,.gu-part{position:relative;border-radius:var(--r);background:var(--well);overflow:hidden;min-width:0}
.gu-image img,.gu-image video{display:block;width:100%;height:100%;object-fit:cover}
.gu-image-wait{position:absolute;inset:0;display:grid;place-items:center;font-size:11px;color:var(--faint);background:repeating-linear-gradient(135deg,transparent 0 7px,var(--well) 7px 8px)}
.gu-part{min-height:40px}
.gu-audio audio{width:100%}
.gu button,.gu-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:99px;background:var(--button-secondary);color:var(--ink);font:500 13px/20px var(--font);white-space:nowrap;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;transition:scale 120ms var(--out),opacity 160ms var(--out)}
.gu button:active{scale:0.97}
.gu button[data-tone=primary],.gu button.primary{background:var(--button);background-origin:border-box;border:1px solid var(--button-edge);color:var(--button-foreground);box-shadow:var(--button-shadow)}
.gu button[data-tone=quiet]{background:none;color:var(--dim)}
.gu button[data-tone=danger]{background:color-mix(in oklab,var(--bad) 15%,transparent);color:var(--bad)}
.gu button[aria-busy=true]{opacity:0.55;cursor:progress}
.gu button:disabled{opacity:0.4;pointer-events:none}
@media (hover:hover) and (pointer:fine){.gu button:hover{background:var(--button-secondary-hover)}.gu button[data-tone=primary]:hover,.gu button.primary:hover{background:var(--button-hover);background-origin:border-box}.gu button[data-tone=quiet]:hover{background:var(--well);color:var(--ink)}.gu button[data-tone=danger]:hover{background:color-mix(in oklab,var(--bad) 24%,transparent)}}
.gu-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.gu-field-label,.gu label{font-size:11px;line-height:16px;font-weight:500;color:var(--dim)}
.gu-range-row{display:flex;align-items:center;gap:12px}
.gu-field-value{min-width:3.5rem;text-align:right;color:var(--ink)}
.gu input[type=range]{appearance:none;-webkit-appearance:none;flex:1;min-width:0;width:100%;height:24px;margin:0;background:none;cursor:pointer;touch-action:pan-y;--part:0.5}
.gu input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:99px;background:linear-gradient(90deg,var(--ink) calc(var(--part)*100%),var(--track) 0)}
.gu input[type=range]::-moz-range-track{height:6px;border-radius:99px;background:linear-gradient(90deg,var(--ink) calc(var(--part)*100%),var(--track) 0)}
.gu input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-6px;border-radius:99px;border:0;background:var(--paper);box-shadow:0 0 0 1px var(--line),0 1px 3px rgb(0 0 0/0.28);transition:scale 120ms var(--out)}
.gu input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:99px;border:0;background:var(--paper);box-shadow:0 0 0 1px var(--line),0 1px 3px rgb(0 0 0/0.28)}
.gu input[type=range]:active::-webkit-slider-thumb{scale:1.12}
.gu-pick{display:inline-flex;align-self:flex-start;max-width:100%;flex-wrap:wrap}
.gu-pick-segment{gap:2px;padding:2px;border-radius:99px;background:var(--track)}
.gu-choice{position:relative;display:inline-flex;cursor:pointer}
.gu-choice input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.gu-pick-segment .gu-choice span{display:block;padding:4px 12px;border-radius:99px;font-size:12px;line-height:20px;font-weight:500;color:var(--dim);transition:background-color 160ms var(--out),color 160ms var(--out)}
.gu-pick-segment input:checked+span{background:var(--paper);color:var(--ink);box-shadow:0 1px 2px rgb(0 0 0/0.14)}
.gu-choice input:focus-visible+*{outline:2px solid var(--ring);outline-offset:2px}
.gu-pick-swatch{gap:8px}
.gu-pick-swatch i{display:block;width:28px;height:28px;border-radius:99px;box-shadow:inset 0 0 0 1px var(--line);transition:scale 120ms var(--out)}
.gu-pick-swatch input:checked+i{box-shadow:0 0 0 2px var(--paper),0 0 0 4px var(--ink)}
.gu-pick-swatch .gu-choice:active i{scale:0.92}
.gu-toggle{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
.gu-toggle .gu-field-label{font-size:13px;line-height:20px;color:var(--ink)}
.gu input[type=checkbox]{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:34px;height:20px;margin:0;border-radius:99px;background:var(--track);cursor:pointer;transition:background-color 160ms var(--out)}
.gu input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:99px;background:var(--paper);box-shadow:0 1px 2px rgb(0 0 0/0.3);transition:transform 220ms var(--out)}
.gu input[type=checkbox]:checked{background:var(--ink)}
.gu input[type=checkbox]:checked::after{transform:translateX(14px)}
.gu input[type=text],.gu input:not([type]),.gu select,.gu textarea{appearance:none;-webkit-appearance:none;width:100%;height:32px;padding:0 10px;border:0;border-radius:var(--r);background:var(--well);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink);font:13px/20px var(--font);user-select:text;-webkit-user-select:text}
.gu input::placeholder{color:var(--faint)}
.gu-skip{display:none}
.gu canvas{display:block;max-width:100%;border-radius:var(--r)}
.gu-frame{margin:0;padding:4px;background:transparent;overflow:hidden}
.gu-frame>*,.gu-frame .gu-col>*,.gu-frame .gu-card-body>*{animation:none}
.gu legend{margin-bottom:6px;display:block}
@media (prefers-reduced-motion:reduce){.gu *,.gu *::after{animation:none!important;transition-duration:0.01ms!important}}
`;
