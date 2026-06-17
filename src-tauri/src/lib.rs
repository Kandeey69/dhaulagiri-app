use tauri_plugin_sql::{Migration, MigrationKind};

const INITIAL_SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const APP_SETTINGS_SCHEMA: &str = include_str!("../migrations/002_app_settings.sql");
const LOCAL_EXPENSES_SCHEMA: &str = include_str!("../migrations/003_local_expenses.sql");
const LOCAL_EXPENSE_TYPE_SCHEMA: &str = include_str!("../migrations/004_local_expense_type.sql");
const ACTIVITY_LOG_USER_SCHEMA: &str = include_str!("../migrations/005_activity_log_user.sql");
const DATABASE_URL: &str = "sqlite:import-purchases.db";

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
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running Dhaulagiri import purchase app");
}
