<?php
// Seed sample data into the database
try {
    $dbPath = __DIR__ . '/../database/shawarma.db';
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Seed categories
    $categories = [
        ['id' => 'cat_coffee', 'name_ku' => 'قاوە', 'name_ar' => 'قهوة', 'name_en' => 'Coffee', 'image' => 'https://cdn-icons-png.flaticon.com/128/924/924514.png'],
        ['id' => 'cat_tea', 'name_ku' => 'چای', 'name_ar' => 'شاي', 'name_en' => 'Tea', 'image' => 'https://cdn-icons-png.flaticon.com/128/1223/1223749.png'],
        ['id' => 'cat_cold', 'name_ku' => 'خواردنەوەی سارد', 'name_ar' => 'مشروبات باردة', 'name_en' => 'Cold Drinks', 'image' => 'https://cdn-icons-png.flaticon.com/128/1113/1113278.png'],
        ['id' => 'cat_dessert', 'name_ku' => 'شیرینی', 'name_ar' => 'حلويات', 'name_en' => 'Dessert', 'image' => 'https://cdn-icons-png.flaticon.com/128/8346/8346809.png'],
        ['id' => 'cat_shisha', 'name_ku' => 'نێرگیلە', 'name_ar' => 'نرگيلة', 'name_en' => 'Shisha', 'image' => 'https://cdn-icons-png.flaticon.com/128/10170/10170651.png'],
    ];
    
    $stmt = $pdo->prepare('INSERT OR REPLACE INTO categories (id, name_ku, name_ar, name_en, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))');
    foreach ($categories as $cat) {
        $stmt->execute([$cat['id'], $cat['name_ku'], $cat['name_ar'], $cat['name_en'], $cat['image']]);
    }
    
    // Seed menu items
    $items = [
        ['id' => 'item_1', 'name_ku' => 'لاتە', 'name_ar' => 'لاتيه', 'name_en' => 'Latte', 'price' => 2500, 'category' => 'cat_coffee', 'available' => 1],
        ['id' => 'item_2', 'name_ku' => 'ئێسپرێسۆ', 'name_ar' => 'إسبريسو', 'name_en' => 'Espresso', 'price' => 2000, 'category' => 'cat_coffee', 'available' => 1],
        ['id' => 'item_3', 'name_ku' => 'کاپوچینۆ', 'name_ar' => 'كابوتشينو', 'name_en' => 'Cappuccino', 'price' => 3000, 'category' => 'cat_coffee', 'available' => 1],
        ['id' => 'item_4', 'name_ku' => 'چای', 'name_ar' => 'شاي', 'name_en' => 'Tea', 'price' => 1500, 'category' => 'cat_tea', 'available' => 1],
        ['id' => 'item_5', 'name_ku' => 'کۆکا', 'name_ar' => 'كوكا كولا', 'name_en' => 'Coca-Cola', 'price' => 1500, 'category' => 'cat_cold', 'available' => 1],
        ['id' => 'item_6', 'name_ku' => 'کەیک شکۆلات', 'name_ar' => 'كيك شوكولاتة', 'name_en' => 'Chocolate Cake', 'price' => 4000, 'category' => 'cat_dessert', 'available' => 1],
    ];
    
    $stmt = $pdo->prepare('INSERT OR REPLACE INTO menu_items (id, name_ku, name_ar, name_en, price, category, available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))');
    foreach ($items as $item) {
        $stmt->execute([$item['id'], $item['name_ku'], $item['name_ar'], $item['name_en'], $item['price'], $item['category'], $item['available']]);
    }
    
    // Seed settings
    $settings = [
            'cafeName' => 'Shawarma',
        'whatsappPhone' => '9647515183406',
        'cafeLocationUrl' => 'https://maps.app.goo.gl/F6d84ty6NiUzPvYY6?g_st=ic',
        'cafeLocationLabel' => 'جووتسایسی-بەحەرکە',
        'cafeOpenTime' => '10:00',
        'cafeCloseTime' => '02:00',
        'cafeInstagram' => '',
        'cafeTiktok' => '',
        'cafeSnapchat' => ''
    ];
    
    $stmt = $pdo->prepare('INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (?, ?, datetime(\'now\'))');
    $stmt->execute(['cafe', json_encode($settings)]);
    
    echo "Sample data seeded successfully!\n";
    echo "Categories: " . count($categories) . "\n";
    echo "Menu items: " . count($items) . "\n";
    
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
