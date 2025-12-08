const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let pool = null;
let dbInitialized = false;

// Função para criar pool de conexões
async function createPool() {
    if (pool) return pool;

    try {
        console.log('[DB] Criando pool de conexões...');
        console.log('[DB] Host:', process.env.DB_HOST);
        console.log('[DB] User:', process.env.DB_USER);
        console.log('[DB] Database:', process.env.DB_NAME);

        pool = mysql.createPool({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'railway',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelayMs: 0
        });

        console.log('[DB] ✅ Pool de conexões criado!');
        return pool;
    } catch (error) {
        console.error('[DB] ❌ Erro ao criar pool:', error.message);
        pool = null;
        throw error;
    }
}

// Função para inicializar banco de dados (criar tabelas se não existirem)
async function initializeDatabase() {
    if (dbInitialized) return true;

    try {
        if (!pool) {
            await createPool();
        }

        console.log('[DB] Inicializando banco de dados...');

        const connection = await pool.getConnection();

        try {
            // Criar tabela users se não existir
            const createUsersTable = `
                CREATE TABLE IF NOT EXISTS users (
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
                CREATE TABLE IF NOT EXISTS tracking_events (
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
            await connection.query(createEventsTable);

            console.log('[DB] ✅ Tabelas criadas ou já existem!');
            dbInitialized = true;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[DB] ❌ Erro ao inicializar banco:', error.message);
        dbInitialized = false;
    }
}

// ==================== ENDPOINTS ====================

// Health Check
app.get('/health', async (req, res) => {
    try {
        if (!pool) {
            await createPool();
        }
        
        const connection = await pool.getConnection();
        connection.release();

        res.json({
            status: 'OK',
            database: 'connected',
            initialized: dbInitialized
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ==================== RASTREAMENTO ====================

// Registrar impressão ou clique
app.post('/api/track', async (req, res) => {
    try {
        const { event_type, zone_id, user_email, estimated_price } = req.body;

        if (!event_type || !zone_id || !user_email) {
            return res.status(400).json({
                success: false,
                message: 'event_type, zone_id e user_email são obrigatórios'
            });
        }

        if (!['impression', 'click'].includes(event_type)) {
            return res.status(400).json({
                success: false,
                message: 'event_type deve ser "impression" ou "click"'
            });
        }

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            // Verificar se usuário existe, senão criar
            const [existingUser] = await connection.query(
                'SELECT id FROM users WHERE email = ?',
                [user_email]
            );

            if (existingUser.length === 0) {
                await connection.query(
                    'INSERT INTO users (email) VALUES (?)',
                    [user_email]
                );
                console.log('[TRACK] Novo usuário criado:', user_email);
            }

            // Inserir evento
            const [result] = await connection.query(
                'INSERT INTO tracking_events (event_type, zone_id, user_email, estimated_price) VALUES (?, ?, ?, ?)',
                [event_type, zone_id, user_email, estimated_price || 0]
            );

            // Atualizar estatísticas do usuário
            if (event_type === 'impression') {
                await connection.query(
                    'UPDATE users SET total_impressions = total_impressions + 1, total_earnings = total_earnings + ? WHERE email = ?',
                    [estimated_price || 0, user_email]
                );
            } else if (event_type === 'click') {
                await connection.query(
                    'UPDATE users SET total_clicks = total_clicks + 1, total_earnings = total_earnings + ? WHERE email = ?',
                    [estimated_price || 0, user_email]
                );
            }

            res.json({
                success: true,
                message: `${event_type} registrado com sucesso`,
                event_id: result.insertId
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[TRACK] Erro ao registrar evento:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao registrar evento',
            error: error.message
        });
    }
});

// ==================== ESTATÍSTICAS ====================

// Obter dados do usuário por email
app.get('/api/user/:email', async (req, res) => {
    try {
        const { email } = req.params;

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            const [users] = await connection.query(
                'SELECT email, total_impressions, total_clicks, total_earnings FROM users WHERE email = ?',
                [email]
            );

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Usuário não encontrado'
                });
            }

            const user = users[0];

            res.json({
                success: true,
                user: {
                    email: user.email,
                    impressions: user.total_impressions,
                    clicks: user.total_clicks,
                    earnings: user.total_earnings
                }
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[STATS] Erro ao buscar dados:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar dados',
            error: error.message
        });
    }
});

// Obter histórico de eventos do usuário
app.get('/api/user/:email/events', async (req, res) => {
    try {
        const { email } = req.params;

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            const [events] = await connection.query(
                'SELECT id, event_type, zone_id, estimated_price FROM tracking_events WHERE user_email = ? ORDER BY id DESC',
                [email]
            );

            res.json({
                success: true,
                events: events
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[EVENTS] Erro ao buscar eventos:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar eventos',
            error: error.message
        });
    }
});

// Obter estatísticas por zona
app.get('/api/stats/zone/:zone_id', async (req, res) => {
    try {
        const { zone_id } = req.params;

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            const [stats] = await connection.query(`
                SELECT 
                    SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) as impressions,
                    SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks,
                    SUM(estimated_price) as total_revenue
                FROM tracking_events
                WHERE zone_id = ?
            `, [zone_id]);

            res.json({
                success: true,
                zone_id: zone_id,
                impressions: stats[0].impressions || 0,
                clicks: stats[0].clicks || 0,
                total_revenue: stats[0].total_revenue || 0
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[STATS] Erro ao buscar estatísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar estatísticas',
            error: error.message
        });
    }
});

// ==================== SERVIDOR ====================

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Criar pool de conexões
        await createPool();

        // Inicializar banco de dados
        await initializeDatabase();

        // Iniciar servidor
        app.listen(PORT, () => {
            console.log(`\n${'='.repeat(50)}`);
            console.log(`✅ Servidor Monetag Postback iniciado na porta ${PORT}`);
            console.log(`🗄️  Banco de dados: ${process.env.DB_HOST}`);
            console.log(`📦 Database: ${process.env.DB_NAME}`);
            console.log(`${'='.repeat(50)}\n`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

startServer();
