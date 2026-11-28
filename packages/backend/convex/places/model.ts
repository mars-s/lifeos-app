import { Effect, Option, Result, Schema } from "effect";
import type { TravelMode } from "../../shared/features";
import { toNeverthrow } from "../../shared/effect/bridge";
import type { ChoiceAsk } from "../ai/transport";
import { GeocoderInvalidResponse, PlacesInvalidResponse, PlacesRefused, PlacesUnavailable } from "./errors";
import type { Place, Position } from "./tables";

const soft = <S extends Schema.Constraint>(schema: S) =>
  Schema.UndefinedOr(schema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))));

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const ROUTING_URL = "https://routing.openstreetmap.de";
export const SEARCH_RADIUS_METRES = 15_000;
export const BRANCH_LIMIT = 5;
export const TRIP_THRESHOLD = 0.5;
export const NO_PLACE = "no particular place";
const TRIP_QUESTION = "needs_trip";
const PLACE_QUESTION = "place";
const PHRASE_LIMIT = 24;
const PHRASE_WORDS = 3;
const SEARCH_RESULTS = 200;
const EARTH_METRES = 6_371_000;

export const ROUTING_PROFILE = { drive: "routed-car", walk: "routed-foot", cycle: "routed-bike" } as const satisfies Record<TravelMode, string>;

export const PLACE_KINDS = [
  { value: "a post office", filters: [`"amenity"="post_office"`], words: ["post office", "auspost", "australia post"] },
  { value: "a pharmacy", filters: [`"amenity"="pharmacy"`], words: ["pharmacy", "chemist"] },
  { value: "a supermarket", filters: [`"shop"="supermarket"`], words: ["supermarket", "groceries", "grocery store"] },
  { value: "a hardware store", filters: [`"shop"="hardware"`, `"shop"="doityourself"`], words: ["hardware store", "hardware"] },
  { value: "a library", filters: [`"amenity"="library"`], words: ["library"] },
  { value: "a bank", filters: [`"amenity"="bank"`], words: ["bank"] },
  { value: "a petrol station", filters: [`"amenity"="fuel"`], words: ["petrol", "petrol station", "servo"] },
  { value: "a newsagent", filters: [`"shop"="newsagent"`], words: ["newsagent", "newsagency"] },
  { value: "a bakery", filters: [`"shop"="bakery"`], words: ["bakery"] },
  { value: "a florist", filters: [`"shop"="florist"`], words: ["florist", "flowers"] },
  { value: "a bottle shop", filters: [`"shop"="alcohol"`], words: ["bottle shop", "bottlo"] },
  { value: "a doctor", filters: [`"amenity"="doctors"`], words: ["doctor", "doctors", "gp"] },
  { value: "a dentist", filters: [`"amenity"="dentist"`], words: ["dentist"] },
  { value: "a hairdresser", filters: [`"shop"="hairdresser"`], words: ["hairdresser", "barber", "haircut"] },
] as const;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "with", "from", "into", "onto", "to", "of", "on", "in", "at", "by", "my", "our", "your", "some", "new",
  "get", "buy", "pick", "up", "drop", "off", "return", "collect", "grab", "go", "visit", "take", "bring", "send", "post",
]);

export const placePhrases = (title: string) => {
  const words = title.split(/[^\p{L}\p{N}&']+/u).filter((word) => word.length >= 2);
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= PHRASE_WORDS && start + length <= words.length; length += 1) {
      const span = words.slice(start, start + length);
      const first = span[0]?.toLowerCase() ?? "";
      const last = span.at(-1)?.toLowerCase() ?? "";
      if (STOP_WORDS.has(first) || STOP_WORDS.has(last)) continue;
      const phrase = span.join(" ");
      const key = phrase.toLowerCase();
      if (seen.has(key) || PLACE_KINDS.some((kind) => kind.value === key) || key === NO_PLACE) continue;
      seen.add(key);
      phrases.push(phrase);
    }
  }
  return phrases.slice(0, PHRASE_LIMIT);
};

const INSTRUCTIONS =
  "Decide whether one person's Task needs them to travel in person to a shop, business or public place, and which place. The JSON holds the Task title. A Task done online, at home, or by phone needs no trip.";

export const tripAsk = (title: string, phrases: readonly string[]) =>
  ({
  cacheKey: "lifeos-places",
  instructions: INSTRUCTIONS,
  parts: [{ type: "input_json", data: { title } }],
  questions: [
    {
      type: "predicate",
      name: TRIP_QUESTION,
      instructions: "Does doing this Task need a trip in person to a shop, business or public place, such as buying, picking up or posting something there?",
    },
    {
      type: "choice",
      name: PLACE_QUESTION,
      instructions: "Which place does the Task need a trip to? Prefer a business or brand named in the title over a general kind of place.",
      choices: [
        ...phrases.map((value) => ({ value, description: "Named in the title." })),
        ...PLACE_KINDS.map(({ value }) => ({ value, description: "Any nearby place of this kind." })),
        { value: NO_PLACE, description: "The Task names no place to go." },
      ],
    },
  ],
}) satisfies ChoiceAsk;

