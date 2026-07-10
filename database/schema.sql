-- SQLite database schema for Shawarma DeMeshq

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name_ku TEXT,
    name_ar TEXT,
    name_en TEXT,
    description_ku TEXT,
    description_ar TEXT,
    description_en TEXT,
    price INTEGER DEFAULT 0,
    category TEXT DEFAULT '',
    image TEXT DEFAULT '',
    available INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name_ku TEXT,
    name_ar TEXT,
    name_en TEXT,
    image TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Sales table
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    items TEXT DEFAULT '[]',
    total INTEGER DEFAULT 0,
    timestamp TEXT DEFAULT (datetime('now')),
    cashier TEXT DEFAULT ''
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    price INTEGER DEFAULT 0,
    date TEXT DEFAULT '',
    time TEXT DEFAULT '',
    timestamp TEXT DEFAULT (datetime('now'))
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    data TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp);
CREATE INDEX IF NOT EXISTS idx_expenses_timestamp ON expenses(timestamp);
