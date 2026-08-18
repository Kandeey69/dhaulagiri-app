import { getCompanySetting, setCompanySetting } from "../../companyContext";

export type LetterheadSettings = {
  contactLine: string;
  nepaliCompanyName: string;
};

export const LETTERHEAD_SETTING_KEYS = {
  contactLine: "accounts-letterhead-contact-line",
  nepaliCompanyName: "accounts-letterhead-nepali-company-name",
} as const;

export const LETTERHEAD_SETTING_KEY_LIST = Object.values(LETTERHEAD_SETTING_KEYS);

export function readLetterheadSettings(): LetterheadSettings {
  return {
    contactLine: getCompanySetting(LETTERHEAD_SETTING_KEYS.contactLine, ""),
    nepaliCompanyName: getCompanySetting(LETTERHEAD_SETTING_KEYS.nepaliCompanyName, ""),
  };
}

export function writeLetterheadSettings(settings: LetterheadSettings) {
  setCompanySetting(LETTERHEAD_SETTING_KEYS.contactLine, settings.contactLine.trim());
  setCompanySetting(LETTERHEAD_SETTING_KEYS.nepaliCompanyName, settings.nepaliCompanyName.trim());
}
