import type { SettingCategory } from "@/types/settings-schema";
import VoiceHubActions from "@/components/settings/custom/VoiceHubActions.vue";
import IconLucideRadio from "~icons/lucide/radio";

const voicehubCategory: SettingCategory = {
  id: "voicehub",
  icon: IconLucideRadio,
  sections: [
    {
      id: "voicehub",
      items: [
        {
          key: "voicehubEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.voicehub.enabled" },
          defaultValue: false,
        },
        {
          key: "voicehubBaseUrl",
          type: "text",
          binding: { store: "settings", path: "system.voicehub.baseUrl" },
          placeholderKey: "settings.voicehubBaseUrl.placeholder",
        },
        {
          key: "voicehubMode",
          type: "select",
          binding: { store: "settings", path: "system.voicehub.mode" },
          defaultValue: "display",
          options: [
            { value: "display", labelKey: "settings.voicehubMode.display" },
            { value: "audio", labelKey: "settings.voicehubMode.audio" },
            { value: "site", labelKey: "settings.voicehubMode.site" },
          ],
        },
        {
          key: "voicehubAutoPopup",
          type: "switch",
          binding: { store: "settings", path: "system.voicehub.autoPopup" },
          defaultValue: true,
        },
        {
          key: "voicehubPopupView",
          type: "select",
          binding: { store: "settings", path: "system.voicehub.popupView" },
          defaultValue: "desktopLyric",
          options: [
            { value: "desktopLyric", labelKey: "settings.voicehubPopupView.desktopLyric" },
            { value: "main", labelKey: "settings.voicehubPopupView.main" },
          ],
        },
        {
          key: "voicehubPollInterval",
          type: "number",
          binding: { store: "settings", path: "system.voicehub.pollIntervalSec" },
          defaultValue: 60,
          min: 15,
          max: 600,
          step: 5,
        },
        {
          key: "voicehubPlayTimeId",
          type: "text",
          binding: { store: "settings", path: "voicehubPlayTimeId" },
          placeholderKey: "settings.voicehubPlayTimeId.placeholder",
        },
        {
          key: "voicehubDefaultStartTime",
          type: "text",
          binding: { store: "settings", path: "system.voicehub.defaultStartTime" },
          placeholderKey: "settings.voicehubDefaultStartTime.placeholder",
        },
        {
          key: "voicehubCookie",
          type: "text",
          binding: { store: "settings", path: "system.voicehub.cookie" },
          placeholderKey: "settings.voicehubCookie.placeholder",
        },
      ],
    },
    {
      id: "voicehubTest",
      items: [
        {
          key: "voicehubActions",
          type: "custom",
          component: VoiceHubActions,
          fullWidth: true,
          hideDescription: true,
        },
      ],
    },
  ],
};

export default voicehubCategory;
