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
import { isWin } from "@main/utils/config";
import * as nowPlaying from "@main/services/nowPlaying";
import {
  createDesktopLyricWindow,
  getDesktopLyricWindow,
  createTaskbarLyricWindow,
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

/** 由排期列表构建带绝对起止的时间轴条目 */
const buildTimedEntries = (
  schedules: VoiceHubScheduleItem[],
  playTimeId: number | "all",
): TimedEntry[] => {
  // 每日固定开始播放时间（HH:mm），作为未配时段/时段无开始时间歌曲的默认锚点
  const defaultStart = (store.get("voicehub.defaultStartTime") || "").trim();
  const next: TimedEntry[] = [];
  const byGroup = new Map<string, VoiceHubScheduleItem[]>();
  for (const item of schedules) {
    const pt = item.playTime;
    // 明确停用的时段跳过；未配时段（pt 为空）保留
    if (pt && pt.enabled === false) continue;
    if (playTimeId !== "all" && item.playTimeId !== playTimeId) continue;
    const key = pt ? `${item.playDate}|${pt.id}` : `fallback|${item.playDate}`;
    const group = byGroup.get(key) || [];
    group.push(item);
    byGroup.set(key, group);
  }
  for (const group of byGroup.values()) {
    group.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const first = group[0];
    // 本组优先用自身时段开始时间；无则回退到配置的每日固定开始时间
    const ownStart = beijingTimeToEpoch(first.playDate, first.playTime?.startTime ?? null);
    const blockStart = ownStart ?? beijingTimeToEpoch(first.playDate, defaultStart || null);
    if (blockStart === null) continue; // 既无时段开始时间也未配每日固定时间，无法定时
    let cursor = blockStart;
    for (const item of group) {
      const durMs = (item.song.durationSeconds || 0) * 1000;
      if (durMs <= 0) continue;
      next.push({ item, startMs: cursor, endMs: cursor + durMs, blockStartMs: blockStart });
      cursor += durMs;
    }
  }
  next.sort((a, b) => a.startMs - b.startMs);
  return next;
};

/** 拉取当日排期并构建时间轴 */
const rebuild = async (): Promise<void> => {
  const playTimeId = store.get("voicehub.playTimeId");
  const date = getBeijingDate();
  const schedules = await api.getSchedules(date);
  entries = buildTimedEntries(schedules, playTimeId);
  lastRebuildAt = Date.now();
};

/**
 * 时间轴诊断：返回当前（模拟）日期的时段概览与模拟时刻是否命中，供控制页排错
 */
export const getTimelineDebug = async (): Promise<{
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
}> => {
  const date = getBeijingDate();
  const now = getNowMs();
  const playTimeId = store.get("voicehub.playTimeId");
  const schedules = await api.getSchedules(date);
  const timed = buildTimedEntries(schedules, playTimeId);
  const current = timed.find((e) => now >= e.startMs && now < e.endMs) || null;
  // 按时段聚合概览（含未定时项），便于定位“为何不弹”
  const winMap = new Map<
    string,
    { name: string; startTime: string | null; endTime: string | null; enabled: boolean; songCount: number; timedCount: number; firstStartMs: number | null; lastEndMs: number | null }
  >();
  for (const item of schedules) {
    const pt = item.playTime;
    const key = pt ? String(pt.id) : "none";
    let w = winMap.get(key);
    if (!w) {
      w = {
        name: pt?.name || "未归属时段",
        startTime: pt?.startTime ?? null,
        endTime: pt?.endTime ?? null,
        enabled: pt ? pt.enabled !== false : true,
        songCount: 0,
        timedCount: 0,
        firstStartMs: null,
        lastEndMs: null,
      };
      winMap.set(key, w);
    }
    w.songCount++;
  }
  for (const e of timed) {
    const key = e.item.playTime ? String(e.item.playTime.id) : "none";
    const w = winMap.get(key);
    if (!w) continue;
    w.timedCount++;
    if (w.firstStartMs === null || e.startMs < w.firstStartMs) w.firstStartMs = e.startMs;
    if (w.lastEndMs === null || e.endMs > w.lastEndMs) w.lastEndMs = e.endMs;
  }
  return {
    date,
    nowMs: now,
    simActive: isSimActive(),
    totalSongs: schedules.length,
    timedSongs: timed.length,
    inWindow: !!current,
    current: current
      ? {
          title: current.item.song.title,
          artist: current.item.song.artist,
          startMs: current.startMs,
          endMs: current.endMs,
        }
      : null,
    windows: [...winMap.values()],
  };
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
  const openDesktop = view === "desktopLyric";
  const openTaskbar = view === "taskbarLyric" || view === "player+taskbar";
  const openPlayer = view === "player" || view === "player+taskbar";
  if (openDesktop) {
    const win = getDesktopLyricWindow();
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.showInactive();
    } else {
      createDesktopLyricWindow();
    }
  }
  // 任务栏歌词仅 Windows；createTaskbarLyricWindow 内部已幂等处理已存在的情况
  if (openTaskbar && isWin) createTaskbarLyricWindow();
  // 软件播放页：聚焦主窗口并通知渲染端展开全屏歌词页
  if (openPlayer) {
    focusMainWindow();
    broadcast("voicehub:openPlayer", null);
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
