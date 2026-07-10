<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $docId = $_GET['id'] ?? 'cafe';
    
    $stmt = $pdo->prepare('SELECT * FROM settings WHERE id = ?');
    $stmt->execute([$docId]);
    $setting = $stmt->fetch();
    
    if (!$setting) {
        jsonResponse(['id' => $docId, 'data' => '{}']);
    }
    
    jsonResponse($setting);
}

if ($method === 'POST' || $method === 'PUT') {
    $data = getJsonInput();
    $docId = $data['id'] ?? 'cafe';
    $settingsData = json_encode($data['data'] ?? []);
    
    $stmt = $pdo->prepare('INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (?, ?, datetime(\'now\'))');
    $stmt->execute([$docId, $settingsData]);
    
    $stmt = $pdo->prepare('SELECT * FROM settings WHERE id = ?');
    $stmt->execute([$docId]);
    jsonResponse($stmt->fetch());
}

jsonError('Method not allowed', 405);
