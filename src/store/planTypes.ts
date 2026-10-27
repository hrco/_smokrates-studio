export const LABEL_DECISIONS = ['label_on', 'label_off'] as const;
export type LabelDecision = (typeof LABEL_DECISIONS)[number];

export const EPISODE_FORMATS = ['track_card', 'scene', 'loop', 'title'] as const;
export type EpisodeFormat = (typeof EPISODE_FORMATS)[number];

export const EPISODE_STATUSES = ['planned', 'rendering', 'ready', 'approved', 'skipped', 'not_new'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const PLAN_STATUSES = ['draft', 'approved'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const MAX_EPISODES_PER_WEEK = 7;
export const MIN_DURATION_SECONDS = 1;
export const MAX_DURATION_SECONDS = 60;

/** One night as the Creator writes it, with the publish time already parsed to epoch milliseconds. */
export type EpisodeInput = {
  night: number;
  format: EpisodeFormat;
  trackSlug: string;
  startSecond: number;
  durationSeconds: number;
  caption: string;
  claim: string;
  publishAtMs: number;
  labelDecision: LabelDecision;
  groksPrompt?: string;
};

/** A partial change to one night. At least one field is set. */
export type EpisodeUpdate = {
  publishAtMs?: number;
  caption?: string;
  trackSlug?: string;
  startSecond?: number;
  durationSeconds?: number;
  format?: EpisodeFormat;
  labelDecision?: LabelDecision;
};

export type PlanImport = {
  weekStart: string;
  shouldReplace: boolean;
  episodes: EpisodeInput[];
};

/** The Episode of docs/openapi.yaml. */
export type Episode = {
  id: string;
  night: number;
  format: EpisodeFormat;
  trackSlug: string;
  startSecond: number;
  durationSeconds: number;
  caption: string;
  claim: string;
  publishAt: string;
  labelDecision: LabelDecision;
  status: EpisodeStatus;
  renderPath: string | null;
};

/** The Plan of docs/openapi.yaml. */
export type Plan = {
  weekStart: string;
  status: PlanStatus;
  episodes: Episode[];
};
