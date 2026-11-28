export const OUTPUTS: readonly { id: string; title: string; ask: string; sockets: readonly string[]; source: string }[] = [
  {
    "id": "sleep-chart",
    "title": "Sleep this week",
    "ask": "Chart my sleep this week from this CSV:",
    "sockets": [],
    "source": "<Data name=sleep>\nday,hours\nMon,7.2\nTue,6.5\nWed,8.1\nThu,7.0\nFri,5.9\nSat,8.4\nSun,7.6\n</Data>\n<Row>\n<Num label=Average value={sleep.hours.avg} unit=h/>\n<Num label=Best value={sleep.hours.max} unit=h/>\n</Row>\n<Chart mark=bar data=sleep x=day y=hours/>"
  },
  {
    "id": "tasks-by-area",
    "title": "Today by Area",
    "ask": "A table of today's Tasks grouped by Area, with the Estimate.",
    "sockets": [],
    "source": "<Data name=tasks from=list_tasks view=today/>\n<Table data=tasks cols=\"title:Task,estimate:Min\" group=area/>"
  },
  {
    "id": "progress-ring",
    "title": "Thesis",
    "ask": "A progress ring for my thesis: 62 of 100 pages written.",
    "sockets": [],
    "source": "<Meter value=62 max=100 kind=ring label=\"Thesis pages\" unit=pages/>"
  },
  {
    "id": "trip-summary",
    "title": "Hobart trip",
    "ask": "Summarise my Hobart trip without a map. Fly out Thu 3 Dec 8:10 am on JQ705 from Melbourne, check in at Salamanca at 2 pm, MONA ferry Fri 9:30 am, fly home Sun 6 Dec 5:45 pm. The budget is $620 for 4 days.",
    "sockets": [],
    "source": "<Row>\n<Num label=Budget value=620 unit=$/>\n<Num label=Days value=4/>\n</Row>\n<Data name=trip>\nday,time,plan\nThu 3 Dec,8:10 am,Fly out on JQ705 from Melbourne\nThu 3 Dec,2 pm,Check in at Salamanca\nFri 4 Dec,9:30 am,MONA ferry\nSun 6 Dec,5:45 pm,Fly home\n</Data>\n<Table data=trip cols=\"day:Day,time:Time,plan:Plan\"/>"
  },
  {
    "id": "pomodoro",
    "title": "Pomodoro",
    "ask": "A pomodoro control: pick the length, start and stop, and show how far in I am.",
    "sockets": [],
    "source": "<Data name=focus from=get_focus/>\n<Pick bind=minutes options=\"15,25,50\" value=25 kind=segment label=Length/>\n<Meter value={focus.elapsed} max={minutes} kind=ring label=Elapsed unit=min/>\n<Row>\n<Button label=Start tool=start_focus minutes={minutes} tone=primary/>\n<Button label=Stop tool=stop_focus tone=quiet/>\n</Row>\n<Text tone=muted>{focus.task}</Text>"
  },
  {
    "id": "summary-sparkline",
    "title": "Thesis notes",
    "ask": "Summarise this note in three bullet points and show the words written per day as a sparkline. Note: 'Methods chapter. The interview protocol is settled at twelve semi-structured interviews. Coding uses two passes, open then axial, and a second coder checks one in five. Ethics approval came through on Tuesday.' Words written: Mon 320, Tue 540, Wed 410, Thu 760, Fri 905.",
    "sockets": [],
    "source": "<Data name=words>\nday,words\nMon,320\nTue,540\nWed,410\nThu,760\nFri,905\n</Data>\n<Text>- The interview protocol is settled at twelve semi-structured interviews.\n- Coding uses two passes, open then axial, and a second coder checks one in five.\n- Ethics approval came through on Tuesday.</Text>\n<Text size=small tone=muted>Words written per day</Text>\n<Chart mark=spark data=words x=day y=words/>"
  },
  {
    "id": "dice-roller",
    "title": "Random number",
    "ask": "A dice roller for the random number workflow: roll a six-sided die and send the number out as roll.",
    "sockets": [],
    "source": "<Frame>\n<Num label=\"Last roll\" value={roll}/>\n<button class=primary onclick=\"throwDie()\">Roll</button>\n<script>\nconst throwDie = () => ui.set(\"roll\", Math.floor(Math.random() * 6) + 1)\n</script>\n</Frame>"
  },
  {
    "id": "spinning-logo",
    "title": "Logo",
    "ask": "A 3D spinning LifeOS logo: a rounded square with a tick on it, slowly rotating.",
    "sockets": [],
    "source": "<Frame>\n<style>\n.stage { display: grid; place-items: center; padding: 32px 0; perspective: 600px; }\n.logo { width: 120px; height: 120px; box-sizing: border-box; border-radius: 28px; border: 6px solid var(--ink); display: grid; place-items: center; transform-style: preserve-3d; animation: spin 12s linear infinite; }\n.logo svg { width: 64px; height: 64px; fill: none; stroke: var(--ink); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }\n@keyframes spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }\n@media (prefers-reduced-motion: reduce) { .logo { animation: none; } }\n</style>\n<div class=\"stage\">\n<div class=\"logo\">\n<svg viewBox=\"0 0 64 64\" aria-label=\"LifeOS logo\"><path d=\"M18 34 L28 44 L46 22\"/></svg>\n</div>\n</div>\n</Frame>"
  },
  {
    "id": "palette-picker",
    "title": "Poster colour",
    "ask": "A colour palette picker. Let me choose one of these five colours for the poster and send it out as colour: #2f6fed, #e4572e, #17b890, #f2c14e, #3d3a4b.",
    "sockets": [],
    "source": "<Pick bind=colour options=\"#2f6fed,#e4572e,#17b890,#f2c14e,#3d3a4b\" value=\"#2f6fed\" kind=swatch label=\"Poster colour\"/>"
  },
  {
    "id": "render-progress",
    "title": "Rendering the frames",
    "ask": "Show the render progress for the film pipeline, with the last frame and a way to stop it.",
    "sockets": [
      "frames"
    ],
    "source": "<Image src={frames.last} alt=\"Last frame\" ratio=16/9/>\n<Meter value={frames.done} max={frames.total} kind=bar label=Frames/>\n<Row>\n<Num label=Done value={frames.done}/>\n<Num label=Left value={frames.eta} unit=min/>\n</Row>\n<Button label=Stop tool=stop_run tone=quiet/>"
  },
  {
    "id": "week-load",
    "title": "This week",
    "ask": "How full is my week? Planned hours per day: Mon 5.5, Tue 7, Wed 3, Thu 6.5, Fri 4. I have 8 free hours a day.",
    "sockets": [],
    "source": "<Data name=week>\nday,planned,free\nMon,5.5,8\nTue,7,8\nWed,3,8\nThu,6.5,8\nFri,4,8\n</Data>\n<Row>\n<Num label=Planned value={week.planned.sum} unit=h/>\n<Num label=Free value={week.free.sum} unit=h/>\n</Row>\n<Chart mark=bar data=week x=day y=planned/>"
  },
  {
    "id": "focus-by-area",
    "title": "Focus by Area",
    "ask": "A stacked chart of focus minutes per day by Area from this data:",
    "sockets": [],
    "source": "<Data name=focus>\nday,area,minutes\nMon,University,90\nMon,Chemwatch,45\nTue,University,60\nTue,Personal,30\nWed,Chemwatch,120\nThu,University,75\nThu,Personal,20\nFri,University,50\nFri,Chemwatch,40\n</Data>\n<Chart mark=bar data=focus x=day y=minutes series=area/>"
  },
  {
    "id": "water-settings",
    "title": "Water reminder",
    "ask": "Controls for a water reminder: a switch to turn it on, how many glasses a day (4 to 12), and a field for its name.",
    "sockets": [],
    "source": "<Row align=between>\n<Toggle bind=reminderOn label=\"Water reminder\"/>\n</Row>\n<Slider bind=glasses min=4 max=12 step=1 value=8 label=\"Glasses a day\" unit=glasses/>\n<Input bind=reminderName label=\"Name\" placeholder=\"Water reminder\"/>"
  },
  {
    "id": "breathing",
    "title": "Breathe",
    "ask": "A breathing exercise: a circle that slowly grows for 4 seconds and shrinks for 4 seconds, with the word in or out.",
    "sockets": [],
    "source": "<Frame>\n<style>\n.breath { display: grid; place-items: center; padding: 24px 16px; }\n.stage { position: relative; display: grid; place-items: center; width: min(64vw, 240px); aspect-ratio: 1; }\n.orb { width: 100%; aspect-ratio: 1; border-radius: 50%; background: var(--good); opacity: 0.4; transform: scale(0.5); }\n.word { position: absolute; font-size: 22px; color: var(--ink); }\n</style>\n<div class=\"breath\">\n<div class=\"stage\">\n<div class=\"orb\" id=\"orb\"></div>\n<span class=\"word\" id=\"word\">in</span>\n</div>\n</div>\n<script>\nconst orb = document.getElementById(\"orb\")\nconst word = document.getElementById(\"word\")\nconst cycle = 8000\nconst start = performance.now()\nlet last = \"in\"\nfunction draw(now) {\n  const t = (now - start) % cycle\n  const p = (1 - Math.cos(2 * Math.PI * t / cycle)) / 2\n  const label = t < cycle / 2 ? \"in\" : \"out\"\n  orb.style.transform = `scale(${ui.reduced ? 1 : 0.5 + 0.5 * p})`\n  if (label !== last) { word.textContent = label; last = label }\n  requestAnimationFrame(draw)\n}\nrequestAnimationFrame(draw)\n</script>\n</Frame>"
  },
  {
    "id": "reading-list",
    "title": "Reading list",
    "ask": "My reading list, one entry per book with its author and how far through I am, from this data:",
    "sockets": [],
    "source": "<Data name=books>\ntitle,author,read,pages\nThe Dispossessed,Ursula K. Le Guin,210,387\nHow Buildings Learn,Stewart Brand,88,243\nSeeing Like a State,James C. Scott,402,445\n</Data>\n<Text tone=muted>{books.read.sum} of {books.pages.sum} pages read</Text>\n<List data=books>\n<Item title={title} detail={author} value=\"{read} of {pages} pages\"/>\n</List>"
  },
  {
    "id": "noughts-and-crosses",
    "title": "Noughts and crosses",
    "ask": "A game of noughts and crosses I can play against myself.",
    "sockets": [],
    "source": "<Frame>\n<p id=\"info\">X to play</p>\n<div id=\"board\"></div>\n<button class=primary onclick=\"reset()\">New game</button>\n<style>\n#board { display: grid; grid-template-columns: repeat(3, 72px); gap: 6px; margin: 12px 0; }\n#board button { height: 72px; font-size: 28px; font-family: var(--mono); }\n</style>\n<script>\nconst lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]\nconst cells = Array(9).fill(\"\")\nconst info = document.getElementById(\"info\")\nconst board = document.getElementById(\"board\")\nconst buttons = []\nlet turn = \"X\", over = false\n\nfor (let i = 0; i < 9; i++) {\n  const b = document.createElement(\"button\")\n  b.onclick = () => play(i)\n  board.appendChild(b)\n  buttons.push(b)\n}\n\nconst winningLine = () => lines.find(([a, b, c]) => cells[a] && cells[a] === cells[b] && cells[a] === cells[c])\n\nfunction render() {\n  cells.forEach((v, i) => { buttons[i].textContent = v })\n}\n\nfunction play(i) {\n  if (over || cells[i]) return\n  cells[i] = turn\n  ui.haptic(\"toggle\")\n  render()\n  if (winningLine()) {\n    over = true\n    info.textContent = turn + \" wins\"\n    ui.haptic(\"complete\")\n    return\n  }\n  if (cells.every(Boolean)) {\n    over = true\n    info.textContent = \"Draw\"\n    return\n  }\n  turn = turn === \"X\" ? \"O\" : \"X\"\n  info.textContent = turn + \" to play\"\n}\n\nfunction reset() {\n  cells.fill(\"\")\n  turn = \"X\"\n  over = false\n  render()\n  info.textContent = \"X to play\"\n}\n\nreset()\n</script>\n</Frame>"
  },
  {
    "id": "inbox-capture",
    "title": "Inbox",
    "ask": "Show how many Tasks are in my Inbox and give me a button that adds a Task called Call the dentist.",
    "sockets": [],
    "source": "<Data name=inbox from=list_tasks view=inbox/>\n<Row align=center>\n<Num label=Inbox value={inbox.count} unit=tasks/>\n<Button label=\"Add task\" tool=create_task title=\"Call the dentist\" tone=primary/>\n</Row>"
  },
  {
    "id": "signature",
    "title": "Sign here",
    "ask": "A box I can sign in with my finger or the mouse, with a clear button.",
    "sockets": [],
    "source": "<Frame>\n<canvas id=\"pad\"></canvas>\n<Row align=end>\n<button onclick=\"clearPad()\">Clear</button>\n</Row>\n<script>\nconst pad = document.getElementById(\"pad\")\nconst ctx = pad.getContext(\"2d\")\nconst height = 220\nlet last = null\nconst size = () => {\n  const k = devicePixelRatio || 1\n  pad.style.height = height + \"px\"\n  pad.width = pad.clientWidth * k\n  pad.height = height * k\n  ctx.setTransform(k, 0, 0, k, 0, 0)\n  ctx.lineWidth = 2.5\n  ctx.lineCap = \"round\"\n  ctx.lineJoin = \"round\"\n}\nconst at = e => {\n  const r = pad.getBoundingClientRect()\n  return [e.clientX - r.left, e.clientY - r.top]\n}\nconst stop = () => { last = null }\nconst clearPad = () => { ctx.clearRect(0, 0, pad.clientWidth, height) }\npad.addEventListener(\"pointerdown\", e => {\n  pad.setPointerCapture(e.pointerId)\n  last = at(e)\n})\npad.addEventListener(\"pointermove\", e => {\n  if (!last) return\n  const p = at(e)\n  ctx.strokeStyle = ui.color(\"ink\")\n  ctx.beginPath()\n  ctx.moveTo(last[0], last[1])\n  ctx.lineTo(p[0], p[1])\n  ctx.stroke()\n  last = p\n})\npad.addEventListener(\"pointerup\", stop)\npad.addEventListener(\"pointercancel\", stop)\nsize()\n</script>\n</Frame>"
  }
];
