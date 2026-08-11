use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionPayload {
    id: String,
    fiscal_year_id: Option<String>,
    lifecycle_status: Option<String>,
    date_bs: String,
    date_ad: Option<String>,
    party_id: String,
    bank_name: Option<String>,
    amount: f64,
    receipt_no: Option<String>,
    remarks: Option<String>,
    posted_at: Option<String>,
    posted_by: Option<String>,
    voided_at: Option<String>,
    reversed_at: Option<String>,
    reversal_reason: Option<String>,
    replacement_transaction_id: Option<String>,
    created_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptAllocationPayload {
    id: String,
    receipt_id: String,
    sale_id: String,
    amount_npr: f64,
    created_at: String,
    updated_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LedgerEntryPayload {
    id: String,
    batch_id: String,
    company_id: String,
    fiscal_year_id: String,
    transaction_date: String,
    account_code: String,
    party_id: Option<String>,
    source_type: String,
    source_id: String,
    posting_version: String,
    debit: f64,
    credit: f64,
    narration: String,
    status: String,
    reversal_of_entry_id: Option<String>,
    created_at: String,
    updated_at: String,
}

const INITIAL_SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const APP_SETTINGS_SCHEMA: &str = include_str!("../migrations/002_app_settings.sql");
const LOCAL_EXPENSES_SCHEMA: &str = include_str!("../migrations/003_local_expenses.sql");
const LOCAL_EXPENSE_TYPE_SCHEMA: &str = include_str!("../migrations/004_local_expense_type.sql");
const ACTIVITY_LOG_USER_SCHEMA: &str = include_str!("../migrations/005_activity_log_user.sql");
const NORMALIZE_FREIGHT_STATUS_SCHEMA: &str =
    include_str!("../migrations/006_normalize_freight_status.sql");
const SUPPLIER_CURRENCY_SCHEMA: &str = include_str!("../migrations/007_supplier_currency.sql");
const ACCOUNTING_MODEL_SCHEMA: &str = include_str!("../migrations/008_accounting_model.sql");
const LIFECYCLE_LEDGER_SCHEMA: &str = include_str!("../migrations/009_lifecycle_ledger.sql");
const PURCHASE_LOADING_UNLOADING_SCHEMA: &str =
    include_str!("../migrations/010_purchase_loading_unloading.sql");
const DATABASE_URL: &str = "sqlite:import-purchases.db";

#[tauri::command]
fn read_company_seed(app: tauri::AppHandle) -> Result<String, String> {
    let seed_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("company-profiles.seed.json");

    if !seed_path.exists() {
        return Ok("[]".to_string());
    }

    std::fs::read_to_string(seed_path).map_err(|error| error.to_string())
}

fn validate_stock_database_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.starts_with("inventorytracked-stock")
        || !filename.ends_with(".db")
    {
        return Err("Invalid stock database filename.".to_string());
    }

    Ok(())
}

fn validate_accounts_database_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.starts_with("accounts")
        || !filename.ends_with(".db")
    {
        return Err("Invalid accounts database filename.".to_string());
    }

    Ok(())
}

fn validate_purchase_database_filename(filename: &str) -> Result<(), String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.starts_with("import-purchases")
        || !filename.ends_with(".db")
    {
        return Err("Invalid purchase database filename.".to_string());
    }

    Ok(())
}

async fn open_sqlite_connection(path: &std::path::Path) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);

    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())?;

    sqlx::query("PRAGMA busy_timeout = 10000")
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&mut connection)
        .await
        .map_err(|error| error.to_string())?;

    Ok(connection)
}

fn json_text(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string()
}

fn json_number(value: &serde_json::Value, key: &str) -> f64 {
    value.get(key).and_then(|item| item.as_f64()).unwrap_or(0.0)
}

