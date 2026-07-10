<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = explode('/', trim($path, '/'));

$collection = 'sales';
$id = null;

if (isset($segments[2]) && $segments[2] === 'sales') {
    $id = $segments[3] ?? null;
}

if ($method === 'GET') {
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM sales WHERE id = ?');
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        if (!$item) {
            jsonError('Sale not found', 404);
        }
        jsonResponse($item);
    } else {
        // Get month filter
        $month = $_GET['month'] ?? null;
        $sql = 'SELECT * FROM sales';
        $params = [];
        if ($month) {
            $year = date('Y');
            $start = "$year-$month-01";
            $end = date('Y-m-t', strtotime($start));
            $sql .= ' WHERE date(timestamp) >= ? AND date(timestamp) <= ?';
            $params = [$start, $end];
        }
        $sql .= ' ORDER BY timestamp DESC';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        jsonResponse($stmt->fetchAll());
    }
}

if ($method === 'POST') {
    $data = getJsonInput();
    $id = $data['id'] ?? uniqid('sale_');
    
    $itemsJson = json_encode($data['items'] ?? []);
    
    $stmt = $pdo->prepare('INSERT INTO sales (id, items, total, timestamp, cashier) VALUES (?, ?, ?, datetime(\'now\'), ?)');
    $stmt->execute([
        $id,
        $itemsJson,
        $data['total'] ?? 0,
        $data['cashier'] ?? ''
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM sales WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch(), 201);
}

if ($method === 'DELETE') {
    if (!$id) {
        jsonError('Sale ID required');
    }
    
    $stmt = $pdo->prepare('DELETE FROM sales WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse(['deleted' => true]);
}

jsonError('Method not allowed', 405);
