const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

        console.log('[DB] ✅ Pool de conexões criado');

        // Testar conexão
        const connection = await pool.getConnection();
        console.log('[DB] ✅ Conectado ao banco de dados:', process.env.DB_NAME);
        
        // Criar tabela se não existir
        await createTablesIfNotExists(connection);
        
        connection.release();

        return true;
    } catch (error) {
        console.error('[DB] ❌ Erro ao conectar ao banco:', error.message);
        return false;
    }
}

// ========================================
// CRIAR TABELAS SE NÃO EXISTIREM
// ========================================
async function createTablesIfNotExists(connection) {
    try {
        // Tabela para rastreamento global (sem email)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS monetag_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(100),
                session_id VARCHAR(100),
                revenue DECIMAL(10, 4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_session_id (session_id),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('[DB] ✅ Tabela monetag_events verificada/criada');
    } catch (error) {
        console.error('[DB] ⚠️  Erro ao criar tabelas:', error.message);
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
        database: pool ? 'connected' : 'disconnected',
        mode: 'global-tracking'
    });
});

// ========================================
// ENDPOINT DE POSTBACK (GLOBAL - SEM EMAIL)
// ========================================
app.post('/api/postback', async (req, res) => {
    if (!pool) {
        console.log('[POSTBACK] ⚠️  Banco de dados não conectado');
        return res.status(200).json({ success: true, message: 'Postback recebido (offline)' });
    }

    const { event_type, zone_id, session_id, estimated_price, revenue } = req.body;

    // Validar dados obrigatórios
    if (!event_type || !zone_id) {
        console.log('[POSTBACK] ❌ Dados inválidos:', { event_type, zone_id });
        return res.status(200).json({ success: true, message: 'Postback recebido' });
    }

    try {
        const connection = await pool.getConnection();

        // Inserir evento na tabela monetag_events (tracking global)
        const finalRevenue = estimated_price || revenue || 0;
        const finalSessionId = session_id || zone_id;

        await connection.query(
            'INSERT INTO monetag_events (event_type, zone_id, session_id, revenue) VALUES (?, ?, ?, ?)',
            [event_type, zone_id, finalSessionId, finalRevenue]
        );

        console.log(`[POSTBACK] ✅ ${event_type.toUpperCase()} registrado | Zona: ${zone_id} | Sessão: ${finalSessionId} | Receita: ${finalRevenue}`);

        connection.release();

        // Retornar sempre 200 para não quebrar o fluxo do cliente
        res.status(200).json({
            success: true,
            message: `${event_type} registrado com sucesso`,
            mode: 'global-tracking'
        });
    } catch (error) {
        console.error('[POSTBACK] ❌ Erro ao registrar evento:', error.message);
        // Retornar 200 mesmo em erro para não quebrar o cliente
        res.status(200).json({
            success: true,
            message: 'Postback recebido'
        });
    }
});

// ========================================
// ENDPOINT DE RASTREAMENTO (COMPATÍVEL COM CLIENTE)
// ========================================
app.post('/api/track', async (req, res) => {
    if (!pool) {
        console.log('[TRACK] ⚠️  Banco de dados não conectado');
        return res.status(200).json({ success: true });
    }

    const { event_type, zone_id, session_id, estimated_price, revenue } = req.body;

    if (!event_type || !zone_id) {
        return res.status(200).json({ success: true });
    }

    try {
        const connection = await pool.getConnection();

        const finalRevenue = estimated_price || revenue || 0;
        const finalSessionId = session_id || zone_id;

        await connection.query(
            'INSERT INTO monetag_events (event_type, zone_id, session_id, revenue) VALUES (?, ?, ?, ?)',
            [event_type, zone_id, finalSessionId, finalRevenue]
        );

        console.log(`[TRACK] ✅ ${event_type} | Zona: ${zone_id}`);

        connection.release();

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[TRACK] ❌ Erro:', error.message);
        res.status(200).json({ success: true });
    }
});

// ========================================
// OBTER ESTATÍSTICAS GLOBAIS
// ========================================
app.get('/api/stats', async (req, res) => {
    if (!pool) {
        return res.status(200).json({
            success: true,
            total_impressions: 0,
            total_clicks: 0,
            total_earnings: '0.0000'
        });
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
            total_earnings: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] ❌ Erro ao buscar estatísticas globais:', error.message);
        res.status(200).json({
            success: true,
            total_impressions: 0,
            total_clicks: 0,
            total_earnings: '0.0000'
        });
    }
});

// ========================================
// OBTER ESTATÍSTICAS POR ZONA
// ========================================
app.get('/api/stats/:zone_id', async (req, res) => {
    if (!pool) {
        return res.status(200).json({
            success: true,
            zone_id: req.params.zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_earnings: '0.0000'
        });
    }

    const { zone_id } = req.params;

    try {
        const connection = await pool.getConnection();

        // Contar impressões e cliques por zona
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "impression" AND zone_id = ?',
            [zone_id]
        );

        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "click" AND zone_id = ?',
            [zone_id]
        );

        const [revenue] = await connection.query(
            'SELECT SUM(revenue) as total FROM monetag_events WHERE zone_id = ?',
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
            total_earnings: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] ❌ Erro ao buscar estatísticas da zona:', error.message);
        res.status(200).json({
            success: true,
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_earnings: '0.0000'
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
        console.warn('[SERVER] ⚠️  Banco de dados não disponível, mas servidor iniciando mesmo assim...');
    }

    app.listen(PORT, () => {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`🚀 Servidor Monetag Postback iniciado na porta ${PORT}`);
        console.log(`📊 Modo: TRACKING GLOBAL (sem email)`);
        console.log(`🗄️  Banco de dados: ${process.env.DB_NAME || 'railway'}`);
        console.log(`${'='.repeat(50)}`);
        console.log(`\n✅ Endpoints disponíveis:`);
        console.log(`   - GET  /health`);
        console.log(`   - POST /api/postback (RECOMENDADO - tracking global)`);
        console.log(`   - POST /api/track (alternativo)`);
        console.log(`   - GET  /api/stats (estatísticas globais)`);
        console.log(`   - GET  /api/stats/:zone_id (estatísticas por zona)`);
        console.log(`\n`);
    });
}

startServer();
