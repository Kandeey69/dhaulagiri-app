# Stock Backup Strategy

Phase 13 intentionally keeps portable company backup as the supported safe backup method for stock data.

The donor automatic backup copied database files directly. MERGED APP now uses company-scoped accounts, purchase, and stock SQLite databases, and those databases may have active WAL sidecars (`.db-wal`, `.db-shm`) while the app is running. A raw file copy of live SQLite files can produce an incomplete snapshot unless the copy is coordinated with SQLite checkpoint/backup APIs or taken when all connections are safely closed.

Current Phase 13 changes therefore only add the legacy/default stock preload (`sqlite:inventorytracked-stock.db`) required for compatibility with the Tauri SQL plugin. Runtime company stock databases continue to resolve dynamically through `getActiveStockDatabaseUrl`.

Future automatic local snapshots should use a SQLite-native backup/checkpoint strategy, include main DB plus WAL/SHM consistently, discover files through a strict allowlist of Easysolution database filename patterns, and treat failures as non-fatal without deleting the last valid snapshot.
