import type { Track } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { VoiceHubSong, VoiceHubScheduleItem, VoiceHubNowPlayingEvent } from "@shared/types/voicehub";
import { useMediaStore } from "@/stores/media";
import { setQueue } from "@/stores/queue";
import { load as loadAudio, setRepeatMode } from "@/core/player";
import { setPlayerExpanded } from "@/services/playerTransition";

/** VoiceHub 平台映射到内部 Platform 枚举 */
const mapPlatform = (platform: string | null): Platform => {
  if (platform === "tencent") return "qqmusic";
  if (platform === "kugou") return "kugou";
  return "netease";
};

/** 由排期歌曲构造 Track（audio 模式经引擎播放时下发给 SMTC/托盘） */
const toTrack = (song: VoiceHubSong): Track => ({
  id: `vh-${song.id}`,
  source: mapPlatform(song.musicPlatform),
  title: song.title,
  artists: song.artist ? [{ name: song.artist }] : [],
  cover: song.cover || undefined,
  duration: (song.durationSeconds || 0) * 1000,
});

let unsubNowPlaying: (() => void) | null = null;
let unsubConfig: (() => void) | null = null;
let unsubOpenPlayer: (() => void) | null = null;
/** 切歌竞态令牌 */
let token = 0;
/** 上次构建队列的签名（当日排期 id 序列），变化才重建 */
let lastQueueSig = "";

/** 由当日排期构建 Track 列表（供 FullPlayer / 队列面板展示） */
const buildTracks = (items: VoiceHubScheduleItem[]): Track[] => items.map((i) => toTrack(i.song));

/** 处理主进程推送的当前曲目：构建当天队列 + 直链交引擎播放 + 歌词写入 media store */
const handleNowPlaying = async (
  event: VoiceHubNowPlayingEvent & { playUrl: string | null },
): Promise<void> => {
  const cfg = (await window.api.config.get("voicehub")) as { mode: string };
  if (cfg?.mode !== "audio") return;
  const myToken = ++token;
  const media = useMediaStore();

  const item = event.item as VoiceHubScheduleItem | null;
  if (!event.inWindow || !item) {
    media.clear();
    return;
  }

  // 构建/刷新当天歌单队列（仅可定时曲目）；设单曲循环防止 SPlayer 用自身解析自动切歌
  const sig = event.queue.map((q) => q.id).join(",");
  if (sig && sig !== lastQueueSig) {
    setQueue(buildTracks(event.queue), {
      originId: "voicehub",
      originType: "page",
      originName: "广播站排期",
    });
    setRepeatMode("one");
    lastQueueSig = sig;
  }

  const song = item.song as VoiceHubSong;
  const track = toTrack(song);
  media.setTrack(track);
  if (event.playUrl) {
    await loadAudio(event.playUrl, true, track);
    if (myToken !== token) return;
  }
  const lyric = await window.api.voicehub.getLyric(song);
  if (myToken !== token) return;
  if (lyric) {
    const source: LyricData = { source: "online", format: lyric.format, platform: track.source as Platform };
    media.setLyric(source, {
      content: lyric.content,
      format: lyric.format,
      translation: lyric.translation,
      translationFormat: "lrc",
    });
  } else {
    media.setLyric(null, null);
  }
};

/** 启动控制器：仅 audio 模式需要渲染端播放；display/site 全在主进程处理 */
export const startVoiceHubController = (): void => {
  if (unsubNowPlaying) return;
  unsubNowPlaying = window.api.voicehub.onNowPlaying((data) =>
    void handleNowPlaying(data).catch((err) => console.warn("[voicehub] 播放失败:", err)),
  );
  unsubConfig = window.api.voicehub.onConfigChange(() => {
    // 配置变更（含切模式）后重置队列签名，下次事件重建；主进程 resetScheduler 会重新推送当前曲
    lastQueueSig = "";
    void (async () => {
      const cfg = (await window.api.config.get("voicehub")) as { mode: string };
      if (cfg?.mode !== "audio") useMediaStore().clear();
    })();
  });
  // 主进程到点弹窗指令：展开软件全屏歌词播放页
  unsubOpenPlayer = window.api.voicehub.onOpenPlayer(() => setPlayerExpanded(true));
};

/** 停止控制器 */
export const stopVoiceHubController = (): void => {
  unsubNowPlaying?.();
  unsubConfig?.();
  unsubOpenPlayer?.();
  unsubNowPlaying = null;
  unsubConfig = null;
  unsubOpenPlayer = null;
};
