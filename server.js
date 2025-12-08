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

// Função para inicializar banco de dados (criar tabelas)
async function initializeDatabase() {
    if (dbInitialized) return true;

    try {
        if (!pool) {
            await createPool();
        }

        console.log('[DB] Inicializando banco de dados...');

        const connection = await pool.getConnection();

        try {
            // Dropar tabelas antigas se existirem
            console.log('[DB] Removendo tabelas antigas...');
            await connection.query('DROP TABLE IF EXISTS tracking_events');
            await connection.query('DROP TABLE IF EXISTS daily_stats');
            await connection.query('DROP TABLE IF EXISTS users');

            // Criar novas tabelas
            console.log('[DB] Criando novas tabelas...');
            
            const createUsersTable = `
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
            `;

            const createEventsTable = `
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
            `;

            await connection.query(createUsersTable);
            await connection.query(createEventsTable);

            console.log('[DB] ✅ Tabelas criadas com sucesso!');
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

// ==================== AUTENTICAÇÃO ====================

// Registrar novo usuário
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username e password são obrigatórios'
            });
        }

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            // Verificar se usuário já existe
            const [existingUser] = await connection.query(
                'SELECT id FROM users WHERE username = ?',
                [username]
            );

            if (existingUser.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Username já existe'
                });
            }

            // Inserir novo usuário
            const [result] = await connection.query(
                'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
                [username, password, email || null]
            );

            res.json({
                success: true,
                message: 'Usuário registrado com sucesso',
                user_id: result.insertId,
                username: username
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('[AUTH] Erro ao registrar:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao registrar usuário',
            error: error.message
        });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username e password são obrigatórios'
            });
        }

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            // Buscar usuário
            const [users] = await connection.query(
                'SELECT id, username, email, total_impressions, total_clicks, total_earnings FROM users WHERE username = ? AND password = ?',
                [username, password]
            );

            if (users.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'Username ou password incorretos'
                });
            }

            const user = users[0];

            res.json({
                success: true,
                message: 'Login realizado com sucesso',
                user: {
                    id: user.id,
                    username: user.username,
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
        console.error('[AUTH] Erro ao fazer login:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao fazer login',
            error: error.message
        });
    }
});

// ==================== RASTREAMENTO ====================

// Registrar impressão ou clique
app.post('/api/track', async (req, res) => {
    try {
        const { event_type, zone_id, user_id, estimated_price } = req.body;

        if (!event_type || !zone_id || !user_id) {
            return res.status(400).json({
                success: false,
                message: 'event_type, zone_id e user_id são obrigatórios'
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
            // Inserir evento
            const [result] = await connection.query(
                'INSERT INTO tracking_events (event_type, zone_id, user_id, estimated_price) VALUES (?, ?, ?, ?)',
                [event_type, zone_id, user_id, estimated_price || 0]
            );

            // Atualizar estatísticas do usuário
            if (event_type === 'impression') {
                await connection.query(
                    'UPDATE users SET total_impressions = total_impressions + 1, total_earnings = total_earnings + ? WHERE id = ?',
                    [estimated_price || 0, user_id]
                );
            } else if (event_type === 'click') {
                await connection.query(
                    'UPDATE users SET total_clicks = total_clicks + 1, total_earnings = total_earnings + ? WHERE id = ?',
                    [estimated_price || 0, user_id]
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

// Obter dados do usuário
app.get('/api/user/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            const [users] = await connection.query(
                'SELECT id, username, email, total_impressions, total_clicks, total_earnings FROM users WHERE id = ?',
                [user_id]
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
                    id: user.id,
                    username: user.username,
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
app.get('/api/user/:user_id/events', async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!pool) {
            await createPool();
        }

        const connection = await pool.getConnection();

        try {
            const [events] = await connection.query(
                'SELECT id, event_type, zone_id, estimated_price FROM tracking_events WHERE user_id = ? ORDER BY id DESC',
                [user_id]
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
