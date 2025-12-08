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
            database: process.env.DB_NAME || 'monetag_tracking',
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
            // Criar tabelas se não existirem
            const createTablesQuery = `
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

            // Executar cada CREATE TABLE separadamente
            const tables = createTablesQuery.split(';').filter(t => t.trim());
            for (const table of tables) {
                if (table.trim()) {
                    await connection.execute(table);
                }
            }

            console.log('[DB] ✅ Tabelas criadas/verificadas com sucesso!');
            dbInitialized = true;
            return true;

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('[DB] ⚠️  Erro ao inicializar banco:', error.message);
        // Não falhar completamente, apenas avisar
        return false;
    }
}

// Health check
app.get('/health', async (req, res) => {
    try {
        // Tentar criar pool se não existir
        if (!pool) {
            await createPool();
        }

        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: pool ? 'connected' : 'disconnected',
            initialized: dbInitialized
        });
    } catch (error) {
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'error',
            error: error.message
        });
    }
});

// Endpoint para receber postbacks de impressões e cliques
app.get('/api/postback', async (req, res) => {
    try {
        // Tentar criar pool se não existir
        if (!pool) {
            await createPool();
        }

        // Tentar inicializar banco se não foi inicializado
        if (!dbInitialized) {
            await initializeDatabase();
        }

        if (!pool) {
            return res.status(503).json({
                success: false,
                message: 'Banco de dados não está disponível'
            });
        }

        const { event_type, zone_id, ymid, user_email, estimated_price } = req.query;

        console.log(`[POSTBACK] Recebido:`, {
            event_type,
            zone_id,
            ymid,
            user_email,
            estimated_price
        });

        // Validar dados obrigatórios
        if (!event_type || !zone_id || !ymid) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros obrigatórios faltando: event_type, zone_id, ymid'
            });
        }

        // Obter conexão do pool
        const connection = await pool.getConnection();

        try {
            // Inserir registro na tabela de tracking
            const query = `
                INSERT INTO tracking_events 
                (event_type, zone_id, user_id, user_email, estimated_price, created_at)
                VALUES (?, ?, ?, ?, ?, NOW())
            `;

            const values = [event_type, zone_id, ymid, user_email || 'unknown@youngmoney.com', estimated_price || '0.00'];

            const [result] = await connection.execute(query, values);

            console.log(`[POSTBACK] ✅ Armazenado:`, {
                id: result.insertId,
                event_type,
                zone_id,
                user_id: ymid
            });

            // Retornar resposta de sucesso
            res.json({
                success: true,
                message: `${event_type} registrado com sucesso`,
                event_id: result.insertId,
                timestamp: new Date().toISOString()
            });

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(`[POSTBACK] ❌ Erro:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao processar postback',
            error: error.message
        });
    }
});

// Endpoint para obter estatísticas
app.get('/api/stats/:zone_id', async (req, res) => {
    try {
        // Tentar criar pool se não existir
        if (!pool) {
            await createPool();
        }

        // Tentar inicializar banco se não foi inicializado
        if (!dbInitialized) {
            await initializeDatabase();
        }

        if (!pool) {
            return res.status(503).json({
                success: false,
                message: 'Banco de dados não está disponível'
            });
        }

        const { zone_id } = req.params;

        console.log(`[STATS] Solicitação para zona: ${zone_id}`);

        const connection = await pool.getConnection();

        try {
            // Contar impressões e cliques
            const query = `
                SELECT 
                    event_type,
                    COUNT(*) as count,
                    SUM(CAST(estimated_price AS DECIMAL(10, 4))) as total_revenue
                FROM tracking_events
                WHERE zone_id = ?
                GROUP BY event_type
            `;

            const [rows] = await connection.execute(query, [zone_id]);

            // Formatar resposta
            const stats = {
                zone_id,
                impressions: 0,
                clicks: 0,
                total_revenue: 0,
                timestamp: new Date().toISOString()
            };

            rows.forEach(row => {
                if (row.event_type === 'impression') {
                    stats.impressions = row.count;
                    stats.total_revenue += parseFloat(row.total_revenue || 0);
                } else if (row.event_type === 'click') {
                    stats.clicks = row.count;
                    stats.total_revenue += parseFloat(row.total_revenue || 0);
                }
            });

            console.log(`[STATS] ✅ Retornando:`, stats);

            res.json(stats);

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(`[STATS] ❌ Erro:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao obter estatísticas',
            error: error.message
        });
    }
});

// Endpoint para obter todos os eventos de um usuário
app.get('/api/events/:user_id', async (req, res) => {
    try {
        // Tentar criar pool se não existir
        if (!pool) {
            await createPool();
        }

        // Tentar inicializar banco se não foi inicializado
        if (!dbInitialized) {
            await initializeDatabase();
        }

        if (!pool) {
            return res.status(503).json({
                success: false,
                message: 'Banco de dados não está disponível'
            });
        }

        const { user_id } = req.params;

        const connection = await pool.getConnection();

        try {
            const query = `
                SELECT *
                FROM tracking_events
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 100
            `;

            const [rows] = await connection.execute(query, [user_id]);

            res.json({
                user_id,
                total_events: rows.length,
                events: rows,
                timestamp: new Date().toISOString()
            });

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(`[EVENTS] ❌ Erro:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao obter eventos',
            error: error.message
        });
    }
});

// Endpoint para resetar dados (apenas para desenvolvimento)
app.post('/api/reset', async (req, res) => {
    try {
        // Verificar se está em desenvolvimento
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({
                success: false,
                message: 'Reset não permitido em produção'
            });
        }

        // Tentar criar pool se não existir
        if (!pool) {
            await createPool();
        }

        if (!pool) {
            return res.status(503).json({
                success: false,
                message: 'Banco de dados não está disponível'
            });
        }

        const connection = await pool.getConnection();

        try {
            await connection.execute('TRUNCATE TABLE tracking_events');

            res.json({
                success: true,
                message: 'Dados resetados com sucesso'
            });

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(`[RESET] ❌ Erro:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao resetar dados',
            error: error.message
        });
    }
});

// Iniciar servidor
async function startServer() {
    const PORT = process.env.PORT || 3000;

    console.log('\n🚀 Iniciando Monetag Postback Server...');
    console.log(`📍 Porta: ${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  DB Host: ${process.env.DB_HOST || 'mysql'}`);
    console.log(`📦 Database: ${process.env.DB_NAME || 'monetag_tracking'}\n`);

    // Tentar criar pool na inicialização (mas não falhar se não conseguir)
    try {
        await createPool();
        console.log('[DB] ✅ Pool de conexões criado na inicialização');
    } catch (error) {
        console.log('[DB] ⚠️  Não foi possível criar pool na inicialização');
        console.log('[DB] O pool será criado sob demanda quando uma requisição chegar');
    }

    app.listen(PORT, () => {
        console.log(`\n✅ Servidor Monetag Postback iniciado na porta ${PORT}`);
        console.log(`📍 Health check: http://localhost:${PORT}/health`);
        console.log(`📊 Postback endpoint: http://localhost:${PORT}/api/postback`);
        console.log(`📈 Stats endpoint: http://localhost:${PORT}/api/stats/:zone_id`);
        console.log(`📝 Events endpoint: http://localhost:${PORT}/api/events/:user_id\n`);
    });
}

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught Exception:', error);
    // Não sair do processo, apenas logar
});

// Iniciar servidor
startServer().catch(error => {
    console.error('[SERVER] ❌ Erro ao iniciar servidor:', error);
    // Não sair, tentar continuar mesmo com erro
});

module.exports = app;
