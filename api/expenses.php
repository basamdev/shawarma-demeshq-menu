<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = explode('/', trim($path, '/'));

$collection = 'expenses';
$id = null;

if (isset($segments[2]) && $segments[2] === 'expenses') {
    $id = $segments[3] ?? null;
}

if ($method === 'GET') {
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM expenses WHERE id = ?');
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        if (!$item) {
            jsonError('Expense not found', 404);
        }
        jsonResponse($item);
    } else {
        $month = $_GET['month'] ?? null;
        $sql = 'SELECT * FROM expenses';
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
    $id = $data['id'] ?? uniqid('exp_');
    
    $stmt = $pdo->prepare('INSERT INTO expenses (id, name, price, date, time, timestamp) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))');
    $stmt->execute([
        $id,
        $data['name'] ?? '',
        $data['price'] ?? 0,
        $data['date'] ?? date('Y-m-d'),
        $data['time'] ?? date('H:i')
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM expenses WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch(), 201);
}

if ($method === 'PUT') {
    if (!$id) {
        jsonError('Expense ID required');
    }
    
    $data = getJsonInput();
    $stmt = $pdo->prepare('UPDATE expenses SET name = ?, price = ?, date = ?, time = ? WHERE id = ?');
    $stmt->execute([
        $data['name'] ?? '',
        $data['price'] ?? 0,
        $data['date'] ?? '',
        $data['time'] ?? '',
        $id
    ]);
    
    $stmt = $pdo->prepare('SELECT * FROM expenses WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse($stmt->fetch());
}

if ($method === 'DELETE') {
    if (!$id) {
        jsonError('Expense ID required');
    }
    
    $stmt = $pdo->prepare('DELETE FROM expenses WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse(['deleted' => true]);
}

jsonError('Method not allowed', 405);
