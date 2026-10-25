import { ipcMain } from "electron";
import * as api from "@main/services/voicehub/api";
import { startScheduler, setSimulation, clearSimulation, getSimulationStatus } from "@main/services/voicehub/scheduler";
import { openSiteWindow, closeSiteWindow, toggleSiteWindow } from "@main/window";
import type { VoiceHubSong } from "@shared/types/voicehub";

/** 注册 VoiceHub 相关 IPC */
export const registerVoiceHubIpc = (): void => {
  // 渲染端按需拉取排期（如站点/手动预览页），主进程代理规避 CORS
  ipcMain.handle("voicehub:schedules", (_event, date?: string) => api.getSchedules(date));
  ipcMain.handle("voicehub:resolveUrl", (_event, song: VoiceHubSong) => api.resolvePlayUrl(song));
  ipcMain.handle("voicehub:lyric", (_event, song: VoiceHubSong) => api.getLyric(song));

  // 完整站点模式窗口
  ipcMain.handle("voicehub:openSite", () => openSiteWindow() !== null);
  ipcMain.handle("voicehub:closeSite", () => closeSiteWindow());
  ipcMain.handle("voicehub:toggleSite", () => toggleSiteWindow());

  // 配置保存后手动触发一次调度重启（设置页可调用，config:set 已自动处理）
  ipcMain.handle("voicehub:reload", () => startScheduler());

  // 时间模拟：将“当前”置为指定日期/时刻，测试到点弹窗
  ipcMain.handle("voicehub:sim:set", (_event, date: string, time: string | null) =>
    setSimulation(date, time),
  );
  ipcMain.handle("voicehub:sim:clear", () => clearSimulation());
  ipcMain.handle("voicehub:sim:status", () => getSimulationStatus());
};
