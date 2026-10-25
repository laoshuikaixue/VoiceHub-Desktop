/** VoiceHub 服务端排期与歌词数据契约（桌面端只读消费，字段对齐 server/api/songs/public.get.ts） */

/** 排期歌曲信息（公开口径，仅保留展示/播放所需字段） */
export interface VoiceHubSong {
  id: number;
  title: string;
  artist: string;
  cover: string | null;
  musicPlatform: string | null;
  musicId: string | null;
  durationSeconds: number | null;
  playUrl: string | null;
  /** 投稿人显示名（可能已脱敏/匿名） */
  requester?: string | null;
}

/** 播放时段（HH:mm 文本，可空表示不限） */
export interface VoiceHubPlayTime {
  id: number;
  name: string;
  startTime: string | null;
  endTime: string | null;
  enabled: boolean;
}

/** 单条排期 */
export interface VoiceHubScheduleItem {
  id: number;
  playDate: string;
  sequence: number;
  playTimeId: number | null;
  playTime: VoiceHubPlayTime | null;
  song: VoiceHubSong;
}

/** 歌词获取结果（原始文本 + 建议格式） */
export interface VoiceHubLyricResult {
  /** 主歌词原文 */
  content: string;
  /** 歌词格式，交由 lyric-kit 解析 */
  format: "lrc" | "qrc" | "yrc" | "ttml";
  /** 翻译歌词（可选） */
  translation?: string;
}

/** 音频直链解析结果 */
export interface VoiceHubPlayUrlResult {
  url: string | null;
  /** 命中来源标识，便于日志 */
  source?: string;
}

/** 调度器推送给渲染端的"当前曲目"事件 */
export interface VoiceHubNowPlayingEvent {
  /** 排期项 */
  item: VoiceHubScheduleItem;
  /** 该曲在北京时间轴上的绝对起始/结束（Unix ms） */
  startMs: number;
  endMs: number;
  /** 当日排期序列（供下一曲/进度展示） */
  queue: VoiceHubScheduleItem[];
  /** 是否处于某个播放时段内 */
  inWindow: boolean;
}

/** 音频直链解析结果（与 VoiceHubPlayUrlResult 同源）已定义于上 */

/** 时间轴诊断结果 */
export interface VoiceHubTimelineDebug {
  date: string;
  nowMs: number;
  simActive: boolean;
  totalSongs: number;
  timedSongs: number;
  inWindow: boolean;
  current: { title: string; artist: string; startMs: number; endMs: number } | null;
  windows: {
    name: string;
    startTime: string | null;
    endTime: string | null;
    enabled: boolean;
    songCount: number;
    timedCount: number;
    firstStartMs: number | null;
    lastEndMs: number | null;
  }[];
}

/** VoiceHub preload API */
export interface VoiceHubApi {
  getSchedules: (date?: string) => Promise<VoiceHubScheduleItem[]>;
  resolveUrl: (song: VoiceHubSong) => Promise<VoiceHubPlayUrlResult>;
  getLyric: (song: VoiceHubSong) => Promise<VoiceHubLyricResult | null>;
  openSite: () => Promise<boolean>;
  closeSite: () => Promise<void>;
  toggleSite: () => Promise<boolean>;
  reload: () => Promise<void>;
  setSimulation: (date: string, time: string | null) => Promise<boolean>;
  clearSimulation: () => Promise<void>;
  simulationStatus: () => Promise<{ active: boolean; virtualDate: string }>;
  timelineDebug: () => Promise<VoiceHubTimelineDebug>;
  onNowPlaying: (
    callback: (data: VoiceHubNowPlayingEvent & { playUrl: string | null }) => void,
  ) => () => void;
  onConfigChange: (callback: (data: VoiceHubSettingsLike) => void) => () => void;
  onOpenPlayer: (callback: () => void) => () => void;
}

/** 配置变更广播的松散结构 */
export type VoiceHubSettingsLike = {
  enabled: boolean;
  baseUrl: string;
  mode: "display" | "audio" | "site";
  pollIntervalSec: number;
  autoPopup: boolean;
  popupView: "player+taskbar" | "taskbarLyric" | "player" | "desktopLyric";
  playTimeId: number | "all";
  defaultStartTime: string;
  cookie: string;
};
