import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as sync from "y-protocols/sync";
import type * as Y from "yjs";

export const NOTES_PROTOCOL = "lifeos-notes";
export const NOTE_TEXT = "markdown";
export const NOTE_META = "meta";

export const MessageKind = { sync: 0, awareness: 1 } as const;

export const noteIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export const isNoteId = (value: string) => noteIdPattern.test(value);

export const frame = (kind: number, write: (encoder: encoding.Encoder) => void) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, kind);
  write(encoder);
  return encoding.toUint8Array(encoder);
};

export const syncStep1 = (doc: Y.Doc) => frame(MessageKind.sync, (e) => sync.writeSyncStep1(e, doc));

export const syncUpdate = (update: Uint8Array) => frame(MessageKind.sync, (e) => sync.writeUpdate(e, update));

export const answerSync = (doc: Y.Doc, message: Uint8Array, origin: unknown) => {
  const decoder = decoding.createDecoder(message);
  const kind = decoding.readVarUint(decoder);
  if (kind !== MessageKind.sync) return { kind, reply: null } as const;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageKind.sync);
  sync.readSyncMessage(decoder, encoder, doc, origin);
  return { kind, reply: encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null } as const;
};

export const readKind = (message: Uint8Array) => decoding.readVarUint(decoding.createDecoder(message));

const pair = (first: Uint8Array, second: Uint8Array) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint8Array(encoder, first);
  encoding.writeVarUint8Array(encoder, second);
  return encoding.toUint8Array(encoder);
};

const unpair = (bytes: Uint8Array) => {
  const decoder = decoding.createDecoder(bytes);
  const first = decoding.readVarUint8Array(decoder);
  const second = decoding.readVarUint8Array(decoder);
  return [first, second] as const;
};

export const encodeCatchUpRequest = (request: { stateVector: Uint8Array; update: Uint8Array }) =>
  pair(request.stateVector, request.update);

export const decodeCatchUpRequest = (bytes: Uint8Array) => {
  const [stateVector, update] = unpair(bytes);
  return { stateVector, update };
};

export const encodeCatchUpReply = (reply: { update: Uint8Array; stateVector: Uint8Array }) =>
  pair(reply.update, reply.stateVector);

export const decodeCatchUpReply = (bytes: Uint8Array) => {
  const [update, stateVector] = unpair(bytes);
  return { update, stateVector };
};

export const tokenFromProtocols = (header: string | null) => {
  const offered = (header ?? "").split(",").map((p) => p.trim());
  if (!offered.includes(NOTES_PROTOCOL)) return null;
  return offered.find((p) => p !== NOTES_PROTOCOL && p.length > 0) ?? null;
};
