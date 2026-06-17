import { useEffect, useState } from "react";
import type { Party } from "../data/types";
import { deleteParty, getParties, saveParty, updateParty } from "../data/storage";

type PartiesProps = {
  canManage: boolean;
};

export default function Parties({ canManage }: PartiesProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [editingPartyId, setEditingPartyId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [panNo, setPanNo] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

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
      setMessage("Master access is required to edit party details.");
      return;
    }

    setMessage("");
    setEditingPartyId(party.id);
    setName(party.name);
    setAddress(party.address ?? "");
    setPhone(party.phone ?? "");
    setPanNo(party.panNo ?? "");
    setOpeningBalance(String(party.openingBalance));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    setMessage("");

    if (!name.trim()) {
      setMessage("Party name is required.");
      return;
    }

    try {
      if (editingPartyId) {
        if (!canManage) {
          setMessage("Master access is required to update party details.");
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
        setMessage("Party updated successfully.");
      } else {
        await saveParty({
          name: name.trim(),
          address,
          phone,
          panNo,
          openingBalance: Number(openingBalance || 0),
          isActive: true,
        });
        setMessage("Party saved successfully.");
      }

      clearForm();
      await loadParties();
    } catch (error) {
      console.error("saveParty error:", error);
      setMessage(
        error instanceof Error
        ? error.message
        : String(error || "Failed to save party.")
      );
    }
  }

  async function handleDeleteParty(party: Party) {
    if (!canManage) {
      setMessage("Master access is required to delete party details.");
      return;
    }

    const confirmed = window.confirm(
      `Delete party ${party.name}?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteParty(party.id);

      if (editingPartyId === party.id) {
        clearForm();
      }

      await loadParties();
      setMessage(`Party ${party.name} deleted successfully.`);
    } catch (error) {
      console.error("deleteParty error:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : String(error || "Failed to delete party.")
      );
    }
  }

  const filteredParties = parties.filter((party) => {
    const query = search.trim().toLowerCase();

    if (!query) return true;

    return [party.name, party.phone, party.panNo, party.address]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <>
      <h1>Party Master</h1>
      {message && <p className="status-message">{message}</p>}

      <div className="card">
        <h3>{editingPartyId ? "Edit Party" : "Add Party"}</h3>

        <div className="form-grid">
          <label className="full-width-field">
            Party Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
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
      </div>

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
              <th>Name</th>
              <th>Phone</th>
              <th>PAN/VAT</th>
              <th>Opening Balance</th>
              <th>Address</th>
              {canManage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filteredParties.map((party) => (
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
