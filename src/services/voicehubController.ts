import type { Track } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import type { VoiceHubSong, VoiceHubScheduleItem, VoiceHubNowPlayingEvent } from "@shared/types/voicehub";
import { useMediaStore } from "@/stores/media";
import { load as loadAudio } from "@/core/player";

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
/** 切歌竞态令牌 */
let token = 0;

/** 处理主进程推送的当前曲目：解析直链交引擎播放，歌词写入 media store（其内部解析并同步 nowPlaying） */
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
    // 切出 audio 模式时清空由本控制器写入的播放态，交回主进程/引擎
    void (async () => {
      const cfg = (await window.api.config.get("voicehub")) as { mode: string };
      if (cfg?.mode !== "audio") useMediaStore().clear();
    })();
  });
};

/** 停止控制器 */
export const stopVoiceHubController = (): void => {
  unsubNowPlaying?.();
  unsubConfig?.();
  unsubNowPlaying = null;
  unsubConfig = null;
};
