// SEEDED RANDOMNESS — the film grain's only source of entropy, and it is not entropy.
//
// The grain must look random and must NOT be random: regenerating a cover next year has to
// produce the same 150,000 specks in the same places, or "deterministic" is a claim about
// the type and not about the bytes. So the seed is the story's own slug, and the generator
// is written out here rather than taken from a dependency.
//
// Both functions are the standard xmur3 / mulberry32 pair. They are reproduced in full — 20
// lines — instead of installed, because a dependency for this would be a fourth thing whose
// version has to be pinned and whose future maintainer could "improve" the mixing constants.
// Every operation below is integer: Math.imul, XOR and unsigned shifts are exactly specified
// by the language, so the sequence is identical on every engine and every platform. The one
// float operation is the final division by 2^32, which is exact for a 32-bit numerator.
//
// NOTE the seed is the SLUG, not the title. Two stories can share a title; a slug is the
// primary key. Retitling a story leaves its grain alone, which is right — the grain is a
// property of the object, not of its words.

/** xmur3: string → a well-mixed 32-bit seed. */
export function seedFrom(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: 32-bit seed → a repeatable stream of floats in [0, 1). */
export function rngFrom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stream for a given slug. The only entry point the renderer uses. */
export const rngForSlug = (slug) => rngFrom(seedFrom(slug));
