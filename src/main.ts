import { Plugin, getLanguage } from "obsidian";
import "./i18n/strings";
import { pickLang, setLang } from "./vendor/kit/i18n";
import { mergeSettings } from "./vendor/kit/settings";
import { DEFAULT_GFS_POLICY, type GfsPolicy } from "./vendor/kit/rotation";
import { ApplyService } from "./obsidian/apply-service";

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

interface AssistantSettings { retention: GfsPolicy }
const DEFAULT_SETTINGS: AssistantSettings = { retention: DEFAULT_GFS_POLICY };

export default class SettingsAssistantPlugin extends Plugin {
  settings: AssistantSettings = mergeSettings(DEFAULT_SETTINGS, null);
  applyService!: ApplyService;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());
    this.applyService = new ApplyService(this.app, () => this.settings);
  }
}
