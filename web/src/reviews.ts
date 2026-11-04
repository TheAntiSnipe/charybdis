import { hash } from './wear';

export interface Review {
  /** Follows the song title: "<title> is an absolutely riveting experience to listen to". */
  phrase: string;
  /** A real music magazine the quote is (falsely) attributed to. */
  source: string;
}

// The point is that whatever the user picked sounds like the best thing ever recorded. Kept short so the quote fits on
// two lines of a sticker. Append freely; reordering or rewording only affects stickers picked from now on.
export const PHRASES = [
  'is an absolutely riveting experience to listen to',
  'is the sound of everything finally clicking into place',
  'is a flat-out masterpiece',
  'will rearrange your entire week',
  'is the reason music exists',
  'is a thunderclap. Play it twice.',
  'is a staggering, unmissable triumph',
  'is the best four minutes you will spend all year',
  'is impossible to ignore and harder to forget',
  'is bold, brilliant and utterly essential',
  'is a masterclass in making everyone else look lazy',
  'is pure, uncut, front-to-back greatness',
  'is a stone-cold, no-skips classic',
  'is the one everyone will be arguing about for years',
  'is a towering, jaw-dropping achievement',
  'is the kind of song that stops traffic',
  'is nothing short of astonishing',
  'is a breathtaking, heart-in-throat rush',
  'is the finest thing they have ever put to tape',
  'sounds like the future arriving early',
  'is relentless, ravishing and gloriously overstuffed',
  'is a gut-punch of pure joy',
  'is sublime from the first second to the last',
  'is a glorious, swaggering triumph',
  'is the sound of a career-defining moment',
  'is dazzling, daring and dangerously catchy',
  'will haunt your headphones for weeks',
  'is an instant, undeniable classic',
  'is spellbinding, start to finish',
  'is the rare song that lives up to the hype',
  'is a revelation, and then a second revelation',
  'is magnificent, merciless and wildly addictive',
  'is a seismic, once-in-a-decade moment',
  'is the song your favourite song wishes it was',
  'is the sound of lightning caught in a bottle',
  'is a shimmering, shameless showstopper',
  'is thrilling, tender and totally fearless',
  'is the greatest thing to happen to speakers since volume',
  'is an electrifying, hair-raising roar',
  'is a dizzying, delirious delight',
  'is ruthlessly, ridiculously good',
  'is the one track you cannot skip, ever',
  'is a monumental, mind-bending marvel',
  'is a fever dream you will want to relive',
  'is a perfectly engineered emotional ambush',
  'is the best argument for turning it up',
  'is a joyous, ferocious, unforgettable ride',
  'is the jewel in an already dazzling crown',
  'is peerless, punchy and impossibly cool',
  'is a sonic event of staggering scale',
  'is an unrepentant, unstoppable anthem',
  'is exquisite, effortless and entirely essential',
  'will make you call someone just to play it for them',
  'is a gorgeous, gleaming, grin-inducing gem',
  'is a ferocious, fully realised statement',
  'is simply the finest four minutes on the record',
  'is what happens when everything goes right',
  'is a head-spinning, heart-swelling wonder',
  'is a defiant, dazzling, deeply satisfying listen',
  'is the sound of someone getting it exactly right',
  'is a kaleidoscopic, knockout blast',
  'is so good it is borderline rude',
  'is a bone-rattling, soul-lifting triumph',
  'is utterly, unapologetically magnificent',
  'is the moment the whole album comes alive',
  'is an extraordinary, endlessly replayable gem',
  'is a roaring, radiant, razor-sharp thrill',
  'is the best use of a chorus in living memory',
  'is the kind of brilliance that gets you into trouble',
  'is a wildly ambitious, wholly successful stunner',
  'is a masterwork of mood, muscle and melody',
  'is quite possibly the song of the decade',
  'is a lush, loud and lovingly crafted knockout',
  'is the drop-everything highlight of the year',
  'is the sound of pure, unfiltered confidence',
  'is a riveting, riotous, rewarding listen',
  'is a cathartic, cinematic, completely compelling triumph',
  'is a flawless, fist-pumping, feel-good marvel',
  'is the kind of song that makes the room go quiet',
  'is a virtuoso, velvet-gloved haymaker',
  'is a pulse-quickening, pitch-perfect gem',
  'is a breathless, brilliant, bone-deep banger',
  'is an utterly irresistible, instantly iconic cut',
  'is beautifully, brutally, blissfully good',
  'is a glittering, genre-bending showstopper',
  'is the answer to every question you had about this band',
  'is an unmissable, unshakeable earworm of genius',
  'is the one they will play at the funeral of boredom',
  'is a sleek, savage, spine-tingling stunner',
  'is the single most persuasive thing you will hear this year',
  'is epic, intimate and unbelievably alive',
  'is a luminous, larger-than-life wonder',
  'is the full, glorious, five-star experience',
  'is a heart-stopping, hip-shaking howler of a track',
  'is a shock to the system in the best possible way',
  'is pure sonic sunshine',
  'is scorching, soulful and supremely self-assured',
  'is a warm, wild and wonderfully weird triumph',
  'is the kind of song you tell strangers about',
  'is a diamond-cut, dancefloor-ready delight',
  'is an enormous, effortless, endlessly rewarding thrill',
  'is perfect. We checked.',
];

// Real music magazines. The quotes are made up; this is a joke sticker on a private shelf.
export const MAGAZINES = [
  'ROLLING STONE', 'NME', 'SPIN', 'PITCHFORK', 'BILLBOARD', 'MOJO', 'UNCUT', 'Q MAGAZINE', 'KERRANG!', 'THE WIRE',
  'MIXMAG', 'VIBE', 'METAL HAMMER', 'CLASH', 'THE FADER', 'XXL', 'MELODY MAKER', 'THE SOURCE', 'ROCK SOUND', 'DJ MAG',
  'GRAMOPHONE', 'DOWNBEAT', 'JAZZTIMES', 'REVOLVER', 'ALTERNATIVE PRESS', 'THE QUIETUS', 'CREEM', 'SOUNDS',
];

/** The entries of `pool` that appear least often among `used`, so nothing repeats until everything has been used. */
function leastUsed(pool: readonly string[], used: readonly string[]): string[] {
  const counts = new Map(pool.map((p) => [p, 0]));
  for (const u of used) if (counts.has(u)) counts.set(u, counts.get(u)! + 1);
  const fewest = Math.min(...counts.values());
  return pool.filter((p) => counts.get(p) === fewest);
}

/**
 * A review for a new hero sticker. `taken` is every review already on the shelf: a quote or magazine is only used a
 * second time once all of them have been used once, a third time once all have been used twice, and so on.
 */
export function pickReview(taken: readonly Review[], seed: string): Review {
  const phrases = leastUsed(PHRASES, taken.map((r) => r.phrase));
  const sources = leastUsed(MAGAZINES, taken.map((r) => r.source));
  return {
    phrase: phrases[hash(`phrase:${seed}`) % phrases.length],
    source: sources[hash(`source:${seed}`) % sources.length],
  };
}