export type TripDecision = { trip: number; place: string | null };

const TripAnswers = Schema.Struct({ answers: Schema.Array(Schema.Unknown) });

const Answer = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  probability: Schema.optional(soft(Schema.Number)),
  choice: Schema.optional(soft(Schema.String)),
});

const decodeAnswer = Schema.decodeUnknownOption(Answer);

export const parseTripDecisionFx = (body: unknown) =>
  Result.gen(function* () {
    const { answers } = yield* Result.mapError(Schema.decodeUnknownResult(TripAnswers)(body), () => new PlacesInvalidResponse());
    const decoded = answers.flatMap((entry) => Option.toArray(decodeAnswer(entry)));
    const trip = decoded.find((answer) => answer.name === TRIP_QUESTION);
    const place = decoded.find((answer) => answer.name === PLACE_QUESTION);
    if (trip?.type === "refusal" || place?.type === "refusal") return yield* Result.fail(new PlacesRefused());
    if (trip?.type !== "predicate" || trip.probability === undefined) return yield* Result.fail(new PlacesInvalidResponse());
    const chosen = place?.type === "choice" && place.choice !== undefined && place.choice !== NO_PLACE ? place.choice : null;
    return { trip: trip.probability, place: chosen } satisfies TripDecision;
  });

export const parseTripDecision = (body: unknown) => toNeverthrow(parseTripDecisionFx(body));

export const kindOf = (phrase: string) => {
  const key = phrase.trim().toLowerCase();
  return PLACE_KINDS.find((kind) => kind.value === key || kind.words.some((word) => word === key));
};

