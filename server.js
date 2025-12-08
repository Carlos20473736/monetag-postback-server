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
        
        // Criar tabelas se não existirem
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
        // Tabela para rastreamento global
        await connection.query(`
            CREATE TABLE IF NOT EXISTS monetag_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(100),
                ymid VARCHAR(100),
                user_email VARCHAR(255),
                estimated_price DECIMAL(10, 4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('[DB] ✅ Tabela monetag_events verificada/criada');

        // Adicionar coluna estimated_price se não existir
        try {
            await connection.query(`
                ALTER TABLE monetag_events ADD COLUMN estimated_price DECIMAL(10, 4) DEFAULT 0
            `);
            console.log('[DB] ✅ Coluna estimated_price adicionada');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('[DB] ℹ️  Coluna estimated_price já existe');
            } else {
                console.log('[DB] ℹ️  Coluna estimated_price verificada');
            }
        }
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
// ENDPOINT DE POSTBACK (GET com query params)
// ========================================
app.get('/api/postback', async (req, res) => {
    // Extrair parâmetros da query string
    const { event_type, zone_id, ymid, user_email, estimated_price } = req.query;

    // Log dos parâmetros recebidos
    console.log('[POSTBACK] 📥 Recebido:');
    console.log('[POSTBACK]   - event_type:', event_type);
    console.log('[POSTBACK]   - zone_id:', zone_id);
    console.log('[POSTBACK]   - ymid:', ymid);
    console.log('[POSTBACK]   - user_email:', user_email);
    console.log('[POSTBACK]   - estimated_price:', estimated_price);

    // Validar dados obrigatórios
    if (!event_type || !zone_id) {
        console.log('[POSTBACK] ⚠️  Dados inválidos - faltam event_type ou zone_id');
        return res.status(200).json({ success: true, message: 'Postback recebido' });
    }

    // Se banco não está conectado, retornar sucesso mesmo assim
    if (!pool) {
        console.log('[POSTBACK] ⚠️  Banco de dados não conectado, retornando sucesso');
        return res.status(200).json({ success: true, message: 'Postback recebido (offline)' });
    }

    try {
        const connection = await pool.getConnection();

        // Inserir evento na tabela
        const finalPrice = estimated_price || 0;
        
        await connection.query(
            'INSERT INTO monetag_events (event_type, zone_id, ymid, user_email, estimated_price) VALUES (?, ?, ?, ?, ?)',
            [event_type, zone_id, ymid || null, user_email || null, finalPrice]
        );

        console.log(`[POSTBACK] ✅ ${event_type.toUpperCase()} registrado`);
        console.log(`[POSTBACK]   - Zona: ${zone_id}`);
        console.log(`[POSTBACK]   - User: ${user_email || ymid || 'anonymous'}`);
        console.log(`[POSTBACK]   - Preço: ${finalPrice}`);

        connection.release();

        // Retornar sempre 200 OK
        res.status(200).json({
            success: true,
            message: `${event_type} registrado com sucesso`
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
// ENDPOINT DE POSTBACK (POST alternativo)
// ========================================
app.post('/api/postback', async (req, res) => {
    const { event_type, zone_id, ymid, user_email, estimated_price } = req.body;

    if (!event_type || !zone_id) {
        return res.status(200).json({ success: true });
    }

    if (!pool) {
        return res.status(200).json({ success: true });
    }

    try {
        const connection = await pool.getConnection();

        const finalPrice = estimated_price || 0;
        
        await connection.query(
            'INSERT INTO monetag_events (event_type, zone_id, ymid, user_email, estimated_price) VALUES (?, ?, ?, ?, ?)',
            [event_type, zone_id, ymid || null, user_email || null, finalPrice]
        );

        console.log(`[POSTBACK] ✅ ${event_type} registrado (POST)`);

        connection.release();

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[POSTBACK] ❌ Erro:', error.message);
        res.status(200).json({ success: true });
    }
});

// ========================================
// OBTER ESTATÍSTICAS POR ZONA (GLOBAL)
// ========================================
app.get('/api/stats/:zone_id', async (req, res) => {
    const { zone_id } = req.params;

    // Se banco não está conectado, retornar zeros
    if (!pool) {
        console.log('[STATS] ⚠️  Banco de dados não conectado');
        return res.status(200).json({
            success: true,
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
        });
    }

    try {
        const connection = await pool.getConnection();

        // Contar impressões da zona
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "impression" AND zone_id = ?',
            [zone_id]
        );

        // Contar cliques da zona
        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "click" AND zone_id = ?',
            [zone_id]
        );

        // Somar receita da zona
        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_events WHERE zone_id = ?',
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
            total_revenue: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] ❌ Erro ao buscar estatísticas da zona:', error.message);
        res.status(200).json({
            success: true,
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
        });
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
            total_revenue: '0.0000'
        });
    }

    try {
        const connection = await pool.getConnection();

        // Contar impressões globais
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "impression"'
        );

        // Contar cliques globais
        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_events WHERE event_type = "click"'
        );

        // Somar receita global
        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_events'
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
            total_revenue: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] ❌ Erro ao buscar estatísticas globais:', error.message);
        res.status(200).json({
            success: true,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
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
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 Servidor Monetag Postback iniciado na porta ${PORT}`);
        console.log(`📊 Modo: Rastreamento Global`);
        console.log(`🗄️  Banco de dados: ${process.env.DB_NAME || 'railway'}`);
        console.log(`${'='.repeat(60)}`);
        console.log(`\n✅ Endpoints disponíveis:`);
        console.log(`   - GET  /health`);
        console.log(`   - GET  /api/postback?event_type=impression&zone_id=10269314&ymid=USER&user_email=EMAIL&estimated_price=0.0023`);
        console.log(`   - POST /api/postback (JSON body)`);
        console.log(`   - GET  /api/stats (estatísticas globais)`);
        console.log(`   - GET  /api/stats/:zone_id (estatísticas por zona)`);
        console.log(`\n`);
    });
}

startServer();
