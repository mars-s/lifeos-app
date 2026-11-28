import { Car, Check } from "lucide-react-native";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, G, Line, Rect } from "react-native-svg";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import { startOfWeek } from "@lifeos/backend/client/dates";
import { useKit } from "@/lib/kit";
import { fonts, usePlanner } from "@/lib/kit-theme";
import { EASE_OUT } from "@/lib/motion";
import { keepAll, keepPrediction, tickBlock, useMinute, useTimeline, type TimelineBlock, type TimelineDay, type TimelinePrediction } from "@/lib/timeline";
import { useLocalDate } from "@/lib/views";

const MINUTE_PX = 1.25;
const GUTTER = 74;
const RAIL = 7;
const MOST_DOTS = 6;
const DOT_PITCH = 5;
const LANE = MOST_DOTS * DOT_PITCH + DOT_PITCH / 2;
const DAY_MINUTES = 24 * 60;
const INK_MS = 360;
const ink = { duration: INK_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System } as const;

type Look = "predicted" | "kept" | "done" | "missed" | "commitment" | "commitment-past";
type Tones = { foreground: string; muted: string; faint: string; ground: string; accent: string; accentText: string; sleep: string };
type Trip = { place: string; minutes: number } | null;

const alpha = (hex: string, amount: number) =>
  /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(amount * 255).toString(16).padStart(2, "0")}` : hex;

const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);

const mix = (from: string, to: string, amount: number) =>
  `#${[1, 3, 5].map((at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount).toString(16).padStart(2, "0")).join("")}`;

const leanOf = (level: number) => Math.max(0.04, (level - 0.22) / 0.78);


const dayStart = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getTime();
};

const minuteIn = (instant: number, date: string) => Math.round((instant - dayStart(date)) / 60_000);

const span = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;

