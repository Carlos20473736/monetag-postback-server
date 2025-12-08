const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetDatabase() {
    try {
        console.log('[RESET] Conectando ao banco de dados...');
        
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'railway'
        });

        console.log('[RESET] Conectado!');
        console.log('[RESET] Dropando tabelas antigas...');

        try {
            await connection.query('DROP TABLE IF EXISTS tracking_events');
            console.log('[RESET] ✅ tracking_events dropada');
        } catch (e) {
            console.log('[RESET] tracking_events não existe');
        }

        try {
            await connection.query('DROP TABLE IF EXISTS daily_stats');
            console.log('[RESET] ✅ daily_stats dropada');
        } catch (e) {
            console.log('[RESET] daily_stats não existe');
        }

        try {
            await connection.query('DROP TABLE IF EXISTS users');
            console.log('[RESET] ✅ users dropada');
        } catch (e) {
            console.log('[RESET] users não existe');
        }

        console.log('[RESET] Criando novas tabelas...');

        const createUsersTable = `
            CREATE TABLE users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                total_impressions INT DEFAULT 0,
                total_clicks INT DEFAULT 0,
                total_earnings DECIMAL(10, 4) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        const createEventsTable = `
            CREATE TABLE tracking_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(50) NOT NULL,
                user_email VARCHAR(255) NOT NULL,
                estimated_price DECIMAL(10, 4) DEFAULT 0.00,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_user_email (user_email),
                FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        await connection.query(createUsersTable);
        console.log('[RESET] ✅ Tabela users criada');

        await connection.query(createEventsTable);
        console.log('[RESET] ✅ Tabela tracking_events criada');

        console.log('[RESET] ✅ Banco de dados resetado com sucesso!');
        
        await connection.end();
        process.exit(0);
    } catch (error) {
        console.error('[RESET] ❌ Erro:', error.message);
        process.exit(1);
    }
}

resetDatabase();
