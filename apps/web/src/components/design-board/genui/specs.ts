export const COST = `<Data name=cost>
format,tokens
Patch,1541
JSON,1304
A2UI,1165
Arrays,619
Tags,466
Lines,426
</Data>
<Chart mark=bar data=cost x=format y=tokens h=112/>
<Text size=small tone=muted>Tokens to write the same five blocks. Tags are what LifeOS uses.</Text>`;

export const MIXED = `<Row>
<Num label=Speed value={speed} unit="turns/min"/>
<Num label=Arms value={arms}/>
</Row>
<Slider bind=speed label=Speed min=1 max=12 value=4 unit="turns/min"/>
<Pick bind=arms options="3,5,8" value=5 label=Arms/>
<Frame>
<canvas id=c height=180></canvas>
<script>
const c = document.getElementById("c"), g = c.getContext("2d")
let t = 0, last = performance.now()
const draw = (now) => {
  const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = 180 * devicePixelRatio
  t += ((now - last) / 60000) * (ui.get("speed") ?? 4) * Math.PI * 2
  last = now
  g.clearRect(0, 0, w, h)
  g.fillStyle = ui.color("ink")
  const arms = ui.get("arms") ?? 5
  for (let i = 0; i < 140; i++) {
    const r = (i / 140) * h * 0.46, a = t + (i % arms) * (Math.PI * 2 / arms) + r * 0.012
    g.globalAlpha = 0.25 + 0.75 * (i / 140)
    g.beginPath()
    g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, devicePixelRatio * (1 + i / 70), 0, 7)
    g.fill()
  }
  if (!ui.reduced) requestAnimationFrame(draw)
}
requestAnimationFrame(draw)
ui.on(() => ui.reduced && requestAnimationFrame(draw))
</script>
</Frame>`;

export const LOADING_GRAMMAR = `<Data name=tasks from=list_tasks view=today/>
<Row>
<Num label=Tasks value={tasks.count}/>
<Num label=Planned value={tasks.estimate.sum} unit=min/>
</Row>
<Table data=tasks cols="title:Task,estimate:Min"/>`;

export const LOADING_FRAME = `<Frame>
<Data name=tasks from=list_tasks view=today/>
<Row>
<Num label=Tasks value={tasks.count}/>
<Num label=Planned value={tasks.estimate.sum} unit=min/>
</Row>
<Table data=tasks cols="title:Task,estimate:Min"/>
</Frame>`;

export const EMPTY = `<Data name=done>
title,area
</Data>
<Num label="Done today" value={done.count} state="Nothing yet"/>
<Table data=done cols="title:Task,area:Area"/>`;

export const BROKEN = `<Gauge value=62/>
<Chart mark=pie data=sleep/>`;

export const ANSWER_ONE = `<Data name=plan from=get_day_plan/>
<Row>
<Num label=Planned value={plan.planned} unit=min/>
<Num label=Free value={plan.free} unit=min/>
</Row>
<Meter kind=dots value={plan.planned} max={plan.free} label="Of your free time" unit=min/>`;
