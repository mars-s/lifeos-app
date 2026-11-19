import { err, ok } from "neverthrow";
import type { TravelMode } from "../../shared/features";
import type { ChoiceAsk } from "../ai/transport";
import type { Place, PlacesError, Position } from "./tables";

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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export type TripDecision = { trip: number; place: string | null };

export const parseTripDecision = (body: unknown) => {
  const invalid = err<TripDecision, PlacesError>({ kind: "invalid_response" });
  if (!isRecord(body) || !Array.isArray(body.answers)) return invalid;
  const answers: unknown[] = body.answers;
  const named = (name: string) => answers.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.name === name);
  const trip = named(TRIP_QUESTION);
  const place = named(PLACE_QUESTION);
  if (trip?.type === "refusal" || place?.type === "refusal") return err<TripDecision, PlacesError>({ kind: "refused" });
  if (trip?.type !== "predicate" || typeof trip.probability !== "number") return invalid;
  const chosen = place?.type === "choice" && typeof place.choice === "string" && place.choice !== NO_PLACE ? place.choice : null;
  return ok<TripDecision, PlacesError>({ trip: trip.probability, place: chosen });
};

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

const gaveUp = (remark: unknown) => typeof remark === "string" && /runtime error|timed out|out of memory/i.test(remark);

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export const straightMetres = (a: Position, b: Position) => {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_METRES * Math.asin(Math.sqrt(h)));
};

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

const placeOf = (element: unknown, home: Position) => {
  if (!isRecord(element) || !isRecord(element.tags) || typeof element.type !== "string" || typeof element.id !== "number") return [];
  const centre = isRecord(element.center) ? element.center : element;
  if (typeof centre.lat !== "number" || typeof centre.lon !== "number") return [];
  const tags = element.tags;
  const name = text(tags.name) ?? text(tags.brand);
  if (!name) return [];
  const position = { lat: centre.lat, lon: centre.lon };
  const suburb = text(tags["addr:suburb"]) ?? text(tags.branch) ?? text(tags["addr:city"]);
  const place: Place = { key: `${element.type}/${element.id}`, name, position, straightMetres: straightMetres(home, position) };
  if (suburb && suburb !== name) place.suburb = suburb;
  return [place];
};

export const nearestPlaces = (body: unknown, home: Position) => {
  if (!isRecord(body) || !Array.isArray(body.elements)) return err<Place[], PlacesError>({ kind: "invalid_response" });
  if (gaveUp(body.remark)) return err<Place[], PlacesError>({ kind: "unavailable" });
  const elements: unknown[] = body.elements;
  return ok<Place[], PlacesError>(
    elements
      .flatMap((element) => placeOf(element, home))
      .toSorted((a, b) => a.straightMetres - b.straightMetres)
      .slice(0, BRANCH_LIMIT),
  );
};

export const routingUrl = (mode: TravelMode, from: Position, places: readonly Place[]) => {
  const points = [from, ...places.map((place) => place.position)].map(({ lat, lon }) => `${lon},${lat}`).join(";");
  return `${ROUTING_URL}/${ROUTING_PROFILE[mode]}/table/v1/driving/${points}?sources=0&annotations=duration,distance`;
};

const rowOf = (value: unknown) => (Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as unknown[]) : null);

export const withTravel = (body: unknown, places: readonly Place[]) => {
  if (!isRecord(body) || body.code !== "Ok") return err<Place[], PlacesError>({ kind: "invalid_response" });
  const durations = rowOf(body.durations);
  const distances = rowOf(body.distances);
  if (!durations || !distances) return err<Place[], PlacesError>({ kind: "invalid_response" });
  return ok<Place[], PlacesError>(
    places
      .map((place, index) => {
        const seconds = durations[index + 1];
        const metres = distances[index + 1];
        return typeof seconds === "number" && typeof metres === "number"
          ? { ...place, travel: { seconds: Math.round(seconds), metres: Math.round(metres) } }
          : place;
      })
      .toSorted((a, b) => (a.travel?.seconds ?? Number.POSITIVE_INFINITY) - (b.travel?.seconds ?? Number.POSITIVE_INFINITY) || a.straightMetres - b.straightMetres),
  );
};

export const geocodeUrl = (address: string) =>
  `${NOMINATIM_URL}?${new URLSearchParams({ q: address, format: "jsonv2", limit: "1", addressdetails: "1" }).toString()}`;

export type Geocoded = { position: Position; found: string };

export const parseGeocode = (body: unknown) => {
  if (!Array.isArray(body)) return err<Geocoded | null, PlacesError>({ kind: "invalid_response" });
  const first: unknown = body[0];
  if (first === undefined) return ok<Geocoded | null, PlacesError>(null);
  if (!isRecord(first)) return err<Geocoded | null, PlacesError>({ kind: "invalid_response" });
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return err<Geocoded | null, PlacesError>({ kind: "invalid_response" });
  const address = isRecord(first.address) ? first.address : {};
  const street = [text(address.house_number), text(address.road)].filter(Boolean).join(" ");
  const area = text(address.suburb) ?? text(address.town) ?? text(address.city) ?? text(address.village);
  const found = [street, area].filter(Boolean).join(", ") || (text(first.display_name) ?? "").split(",").slice(0, 2).join(",").trim();
  return ok<Geocoded | null, PlacesError>({ position: { lat, lon }, found });
};

export const normalisedAddress = (address: string) => address.trim().replace(/\s+/g, " ").toLowerCase();

export const roundTripMinutes = (seconds: number) => Math.max(1, Math.ceil((2 * seconds) / 60));
