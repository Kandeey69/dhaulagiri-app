import { useEffect, useState } from "react";
import type { Party } from "../data/types";
import { deleteParty, getParties, saveParty, updateParty } from "../data/storage";
import { scrollToPageTop } from "../../scroll";
import { confirmAction, notifyError, notifyToast } from "../../components/notificationService";

type PartiesProps = {
  canManage: boolean;
  isReadOnly?: boolean;
};

type PartySortKey = "name" | "phone" | "panNo" | "openingBalance" | "address";
type SortDirection = "asc" | "desc";

export default function Parties({ canManage, isReadOnly = false }: PartiesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [editingPartyId, setEditingPartyId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [panNo, setPanNo] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [search, setSearch] = useState("");
  const [nameError, setNameError] = useState("");
  const [partySort, setPartySort] = useState<{ key: PartySortKey | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });

  async function loadParties() {
    setParties(await getParties());
  }

  useEffect(() => {
    loadParties();
  }, []);

  function clearForm() {
    setEditingPartyId("");
    setName("");
    setAddress("");
    setPhone("");
    setPanNo("");
    setOpeningBalance("0");
  }

  function handleEditParty(party: Party) {
    if (!canManage) {
      notifyError("Master access is required to edit party details.", "Edit not allowed");
      return;
    }

    setEditingPartyId(party.id);
    setName(party.name);
    setAddress(party.address ?? "");
    setPhone(party.phone ?? "");
    setPanNo(party.panNo ?? "");
    setOpeningBalance(String(party.openingBalance));
    scrollToPageTop("smooth");
  }

  async function handleSave() {
    setNameError("");

    if (!name.trim()) {
      setNameError("Party name is required.");
      window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[name="partyName"]')?.focus());
      return;
    }

    try {
      if (editingPartyId) {
        if (!canManage) {
          notifyError("Master access is required to update party details.", "Edit not allowed");
          return;
        }

        await updateParty({
          id: editingPartyId,
          name: name.trim(),
          address,
          phone,
          panNo,
          openingBalance: Number(openingBalance || 0),
          isActive: true,
        });
        notifyToast("Party updated successfully.");
      } else {
        await saveParty({
          name: name.trim(),
          address,
          phone,
          panNo,
          openingBalance: Number(openingBalance || 0),
          isActive: true,
        });
        notifyToast("Party saved successfully.");
      }

      clearForm();
      await loadParties();
    } catch (error) {
      console.error("saveParty error:", error);
      notifyError(error instanceof Error ? error.message : String(error || "Failed to save party."), "Party could not be saved");
    }
  }

  async function handleDeleteParty(party: Party) {
    if (!canManage) {
      notifyError("Master access is required to delete party details.", "Delete not allowed");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete party?",
      message: `Party: ${party.name}\nPAN: ${party.panNo || "-"}\nOpening balance: ${party.openingBalance.toLocaleString()}\n\nThis cannot be undone.`,
      confirmLabel: "Delete party",
      destructive: true,
    });

    if (!confirmed) return;

    try {
      await deleteParty(party.id);

      if (editingPartyId === party.id) {
        clearForm();
      }

      await loadParties();
      notifyToast(`Party ${party.name} deleted successfully.`);
    } catch (error) {
      console.error("deleteParty error:", error);
      notifyError(error instanceof Error ? error.message : String(error || "Failed to delete party."), "Party could not be deleted");
    }
  }

  const filteredParties = parties.filter((party) => {
    const query = search.trim().toLowerCase();

    if (!query) return true;

    return [party.name, party.phone, party.panNo, party.address]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const sortedParties = partySort.key
    ? [...filteredParties].sort((left, right) => compareParties(left, right, partySort.key as PartySortKey, partySort.direction))
    : filteredParties;

  function togglePartySort(key: PartySortKey) {
    setPartySort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function renderSortableHeader(key: PartySortKey, label: string) {
    const isActive = partySort.key === key;
    return (
      <th aria-sort={isActive ? (partySort.direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sortable-table-header" onClick={() => togglePartySort(key)}>
          {label}
          <span aria-hidden="true">{isActive ? (partySort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
          <span className="sr-only">
            {isActive ? ` sorted ${partySort.direction === "asc" ? "ascending" : "descending"}` : " sort column"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <>
      <h1>Party Master</h1>
      {!isReadOnly && <div className="card">
        <h3>{editingPartyId ? "Edit Party" : "Add Party"}</h3>

        <div className="form-grid">
          <label className="full-width-field">
            Party Name
            <input name="partyName" value={name} aria-invalid={Boolean(nameError)} onChange={(e) => {
              setName(e.target.value);
              setNameError("");
            }} />
            {nameError && <span className="field-error" role="alert">{nameError}</span>}
          </label>

          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>

          <label>
            PAN/VAT No.
            <input value={panNo} onChange={(e) => setPanNo(e.target.value)} />
          </label>

          <label>
            Opening Balance
            <input
              type="number"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </label>

          <label>
            Address
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
        </div>

        <br />
        <div className="action-buttons">
          <button className="primary" onClick={handleSave}>
            {editingPartyId ? "Update Party" : "Add Party"}
          </button>

          {editingPartyId && (
            <button className="secondary" onClick={clearForm}>
              Cancel Edit
            </button>
          )}
        </div>
      </div>}

      <div className="card">
        <div className="card-header report-header">
          <h3>Parties</h3>

          <label className="search-field">
            Search Party
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, PAN, or address"
            />
          </label>
        </div>

        <table>
          <thead>
            <tr>
              {renderSortableHeader("name", "Name")}
              {renderSortableHeader("phone", "Phone")}
              {renderSortableHeader("panNo", "PAN/VAT")}
              {renderSortableHeader("openingBalance", "Opening Balance")}
              {renderSortableHeader("address", "Address")}
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {sortedParties.map((party) => (
              <tr key={party.id}>
                <td>{party.name}</td>
                <td>{party.phone}</td>
                <td>{party.panNo}</td>
                <td>{party.openingBalance.toLocaleString()}</td>
                <td>{party.address}</td>
                {canManage && (
                  <td>
                    <div className="action-buttons">
                      <button
                        className="secondary small"
                        onClick={() => handleEditParty(party)}
                      >
                        Edit
                      </button>

                      <button
                        className="danger small"
                        onClick={() => handleDeleteParty(party)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function compareParties(left: Party, right: Party, key: PartySortKey, direction: SortDirection) {
  const directionMultiplier = direction === "asc" ? 1 : -1;

  if (key === "openingBalance") {
    const compare = Number(left.openingBalance || 0) - Number(right.openingBalance || 0);
    if (compare !== 0) return compare * directionMultiplier;
  } else {
    const compare = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
    if (compare !== 0) return compare * directionMultiplier;
  }

  return left.name.localeCompare(right.name);
}
