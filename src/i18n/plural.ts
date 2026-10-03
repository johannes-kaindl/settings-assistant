import { t } from "../vendor/kit/i18n";

/** Zahlenrichtiger Text: waehlt `<key>.one` bei n === 1, sonst `<key>.many`; {0} ist n. */
export function tn(key: string, n: number): string {
  return t(n === 1 ? `${key}.one` : `${key}.many`, n);
}
