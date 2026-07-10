<?php
try {
    $dbPath = __DIR__ . '/../database/shawarma.db';
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $schema = file_get_contents(__DIR__ . '/../database/schema.sql');
    $pdo->exec($schema);
    echo "Database initialized successfully at: $dbPath\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
