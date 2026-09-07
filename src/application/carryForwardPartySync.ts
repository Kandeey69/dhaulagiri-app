export type CarryForwardPartyRef = {
  id: string;
};

export type CarryForwardActivityRef = {
  action: string;
  detail?: string;
  details?: string;
  metadata?: string;
  oldValue?: string;
};

export type CarryForwardPartyRemovalInput<T extends CarryForwardPartyRef> = {
  deletedSourcePartyIds: Iterable<string>;
  referencedTargetPartyIds: Iterable<string>;
  sourcePartyIds: Iterable<string>;
  targetParties: T[];
};

export function deletedPartyIdsFromCarryForwardSourceLogs(logs: CarryForwardActivityRef[]) {
  const ids = new Set<string>();

  logs.forEach((log) => {
    const action = log.action.trim().toLowerCase();
    if (!action.includes("party deleted") && !action.includes("deleted party")) {
      return;
    }

    addDeletedPartyIdFromText(ids, log.detail);
    addDeletedPartyIdFromText(ids, log.details);
    addDeletedPartyIdFromJson(ids, log.oldValue);
    addDeletedPartyIdFromJson(ids, log.metadata);
  });

  return ids;
}

export function removableDeletedCarryForwardPartyIds<T extends CarryForwardPartyRef>({
  deletedSourcePartyIds,
  referencedTargetPartyIds,
  sourcePartyIds,
  targetParties,
}: CarryForwardPartyRemovalInput<T>) {
  const sourceIds = new Set(sourcePartyIds);
  const deletedIds = new Set(deletedSourcePartyIds);
  const referencedIds = new Set(referencedTargetPartyIds);

  return targetParties
    .filter((party) =>
      party.id &&
      deletedIds.has(party.id) &&
      !sourceIds.has(party.id) &&
      !referencedIds.has(party.id),
    )
    .map((party) => party.id);
}

function addDeletedPartyIdFromText(ids: Set<string>, text?: string) {
  if (!text) {
    return;
  }

  const match = text.match(/\bDeleted party\s+([A-Za-z0-9_-]+)\.?/i);
  if (match?.[1]) {
    ids.add(match[1]);
  }
}

function addDeletedPartyIdFromJson(ids: Set<string>, text?: string) {
  if (!text?.trim()) {
    return;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const maybeId = partyIdFromJsonValue(parsed);
    if (maybeId) {
      ids.add(maybeId);
    }
  } catch {
    // Older activity log fields are plain text; only JSON payloads can add IDs here.
  }
}

function partyIdFromJsonValue(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") {
    return record.id;
  }

  const party = record.party;
  if (party && typeof party === "object") {
    const partyRecord = party as Record<string, unknown>;
    if (typeof partyRecord.id === "string") {
      return partyRecord.id;
    }
  }

  return "";
}
