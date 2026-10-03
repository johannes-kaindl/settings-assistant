import { Plugin, getLanguage } from "obsidian";
import "./i18n/strings";
import { pickLang, setLang } from "./vendor/kit/i18n";

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class SettingsAssistantPlugin extends Plugin {
  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
  }
}
