import { useEffect, useState } from "react";
import type { ActivityLog } from "../data/types";
import { getActivityLogs } from "../data/storage";

export default function ActivityLogs() {
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  async function loadActivityLogs() {
    setActivityLogs(await getActivityLogs(100));
  }

  useEffect(() => {
    loadActivityLogs();
  }, []);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header report-header">
          <h3>Activity Logs</h3>
          <button className="secondary" type="button" onClick={loadActivityLogs}>
            Refresh
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created at</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activityLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatActivityTime(log.createdAt)}</td>
                  <td>{log.action}</td>
                  <td>{log.detail}</td>
                </tr>
              ))}
              {activityLogs.length === 0 && (
                <tr>
                  <td className="empty" colSpan={3}>
                    No activity recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatActivityTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
