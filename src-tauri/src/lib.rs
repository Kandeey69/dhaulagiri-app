use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
        .invoke_handler(tauri::generate_handler![read_company_seed])
        .build(tauri::generate_context!())
        .expect("error while building Easysolution")
        .run(|_, _| {});
}
