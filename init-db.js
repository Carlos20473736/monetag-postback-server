const mysql = require('mysql2/promise');
require('dotenv').config();

async function initializeDatabase() {
    try {
        // Conectar ao MySQL sem especificar banco de dados
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
        });

        console.log('✅ Conectado ao MySQL');

        // Criar banco de dados se não existir
        const dbName = process.env.DB_NAME || 'monetag_tracking';
        await connection.execute(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
        console.log(`✅ Banco de dados '${dbName}' criado/verificado`);

        // Selecionar banco de dados
        await connection.execute(`USE ${dbName}`);

        // Criar tabela de tracking
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS tracking_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(50) NOT NULL,
                user_id VARCHAR(100) NOT NULL,
                user_email VARCHAR(255),
                estimated_price DECIMAL(10, 4) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        await connection.execute(createTableQuery);
        console.log('✅ Tabela tracking_events criada/verificada');

        // Criar tabela de estatísticas agregadas
        const createStatsTableQuery = `
            CREATE TABLE IF NOT EXISTS daily_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                zone_id VARCHAR(50) NOT NULL,
                event_date DATE NOT NULL,
                impressions INT DEFAULT 0,
                clicks INT DEFAULT 0,
                total_revenue DECIMAL(10, 4) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_zone_date (zone_id, event_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        await connection.execute(createStatsTableQuery);
        console.log('✅ Tabela daily_stats criada/verificada');

        // Criar tabela de usuários
        const createUsersTableQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL UNIQUE,
                email VARCHAR(255),
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                total_impressions INT DEFAULT 0,
                total_clicks INT DEFAULT 0,
                total_earnings DECIMAL(10, 4) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        await connection.execute(createUsersTableQuery);
        console.log('✅ Tabela users criada/verificada');

        await connection.end();
        console.log('\n✅ Banco de dados inicializado com sucesso!\n');

    } catch (error) {
        console.error('❌ Erro ao inicializar banco de dados:', error);
        process.exit(1);
    }
}

// Executar inicialização
initializeDatabase();
