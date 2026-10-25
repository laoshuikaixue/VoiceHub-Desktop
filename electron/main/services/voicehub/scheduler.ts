import { parseLyric } from "lyric-kit";
import type { LyricLine } from "lyric-kit";
import type { Track } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type {
  VoiceHubScheduleItem,
  VoiceHubNowPlayingEvent,
} from "@shared/types/voicehub";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import * as nowPlaying from "@main/services/nowPlaying";
import {
  createDesktopLyricWindow,
  getDesktopLyricWindow,
  focusMainWindow,
} from "@main/window";
import * as api from "./api";
import { beijingTimeToEpoch, getBeijingDate, getNowMs, makeSimEpoch, setSimNow, isSimActive } from "./time";

/** 时间轴条目：排期项 + 北京时间轴上的绝对起止 */
interface TimedEntry {
  item: VoiceHubScheduleItem;
  startMs: number;
  endMs: number;
  /** 所属时段起点，用于时段首次进入时触发弹窗 */
  blockStartMs: number;
}

/** 评估周期：驱动位置与切歌判定 */
const TICK_MS = 1000;

let entries: TimedEntry[] = [];
let lastRebuildAt = 0;
let currentId: number | null = null;
let lastPoppedBlockStart: number | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let lyricToken = 0;
let running = false;

/** VoiceHub 平台映射到 SPlayer 内部 Platform 枚举（仅供类型收窄与来源标识） */
const mapPlatform = (platform: string | null): Platform => {
  if (platform === "tencent") return "qqmusic";
  if (platform === "kugou") return "kugou";
  return "netease";
};

/** 由排期歌曲构造 Track */
const toTrack = (item: VoiceHubScheduleItem): Track => {
  const song = item.song;
  return {
    id: `vh-${song.id}`,
    source: mapPlatform(song.musicPlatform),
    title: song.title,
    artists: song.artist ? [{ name: song.artist }] : [],
    cover: song.cover || undefined,
    duration: (song.durationSeconds || 0) * 1000,
  };
};

/** 拉取当日排期并构建时间轴 */
const rebuild = async (): Promise<void> => {
  const playTimeId = store.get("voicehub.playTimeId");
  const date = getBeijingDate();
  const schedules = await api.getSchedules(date);
  const next: TimedEntry[] = [];
  // 按时段分组，累加时长得到每首歌曲的绝对时间点
  const byPlayTime = new Map<string, VoiceHubScheduleItem[]>();
  for (const item of schedules) {
    const pt = item.playTime;
    if (!pt || pt.enabled === false) continue;
    const startMs = beijingTimeToEpoch(item.playDate, pt.startTime);
    if (startMs === null) continue;
    if (playTimeId !== "all" && item.playTimeId !== playTimeId) continue;
    const key = `${item.playDate}|${pt.id}`;
    const group = byPlayTime.get(key) || [];
    group.push(item);
    byPlayTime.set(key, group);
  }
  for (const group of byPlayTime.values()) {
    group.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const first = group[0];
    const blockStart = beijingTimeToEpoch(first.playDate, first.playTime!.startTime)!;
    let cursor = blockStart;
    for (const item of group) {
      const durMs = (item.song.durationSeconds || 0) * 1000;
      if (durMs <= 0) continue;
      next.push({ item, startMs: cursor, endMs: cursor + durMs, blockStartMs: blockStart });
      cursor += durMs;
    }
  }
  next.sort((a, b) => a.startMs - b.startMs);
  entries = next;
  lastRebuildAt = Date.now();
};

/** 当前时间命中的条目 */
const pickCurrent = (now: number): TimedEntry | null =>
  entries.find((e) => now >= e.startMs && now < e.endMs) || null;

/** 解析歌词原文为 LyricLine[] */
const parseLyricLines = (
  content: string,
  format: "lrc" | "qrc" | "yrc" | "ttml",
  translation?: string,
): LyricLine[] => {
  try {
    const result = parseLyric(
      { content, format, translation, translationFormat: "lrc" },
      { detectBackground: true, preferredLang: "zh-CN", cleanKangxi: true, extractMetadata: true },
    );
    return result.lines;
  } catch (error) {
    console.warn("[voicehub] 歌词解析失败:", error);
    return [];
  }
};

/** 时段起点首次进入时弹窗（每天每时段仅一次） */
const maybePopup = (entry: TimedEntry): void => {
  if (!store.get("voicehub.autoPopup")) return;
  if (lastPoppedBlockStart === entry.blockStartMs) return;
  lastPoppedBlockStart = entry.blockStartMs;
  const view = store.get("voicehub.popupView");
  if (view === "main") {
    focusMainWindow();
    return;
  }
  const win = getDesktopLyricWindow();
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) win.showInactive();
  } else {
    createDesktopLyricWindow();
  }
};

