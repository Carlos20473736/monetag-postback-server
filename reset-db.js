const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetDatabase() {
    try {
        console.log('[DB] Conectando ao banco de dados...');

        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'railway'
        });

        console.log('[DB] ✅ Conectado!');

        // Dropar tabelas antigas
        console.log('[DB] Dropando tabelas antigas...');
        await connection.query('DROP TABLE IF EXISTS tracking_events');
        await connection.query('DROP TABLE IF EXISTS daily_stats');
        await connection.query('DROP TABLE IF EXISTS users');
        console.log('[DB] ✅ Tabelas antigas removidas!');

        // Criar novas tabelas
        console.log('[DB] Criando novas tabelas...');
        
        await connection.query(`
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                total_impressions INT DEFAULT 0,
                total_clicks INT DEFAULT 0,
                total_earnings DECIMAL(10, 4) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_username (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.query(`
            CREATE TABLE tracking_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(50) NOT NULL,
                user_id INT NOT NULL,
                estimated_price DECIMAL(10, 4) DEFAULT 0.00,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_user_id (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        console.log('[DB] ✅ Novas tabelas criadas com sucesso!');

        await connection.end();
        console.log('[DB] ✅ Banco de dados resetado com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('[DB] ❌ Erro:', error.message);
        process.exit(1);
    }
}

resetDatabase();
