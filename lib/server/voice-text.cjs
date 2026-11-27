// Prepares text for Kokoro. sherpa-onnx 2 reads words only through a lexicon, and silently skips a word that is
// not in it: numbers, acronyms and new words such as "softmax" were lost. Each such word is rewritten here into
// words the lexicon has. `has(word)` says whether the lexicon has a lowercase word.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];

/** A whole number below 10^15 in words: 1995 is "one thousand nine hundred ninety five". */
const integerWords = (n) => {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred` + (n % 100 ? ` ${integerWords(n % 100)}` : "");
  for (const [size, name] of SCALES) if (n >= size) return `${integerWords(Math.floor(n / size))} ${name}` + (n % size ? ` ${integerWords(n % size)}` : "");
  return String(n);
};

/** A year from 1100 to 2099 is read as people say it: 1995 is "nineteen ninety five", 2026 "twenty twenty six". */
const yearWords = (n) => {
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${integerWords(high)} hundred`;
  return `${integerWords(high)} ${low < 10 ? `oh ${ONES[low]}` : integerWords(low)}`;
};

/** A number as written ("1,024", "3.14", "1995") in words. */
const numberWords = (written) => {
  const [whole, fraction] = written.replace(/,/g, "").split(".");
  const n = Number(whole);
  if (!Number.isSafeInteger(n) || n >= 1e15) return written.split("").join(" ");
  const head = !fraction && whole.length === 4 && n >= 1100 && n < 2100 ? yearWords(n) : integerWords(n);
  return fraction ? `${head} point ${fraction.split("").map((digit) => ONES[Number(digit)]).join(" ")}` : head;
};

/** A word cut into the fewest words the lexicon has, each of two letters or more; null when it cannot be. */
const segment = (word, has) => {
  const best = new Array(word.length + 1).fill(null);
  best[0] = [];
  for (let end = 2; end <= word.length; end++)
    for (let start = 0; start <= end - 2; start++) {
      const part = word.slice(start, end);
      const said = knownOrAlias(part, has);
      if (best[start] && said && (!best[end] || best[start].length + 1 < best[end].length)) best[end] = [...best[start], said];
    }
  return best[word.length];
};

const spell = (word) => word.toLowerCase().split("").join(" ");

/* An ending the lexicon may lack on a word it has, and the word Kokoro says for it ("" says nothing):
   "tokenizer" is "tokenize er", "embeddings" is "embedding". A plural's sound is lost; the word is not. */
const ENDINGS = [["r", "er"], ["er", "er"], ["ers", "ers"], ["ing", "ing"], ["s", ""], ["es", ""], ["ly", "lee"]];

/** Pieces the lexicon lacks, written as words that sound the same. */
const SOUNDS_LIKE = { py: "pie" };

const knownOrAlias = (part, has) => (has(part) ? part : SOUNDS_LIKE[part]);

/** One word the lexicon may not have, rewritten into words it has. */
const wordFor = (word, has) => {
  const lower = word.toLowerCase();
  if (has(lower)) return word;
  /* "model's", "models'" */
  const bare = lower.replace(/['’]s?$/, "");
  if (bare !== lower && has(bare)) return bare;
  /* GPT, LLM, FPS: an acronym is read letter by letter, as people say it. */
  if (/^[A-Z]{2,6}s?$/.test(word)) return spell(word.replace(/s$/, "")) + (word.endsWith("s") ? "s" : "");
  for (const [ending, said] of ENDINGS)
    if (bare.endsWith(ending) && has(bare.slice(0, -ending.length))) return [bare.slice(0, -ending.length), said].filter(Boolean).join(" ");
  const parts = segment(bare, has);
  if (parts) return parts.join(" ");
  return word.length <= 4 ? spell(word) : word;
};

/** The text with every number and every word the lexicon does not have rewritten so Kokoro says it. */
const speakable = (text, has) =>
  text
    .replace(/(\d)%/g, "$1 percent")
    .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (written) => ` ${numberWords(written)} `)
    .replace(/[\p{L}][\p{L}'’]*/gu, (word) => wordFor(word, has))
    .replace(/[-–—/]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();

module.exports = { speakable, numberWords };