/** display 模式：主进程直接喂 nowPlaying，供各歌词窗口无渲染端也能显示 */
const feedDisplayLyric = async (entry: TimedEntry): Promise<void> => {
  const token = ++lyricToken;
  const track = toTrack(entry.item);
  const lyric = await api.getLyric(entry.item.song);
  if (token !== lyricToken) return; // 已切歌，丢弃过期结果
  const lines = lyric ? parseLyricLines(lyric.content, lyric.format, lyric.translation) : [];
  const source: LyricData = lyric
    ? { source: "online", format: lyric.format, platform: track.source as Platform }
    : null;
  nowPlaying.update(track, lines, source);
  nowPlaying.onPlayStateChange("playing");
};

/** 推送到渲染端（audio/site 模式据此播放或展示） */
const emitNowPlaying = async (entry: TimedEntry | null): Promise<void> => {
  let event: VoiceHubNowPlayingEvent & { playUrl: string | null } = {
    item: entry?.item ?? (null as unknown as VoiceHubScheduleItem),
    startMs: entry?.startMs ?? 0,
    endMs: entry?.endMs ?? 0,
    queue: entries.map((e) => e.item),
    inWindow: !!entry,
    playUrl: null,
  };
  if (entry && store.get("voicehub.mode") === "audio") {
    const resolved = await api.resolvePlayUrl(entry.item.song);
    event.playUrl = resolved.url;
  }
  broadcast("voicehub:now-playing", event);
};

/** 每个 tick 的核心评估 */
const evaluate = async (): Promise<void> => {
  const now = getNowMs();
  const mode = store.get("voicehub.mode");
  const current = pickCurrent(now);

  if (!current) {
    if (currentId !== null) {
      currentId = null;
      if (mode === "display") nowPlaying.clear();
      await emitNowPlaying(null);
    }
    return;
  }

  // display 模式持续用墙钟驱动位置
  if (mode === "display") {
    const elapsed = Math.max(0, Math.min(now - current.startMs, current.endMs - current.startMs));
    nowPlaying.onPosition(elapsed, true);
  }

  if (currentId !== current.item.id) {
    currentId = current.item.id;
    maybePopup(current);
    await emitNowPlaying(current);
    if (mode === "display") await feedDisplayLyric(current);
  }
};

const loop = (): void => {
  const pollMs = Math.max(15, store.get("voicehub.pollIntervalSec") || 60) * 1000;
  const run = async (): Promise<void> => {
    if (!store.get("voicehub.enabled")) return;
    try {
      if (Date.now() - lastRebuildAt > pollMs) await rebuild();
      await evaluate();
    } catch (error) {
      console.warn("[voicehub] 调度轮询失败:", error);
    }
  };
  void run();
  tickTimer = setInterval(() => void run(), TICK_MS);
  running = true;
};

/** 停止调度并清理播放态 */
export const stopScheduler = (): void => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (running && store.get("voicehub.mode") === "display") nowPlaying.clear();
  running = false;
  currentId = null;
  entries = [];
};

/** 启动调度（幂等）；配置变更后应调用 resetScheduler 重新评估 */
export const startScheduler = (): void => {
  if (running) return;
  if (!store.get("voicehub.enabled")) return;
  loop();
};

/** 配置变更后重启：先停后启，立即重新拉取 */
export const resetScheduler = (): void => {
  stopScheduler();
  lastPoppedBlockStart = null;
  startScheduler();
};

/** 强制下一 tick 重新拉取模拟日的排期并重新判定当前曲/弹窗 */
const forceRefresh = (): void => {
  lastRebuildAt = 0;
  currentId = null;
  lastPoppedBlockStart = null;
};

/**
 * 开启时间模拟：把“当前”置为指定北京日期（可选时刻），虚拟时间按真实速率推进
 * @returns 基准合法并已生效返回 true
 */
export const setSimulation = (date: string, time: string | null): boolean => {
  const base = makeSimEpoch(date, time);
  if (base === null) return false;
  setSimNow(base);
  forceRefresh();
  startScheduler();
  return true;
};

/** 退出时间模拟，恢复真实时间 */
export const clearSimulation = (): void => {
  setSimNow(null);
  forceRefresh();
};

/** 模拟状态：供控制页回显 */
export const getSimulationStatus = (): { active: boolean; virtualDate: string } => ({
  active: isSimActive(),
  virtualDate: getBeijingDate(),
});