async fn insert_purchase_ledger_entries(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entries: &[LedgerEntryPayload],
) -> Result<(), String> {
    for entry in entries {
        sqlx::query(
            r#"
            INSERT INTO ledger_entries (
                id, batchId, companyId, fiscalYearId, transactionDate, accountCode,
                partyId, sourceType, sourceId, postingVersion, debit, credit,
                narration, status, reversalOfEntryId, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&entry.id)
        .bind(&entry.batch_id)
        .bind(&entry.company_id)
        .bind(&entry.fiscal_year_id)
        .bind(&entry.transaction_date)
        .bind(&entry.account_code)
        .bind(entry.party_id.as_deref().unwrap_or(""))
        .bind(&entry.source_type)
        .bind(&entry.source_id)
        .bind(&entry.posting_version)
        .bind(entry.debit)
        .bind(entry.credit)
        .bind(&entry.narration)
        .bind(&entry.status)
        .bind(entry.reversal_of_entry_id.as_deref().unwrap_or(""))
        .bind(&entry.created_at)
        .bind(&entry.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

async fn insert_purchase_activity_log(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    activity_log: &serde_json::Value,
) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO activity_logs (
            id, action, details, userName, oldValue, newValue, metadata, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(json_text(activity_log, "id"))
    .bind(json_text(activity_log, "action"))
    .bind(json_text(activity_log, "details"))
    .bind(json_text(activity_log, "userName"))
    .bind(json_text(activity_log, "oldValue"))
    .bind(json_text(activity_log, "newValue"))
    .bind(json_text(activity_log, "metadata"))
    .bind(json_text(activity_log, "createdAt"))
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn delete_sale_with_stock_cleanup(
    app: tauri::AppHandle,
    accounts_filename: String,
    stock_filename: String,
    sale_id: String,
) -> Result<String, String> {
    validate_accounts_database_filename(&accounts_filename)?;
    if !stock_filename.trim().is_empty() {
        validate_stock_database_filename(&stock_filename)?;
    }

    let normalized_sale_id = sale_id.trim().to_string();
    if normalized_sale_id.is_empty() {
        return Err("Sale ID is required.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let accounts_path = app_data_dir.join(&accounts_filename);
    let mut accounts = open_sqlite_connection(&accounts_path).await?;

    let mut account_tx = accounts.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM receipt_allocations WHERE sale_id = ?")
        .bind(&normalized_sale_id)
        .execute(&mut *account_tx)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM ledger_entries WHERE source_type = 'SALE' AND source_id = ?")
        .bind(&normalized_sale_id)
        .execute(&mut *account_tx)
        .await
        .map_err(|error| error.to_string())?;
    let deleted_sale = sqlx::query("DELETE FROM sales WHERE id = ?")
        .bind(&normalized_sale_id)
        .execute(&mut *account_tx)
        .await
        .map_err(|error| error.to_string())?
        .rows_affected();

    let now_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let activity_id = format!("sale-delete-{now_millis}");
    let activity_detail = format!("Deleted sale {normalized_sale_id}.");
    sqlx::query(
        "INSERT INTO activity_logs (id, action, detail, created_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(activity_id)
    .bind("Sale Deleted")
    .bind(activity_detail)
    .execute(&mut *account_tx)
    .await
    .map_err(|error| error.to_string())?;

    account_tx
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    let mut stock_deleted = 0;
    if !stock_filename.trim().is_empty() {
        let stock_path = app_data_dir.join(&stock_filename);
        if stock_path.exists() {
            let mut stock = open_sqlite_connection(&stock_path).await?;
            let mut stock_tx = stock.begin().await.map_err(|error| error.to_string())?;
            sqlx::query(
                "DELETE FROM stock_sales_lines WHERE bill_id IN (SELECT id FROM stock_sales_bills WHERE id = ? AND source_type = 'Sale')",
            )
            .bind(&normalized_sale_id)
            .execute(&mut *stock_tx)
            .await
            .map_err(|error| error.to_string())?;
            stock_deleted =
                sqlx::query("DELETE FROM stock_sales_bills WHERE id = ? AND source_type = 'Sale'")
                    .bind(&normalized_sale_id)
                    .execute(&mut *stock_tx)
                    .await
                    .map_err(|error| error.to_string())?
                    .rows_affected();
            stock_tx.commit().await.map_err(|error| error.to_string())?;
        }
    }

    Ok(format!(
        "deleted_sale_rows:{deleted_sale};deleted_stock_bill_rows:{stock_deleted}"
    ))
}

#[tauri::command]
async fn write_collection_transaction(
    app: tauri::AppHandle,
    accounts_filename: String,
    mode: String,
    collection_id: String,
    collection: Option<CollectionPayload>,
    allocations: Vec<ReceiptAllocationPayload>,
    ledger_entries: Vec<LedgerEntryPayload>,
    activity_id: String,
    activity_action: String,
    activity_detail: String,
    activity_created_at: String,
) -> Result<String, String> {
    validate_accounts_database_filename(&accounts_filename)?;

    let normalized_mode = mode.trim().to_ascii_lowercase();
    if !["create", "update", "delete"].contains(&normalized_mode.as_str()) {
        return Err("Invalid collection write mode.".to_string());
    }

    let normalized_collection_id = collection_id.trim().to_string();
    if normalized_collection_id.is_empty() {
        return Err("Collection ID is required.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let accounts_path = app_data_dir.join(&accounts_filename);
    let mut accounts = open_sqlite_connection(&accounts_path).await?;
    let mut tx = accounts.begin().await.map_err(|error| error.to_string())?;

    let collection_rows;
    if normalized_mode == "create" {
        let payload = collection
            .as_ref()
            .ok_or_else(|| "Collection payload is required.".to_string())?;
        collection_rows = sqlx::query(
            r#"
            INSERT INTO collections (
                id, fiscal_year_id, lifecycle_status, date_bs, date_ad, party_id,
                bank_name, amount, reference_no, posted_at, posted_by, voided_at,
                reversed_at, reversal_reason, replacement_transaction_id, remarks, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&payload.id)
        .bind(payload.fiscal_year_id.as_deref().unwrap_or(""))
        .bind(payload.lifecycle_status.as_deref().unwrap_or("POSTED"))
        .bind(&payload.date_bs)
        .bind(payload.date_ad.as_deref().unwrap_or(""))
        .bind(&payload.party_id)
        .bind(payload.bank_name.as_deref().unwrap_or(""))
        .bind(payload.amount)
        .bind(payload.receipt_no.as_deref().unwrap_or(""))
        .bind(payload.posted_at.as_deref().unwrap_or(""))
        .bind(payload.posted_by.as_deref().unwrap_or(""))
        .bind(payload.voided_at.as_deref().unwrap_or(""))
        .bind(payload.reversed_at.as_deref().unwrap_or(""))
        .bind(payload.reversal_reason.as_deref().unwrap_or(""))
        .bind(payload.replacement_transaction_id.as_deref().unwrap_or(""))
        .bind(payload.remarks.as_deref().unwrap_or(""))
        .bind(&payload.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?
        .rows_affected();
    } else {
        sqlx::query("DELETE FROM receipt_allocations WHERE receipt_id = ?")
            .bind(&normalized_collection_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query(
            "DELETE FROM ledger_entries WHERE source_type = 'CUSTOMER_RECEIPT' AND source_id = ?",
        )
        .bind(&normalized_collection_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

        if normalized_mode == "update" {
            let payload = collection
                .as_ref()
                .ok_or_else(|| "Collection payload is required.".to_string())?;
            collection_rows = sqlx::query(
                r#"
                UPDATE collections
                SET fiscal_year_id = ?, lifecycle_status = ?, date_bs = ?, date_ad = ?,
                    party_id = ?, bank_name = ?, amount = ?, reference_no = ?,
                    posted_at = ?, posted_by = ?, voided_at = ?, reversed_at = ?,
                    reversal_reason = ?, replacement_transaction_id = ?, remarks = ?
                WHERE id = ?
                "#,
            )
            .bind(payload.fiscal_year_id.as_deref().unwrap_or(""))
            .bind(payload.lifecycle_status.as_deref().unwrap_or("POSTED"))
            .bind(&payload.date_bs)
            .bind(payload.date_ad.as_deref().unwrap_or(""))
            .bind(&payload.party_id)
            .bind(payload.bank_name.as_deref().unwrap_or(""))
            .bind(payload.amount)
            .bind(payload.receipt_no.as_deref().unwrap_or(""))
            .bind(payload.posted_at.as_deref().unwrap_or(""))
            .bind(payload.posted_by.as_deref().unwrap_or(""))
            .bind(payload.voided_at.as_deref().unwrap_or(""))
            .bind(payload.reversed_at.as_deref().unwrap_or(""))
            .bind(payload.reversal_reason.as_deref().unwrap_or(""))
            .bind(payload.replacement_transaction_id.as_deref().unwrap_or(""))
            .bind(payload.remarks.as_deref().unwrap_or(""))
            .bind(&normalized_collection_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?
            .rows_affected();
        } else {
            collection_rows = sqlx::query("DELETE FROM collections WHERE id = ?")
                .bind(&normalized_collection_id)
                .execute(&mut *tx)
                .await
                .map_err(|error| error.to_string())?
                .rows_affected();
        }
    }

    if normalized_mode != "delete" {
        for allocation in &allocations {
            sqlx::query(
                r#"
                INSERT INTO receipt_allocations (
                    id, receipt_id, sale_id, amount_npr, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&allocation.id)
            .bind(&allocation.receipt_id)
            .bind(&allocation.sale_id)
            .bind(allocation.amount_npr)
            .bind(&allocation.created_at)
            .bind(&allocation.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        }

        for entry in &ledger_entries {
            sqlx::query(
                r#"
                INSERT INTO ledger_entries (
                    id, batch_id, company_id, fiscal_year_id, transaction_date, account_code,
                    party_id, source_type, source_id, posting_version, debit, credit,
                    narration, status, reversal_of_entry_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&entry.id)
            .bind(&entry.batch_id)
            .bind(&entry.company_id)
            .bind(&entry.fiscal_year_id)
            .bind(&entry.transaction_date)
            .bind(&entry.account_code)
            .bind(entry.party_id.as_deref().unwrap_or(""))
            .bind(&entry.source_type)
            .bind(&entry.source_id)
            .bind(&entry.posting_version)
            .bind(entry.debit)
            .bind(entry.credit)
            .bind(&entry.narration)
            .bind(&entry.status)
            .bind(entry.reversal_of_entry_id.as_deref().unwrap_or(""))
            .bind(&entry.created_at)
            .bind(&entry.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        }
    }

    sqlx::query("INSERT INTO activity_logs (id, action, detail, created_at) VALUES (?, ?, ?, ?)")
        .bind(activity_id)
        .bind(activity_action)
        .bind(activity_detail)
        .bind(activity_created_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

    tx.commit().await.map_err(|error| error.to_string())?;

    Ok(format!(
        "mode:{normalized_mode};collection_rows:{collection_rows};allocations:{};ledger_entries:{}",
        allocations.len(),
        ledger_entries.len()
    ))
}

#[tauri::command]
async fn write_import_purchase_transaction(
    app: tauri::AppHandle,
    purchase_filename: String,
    mode: String,
    purchase_id: String,
    purchase: Option<serde_json::Value>,
    ledger_entries: Vec<LedgerEntryPayload>,
    activity_log: serde_json::Value,
) -> Result<String, String> {
    validate_purchase_database_filename(&purchase_filename)?;

    let normalized_mode = mode.trim().to_ascii_lowercase();
    if !["upsert", "delete"].contains(&normalized_mode.as_str()) {
        return Err("Invalid import purchase write mode.".to_string());
    }

    let normalized_purchase_id = purchase_id.trim().to_string();
    if normalized_purchase_id.is_empty() {
        return Err("Import purchase ID is required.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let purchase_path = app_data_dir.join(&purchase_filename);
    let mut purchase_db = open_sqlite_connection(&purchase_path).await?;
    let mut tx = purchase_db
        .begin()
        .await
        .map_err(|error| error.to_string())?;

    sqlx::query("DELETE FROM payment_allocations WHERE purchaseId = ?")
        .bind(&normalized_purchase_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM ledger_entries WHERE sourceType = 'PURCHASE' AND sourceId = ?")
        .bind(&normalized_purchase_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

    let purchase_rows = if normalized_mode == "delete" {
        sqlx::query("DELETE FROM import_purchases WHERE id = ?")
            .bind(&normalized_purchase_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?
            .rows_affected()
    } else {
        let payload = purchase
            .as_ref()
            .ok_or_else(|| "Import purchase payload is required.".to_string())?;
        sqlx::query(
            r#"
            INSERT INTO import_purchases (
              id, fiscalYearId, lifecycleStatus, vendorPartyId, vendorBillNumber, billDate, supplierCurrency,
              amountIC, supplierExchangeRate, supplierAmountNPR, customAgentPartyId,
              debitNoteNumber, debitNoteDate, importDutyNPR, customServiceNPR,
              importVatNPR, terminalChargeWithoutVatNPR, terminalVatNPR,
              totalTerminalChargeNPR, freightIndiaStatus, freightIndiaAmountIC,
              freightIndiaPartyId, freightIndiaExchangeRate, freightIndiaAmountNPR,
              totalKg, loadingUnloadingChargePerKg, loadingUnloadingChargeNPR, otherChargesNPR,
              debitNoteTotalNPR, agentServiceBillNumber, agentServiceBillDate,
              agentServiceAmountBeforeVatNPR, agentServiceVatNPR,
              agentServiceTotalNPR, totalAgentPayableNPR, totalInputVatNPR,
              landedCostNPR, appliedVatRate, appliedExchangeRate, calculationVersion,
              calculatedAt, postedAt, postedBy, voidedAt, reversedAt, reversalReason,
              replacementTransactionId, remarks, createdAt, updatedAt
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(id) DO UPDATE SET
              fiscalYearId = excluded.fiscalYearId,
              lifecycleStatus = excluded.lifecycleStatus,
              vendorPartyId = excluded.vendorPartyId,
              vendorBillNumber = excluded.vendorBillNumber,
              billDate = excluded.billDate,
              supplierCurrency = excluded.supplierCurrency,
              amountIC = excluded.amountIC,
              supplierExchangeRate = excluded.supplierExchangeRate,
              supplierAmountNPR = excluded.supplierAmountNPR,
              customAgentPartyId = excluded.customAgentPartyId,
              debitNoteNumber = excluded.debitNoteNumber,
              debitNoteDate = excluded.debitNoteDate,
              importDutyNPR = excluded.importDutyNPR,
              customServiceNPR = excluded.customServiceNPR,
              importVatNPR = excluded.importVatNPR,
              terminalChargeWithoutVatNPR = excluded.terminalChargeWithoutVatNPR,
              terminalVatNPR = excluded.terminalVatNPR,
              totalTerminalChargeNPR = excluded.totalTerminalChargeNPR,
              freightIndiaStatus = excluded.freightIndiaStatus,
              freightIndiaAmountIC = excluded.freightIndiaAmountIC,
              freightIndiaPartyId = excluded.freightIndiaPartyId,
              freightIndiaExchangeRate = excluded.freightIndiaExchangeRate,
              freightIndiaAmountNPR = excluded.freightIndiaAmountNPR,
              totalKg = excluded.totalKg,
              loadingUnloadingChargePerKg = excluded.loadingUnloadingChargePerKg,
              loadingUnloadingChargeNPR = excluded.loadingUnloadingChargeNPR,
              otherChargesNPR = excluded.otherChargesNPR,
              debitNoteTotalNPR = excluded.debitNoteTotalNPR,
              agentServiceBillNumber = excluded.agentServiceBillNumber,
              agentServiceBillDate = excluded.agentServiceBillDate,
              agentServiceAmountBeforeVatNPR = excluded.agentServiceAmountBeforeVatNPR,
              agentServiceVatNPR = excluded.agentServiceVatNPR,
              agentServiceTotalNPR = excluded.agentServiceTotalNPR,
              totalAgentPayableNPR = excluded.totalAgentPayableNPR,
              totalInputVatNPR = excluded.totalInputVatNPR,
              landedCostNPR = excluded.landedCostNPR,
              appliedVatRate = excluded.appliedVatRate,
              appliedExchangeRate = excluded.appliedExchangeRate,
              calculationVersion = excluded.calculationVersion,
              calculatedAt = excluded.calculatedAt,
              postedAt = excluded.postedAt,
              postedBy = excluded.postedBy,
              voidedAt = excluded.voidedAt,
              reversedAt = excluded.reversedAt,
              reversalReason = excluded.reversalReason,
              replacementTransactionId = excluded.replacementTransactionId,
              remarks = excluded.remarks,
              updatedAt = excluded.updatedAt
            "#,
        )
        .bind(json_text(payload, "id"))
        .bind(json_text(payload, "fiscalYearId"))
        .bind(json_text(payload, "lifecycleStatus"))
        .bind(json_text(payload, "vendorPartyId"))
        .bind(json_text(payload, "vendorBillNumber"))
        .bind(json_text(payload, "billDate"))
        .bind(json_text(payload, "supplierCurrency"))
        .bind(json_number(payload, "amountIC"))
        .bind(json_number(payload, "supplierExchangeRate"))
        .bind(json_number(payload, "supplierAmountNPR"))
        .bind(json_text(payload, "customAgentPartyId"))
        .bind(json_text(payload, "debitNoteNumber"))
        .bind(json_text(payload, "debitNoteDate"))
        .bind(json_number(payload, "importDutyNPR"))
        .bind(json_number(payload, "customServiceNPR"))
        .bind(json_number(payload, "importVatNPR"))
        .bind(json_number(payload, "terminalChargeWithoutVatNPR"))
        .bind(json_number(payload, "terminalVatNPR"))
        .bind(json_number(payload, "totalTerminalChargeNPR"))
        .bind(json_text(payload, "freightIndiaStatus"))
        .bind(json_number(payload, "freightIndiaAmountIC"))
        .bind(json_text(payload, "freightIndiaPartyId"))
        .bind(json_number(payload, "freightIndiaExchangeRate"))
        .bind(json_number(payload, "freightIndiaAmountNPR"))
        .bind(json_number(payload, "totalKg"))
        .bind(json_number(payload, "loadingUnloadingChargePerKg"))
        .bind(json_number(payload, "loadingUnloadingChargeNPR"))
        .bind(json_number(payload, "otherChargesNPR"))
        .bind(json_number(payload, "debitNoteTotalNPR"))
        .bind(json_text(payload, "agentServiceBillNumber"))
        .bind(json_text(payload, "agentServiceBillDate"))
        .bind(json_number(payload, "agentServiceAmountBeforeVatNPR"))
        .bind(json_number(payload, "agentServiceVatNPR"))
        .bind(json_number(payload, "agentServiceTotalNPR"))
        .bind(json_number(payload, "totalAgentPayableNPR"))
        .bind(json_number(payload, "totalInputVatNPR"))
        .bind(json_number(payload, "landedCostNPR"))
        .bind(json_number(payload, "appliedVatRate"))
        .bind(json_number(payload, "appliedExchangeRate"))
        .bind(json_text(payload, "calculationVersion"))
        .bind(json_text(payload, "calculatedAt"))
        .bind(json_text(payload, "postedAt"))
        .bind(json_text(payload, "postedBy"))
        .bind(json_text(payload, "voidedAt"))
        .bind(json_text(payload, "reversedAt"))
        .bind(json_text(payload, "reversalReason"))
        .bind(json_text(payload, "replacementTransactionId"))
        .bind(json_text(payload, "remarks"))
        .bind(json_text(payload, "createdAt"))
        .bind(json_text(payload, "updatedAt"))
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?
        .rows_affected()
    };

    if normalized_mode != "delete" {
        insert_purchase_ledger_entries(&mut tx, &ledger_entries).await?;
    }
    insert_purchase_activity_log(&mut tx, &activity_log).await?;
    tx.commit().await.map_err(|error| error.to_string())?;

    Ok(format!(
        "mode:{normalized_mode};import_purchase_rows:{purchase_rows};ledger_entries:{}",
        ledger_entries.len()
    ))
}

#[tauri::command]
async fn write_local_purchase_transaction(
    app: tauri::AppHandle,
    purchase_filename: String,
    mode: String,
    local_expense_id: String,
    local_expense: Option<serde_json::Value>,
    ledger_entries: Vec<LedgerEntryPayload>,
    activity_log: serde_json::Value,
) -> Result<String, String> {
    validate_purchase_database_filename(&purchase_filename)?;

    let normalized_mode = mode.trim().to_ascii_lowercase();
    if !["upsert", "delete"].contains(&normalized_mode.as_str()) {
        return Err("Invalid local purchase write mode.".to_string());
    }

    let normalized_local_expense_id = local_expense_id.trim().to_string();
    if normalized_local_expense_id.is_empty() {
        return Err("Local purchase ID is required.".to_string());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let purchase_path = app_data_dir.join(&purchase_filename);
    let mut purchase_db = open_sqlite_connection(&purchase_path).await?;
    let mut tx = purchase_db
        .begin()
        .await
        .map_err(|error| error.to_string())?;

    sqlx::query("DELETE FROM ledger_entries WHERE sourceType = 'LOCAL_EXPENSE' AND sourceId = ?")
        .bind(&normalized_local_expense_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

    let local_rows = if normalized_mode == "delete" {
        sqlx::query("DELETE FROM local_expenses WHERE id = ?")
            .bind(&normalized_local_expense_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?
            .rows_affected()
    } else {
        let payload = local_expense
            .as_ref()
            .ok_or_else(|| "Local purchase payload is required.".to_string())?;
        sqlx::query(
            r#"
            INSERT INTO local_expenses (
              id, fiscalYearId, lifecycleStatus, partyId, billNumber, billDate, expenseType,
              expenseHead, amountBeforeVatNPR, vatNPR, totalAmountNPR, remarks,
              postedAt, postedBy, voidedAt, reversedAt, reversalReason,
              replacementTransactionId, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              fiscalYearId = excluded.fiscalYearId,
              lifecycleStatus = excluded.lifecycleStatus,
              partyId = excluded.partyId,
              billNumber = excluded.billNumber,
              billDate = excluded.billDate,
              expenseType = excluded.expenseType,
              expenseHead = excluded.expenseHead,
              amountBeforeVatNPR = excluded.amountBeforeVatNPR,
              vatNPR = excluded.vatNPR,
              totalAmountNPR = excluded.totalAmountNPR,
              remarks = excluded.remarks,
              postedAt = excluded.postedAt,
              postedBy = excluded.postedBy,
              voidedAt = excluded.voidedAt,
              reversedAt = excluded.reversedAt,
              reversalReason = excluded.reversalReason,
              replacementTransactionId = excluded.replacementTransactionId,
              updatedAt = excluded.updatedAt
            "#,
        )
        .bind(json_text(payload, "id"))
        .bind(json_text(payload, "fiscalYearId"))
        .bind(json_text(payload, "lifecycleStatus"))
        .bind(json_text(payload, "partyId"))
        .bind(json_text(payload, "billNumber"))
        .bind(json_text(payload, "billDate"))
        .bind(json_text(payload, "expenseType"))
        .bind(json_text(payload, "expenseHead"))
        .bind(json_number(payload, "amountBeforeVatNPR"))
        .bind(json_number(payload, "vatNPR"))
        .bind(json_number(payload, "totalAmountNPR"))
        .bind(json_text(payload, "remarks"))
        .bind(json_text(payload, "postedAt"))
        .bind(json_text(payload, "postedBy"))
        .bind(json_text(payload, "voidedAt"))
        .bind(json_text(payload, "reversedAt"))
        .bind(json_text(payload, "reversalReason"))
        .bind(json_text(payload, "replacementTransactionId"))
        .bind(json_text(payload, "createdAt"))
        .bind(json_text(payload, "updatedAt"))
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?
        .rows_affected()
    };

    if normalized_mode != "delete" {
        insert_purchase_ledger_entries(&mut tx, &ledger_entries).await?;
    }
    insert_purchase_activity_log(&mut tx, &activity_log).await?;
    tx.commit().await.map_err(|error| error.to_string())?;

    Ok(format!(
        "mode:{normalized_mode};local_purchase_rows:{local_rows};ledger_entries:{}",
        ledger_entries.len()
    ))
}

#[tauri::command]
fn migrate_stock_database(
    app: tauri::AppHandle,
    canonical_filename: String,
    legacy_filenames: Vec<String>,
) -> Result<String, String> {
    validate_stock_database_filename(&canonical_filename)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    let canonical_path = app_data_dir.join(&canonical_filename);

    if canonical_path.exists() {
        return Ok("canonical-exists".to_string());
    }

    for legacy_filename in legacy_filenames {
        validate_stock_database_filename(&legacy_filename)?;

        if legacy_filename == canonical_filename {
            continue;
        }

        let legacy_path = app_data_dir.join(&legacy_filename);
        if !legacy_path.exists() {
            continue;
        }

        std::fs::copy(&legacy_path, &canonical_path).map_err(|error| error.to_string())?;

        for suffix in ["-wal", "-shm"] {
            let legacy_sidecar = app_data_dir.join(format!("{legacy_filename}{suffix}"));
            let canonical_sidecar = app_data_dir.join(format!("{canonical_filename}{suffix}"));

            if legacy_sidecar.exists() && !canonical_sidecar.exists() {
                std::fs::copy(legacy_sidecar, canonical_sidecar)
                    .map_err(|error| error.to_string())?;
            }
        }

        return Ok(format!("copied-from:{legacy_filename}"));
    }

    Ok("no-legacy-found".to_string())
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_import_purchase_tables",
            sql: INITIAL_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_app_settings",
            sql: APP_SETTINGS_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_local_expenses",
            sql: LOCAL_EXPENSES_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_local_expense_type",
            sql: LOCAL_EXPENSE_TYPE_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_activity_log_user",
            sql: ACTIVITY_LOG_USER_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "normalize_freight_status",
            sql: NORMALIZE_FREIGHT_STATUS_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_supplier_currency",
            sql: SUPPLIER_CURRENCY_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_fiscal_years_and_allocations",
            sql: ACCOUNTING_MODEL_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_lifecycle_and_ledger_entries",
            sql: LIFECYCLE_LEDGER_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_purchase_loading_unloading_charges",
            sql: PURCHASE_LOADING_UNLOADING_SCHEMA,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            read_company_seed,
            delete_sale_with_stock_cleanup,
            write_collection_transaction,
            write_import_purchase_transaction,
            write_local_purchase_transaction,
            migrate_stock_database
        ])
        .build(tauri::generate_context!())
        .expect("error while building Easysolution")
        .run(|_, _| {});
}
