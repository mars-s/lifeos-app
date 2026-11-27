const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export const toBase64 = (bytes: Uint8Array) => {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const word = (a << 16) | (b << 8) | c;
    out.push(
      ALPHABET[(word >> 18) & 63]!,
      ALPHABET[(word >> 12) & 63]!,
      i + 1 < bytes.length ? ALPHABET[(word >> 6) & 63]! : "=",
      i + 2 < bytes.length ? ALPHABET[word & 63]! : "=",
    );
  }
  return out.join("");
};

export const fromBase64 = (text: string) => {
  const clean = text.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP.get(clean[i]!) ?? 0;
    const b = LOOKUP.get(clean[i + 1]!) ?? 0;
    const c = LOOKUP.get(clean[i + 2] ?? "A") ?? 0;
    const d = LOOKUP.get(clean[i + 3] ?? "A") ?? 0;
    const word = (a << 18) | (b << 12) | (c << 6) | d;
    if (at < bytes.length) bytes[at++] = (word >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (word >> 8) & 255;
    if (at < bytes.length) bytes[at++] = word & 255;
  }
  return bytes;
};
