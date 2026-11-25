import { fsrs, generatorParameters, Rating as FsrsRating, State, type Card, type Grade } from "ts-fsrs";
import { lastRecord, recordSignal } from "./confidence";
import type { CardSet, Cue, Rating, Schedule, ScheduleState, Stance } from "./types";

const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  }),
);

const GRADES: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

const STATES: Record<ScheduleState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const STATE_NAMES = Object.fromEntries(Object.entries(STATES).map(([name, state]) => [state, name])) as Record<State, ScheduleState>;

const toCard = (s: Schedule): Card => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: 0,
  scheduled_days: s.scheduledDays,
  learning_steps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: STATES[s.state],
  last_review: s.lastReview ? new Date(s.lastReview) : undefined,
});

const fromCard = (card: Card): Schedule => ({
  state: STATE_NAMES[card.state],
  due: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  lastReview: card.last_review ? card.last_review.toISOString() : null,
});

export const newSchedule = (now: Date): Schedule => ({
  state: "new",
  due: now.toISOString(),
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  lastReview: null,
});

/** Hours past local midnight when a new study day begins, so a late night still counts as the same day. */
const DAY_STARTS_AT = 4;

/** The local study day a moment falls on, as YYYY-MM-DD. Built from local fields, so daylight-saving changes don't move it. */
export const studyDay = (at: Date): string => {
  const shifted = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours() - DAY_STARTS_AT, at.getMinutes());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
};

const inLearning = (s: Schedule) => s.state === "learning" || s.state === "relearning";

/**
 * Whether a set that has been seen before should come up now. A learning step
 * waits for its exact minute; a review is due all of its study day.
 */
export const isDue = (s: Schedule, now: Date): boolean => {
  if (s.state === "new") return false;
  if (inLearning(s)) return new Date(s.due) <= now;
  return studyDay(new Date(s.due)) <= studyDay(now);
};

/** When each rating would bring the set back, for the rating buttons. */
export const previewDue = (s: Schedule, now: Date): Record<Rating, Date> => {
  const log = scheduler.repeat(toCard(s), now);
  return {
    again: log[FsrsRating.Again].card.due,
    hard: log[FsrsRating.Hard].card.due,
    good: log[FsrsRating.Good].card.due,
    easy: log[FsrsRating.Easy].card.due,
  };
};

/** A short label for how long until a date: 1m, 10m, 3h, 4d, 2mo, 1.5y. */
export const intervalLabel = (from: Date, to: Date): string => {
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
};

/** Relative odds of showing a cue, by its last rating: weaker cues come up more, none is ever left out. */
const CUE_WEIGHTS: Record<Rating | "untried", number> = { again: 4, hard: 3, good: 2, easy: 1, untried: 3 };

/** A cue last answered wrong with confidence holds a belief that is false: it comes up more than any other. */
const MISCONCEPTION_WEIGHT = 6;

const cueWeight = (set: CardSet, cue: Cue): number => {
  const last = lastRecord(set, cue.id);
  if (last && recordSignal(last) === "misconception") return MISCONCEPTION_WEIGHT;
  return CUE_WEIGHTS[cue.lastRating ?? "untried"];
};

/** The cue to show next. `random` is in [0, 1), passed in so the choice can be tested. */
export const pickCue = (set: CardSet, random: number): Cue => {
  const pinned = set.learningCueId && set.cues.find((cue) => cue.id === set.learningCueId);
  if (pinned) return pinned;
  const weights = set.cues.map((cue) => cueWeight(set, cue));
  let target = random * weights.reduce((sum, w) => sum + w, 0);
  for (const [i, cue] of set.cues.entries()) {
    target -= weights[i];
    if (target < 0) return cue;
  }
  return set.cues[set.cues.length - 1];
};

export interface Review extends Partial<Stance> {
  cueId: string;
  rating: Rating;
  /** The set's `schedule.reps` when the cue was shown. A stale or repeated rating carries an old count and is ignored. */
  reps: number;
}

/** Ratings a set keeps in its history; older ones fall off. Enough for any read of recent confidence. */
export const HISTORY_LIMIT = 50;

/** Applies one rating. Returns the set unchanged when the review is stale or names a cue the set no longer has. */
export const applyReview = (set: CardSet, review: Review, now: Date): CardSet => {
  if (review.reps !== set.schedule.reps || !set.cues.some((cue) => cue.id === review.cueId)) return set;
  const schedule = fromCard(scheduler.next(toCard(set.schedule), now, GRADES[review.rating]).card);
  return {
    ...set,
    schedule,
    cues: set.cues.map((cue) => (cue.id === review.cueId ? { ...cue, lastRating: review.rating } : cue)),
    learningCueId: inLearning(schedule) ? review.cueId : null,
    introducedOn: set.introducedOn ?? studyDay(now),
    history: [
      ...(set.history ?? []),
      { at: now.toISOString(), cueId: review.cueId, rating: review.rating, confidence: review.confidence ?? null, thinking: review.thinking ?? null },
    ].slice(-HISTORY_LIMIT),
  };
};

/** New sets a book introduces per study day unless the reader changes it. */
export const NEW_PER_DAY = 10;

/**
 * The sets to review now, in order: learning steps that are ready, then due
 * reviews, then new sets up to what is left of today's new limit. Sets with no
 * cues are skipped.
 */
export const reviewQueue = (sets: CardSet[], now: Date, newPerDay = NEW_PER_DAY): CardSet[] => {
  const live = sets.filter((set) => set.cues.length > 0);
  const byDue = (a: CardSet, b: CardSet) => a.schedule.due.localeCompare(b.schedule.due);
  const learning = live.filter((set) => inLearning(set.schedule) && isDue(set.schedule, now)).sort(byDue);
  const due = live.filter((set) => set.schedule.state === "review" && isDue(set.schedule, now)).sort(byDue);
  const today = studyDay(now);
  const introduced = sets.filter((set) => set.introducedOn === today).length;
  const fresh = live
    .filter((set) => set.schedule.state === "new")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, newPerDay - introduced));
  return [...learning, ...due, ...fresh];
};

/** When the next learning step comes up today, if any, so the review screen can say when to come back. */
export const nextLearningAt = (sets: CardSet[], now: Date): Date | null => {
  const upcoming = sets
    .filter((set) => set.cues.length > 0 && inLearning(set.schedule) && !isDue(set.schedule, now))
    .map((set) => new Date(set.schedule.due))
    .filter((due) => studyDay(due) === studyDay(now))
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
};
