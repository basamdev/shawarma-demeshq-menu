<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = explode('/', trim($path, '/'));

$collection = 'categories';
$id = null;

if (isset($segments[2]) && $segments[2] === 'categories') {
    $id = $segments[3] ?? null;
}

if ($method === 'GET') {
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM categories WHERE id = ?');
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        if (!$item) {
            jsonError('Category not found', 404);
        }
        jsonResponse($item);
    } else {
        $stmt = $pdo->query('SELECT * FROM categories ORDER BY created_at DESC');
        jsonResponse($stmt->fetchAll());
    }
}

if ($method === 'POST') {
    $data = getJsonInput();
    $id = $data['id'] ?? uniqid('cat_');
    
    $stmt = $pdo->prepare('INSERT INTO categories (id, name_ku, name_ar, name_en, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))');
    $stmt->execute([
        $id,
        $data['name_ku'] ?? '',
        $data['name_ar'] ?? '',
        $data['name_en'] ?? '',
        $data['image'] ?? ''
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM categories WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch(), 201);
}

if ($method === 'PUT') {
    if (!$id) {
        jsonError('Category ID required');
    }
    
    $data = getJsonInput();
    $stmt = $pdo->prepare('UPDATE categories SET name_ku = ?, name_ar = ?, name_en = ?, image = ?, updated_at = datetime(\'now\') WHERE id = ?');
    $stmt->execute([
        $data['name_ku'] ?? '',
        $data['name_ar'] ?? '',
        $data['name_en'] ?? '',
        $data['image'] ?? '',
        $id
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM categories WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch());
}

if ($method === 'DELETE') {
    if (!$id) {
        jsonError('Category ID required');
    }
    
    $stmt = $pdo->prepare('DELETE FROM categories WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse(['deleted' => true]);
}

jsonError('Method not allowed', 405);
