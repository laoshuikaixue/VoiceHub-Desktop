<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { toast } from "@/composables/useToast";
import type { VoiceHubSettings } from "@shared/types/settings";
import type { VoiceHubScheduleItem } from "@shared/types/voicehub";

const defaults: VoiceHubSettings = {
  enabled: false,
  baseUrl: "",
  mode: "display",
  pollIntervalSec: 60,
  autoPopup: true,
  popupView: "desktopLyric",
  playTimeId: "all",
  cookie: "",
};

const form = reactive<VoiceHubSettings>({ ...defaults });
/** playTimeId 以文本编辑，保存时归一化为 number | "all" */
const playTimeIdText = ref<string>("all");
const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const preview = ref<VoiceHubScheduleItem[]>([]);

const loadConfig = async (): Promise<void> => {
  loading.value = true;
  try {
    const cfg = (await window.api.config.get("voicehub")) as VoiceHubSettings | null;
    Object.assign(form, defaults, cfg || {});
    playTimeIdText.value = String(form.playTimeId);
  } finally {
    loading.value = false;
  }
};

const save = async (): Promise<void> => {
  saving.value = true;
  try {
    // 逐键写入：主进程 config:set 监听 voicehub.* 变更后自动重启调度
    await window.api.config.set("voicehub.enabled", form.enabled);
    await window.api.config.set("voicehub.baseUrl", form.baseUrl.trim().replace(/\/+$/, ""));
    await window.api.config.set("voicehub.mode", form.mode);
    await window.api.config.set("voicehub.pollIntervalSec", Math.max(15, form.pollIntervalSec));
    await window.api.config.set("voicehub.autoPopup", form.autoPopup);
    await window.api.config.set("voicehub.popupView", form.popupView);
    const rawPt = playTimeIdText.value.trim();
    const playTimeId = rawPt === "" || rawPt.toLowerCase() === "all" ? "all" : Number(rawPt);
    await window.api.config.set("voicehub.playTimeId", Number.isNaN(playTimeId as number) ? "all" : playTimeId);
    await window.api.config.set("voicehub.cookie", form.cookie.trim());
    toast.success("已保存 VoiceHub 配置");
  } catch (error) {
    toast.error(`保存失败：${String(error)}`);
  } finally {
    saving.value = false;
  }
};

const testConnection = async (): Promise<void> => {
  testing.value = true;
  preview.value = [];
  try {
    const list = await window.api.voicehub.getSchedules();
    preview.value = list.slice(0, 8);
    toast.success(`连接成功，今日排期 ${list.length} 首`);
  } catch (error) {
    toast.error(`连接失败：${String(error)}`);
  } finally {
    testing.value = false;
  }
};

const openSite = async (): Promise<void> => {
  const ok = await window.api.voicehub.openSite();
  if (!ok) toast.warning("请先填写服务地址并保存");
};

/** 模拟测试：把“当前”置为指定日期/时刻，观察到点是否弹窗 */
const simDate = ref<string>(new Date().toISOString().slice(0, 10));
const simTime = ref<string>("");
const simActive = ref(false);

const refreshSimStatus = async (): Promise<void> => {
  try {
    const s = await window.api.voicehub.simulationStatus();
    simActive.value = s.active;
  } catch {
    simActive.value = false;
  }
};

const startSim = async (): Promise<void> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(simDate.value)) {
    toast.warning("请选择模拟日期");
    return;
  }
  const ok = await window.api.voicehub.setSimulation(simDate.value, simTime.value || null);
  if (ok) {
    simActive.value = true;
    toast.success(`已模拟为 ${simDate.value}${simTime.value ? " " + simTime.value : ""}`);
  } else {
    toast.error("模拟时间无效");
  }
};

const clearSim = async (): Promise<void> => {
  await window.api.voicehub.clearSimulation();
  simActive.value = false;
  toast.info("已恢复真实时间");
};

onMounted(() => {
  void loadConfig();
  void refreshSimStatus();
});
</script>

