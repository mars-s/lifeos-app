"use client";

import { Schema } from "effect";
import { Atom } from "effect/reactivity";
import { registry } from "../../../lib/atoms";
import { atomRuntime } from "../../../lib/runtime";

const Recent = Schema.Struct({ kind: Schema.Literals(["task", "project", "area", "list"]), id: Schema.String });

export type Recent = typeof Recent.Type;

const KEY = "lifeos:bar:recents:v1";
const LIMIT = 6;

const NONE: readonly Recent[] = [];

const recentsAtom = Atom.kvs({ runtime: atomRuntime, key: KEY, schema: Schema.Array(Recent), defaultValue: () => NONE }).pipe(Atom.keepAlive);

export const readRecents = () => registry.get(recentsAtom).slice(0, LIMIT);

export const rememberRecent = (recent: Recent) =>
  registry.set(recentsAtom, [recent, ...readRecents().filter((other) => other.kind !== recent.kind || other.id !== recent.id)].slice(0, LIMIT));
