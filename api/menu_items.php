<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = explode('/', trim($path, '/'));

// Handle /api/menu_items or /api/menu_items/{id}
$collection = 'menu_items';
$id = null;

if (isset($segments[2]) && $segments[2] === 'menu_items') {
    $id = $segments[3] ?? null;
}

// GET - List all items or get single item
if ($method === 'GET') {
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM menu_items WHERE id = ?');
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        if (!$item) {
            jsonError('Item not found', 404);
        }
        jsonResponse($item);
    } else {
        // Check for category filter
        $category = $_GET['category'] ?? null;
        $sql = 'SELECT * FROM menu_items';
        $params = [];
        if ($category) {
            $sql .= ' WHERE category = ?';
            $params[] = $category;
        }
        $sql .= ' ORDER BY created_at DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $items = $stmt->fetchAll();
        jsonResponse($items);
    }
}

// POST - Create new item
if ($method === 'POST') {
    $data = getJsonInput();
    $id = $data['id'] ?? uniqid('item_');
    
    $stmt = $pdo->prepare('INSERT INTO menu_items (id, name_ku, name_ar, name_en, description_ku, description_ar, description_en, price, category, image, available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))');
    $stmt->execute([
        $id,
        $data['name_ku'] ?? '',
        $data['name_ar'] ?? '',
        $data['name_en'] ?? '',
        $data['description_ku'] ?? '',
        $data['description_ar'] ?? '',
        $data['description_en'] ?? '',
        $data['price'] ?? 0,
        $data['category'] ?? '',
        $data['image'] ?? '',
        $data['available'] ?? 1
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM menu_items WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch(), 201);
}

// PUT - Update item
if ($method === 'PUT') {
    if (!$id) {
        jsonError('Item ID required');
    }
    
    $data = getJsonInput();
    $stmt = $pdo->prepare('UPDATE menu_items SET name_ku = ?, name_ar = ?, name_en = ?, description_ku = ?, description_ar = ?, description_en = ?, price = ?, category = ?, image = ?, available = ?, updated_at = datetime(\'now\') WHERE id = ?');
    $stmt->execute([
        $data['name_ku'] ?? '',
        $data['name_ar'] ?? '',
        $data['name_en'] ?? '',
        $data['description_ku'] ?? '',
        $data['description_ar'] ?? '',
        $data['description_en'] ?? '',
        $data['price'] ?? 0,
        $data['category'] ?? '',
        $data['image'] ?? '',
        $data['available'] ?? 1,
        $id
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM menu_items WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch());
}

// DELETE - Delete item
if ($method === 'DELETE') {
    if (!$id) {
        jsonError('Item ID required');
    }
    
    $stmt = $pdo->prepare('DELETE FROM menu_items WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse(['deleted' => true]);
}

jsonError('Method not allowed', 405);
