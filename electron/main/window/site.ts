import { BrowserWindow, shell } from "electron";
import { store } from "@main/store";

const SITE_PARTITION = "persist:voicehub-site";

let siteWindow: BrowserWindow | null = null;

/** 规范化站点地址 */
const getSiteUrl = (): string | null => {
  const base = (store.get("voicehub.baseUrl") || "").replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : null;
};

/** 打开/聚焦完整站点模式窗口（持久化登录态） */
export const openSiteWindow = (): BrowserWindow | null => {
  const url = getSiteUrl();
  if (!url) return null;

  if (siteWindow && !siteWindow.isDestroyed()) {
    if (!siteWindow.isVisible()) siteWindow.show();
    siteWindow.focus();
    // 已打开时仅在地址变化时重新导航
    if (siteWindow.webContents.getURL().replace(/\/+$/, "") !== url) {
      void siteWindow.loadURL(url);
    }
    return siteWindow;
  }

  siteWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    autoHideMenuBar: true,
    title: "VoiceHub",
    show: false,
    webPreferences: {
      partition: SITE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 站点模式不注入应用 preload，保持与被嵌入网站一致的行为
      preload: undefined,
    },
  });

  // 站点的 window.open / target=_blank 在新窗口继续用同一持久化会话
  siteWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:$/i.test(new URL(target).protocol)) void shell.openExternal(target);
    return { action: "deny" };
  });

  siteWindow.once("ready-to-show", () => siteWindow?.show());
  siteWindow.on("closed", () => {
    siteWindow = null;
  });

  void siteWindow.loadURL(url);
  return siteWindow;
};

/** 获取站点窗口实例 */
export const getSiteWindow = (): BrowserWindow | null =>
  siteWindow && !siteWindow.isDestroyed() ? siteWindow : null;

/** 关闭站点窗口 */
export const closeSiteWindow = (): void => {
  if (siteWindow && !siteWindow.isDestroyed()) siteWindow.close();
};

/** 切换站点窗口显隐，返回切换后是否可见 */
export const toggleSiteWindow = (): boolean => {
  const win = getSiteWindow();
  if (win && win.isVisible()) {
    win.hide();
    return false;
  }
  return openSiteWindow() !== null;
};
