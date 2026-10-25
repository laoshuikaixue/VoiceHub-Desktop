import { store } from "@main/store";
import type {
  VoiceHubScheduleItem,
  VoiceHubSong,
  VoiceHubLyricResult,
  VoiceHubPlayUrlResult,
} from "@shared/types/voicehub";

/** 读取并规范化服务端根地址（去末尾斜杠） */
const getBaseUrl = (): string => (store.get("voicehub.baseUrl") || "").replace(/\/+$/, "");

/** 管理员预览草稿用 Cookie，公开口径为空 */
const getCookie = (): string => store.get("voicehub.cookie") || "";

const isConfigured = (): boolean => /^https?:\/\//i.test(getBaseUrl());

/** 统一请求：拼接根地址、附带 Cookie、超时保护、非 2xx 抛错 */
const request = async <T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> => {
  if (!isConfigured()) throw new Error("VoiceHub 服务地址未配置");
  const { timeoutMs = 15000, headers, ...rest } = init;
  const cookie = getCookie();
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`VoiceHub 接口 ${path} 返回 ${response.status}`);
  return (await response.json()) as T;
};

/** 拉取指定北京日期（默认今天）的公开排期 */
export const getSchedules = async (date?: string): Promise<VoiceHubScheduleItem[]> => {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const data = await request<VoiceHubScheduleItem[]>(`/api/songs/public${query}`);
  return Array.isArray(data) ? data : [];
};

/**
 * 解析可直接播放的音频直链
 * 与站点降级链一致但只走服务端接口（规避 CORS / 第三方源）
 */
export const resolvePlayUrl = async (song: VoiceHubSong): Promise<VoiceHubPlayUrlResult> => {
  const platform = (song.musicPlatform || "").trim();
  const musicId = (song.musicId || "").trim();

  // 已带直链的历史数据优先透传
  if (song.playUrl && platform !== "tencent") return { url: song.playUrl, source: "stored" };
  if (!platform || !musicId) return { url: null };

  try {
    if (platform === "netease") {
      const res = await request<any>(
        `/api/api-enhanced/netease/song/url/v1?id=${encodeURIComponent(musicId)}&level=exhigh`,
      );
      const url = res?.data?.[0]?.url;
      return { url: typeof url === "string" && url ? url : null, source: "netease" };
    }
    if (platform === "tencent") {
      const res = await request<any>("/api/music/resolve-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "tencent", musicId, quality: 8, strategy: "fallback" }),
      });
      return { url: res?.success && res?.url ? String(res.url) : null, source: res?.source };
    }
    if (platform === "migu") {
      const res = await request<any>(
        `/api/native-api/migu/playurl?contentId=${encodeURIComponent(musicId)}&toneFlag=PQ`,
      );
      let url = res?.success && res?.url ? String(res.url) : null;
      // http 直链在 https 站点下无碍（本地 <audio>），保持原样
      return { url, source: "migu" };
    }
  } catch (error) {
    console.warn(`[voicehub] 解析播放链接失败 (${platform}):`, error);
  }
  return { url: null };
};

/** 获取歌词原文（LRC/QRC），失败返回 null，交由上层展示"暂无歌词" */
export const getLyric = async (song: VoiceHubSong): Promise<VoiceHubLyricResult | null> => {
  const platform = (song.musicPlatform || "").trim();
  const musicId = (song.musicId || "").trim();
  if (!platform || !musicId) return null;

  try {
    if (platform === "netease") {
      const res = await request<any>(
        `/api/api-enhanced/netease/lyric?id=${encodeURIComponent(musicId)}`,
      );
      const content = res?.lrc?.lyric || "";
      if (!content.trim()) return null;
      return { content, format: "lrc", translation: res?.tlyric?.lyric || undefined };
    }
    if (platform === "tencent") {
      const res = await request<any>(
        `/api/native-api/lyric/tx?songmid=${encodeURIComponent(musicId)}`,
      );
      const data = res?.data || {};
      const content = data.qrc || data.lrc || "";
      if (!content.trim()) return null;
      return {
        content,
        format: data.qrc ? "qrc" : "lrc",
        translation: data.trans || undefined,
      };
    }
    if (platform === "migu") {
      const res = await request<any>(
        `/api/native-api/lyric/mg?contentId=${encodeURIComponent(musicId)}`,
      );
      const content = res?.data?.lrc || "";
      if (!content.trim()) return null;
      return { content, format: "lrc", translation: res?.data?.trans || undefined };
    }
  } catch (error) {
    console.warn(`[voicehub] 获取歌词失败 (${platform}):`, error);
  }
  return null;
};

export const isVoiceHubConfigured = isConfigured;
