use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, RunEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

const INITIAL_SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const APP_SETTINGS_SCHEMA: &str = include_str!("../migrations/002_app_settings.sql");
const LOCAL_EXPENSES_SCHEMA: &str = include_str!("../migrations/003_local_expenses.sql");
const LOCAL_EXPENSE_TYPE_SCHEMA: &str = include_str!("../migrations/004_local_expense_type.sql");
const ACTIVITY_LOG_USER_SCHEMA: &str = include_str!("../migrations/005_activity_log_user.sql");
const NORMALIZE_FREIGHT_STATUS_SCHEMA: &str =
    include_str!("../migrations/006_normalize_freight_status.sql");
const DATABASE_URL: &str = "sqlite:import-purchases.db";
const DATABASE_FILES: [&str; 2] = ["accounts.db", "import-purchases.db"];

fn timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    seconds.to_string()
}

fn installed_folder() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|error| error.to_string())?;

    exe_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not find installed application folder.".to_string())
}

fn copy_if_exists(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(true)
}

fn create_backup(app: &tauri::AppHandle, reason: &str) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let backup_dir =
        installed_folder()?
            .join("Backups")
            .join(format!("{}-{}", timestamp(), reason));
    let mut copied = 0;

    for database_file in DATABASE_FILES {
        let source = data_dir.join(database_file);
        let destination = backup_dir.join(database_file);

        if copy_if_exists(&source, &destination)? {
            copied += 1;
        }

        for suffix in ["-wal", "-shm"] {
            let sidecar = format!("{database_file}{suffix}");
            let source = data_dir.join(&sidecar);
            let destination = backup_dir.join(sidecar);
            copy_if_exists(&source, &destination)?;
        }
    }

    if copied == 0 {
        return Err("No database files were found to back up yet.".to_string());
    }

    Ok(backup_dir)
}

fn create_backup_without_prompt(app: &tauri::AppHandle, reason: &str) {
    if let Err(error) = create_backup(app, reason) {
        eprintln!("Automatic {reason} backup failed: {error}");
    }
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
    ];

    let app = tauri::Builder::default()
        .setup(|app| {
            create_backup_without_prompt(&app.handle(), "open");
            Ok(())
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("error while building Dhaulagiri business suite");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            create_backup_without_prompt(app_handle, "close");
        }
    });
}
