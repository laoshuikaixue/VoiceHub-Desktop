/** VoiceHub 排期均按北京时间（UTC+8，无夏令时）计算，桌面端自包含实现，不依赖站点 */

const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 模拟时钟基准（Unix ms）；null 表示使用真实时间 */
let simBaseMs: number | null = null;
/** 设定模拟基准时的真实墙钟，用于让虚拟时间按真实速率推进 */
let simAnchorReal = 0;

/** 当前调度评估时间：模拟态为 base + 真实经过毫秒，否则真实时间 */
export const getNowMs = (): number =>
  simBaseMs === null ? Date.now() : simBaseMs + (Date.now() - simAnchorReal);

/** 是否处于模拟态 */
export const isSimActive = (): boolean => simBaseMs !== null;

/** 设置/清除模拟基准时间 */
export const setSimNow = (baseEpochMs: number | null): void => {
  simBaseMs = baseEpochMs;
  simAnchorReal = baseEpochMs === null ? 0 : Date.now();
};

/** 将 HH:mm 或 HH:mm:ss 归一化补齐为 HH:mm:ss */
const normalizeHms = (hhmm: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
};

/**
 * 由模拟输入算出基准 Unix ms
 * @param date - YYYY-MM-DD
 * @param time - HH:mm(:ss)，为空则沿用当前真实北京时刻的时分秒
 */
export const makeSimEpoch = (date: string, time: string | null): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (time) {
    const hms = normalizeHms(time);
    if (!hms) return null;
    const ms = Date.parse(`${date}T${hms}+08:00`);
    return Number.isNaN(ms) ? null : ms;
  }
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  if (Number.isNaN(midnight)) return null;
  return midnight + getBeijingMsOfDay(Date.now());
};

/** 当前北京时间日历日 YYYY-MM-DD */
export const getBeijingDate = (nowMs = getNowMs()): string =>
  new Date(nowMs + BJ_OFFSET_MS).toISOString().slice(0, 10);

/** 当前北京时间当日已过毫秒数 */
export const getBeijingMsOfDay = (nowMs = getNowMs()): number =>
  (nowMs + BJ_OFFSET_MS) % 86400000;

/**
 * 把北京时间 (playDate, "HH:mm") 组合为绝对 Unix ms
 * @returns 无法解析时返回 null
 */
export const beijingTimeToEpoch = (playDate: string, hhmm: string | null): number | null => {
  if (!playDate || !hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const ms = Date.parse(`${playDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  return Number.isNaN(ms) ? null : ms;
};
