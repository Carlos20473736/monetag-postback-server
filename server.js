const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do pool de conexões MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'monetag_tracking',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Endpoint para receber postbacks de impressões e cliques
app.get('/api/postback', async (req, res) => {
    try {
        const { event_type, zone_id, ymid, user_email, estimated_price } = req.query;

        console.log(`[${new Date().toISOString()}] Postback recebido:`, {
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

            console.log(`[${new Date().toISOString()}] Evento armazenado com sucesso:`, {
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
        console.error(`[${new Date().toISOString()}] Erro ao processar postback:`, error);
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
        const { zone_id } = req.params;

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

            res.json(stats);

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao obter estatísticas:`, error);
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
        console.error(`[${new Date().toISOString()}] Erro ao obter eventos:`, error);
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
        console.error(`[${new Date().toISOString()}] Erro ao resetar dados:`, error);
        res.status(500).json({
            success: false,
            message: 'Erro ao resetar dados',
            error: error.message
        });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n✅ Servidor Monetag Postback iniciado na porta ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Postback endpoint: http://localhost:${PORT}/api/postback`);
    console.log(`📈 Stats endpoint: http://localhost:${PORT}/api/stats/:zone_id`);
    console.log(`\n🗄️  Banco de dados: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`📦 Database: ${process.env.DB_NAME || 'monetag_tracking'}\n`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