const overpassText = (text: string) => text.replace(/[\\"]/g, (char) => `\\${char}`).replace(/[.^$*+?()[\]{}|]/g, (char) => `\\\\${char}`);

export const roundedPosition = ({ lat, lon }: Position) => ({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });

const exactText = (text: string) => text.replace(/[\\"]/g, (char) => `\\${char}`);

const titleCase = (text: string) => text.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`);

const casings = (phrase: string) => [...new Set([phrase, titleCase(phrase), phrase.toLowerCase(), phrase.toUpperCase()])];

const brandFilters = (phrase: string) => {
  const exact = casings(phrase).flatMap((casing) => [`["brand"="${exactText(casing)}"]`, `["name"="${exactText(casing)}"]`]);
  const pattern = overpassText(phrase);
  return [...exact, `["shop"]["name"~"${pattern}",i]`, `["amenity"]["name"~"${pattern}",i]`];
};

export const overpassQuery = (phrase: string, from: Position) => {
  const around = `(around:${SEARCH_RADIUS_METRES},${from.lat},${from.lon})`;
  const kind = kindOf(phrase);
  const filters = kind ? kind.filters.map((filter) => `[${filter}]`) : brandFilters(phrase.trim());
  return `[out:json][timeout:25];(${filters.map((filter) => `nwr${filter}${around};`).join("")});out center tags ${SEARCH_RESULTS};`;
};

const gaveUp = (remark: string | undefined) => remark !== undefined && /runtime error|timed out|out of memory/i.test(remark);

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export const straightMetres = (a: Position, b: Position) => {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_METRES * Math.asin(Math.sqrt(h)));
};

const text = (value: string | undefined) => (value !== undefined && value.trim() !== "" ? value.trim() : undefined);

const Tags = Schema.Struct({
  name: Schema.optional(soft(Schema.String)),
  brand: Schema.optional(soft(Schema.String)),
  "addr:suburb": Schema.optional(soft(Schema.String)),
  branch: Schema.optional(soft(Schema.String)),
  "addr:city": Schema.optional(soft(Schema.String)),
});

const Element = Schema.Struct({
  type: Schema.String,
  id: Schema.Number,
  tags: Tags,
  lat: Schema.optional(Schema.Number),
  lon: Schema.optional(Schema.Number),
  center: Schema.optional(Schema.Struct({ lat: Schema.Number, lon: Schema.Number })),
});

const OverpassBody = Schema.Struct({
  elements: Schema.Array(Schema.Unknown),
  remark: Schema.optional(soft(Schema.String)),
});

const decodeElement = Schema.decodeUnknownOption(Element);

const placeOf = (raw: unknown, home: Position) => {
  const element = Option.getOrUndefined(decodeElement(raw));
  if (!element) return [];
  const centre = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : undefined);
  if (!centre) return [];
  const name = text(element.tags.name) ?? text(element.tags.brand);
  if (!name) return [];
  const position = { lat: centre.lat, lon: centre.lon };
  const suburb = text(element.tags["addr:suburb"]) ?? text(element.tags.branch) ?? text(element.tags["addr:city"]);
  const place: Place = { key: `${element.type}/${element.id}`, name, position, straightMetres: straightMetres(home, position) };
  if (suburb && suburb !== name) place.suburb = suburb;
  return [place];
};

export const nearestPlaces = (body: unknown, home: Position) =>
  Result.gen(function* () {
    const decoded = yield* Result.mapError(Schema.decodeUnknownResult(OverpassBody)(body), () => new PlacesInvalidResponse());
    if (gaveUp(decoded.remark)) return yield* Result.fail(new PlacesUnavailable({}));
    return decoded.elements
      .flatMap((element) => placeOf(element, home))
      .toSorted((a, b) => a.straightMetres - b.straightMetres)
      .slice(0, BRANCH_LIMIT);
  });

export const routingUrl = (mode: TravelMode, from: Position, places: readonly Place[]) => {
  const points = [from, ...places.map((place) => place.position)].map(({ lat, lon }) => `${lon},${lat}`).join(";");
  return `${ROUTING_URL}/${ROUTING_PROFILE[mode]}/table/v1/driving/${points}?sources=0&annotations=duration,distance`;
};

const RoutingBody = Schema.Struct({
  code: Schema.Literal("Ok"),
  durations: Schema.NonEmptyArray(Schema.Array(soft(Schema.Number))),
  distances: Schema.NonEmptyArray(Schema.Array(soft(Schema.Number))),
});

export const withTravel = (body: unknown, places: readonly Place[]) =>
  Result.gen(function* () {
    const decoded = yield* Result.mapError(Schema.decodeUnknownResult(RoutingBody)(body), () => new PlacesInvalidResponse());
    const [durations] = decoded.durations;
    const [distances] = decoded.distances;
    return places
      .map((place, index) => {
        const seconds = durations[index + 1];
        const metres = distances[index + 1];
        return seconds !== undefined && metres !== undefined ? { ...place, travel: { seconds: Math.round(seconds), metres: Math.round(metres) } } : place;
      })
      .toSorted((a, b) => (a.travel?.seconds ?? Number.POSITIVE_INFINITY) - (b.travel?.seconds ?? Number.POSITIVE_INFINITY) || a.straightMetres - b.straightMetres);
  });

export const geocodeUrl = (address: string) =>
  `${NOMINATIM_URL}?${new URLSearchParams({ q: address, format: "jsonv2", limit: "1", addressdetails: "1" }).toString()}`;

export type Geocoded = { position: Position; found: string };

const GeocodeAddress = Schema.Struct({
  house_number: Schema.optional(soft(Schema.String)),
  road: Schema.optional(soft(Schema.String)),
  suburb: Schema.optional(soft(Schema.String)),
  town: Schema.optional(soft(Schema.String)),
  city: Schema.optional(soft(Schema.String)),
  village: Schema.optional(soft(Schema.String)),
});

const GeocodeHit = Schema.Struct({
  lat: Schema.Union([Schema.String, Schema.Number]),
  lon: Schema.Union([Schema.String, Schema.Number]),
  display_name: Schema.optional(soft(Schema.String)),
  address: Schema.optional(soft(GeocodeAddress)),
});

export const parseGeocode = (body: unknown) =>
  Result.gen(function* () {
    const hits = yield* Result.mapError(Schema.decodeUnknownResult(Schema.Array(Schema.Unknown))(body), () => new GeocoderInvalidResponse());
    const [first] = hits;
    if (first === undefined) return null;
    const hit = yield* Result.mapError(Schema.decodeUnknownResult(GeocodeHit)(first), () => new GeocoderInvalidResponse());
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return yield* Result.fail(new GeocoderInvalidResponse());
    const address = hit.address ?? {};
    const street = [text(address.house_number), text(address.road)].filter(Boolean).join(" ");
    const area = text(address.suburb) ?? text(address.town) ?? text(address.city) ?? text(address.village);
    const found = [street, area].filter(Boolean).join(", ") || (text(hit.display_name) ?? "").split(",").slice(0, 2).join(",").trim();
    return { position: { lat, lon }, found } satisfies Geocoded;
  });

export const normalisedAddress = (address: string) => address.trim().replace(/\s+/g, " ").toLowerCase();

export const roundTripMinutes = (seconds: number) => Math.max(1, Math.ceil((2 * seconds) / 60));
