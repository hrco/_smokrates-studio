import type {CheckTikTokPublishesSummary} from '../publish/checkTikTokPublishes';
import type {SendEpisodeToTikTokResult} from '../publish/sendEpisodeToTikTok';

export type TickSendRequest = {
  episodeId: string;
  nowMs: number;
  newId: () => string;
};

/** What the tick needs from TikTok. Absent on the server when credentials are missing. */
export type TickActions = {
  /** False when the token file has no saved tokens. The tick then stays idle and creates no job. */
  hasStoredToken: () => Promise<boolean>;
  checkPublishes: (nowMs: number) => Promise<CheckTikTokPublishesSummary>;
  sendEpisode: (request: TickSendRequest) => Promise<SendEpisodeToTikTokResult>;
};
