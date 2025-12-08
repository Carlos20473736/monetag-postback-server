const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Pool de conexões MySQL
let pool = null;

// ========================================
// INICIALIZAR CONEXÃO COM BANCO DE DADOS
// ========================================
async function initializeDatabase() {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'mysql',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'password',
            database: process.env.DB_NAME || 'railway',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        console.log('✅ Pool de conexões criado');

        // Testar conexão
        const connection = await pool.getConnection();
        console.log('✅ Conectado ao banco de dados:', process.env.DB_NAME);
        connection.release();

        return true;
    } catch (error) {
        console.error('❌ Erro ao conectar ao banco:', error.message);
        return false;
    }
}

// ========================================
// ENDPOINTS
// ========================================

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: pool ? 'connected' : 'disconnected'
    });
});

// Registrar Impressão/Clique (Dados Globais)
app.post('/api/track', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ success: false, message: 'Banco de dados não conectado' });
    }

    const { event_type, zone_id, estimated_price } = req.body;

    // Validar dados obrigatórios
    if (!event_type || !zone_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'event_type e zone_id são obrigatórios' 
        });
    }

    try {
        const connection = await pool.getConnection();

        // Inserir evento na tabela monetag_events (sem user_id/email)
        const [result] = await connection.query(
            'INSERT INTO monetag_events (event_type, revenue, session_id) VALUES (?, ?, ?)',
            [event_type, estimated_price || 0, zone_id]
        );

        console.log(`[TRACK] ${event_type} registrado para zona ${zone_id}`);

        connection.release();

        res.json({
            success: true,
            message: `${event_type} registrado com sucesso`,
            event_id: result.insertId
        });
    } catch (error) {
        console.error('[TRACK] Erro ao registrar evento:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao registrar evento',
            error: error.message
        });
    }
});

// Obter Estatísticas Globais
app.get('/api/stats/:zone_id', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ success: false, message: 'Banco de dados não conectado' });
    }

    const { zone_id } = req.params;

    try {
        const connection = await pool.getConnection();

        // Contar impressões e cliques por zona_id (armazenado em session_id)
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "impression" AND session_id = ?',
            [zone_id]
        );

        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "click" AND session_id = ?',
            [zone_id]
        );

        const [revenue] = await connection.query(
            'SELECT SUM(revenue) as total FROM monetag_events WHERE session_id = ?',
            [zone_id]
        );

        connection.release();

        const totalImpressions = impressions[0]?.count || 0;
        const totalClicks = clicks[0]?.count || 0;
        const totalRevenue = revenue[0]?.total || 0;

        console.log(`[STATS] Zona ${zone_id}: ${totalImpressions} impressões, ${totalClicks} cliques, R$ ${totalRevenue}`);

        res.json({
            success: true,
            zone_id: zone_id,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_earnings: totalRevenue.toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] Erro ao buscar estatísticas:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar estatísticas',
            error: error.message
        });
    }
});

// Obter Estatísticas Globais (sem zona_id)
app.get('/api/stats', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ success: false, message: 'Banco de dados não conectado' });
    }

    try {
        const connection = await pool.getConnection();

        // Contar impressões e cliques globais
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "impression"'
        );

        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "click"'
        );

        const [revenue] = await connection.query(
            'SELECT SUM(revenue) as total FROM monetag_events'
        );

        connection.release();

        const totalImpressions = impressions[0]?.count || 0;
        const totalClicks = clicks[0]?.count || 0;
        const totalRevenue = revenue[0]?.total || 0;

        console.log(`[STATS] Global: ${totalImpressions} impressões, ${totalClicks} cliques, R$ ${totalRevenue}`);

        res.json({
            success: true,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_earnings: totalRevenue.toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] Erro ao buscar estatísticas globais:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar estatísticas',
            error: error.message
        });
    }
});

// ========================================
// INICIAR SERVIDOR
// ========================================
async function startServer() {
    // Conectar ao banco de dados
    const dbConnected = await initializeDatabase();

    if (!dbConnected) {
        console.warn('⚠️  Banco de dados não disponível, mas servidor iniciando mesmo assim...');
    }

    app.listen(PORT, () => {
        console.log(`\n🚀 Servidor Monetag Postback iniciado na porta ${PORT}`);
        console.log(`📊 Modo: Dados Globais (sem identificação de usuário)`);
        console.log(`🗄️  Banco de dados: ${process.env.DB_NAME || 'railway'}`);
        console.log(`\n✅ Endpoints disponíveis:`);
        console.log(`   - GET  /health`);
        console.log(`   - POST /api/track`);
        console.log(`   - GET  /api/stats`);
        console.log(`   - GET  /api/stats/:zone_id`);
        console.log(`\n`);
    });
}

startServer();
