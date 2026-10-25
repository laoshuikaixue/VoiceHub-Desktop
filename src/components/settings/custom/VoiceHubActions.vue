<script setup lang="ts">
import { ref } from "vue";
import { toast } from "@/composables/useToast";
import type { VoiceHubScheduleItem, VoiceHubTimelineDebug } from "@shared/types/voicehub";

const testing = ref(false);
const preview = ref<VoiceHubScheduleItem[]>([]);
const simActive = ref(false);
const simDate = ref<string>(new Date().toISOString().slice(0, 10));
const simTime = ref<string>("");
const debug = ref<VoiceHubTimelineDebug | null>(null);
const debugging = ref(false);

/** Unix ms → 北京时间 HH:mm:ss */
const fmtBJ = (ms: number | null): string =>
  ms === null
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(ms));

const runDebug = async (): Promise<void> => {
  debugging.value = true;
  try {
    debug.value = await window.api.voicehub.timelineDebug();
  } catch (error) {
    toast.error(`诊断失败：${String(error)}`);
  } finally {
    debugging.value = false;
  }
};

/** 测试连接：拉取（模拟态下的）当日排期 */
const testConnection = async (): Promise<void> => {
  testing.value = true;
  preview.value = [];
  try {
    const list = await window.api.voicehub.getSchedules();
    preview.value = list.slice(0, 8);
    toast.success(`连接成功，排期 ${list.length} 首`);
  } catch (error) {
    toast.error(`连接失败：${String(error)}`);
  } finally {
    testing.value = false;
  }
};

const openSite = async (): Promise<void> => {
  const ok = await window.api.voicehub.openSite();
  if (!ok) toast.warning("请先在上方填写并保存服务地址");
};

const refreshSimStatus = async (): Promise<void> => {
  try {
    const s = await window.api.voicehub.simulationStatus();
    simActive.value = s.active;
  } catch {
    simActive.value = false;
  }
};
void refreshSimStatus();

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
</script>

<template>
  <div class="vh-actions">
    <div class="btns">
      <button class="vh-btn" :disabled="testing" @click="testConnection">测试连接</button>
      <button class="vh-btn" @click="openSite">打开站点模式</button>
      <span v-if="simActive" class="badge">模拟中</span>
    </div>

    <div class="sim">
      <div class="sim-title">模拟测试（验证到点弹窗）</div>
      <p class="tip">
        将“当前时间”设为指定日期（留空时刻则沿用当前时分秒），虚拟时间按真实速率推进。设定到某时段开始前几十秒即可观察到点自动弹窗，需先启用并保存，建议“仅显示歌词”模式。
      </p>
      <div class="sim-row">
        <input v-model="simDate" type="date" class="vh-input" />
        <input v-model="simTime" type="time" step="1" class="vh-input" />
        <button class="vh-btn" @click="startSim">开始模拟</button>
        <button class="vh-btn ghost" @click="clearSim">恢复真实时间</button>
      </div>
      <div class="sim-row">
        <button class="vh-btn ghost" :disabled="debugging" @click="runDebug">时间轴诊断</button>
        <span class="tip">查看该日期有哪些时段、模拟时刻是否落在时段内</span>
      </div>

      <div v-if="debug" class="debug">
        <div class="dbg-line">
          日期 {{ debug.date }}・模拟时刻 {{ fmtBJ(debug.nowMs) }}・
          排期 {{ debug.totalSongs }} 首（可定时 {{ debug.timedSongs }}）
        </div>
        <div class="dbg-line" :class="debug.inWindow ? 'ok' : 'warn'">
          {{
            debug.inWindow
              ? `当前命中：${debug.current?.title} — ${debug.current?.artist}（${fmtBJ(debug.current?.startMs ?? null)}~${fmtBJ(debug.current?.endMs ?? null)}）`
              : "当前模拟时刻未落在任何播放时段，故不会弹窗（请把时刻设到某时段起点前几秒）"
          }}
        </div>
        <ul class="dbg-windows">
          <li v-for="(w, i) in debug.windows" :key="i">
            {{ w.name }} {{ w.startTime || "—" }}
            <span v-if="w.timedCount">（{{ fmtBJ(w.firstStartMs) }}~{{ fmtBJ(w.lastEndMs) }}）</span>
            · {{ w.songCount }} 首
            <span v-if="!w.enabled" class="tag">已停用</span>
            <span v-else-if="w.timedCount === 0" class="tag">{{
              w.startTime ? "歌曲缺时长" : "无开始时间可锚定"
            }}</span>
          </li>
        </ul>
      </div>
    </div>

    <ul v-if="preview.length" class="preview">
      <li v-for="item in preview" :key="item.id">
        #{{ item.sequence }} {{ item.song.title }} — {{ item.song.artist }}
        <span class="pt">（{{ item.playTime?.name || "未定时段" }}）</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.vh-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.btns {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vh-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: var(--primary-color, #4f7cff);
  color: #fff;
  font-size: 13px;
}
.vh-btn.ghost {
  background: transparent;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
  color: inherit;
}
.vh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary-color, #4f7cff);
  color: #fff;
}
.sim {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
}
.sim-title {
  font-size: 13px;
  font-weight: 600;
}
.tip {
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.7;
  margin: 6px 0 10px;
}
.sim-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.vh-input {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  background: var(--input-bg, rgba(128, 128, 128, 0.08));
  color: inherit;
}
.preview {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.preview li {
  padding: 5px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.preview .pt {
  opacity: 0.6;
  font-size: 12px;
}
.debug {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
}
.dbg-line.warn {
  color: #e6a23c;
}
.dbg-line.ok {
  color: #67c23a;
}
.dbg-windows {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
}
.dbg-windows li {
  padding: 3px 0;
  border-top: 1px dashed rgba(128, 128, 128, 0.2);
}
.dbg-windows .tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(230, 162, 60, 0.18);
  color: #e6a23c;
}
</style>
