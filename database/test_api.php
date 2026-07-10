<?php
echo "Testing API endpoints...\n";
$urls = [
    'http://localhost/shawarma-demeshq-menu/api/menu_items.php',
    'http://localhost/shawarma-demeshq-menu/api/categories.php',
    'http://localhost/shawarma-demeshq-menu/api/sales.php',
    'http://localhost/shawarma-demeshq-menu/api/expenses.php',
    'http://localhost/shawarma-demeshq-menu/api/settings.php?id=cafe'
];

foreach ($urls as $url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $response = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo $url . ' => ' . $code . "\n";
    if ($code === 200) {
        echo 'Response: ' . substr($response, 0, 100) . "\n";
    }
}