const clock = (minute: number, bare = false) => {
  const hour = Math.floor(minute / 60) % 24;
  const text = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute % 60).padStart(2, "0")}`;
  return bare ? text : `${text} ${hour < 12 ? "am" : "pm"}`;
};

const hourLabel = (minute: number) => {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;
};

const weekdayOf = (date: string, style: "short" | "long" | "narrow") => new Date(dayStart(date)).toLocaleDateString("en-AU", { weekday: style });

const dayName = (date: string, today: string) =>
  date === today ? "Today" : date === addDays(today as IsoDate, 1) ? "Tomorrow" : date === addDays(today as IsoDate, -1) ? "Yesterday" : weekdayOf(date, "long");

const Hatch = ({ colour, width, height }: { colour: string; width: number; height: number }) => (
  <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
    {Array.from({ length: Math.ceil((width + height) / 7) + 1 }, (_, index) => index * 7 - height).map((x) => (
      <Line key={x} x1={x} y1={height} x2={x + height} y2={0} stroke={colour} strokeWidth={1.2} />
    ))}
  </Svg>
);

const useInk = (value: number) => {
  const shared = useSharedValue(value);
  useEffect(() => {
    shared.value = withTiming(value, ink);
  }, [shared, value]);
  return shared;
};

const Box = ({ done, tint, onPress, label }: { done: boolean; tint: string; onPress?: () => void; label: string }) => (
  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={label} hitSlop={12} onPress={onPress} disabled={!onPress}>
    <View style={[styles.box, done ? { backgroundColor: tint } : { borderColor: tint, borderWidth: 1.5 }]}>{done ? <Check size={11} strokeWidth={3} color="#FFFFFF" /> : null}</View>
  </Pressable>
);

const TripBand = ({ trip, start, height, back, tone }: { trip: NonNullable<Trip>; start: number; height: number; back: boolean; tone: string }) => (
  <View style={[styles.trip, { height, borderColor: alpha(tone, 0.25) }, back ? styles.tripBack : styles.tripThere]}>
    {height >= 12 ? (
      <>
        <Car size={11} color={tone} />
        <Text numberOfLines={1} style={[styles.tripText, { color: tone }]}>
          {back ? `${trip.minutes} min back` : `${trip.minutes} min drive, leave by ${clock(start - trip.minutes)}`}
        </Text>
      </>
    ) : null}
  </View>
);

type Card = {
  key: string;
  look: Look;
  title: string;
  start: number;
  minutes: number;
  colour: string;
  trip: Trip;
  meta: string;
  done: boolean;
  onPress?: () => void;
  onTick?: () => void;
};

const BlockCard = ({ card, top, width, tones, compact }: { card: Card; top: number; width: number; tones: Tones; compact: boolean }) => {
  const travel = (card.trip?.minutes ?? 0) * MINUTE_PX;
  const main = Math.max(card.minutes * MINUTE_PX - 2, compact ? 4 : 16);
  const height = main + travel * 2;
  const predicted = card.look === "predicted";
  const past = card.look === "done" || card.look === "missed" || card.look === "commitment-past";
  const commitment = card.look.startsWith("commitment");
  const kept = useInk(predicted ? 0 : 1);
  const drained = useInk(past ? 1 : 0);
  const fill = useAnimatedStyle(() => ({ opacity: commitment ? 0 : kept.value * (1 - drained.value) }));
  const hatch = useAnimatedStyle(() => ({ opacity: 1 - kept.value }));
  const graphite = useAnimatedStyle(() => ({ opacity: commitment ? 0 : drained.value * (card.look === "missed" ? 0.4 : 1) }));
  const edge = predicted ? alpha(card.colour, 0.62) : card.look === "missed" ? alpha(tones.foreground, 0.34) : commitment ? alpha(tones.foreground, 0.17) : alpha(card.colour, 0.26);
  const text = past ? tones.muted : tones.foreground;
  const slim = main < 44;
  const label = `${predicted ? "Predicted, " : ""}${card.title}, ${clock(card.start)} to ${clock(card.start + card.minutes)}${card.look === "missed" ? ", not done" : card.done ? ", done" : ""}`;
  const body = (
    <Animated.View style={[styles.card, { height, borderColor: edge, backgroundColor: tones.ground, borderRadius: slim ? 7 : 10 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(card.colour, 0.3) }, fill]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(tones.foreground, 0.09) }, graphite]} />
      {!commitment ? (
        <Animated.View style={[StyleSheet.absoluteFill, hatch]} pointerEvents="none">
          <Hatch colour={alpha(card.colour, 0.46)} width={width} height={height} />
        </Animated.View>
      ) : null}
      {card.trip ? <TripBand trip={card.trip} start={card.start} height={travel} back={false} tone={alpha(text, 0.7)} /> : null}
      {compact ? null : (
        <View style={[styles.cardRow, { height: main, alignItems: slim ? "center" : "flex-start", paddingTop: slim ? 0 : 7 }]}>
          {commitment ? <View style={[styles.calendarDot, { backgroundColor: card.colour, opacity: past ? 0.5 : 1 }]} /> : null}
          {!commitment && !predicted ? (
            <Box done={card.done} tint={card.done ? (past ? tones.muted : card.colour) : past ? alpha(tones.foreground, 0.48) : alpha(card.colour, 0.8)} label={`${card.done ? "Reopen" : "Complete"} ${card.title}`} {...(card.onTick ? { onPress: card.onTick } : {})} />
          ) : null}
          <View style={styles.cardText}>
            <Text numberOfLines={1} style={[styles.cardTitle, { color: text }, card.done && styles.struck, predicted && { backgroundColor: tones.ground, alignSelf: "flex-start", paddingHorizontal: 4, borderRadius: 4 }]}>
              {card.title}
            </Text>
            {!slim ? (
              <Text numberOfLines={1} style={[styles.cardMeta, { color: alpha(text, 0.7) }, predicted && { backgroundColor: tones.ground, alignSelf: "flex-start", paddingHorizontal: 4, borderRadius: 4 }]}>
                {card.look === "missed" ? "Not done · " : ""}
                {clock(card.start, card.start < 720 === card.start + card.minutes < 720)} – {clock(card.start + card.minutes)}
                {card.meta ? ` · ${card.meta}` : ""}
              </Text>
            ) : null}
          </View>
          {slim ? <Text style={[styles.cardMeta, { color: alpha(text, 0.7) }, predicted && { backgroundColor: tones.ground, paddingHorizontal: 4, borderRadius: 4 }]}>{clock(card.start)}</Text> : null}
        </View>
      )}
      {card.trip ? <TripBand trip={card.trip} start={card.start} height={travel} back tone={alpha(text, 0.7)} /> : null}
    </Animated.View>
  );
  const place = { position: "absolute", top, left: 0, width, height } as const;
  if (!card.onPress) return <View accessible={!card.onTick} accessibilityLabel={label} style={place}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Tap to keep it.`} onPress={card.onPress} style={({ pressed }) => [place, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
};

const cardsOf = (day: TimelineDay, today: string, nowMinute: number, area: Record<string, string>, tones: Tones) => {
  const pastAt = (end: number) => day.date < today || (day.date === today && end <= nowMinute);
  const colourOf = (row: { area?: { colour: string } | undefined | null }) => (row.area ? (area[row.area.colour] ?? tones.muted) : tones.muted);
  const blocks = day.blocks.map((block: TimelineBlock) => {
    const start = minuteIn(block.start, day.date);
    const past = pastAt(start + block.minutes + (block.trip?.minutes ?? 0));
    return {
      key: `t:${block.taskId}`,
      look: past ? (block.done ? "done" : "missed") : "kept",
      title: block.title,
      start,
      minutes: block.minutes,
      colour: colourOf(block),
      trip: block.trip,
      meta: block.area?.title ?? "",
      done: block.done,
      onTick: () => tickBlock(block),
    } satisfies Card;
  });
  const predictions = day.predictions.map((prediction: TimelinePrediction) => ({
    key: `t:${prediction.taskId}`,
    look: "predicted" as const,
    title: prediction.title,
    start: minuteIn(prediction.start, day.date),
    minutes: prediction.minutes,
    colour: colourOf(prediction),
    trip: prediction.trip,
    meta: `${prediction.guess ? "~" : ""}${span(prediction.minutes)}${prediction.fit ? ` · at your ${prediction.fit}` : ""}`,
    done: false,
    onPress: () => keepPrediction(day.date, prediction),
  }));
  const commitments = day.commitments
    .filter((row) => !row.allDay)
    .map((row) => {
      const start = Math.max(0, minuteIn(row.start, day.date));
      const end = Math.min(DAY_MINUTES, minuteIn(row.end, day.date));
      return {
        key: `c:${row._id}`,
        look: pastAt(end) ? ("commitment-past" as const) : ("commitment" as const),
        title: row.title,
        start,
        minutes: end - start,
        colour: row.calendar.colour,
        trip: null,
        meta: row.calendar.title,
        done: false,
      } satisfies Card;
    });
  return [...commitments, ...blocks, ...predictions];
};

const gapsOf = (cards: readonly Card[], from: number, until: number) => {
  const spans = cards.map((card) => ({ start: card.start - (card.trip?.minutes ?? 0), end: card.start + card.minutes + (card.trip?.minutes ?? 0) })).filter((each) => each.end > from && each.start < until);
  const edges = [...spans.toSorted((a, b) => a.start - b.start), { start: until, end: until }];
  const gaps: { start: number; minutes: number }[] = [];
  let reach = from;
  for (const edge of edges) {
    if (edge.start - reach >= 15) gaps.push({ start: reach, minutes: edge.start - reach });
    reach = Math.max(reach, edge.end);
  }
  return gaps;
};

const curveOf = (energy: TimelineDay["energy"]) => (energy && (energy.kind === "solid" || energy.kind === "usual") ? energy : null);

const hint = (day: TimelineDay["energy"], minute: number) => {
  const energy = curveOf(day);
  if (!energy) return "";
  if (minute >= energy.peak.start && minute < energy.peak.end) return " · peak, good for deep work";
  if (minute >= energy.dip.start && minute < energy.dip.end) return " · dip, good for admin or a walk";
  return "";
};

const Rail = ({ day, today, nowMinute, tones }: { day: TimelineDay; today: string; nowMinute: number; tones: Tones }) => {
  const { area } = usePlanner();
  const live = day.date === today;
  const reached = day.date < today ? DAY_MINUTES : live ? nowMinute : 0;
  const curve = curveOf(day.energy);
  const mode = day.date < today ? "past" : live && curve?.kind === "solid" ? "today" : "usual";
  const points = (curve?.points ?? []).filter((point) => point.minute <= DAY_MINUTES);
  const first = points[0];
  const last = points.at(-1);
  const levelAt = (minute: number) => {
    const after = points.findIndex((point) => point.minute >= minute);
    const next = points[after];
    const previous = points[after - 1];
    if (!next) return last?.level ?? 0;
    if (!previous) return next.level;
    return previous.level + ((next.level - previous.level) * (minute - previous.minute)) / Math.max(1, next.minute - previous.minute);
  };
  const pale = mix(tones.ground, tones.foreground, 0.26);
  const rows = first && last ? Array.from({ length: DAY_MINUTES / 15 }, (_, index) => index * 15).filter((minute) => minute > 0 && minute >= first.minute && minute <= last.minute) : [];
  const bead = useSharedValue(nowMinute * MINUTE_PX);
  useEffect(() => {
    bead.value = withTiming(nowMinute * MINUTE_PX, ink);
  }, [bead, nowMinute]);
  const beadStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bead.value }] }));
  return (
    <View pointerEvents="none" style={[styles.gutter, { height: DAY_MINUTES * MINUTE_PX }]}>
      <Svg width={6} height={DAY_MINUTES * MINUTE_PX} style={[styles.dots, { right: RAIL - 3 }]}>
        {Array.from({ length: DAY_MINUTES / 15 }, (_, index) => (
          <Circle key={index} cx={3} cy={index * 15 * MINUTE_PX} r={index % 4 === 0 ? 1.8 : 0.95} fill={alpha(tones.foreground, 0.38)} />
        ))}
      </Svg>
      <View style={[styles.reached, { right: RAIL - 0.5, height: reached * MINUTE_PX, backgroundColor: alpha(tones.foreground, 0.55) }]} />
      {curve ? (
        <Svg width={LANE} height={DAY_MINUTES * MINUTE_PX} style={[styles.dots, { right: RAIL }]}>
          <Rect x={0} y={(curve.bedtime - 30) * MINUTE_PX} width={LANE} height={45 * MINUTE_PX} rx={3} fill={alpha(tones.sleep, 0.18)} />
          {rows.map((minute) => {
            const dots = Math.round(leanOf(levelAt(minute)) * MOST_DOTS);
            const tint = mix(pale, area.green, Math.max(0, dots - 1) / (MOST_DOTS - 1));
            return (
              <G key={minute} opacity={mode === "past" ? 0.34 : mode === "today" && minute < nowMinute ? 0.4 : 1}>
                {Array.from({ length: dots }, (_, index) => (
                  <Circle
                    key={index}
                    cx={LANE - (index + 1) * DOT_PITCH}
                    cy={minute * MINUTE_PX}
                    r={mode === "usual" ? 1.35 : 1.6}
                    fill={mode === "past" ? tones.foreground : mode === "usual" ? "none" : tint}
                    stroke={mode === "usual" ? tint : undefined}
                    strokeWidth={mode === "usual" ? 0.9 : undefined}
                  />
                ))}
              </G>
            );
          })}
        </Svg>
      ) : null}
      {Array.from({ length: 23 }, (_, index) => (index + 1) * 60).map((minute) => (
        <Text key={minute} style={[styles.hour, { top: minute * MINUTE_PX - 7, right: RAIL + 3, color: tones.muted, backgroundColor: tones.ground, opacity: live && Math.abs(minute - nowMinute) < 14 ? 0 : 1 }]}>
          {hourLabel(minute)}
        </Text>
      ))}
      {live ? (
        <Animated.View style={[styles.nowAnchor, beadStyle]}>
          <View style={[styles.bead, { right: RAIL - 5, backgroundColor: tones.accent, borderColor: tones.ground }]} />
          <View style={[styles.pill, { right: RAIL + 7, backgroundColor: tones.accent }]}>
            <Text style={[styles.pillText, { color: tones.accentText }]}>{clock(nowMinute, true)}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
};

const DayTimeline = ({ day, today, nowMinute, tones, workingHours }: { day: TimelineDay; today: string; nowMinute: number; tones: Tones; workingHours: { startMinute: number; endMinute: number } }) => {
  const { width, height } = useWindowDimensions();
  const area = usePlanner().area;
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const cards = useMemo(() => cardsOf(day, today, nowMinute, area, tones), [day, today, nowMinute, area, tones]);
  const from = Math.max(workingHours.startMinute, day.date === today ? nowMinute : day.date < today ? DAY_MINUTES : 0);
  const gaps = gapsOf(cards.filter((card) => card.look !== "commitment-past"), from, workingHours.endMinute);
  const trackWidth = width - GUTTER - 16;
  const settle = useEffectEvent(() => {
    const anchor = day.date === today ? nowMinute * MINUTE_PX - height / 3 : (workingHours.startMinute - 45) * MINUTE_PX;
    scroller.current?.scrollTo({ y: Math.max(0, anchor), animated: false });
  });
  useEffect(() => settle(), [day.date]);
  return (
    <ScrollView ref={scroller} style={styles.flex} contentContainerStyle={styles.timelineContent}>
      <View style={{ height: DAY_MINUTES * MINUTE_PX }}>
        <Rail day={day} today={today} nowMinute={nowMinute} tones={tones} />
        {Array.from({ length: 23 }, (_, index) => (index + 1) * 60).map((minute) => (
          <View key={minute} style={[styles.rule, { top: minute * MINUTE_PX, left: GUTTER, borderColor: alpha(tones.foreground, 0.09) }]} />
        ))}
        {gaps.map((gap) => (
          <Text key={gap.start} style={[styles.gap, { top: (gap.start + gap.minutes / 2) * MINUTE_PX - 6, left: GUTTER + 10, color: tones.faint }]}>
            {gap.minutes < 30 ? "Buffer" : "Free"} <Text style={styles.mono}>{span(gap.minutes)}</Text>
            {gap.minutes >= 30 ? hint(day.energy, gap.start + gap.minutes / 2) : ""}
          </Text>
        ))}
        <View style={[styles.track, { left: GUTTER, width: trackWidth }]}>
          {cards.map((card) => (
            <BlockCard key={card.key} card={card} top={(card.start - (card.trip?.minutes ?? 0)) * MINUTE_PX + 1} width={trackWidth} tones={tones} compact={false} />
          ))}
        </View>
        {day.date === today ? <View pointerEvents="none" style={[styles.nowLine, { top: nowMinute * MINUTE_PX, left: GUTTER, backgroundColor: tones.accent }]} /> : null}
      </View>
    </ScrollView>
  );
};

const kindsOf = (load: TimelineDay["load"], capacity: number, unit: number) => {
  const total = Math.max(1, Math.round(capacity / unit));
  const done = Math.round(load.done / unit);
  const kept = Math.round((load.done + load.kept) / unit) - done;
  const predicted = Math.round((load.done + load.kept + load.predicted) / unit) - done - kept;
  return Array.from({ length: total }, (_, index) => (index < done ? "done" : index < done + kept ? "kept" : index < done + kept + predicted ? "predicted" : "free"));
};

const CapacityRing = ({ day, tones }: { day: TimelineDay; tones: Tones }) => {
  const capacity = day.capacity?.freeMinutes ?? 0;
  const left = capacity - day.load.done - day.load.kept - day.load.predicted;
  const kinds = kindsOf(day.load, capacity, 15);
  const size = 46;
  const radius = size / 2 - 3;
  return (
    <View accessible accessibilityLabel={`Capacity: ${span(Math.abs(left))} ${left < 0 ? "over" : "left"} of ${span(capacity)}`} style={[styles.ring, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {kinds.map((kind, index) => {
          const angle = (index / kinds.length) * Math.PI * 2 - Math.PI / 2;
          const cx = size / 2 + Math.cos(angle) * radius;
          const cy = size / 2 + Math.sin(angle) * radius;
          return kind === "predicted" ? (
            <Circle key={index} cx={cx} cy={cy} r={1.3} fill="none" stroke={tones.foreground} strokeWidth={0.8} />
          ) : (
            <Circle key={index} cx={cx} cy={cy} r={1.6} fill={tones.foreground} opacity={kind === "kept" ? 1 : kind === "done" ? 0.4 : 0.13} />
          );
        })}
      </Svg>
      <Text style={[styles.ringText, { color: left < 0 ? "#C9302D" : tones.foreground }]}>{span(Math.abs(left))}</Text>
    </View>
  );
};

const LoadDots = ({ day, tones, count = 5 }: { day: TimelineDay; tones: Tones; count?: number }) => {
  const kinds = kindsOf(day.load, day.capacity?.freeMinutes ?? 0, Math.max(30, Math.round((day.capacity?.freeMinutes ?? 0) / count))).slice(0, count);
  return (
    <View style={styles.loadDots}>
      {kinds.map((kind, index) => (
        <View
          key={index}
          style={[
            styles.loadDot,
            kind === "predicted" ? { borderWidth: 1, borderColor: tones.foreground } : { backgroundColor: tones.foreground, opacity: kind === "kept" ? 1 : kind === "done" ? 0.4 : 0.13 },
          ]}
        />
      ))}
    </View>
  );
};

const WeekStrip = ({ days, chosen, today, tones, onChoose }: { days: readonly TimelineDay[]; chosen: string; today: string; tones: Tones; onChoose: (date: string) => void }) => (
  <View style={styles.strip}>
    {days.map((day) => {
      const on = day.date === chosen;
      return (
        <Pressable key={day.date} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${weekdayOf(day.date, "long")} ${Number(day.date.slice(8))}`} onPress={() => onChoose(day.date)} style={styles.stripDay}>
          <Text style={[styles.stripWeekday, { color: day.date < today ? tones.faint : tones.muted }]}>{weekdayOf(day.date, "narrow")}</Text>
          <View style={[styles.stripDisc, on && { backgroundColor: day.date === today ? tones.accent : tones.foreground }]}>
            <Text style={[styles.stripDate, { color: on ? tones.ground : day.date === today ? tones.accent : day.date < today ? tones.faint : tones.foreground }]}>{Number(day.date.slice(8))}</Text>
          </View>
          <LoadDots day={day} tones={tones} />
        </Pressable>
      );
    })}
  </View>
);

const WeekColumns = ({ days, today, nowMinute, tones, workingHours, onChoose }: { days: readonly TimelineDay[]; today: string; nowMinute: number; tones: Tones; workingHours: { startMinute: number; endMinute: number }; onChoose: (date: string) => void }) => {
  const { width } = useWindowDimensions();
  const area = usePlanner().area;
  const from = 8 * 60;
  const to = Math.max(workingHours.endMinute, from + 8 * 60);
  const scale = 0.62;
  const column = (width - 32) / 7;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.weekContent}>
      <View style={styles.weekRow}>
        {days.map((day) => {
          const planned = day.load.done + day.load.kept + day.load.predicted;
          const cards = cardsOf(day, today, nowMinute, area, tones).filter((card) => card.start + card.minutes > from && card.start < to);
          return (
            <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`${weekdayOf(day.date, "long")}, ${span(planned)} planned. Opens that day.`} onPress={() => onChoose(day.date)} style={[styles.weekColumn, { width: column }, day.date === today && { backgroundColor: alpha(tones.foreground, 0.04) }]}>
              <Text style={[styles.weekHead, { color: day.date === today ? tones.accent : tones.muted }]}>{weekdayOf(day.date, "short")}</Text>
              <Text style={[styles.weekPlanned, { color: tones.faint }]}>{span(planned)}</Text>
              <View style={{ height: (to - from) * scale }}>
                {cards.map((card) => (
                  <View key={card.key} style={[styles.weekCard, { top: (Math.max(card.start, from) - from) * scale }]}>
                    <BlockCard card={{ ...card, minutes: (Math.max(10, card.minutes) * scale) / MINUTE_PX, trip: null }} top={0} width={column - 6} tones={tones} compact />
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.key, { color: tones.faint }]}>Hatched predicted · filled kept · grey done · outlined not done or calendar</Text>
    </ScrollView>
  );
};

export const TimelineFace = () => {
  const today = useLocalDate();
  const { colors } = useKit();
  const planner = usePlanner();
  const minute = useMinute();
  const [chosen, setChosen] = useState<string>(today);
  const [week, setWeek] = useState(false);
  const monday = startOfWeek(chosen as IsoDate);
  const view = useTimeline(monday, 7, minute);
  const tones = useMemo(
    () => ({ foreground: colors.foreground, muted: colors.mutedForeground, faint: planner.faintForeground, ground: colors.background, accent: colors.accent, accentText: colors.accentForeground, sleep: planner.area.violet }) satisfies Tones,
    [colors, planner],
  );
  const nowMinute = Math.round((minute - dayStart(today)) / 60_000);
  const day = view?.days.find((each) => each.date === chosen);
  if (!view || !day) return <View style={[styles.flex, { backgroundColor: colors.background }]} />;
  const past = chosen < today;
  const done = day.blocks.filter((block) => block.done).length;
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={[styles.dayName, { color: colors.foreground }]}>{dayName(chosen, today)}</Text>
            <Text style={[styles.date, { color: colors.mutedForeground }]}>{new Date(dayStart(chosen)).toLocaleDateString("en-AU", { day: "numeric", month: "long" })}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={week ? "Show the day" : "Show the week"} hitSlop={8} onPress={() => setWeek(!week)} style={[styles.weekButton, { backgroundColor: alpha(colors.foreground, 0.06) }]}>
            <Text style={[styles.weekButtonText, { color: colors.foreground }]}>{week ? "Day" : "Week"}</Text>
          </Pressable>
          <CapacityRing day={day} tones={tones} />
        </View>
        <WeekStrip days={view.days} chosen={chosen} today={today} tones={tones} onChoose={setChosen} />
        {!week ? (
          <View style={styles.summary}>
            <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
              {past
                ? `${done} done, ${day.blocks.length - done} not done`
                : day.predictions.length > 0
                  ? `${day.predictions.length} predicted${chosen === today ? " later" : ""}, ${span(day.load.predicted)}`
                  : day.unfit.length > 0
                    ? `${day.unfit.length} did not fit ${chosen === today ? "today" : "this day"}`
                    : day.predicts
                    ? "Every block is kept"
                    : `${day.blocks.length} kept`}
            </Text>
            {!past && day.predictions.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => keepAll(day.date, day.predictions)} style={[styles.keepAll, { backgroundColor: alpha(colors.foreground, 0.08) }]}>
                <Text style={[styles.keepAllText, { color: colors.foreground }]}>Keep all</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {week ? (
        <WeekColumns days={view.days} today={today} nowMinute={nowMinute} tones={tones} workingHours={view.workingHours} onChoose={(date) => {
          setChosen(date);
          setWeek(false);
        }} />
      ) : (
        <DayTimeline day={day} today={today} nowMinute={nowMinute} tones={tones} workingHours={view.workingHours} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayName: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  date: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  weekButton: { height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: "center" },
  weekButtonText: { fontFamily: fonts.medium, fontSize: 13 },
  ring: { alignItems: "center", justifyContent: "center" },
  ringText: { fontFamily: fonts.monoMedium, fontSize: 11 },
  strip: { flexDirection: "row", justifyContent: "space-between" },
  stripDay: { alignItems: "center", gap: 4, minWidth: 40, paddingVertical: 2 },
  stripWeekday: { fontFamily: fonts.medium, fontSize: 11 },
  stripDisc: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stripDate: { fontFamily: fonts.monoMedium, fontSize: 13 },
  loadDots: { flexDirection: "row", gap: 2, height: 4 },
  loadDot: { width: 4, height: 4, borderRadius: 2 },
  summary: { flexDirection: "row", alignItems: "center", minHeight: 36, gap: 8, paddingBottom: 6 },
  summaryText: { flex: 1, fontFamily: fonts.regular, fontSize: 13 },
  keepAll: { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: "center" },
  keepAllText: { fontFamily: fonts.medium, fontSize: 14 },
  timelineContent: { paddingBottom: 200 },
  gutter: { position: "absolute", top: 0, left: 0, width: GUTTER },
  hour: { position: "absolute", fontFamily: fonts.mono, fontSize: 10, lineHeight: 14, paddingHorizontal: 2, borderRadius: 3, overflow: "hidden" },
  dots: { position: "absolute", top: 0 },
  reached: { position: "absolute", top: 0, width: 1, borderRadius: 1 },
  nowAnchor: { position: "absolute", top: 0, left: 0, right: 0, height: 0 },
  bead: { position: "absolute", top: -5, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  pill: { position: "absolute", top: -8, height: 16, paddingHorizontal: 6, borderRadius: 8, justifyContent: "center" },
  pillText: { fontFamily: fonts.monoMedium, fontSize: 10 },
  rule: { position: "absolute", right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderStyle: "dotted" },
  gap: { position: "absolute", fontFamily: fonts.regular, fontSize: 10, lineHeight: 12 },
  mono: { fontFamily: fonts.mono },
  track: { position: "absolute", top: 0, bottom: 0 },
  nowLine: { position: "absolute", right: 0, height: 1 },
  card: { overflow: "hidden", borderWidth: 1 },
  cardRow: { flexDirection: "row", gap: 8, paddingHorizontal: 9 },
  cardText: { flex: 1, minWidth: 0, gap: 1 },
  cardTitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  cardMeta: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16 },
  struck: { textDecorationLine: "line-through" },
  calendarDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  box: { width: 16, height: 16, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  trip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, overflow: "hidden" },
  tripThere: { borderBottomWidth: 1, borderStyle: "dashed" },
  tripBack: { borderTopWidth: 1, borderStyle: "dashed" },
  tripText: { fontFamily: fonts.regular, fontSize: 10, flexShrink: 1 },
  pressed: { transform: [{ scale: 0.985 }] },
  weekContent: { paddingHorizontal: 16, paddingBottom: 200 },
  weekRow: { flexDirection: "row" },
  weekColumn: { paddingHorizontal: 3, borderRadius: 8, paddingTop: 6 },
  weekHead: { fontFamily: fonts.medium, fontSize: 11, textAlign: "center" },
  weekPlanned: { fontFamily: fonts.mono, fontSize: 10, textAlign: "center", marginBottom: 6 },
  weekCard: { position: "absolute", left: 0, right: 0 },
  key: { fontFamily: fonts.regular, fontSize: 11, marginTop: 14, textAlign: "center" },
});