<template>
  <div class="voicehub-page">
    <h2 class="title">VoiceHub 集成</h2>
    <p class="desc">
      到点自动弹出歌词窗，补全广播站播放时无法看到当前歌曲的情况。三种模式：仅显示歌词（不发声，按排期时间轴同步）、桌面播放（解析直链出声）、完整站点（内嵌网页）。
    </p>

    <div v-if="loading" class="hint">加载配置中…</div>

    <form v-else class="form" @submit.prevent="save">
      <label class="row">
        <span>启用</span>
        <input v-model="form.enabled" type="checkbox" />
      </label>

      <label class="row">
        <span>服务地址</span>
        <input v-model="form.baseUrl" type="text" placeholder="https://your-voicehub.example.com" />
      </label>

      <label class="row">
        <span>模式</span>
        <select v-model="form.mode">
          <option value="display">仅显示歌词</option>
          <option value="audio">桌面播放</option>
          <option value="site">完整站点</option>
        </select>
      </label>

      <label class="row">
        <span>轮询间隔（秒）</span>
        <input v-model.number="form.pollIntervalSec" type="number" min="15" max="600" />
      </label>

      <label class="row">
        <span>到点自动弹窗</span>
        <input v-model="form.autoPopup" type="checkbox" />
      </label>

      <label class="row">
        <span>弹窗视图</span>
        <select v-model="form.popupView">
          <option value="desktopLyric">桌面歌词</option>
          <option value="main">主窗口</option>
        </select>
      </label>

      <label class="row">
        <span>时段 ID</span>
        <input v-model="playTimeIdText" type="text" placeholder="all 或数字" />
      </label>

      <label class="row">
        <span>管理员 Cookie（可选）</span>
        <input v-model="form.cookie" type="text" placeholder="留空为匿名公开口径" />
      </label>

      <div class="actions">
        <button type="submit" :disabled="saving">保存</button>
        <button type="button" :disabled="testing" @click="testConnection">测试连接</button>
        <button type="button" @click="openSite">打开站点模式</button>
      </div>
    </form>

    <div class="sim">
      <div class="sim-head">
        <h3>模拟测试</h3>
        <span v-if="simActive" class="badge">模拟中</span>
      </div>
      <p class="sim-tip">
        将“当前时间”设为指定日期（留空时刻则沿用当前时分秒），虚拟时间按真实速率推进；设定到某个时段开始前几十秒，即可观察到点自动弹窗（需先启用并保存，建议“仅显示歌词”模式）。
      </p>
      <div class="sim-row">
        <input v-model="simDate" type="date" />
        <input v-model="simTime" type="time" placeholder="时刻（可选）" />
        <button type="button" @click="startSim">开始模拟</button>
        <button type="button" @click="clearSim">恢复真实时间</button>
      </div>
    </div>

    <div v-if="preview.length" class="preview">
      <h3>今日排期预览</h3>
      <ul>
        <li v-for="item in preview" :key="item.id">
          #{{ item.sequence }} {{ item.song.title }} — {{ item.song.artist }}
          <span class="pt">（{{ item.playTime?.name || "未定时段" }}）</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.voicehub-page {
  padding: 24px;
  max-width: 720px;
}
.title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}
.desc {
  font-size: 13px;
  line-height: 1.6;
  opacity: 0.75;
  margin-bottom: 20px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.row > span {
  font-size: 14px;
}
.row input[type="text"],
.row input[type="number"],
.row select {
  flex: 1;
  max-width: 360px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  background: var(--input-bg, rgba(128, 128, 128, 0.08));
  color: inherit;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}
.actions button {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: var(--primary-color, #4f7cff);
  color: #fff;
}
.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  opacity: 0.6;
}
.preview {
  margin-top: 24px;
}
.sim {
  margin-top: 24px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
}
.sim-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sim-head h3 {
  margin: 0;
  font-size: 16px;
}
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-color, #4f7cff);
  color: #fff;
}
.sim-tip {
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.7;
  margin: 8px 0;
}
.sim-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.sim-row input {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  background: var(--input-bg, rgba(128, 128, 128, 0.08));
  color: inherit;
}
.sim-row button {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: var(--primary-color, #4f7cff);
  color: #fff;
}
.preview ul {
  list-style: none;
  padding: 0;
}
.preview li {
  padding: 6px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.preview .pt {
  opacity: 0.6;
  font-size: 12px;
}
</style>
