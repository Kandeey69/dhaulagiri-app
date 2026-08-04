import {
  companyStorageKey,
  getActiveCompanyId,
  getCompanySetting,
  setCompanySetting,
} from "../companyContext";

export const TRACK_INVENTORY_KEY = "suite-track-inventory";
export const TRACK_INVENTORY_LEGACY_MIGRATION_KEY = `${TRACK_INVENTORY_KEY}:legacy-migrated`;

const isBrowser = () => typeof window !== "undefined" && Boolean(window.localStorage);

export function inventoryTrackingStorageKey(companyId = getActiveCompanyId()) {
  return companyStorageKey(TRACK_INVENTORY_KEY, companyId);
}

export function inventoryTrackingLegacyMigrationKey(companyId = getActiveCompanyId()) {
  return companyStorageKey(TRACK_INVENTORY_LEGACY_MIGRATION_KEY, companyId);
}

export function migrateLegacyInventoryTrackingSetting(companyId = getActiveCompanyId()) {
  if (!isBrowser()) {
    return;
  }

  const scopedKey = inventoryTrackingStorageKey(companyId);
  const migrationKey = inventoryTrackingLegacyMigrationKey(companyId);

  if (localStorage.getItem(scopedKey) !== null) {
    localStorage.setItem(migrationKey, "yes");
    return;
  }

  if (localStorage.getItem(migrationKey) === "yes") {
    return;
  }

  const legacyValue = localStorage.getItem(TRACK_INVENTORY_KEY);
  if (legacyValue === "yes" || legacyValue === "no") {
    localStorage.setItem(scopedKey, legacyValue);
  }

  localStorage.setItem(migrationKey, "yes");
}

export function isInventoryTrackingEnabled() {
  migrateLegacyInventoryTrackingSetting();
  return getCompanySetting(TRACK_INVENTORY_KEY, "no") === "yes";
}

export function isInventoryTrackingEnabledForCompany(companyId: string) {
  if (!isBrowser()) {
    return false;
  }

  migrateLegacyInventoryTrackingSetting(companyId);
  return localStorage.getItem(inventoryTrackingStorageKey(companyId)) === "yes";
}

export function writeInventoryTrackingSetting(enabled: boolean) {
  setCompanySetting(TRACK_INVENTORY_KEY, enabled ? "yes" : "no");

  if (isBrowser()) {
    localStorage.setItem(inventoryTrackingLegacyMigrationKey(), "yes");
  }
}

export function writeInventoryTrackingSettingForCompany(companyId: string, enabled: boolean) {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(inventoryTrackingStorageKey(companyId), enabled ? "yes" : "no");
  localStorage.setItem(inventoryTrackingLegacyMigrationKey(companyId), "yes");
}
