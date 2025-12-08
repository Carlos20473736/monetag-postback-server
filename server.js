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

// Pool de conexoes MySQL
let pool = null;

// Armazenar ultimos eventos em memoria (para deteccao de mudancas)
const eventLog = {
    lastEventId: 0,
    events: []
};

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
        // Tabela para rastreamento de eventos do Monetag
        await connection.query(`
            CREATE TABLE IF NOT EXISTS monetag_postbacks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                zone_id VARCHAR(100),
                ymid VARCHAR(100),
                request_var VARCHAR(255),
                telegram_id VARCHAR(100),
                estimated_price DECIMAL(10, 4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_ymid (ymid),
                INDEX idx_telegram_id (telegram_id),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('[DB] ✅ Tabela monetag_postbacks verificada/criada');
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
        mode: 'monetag-postback-receiver'
    });
});

// ========================================
// ENDPOINT DE POSTBACK DO MONETAG (GET)
// Recebe postbacks do SDK Monetag
// ========================================
app.get('/api/postback', async (req, res) => {
    // Extrair parâmetros da query string (conforme URL do Monetag)
    const { event_type, zone_id, ymid, estimated_price, request_var, telegram_id } = req.query;

    // Log dos parâmetros recebidos
    const timestamp = new Date().toISOString();
    console.log(`[POSTBACK] [${timestamp}] 📥 Recebido do SDK Monetag:`);
    console.log(`[POSTBACK]   - event_type: ${event_type}`);
    console.log(`[POSTBACK]   - zone_id: ${zone_id}`);
    console.log(`[POSTBACK]   - ymid: ${ymid}`);
    console.log(`[POSTBACK]   - estimated_price: ${estimated_price}`);
    console.log(`[POSTBACK]   - request_var: ${request_var}`);
    console.log(`[POSTBACK]   - telegram_id: ${telegram_id}`);

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
            'INSERT INTO monetag_postbacks (event_type, zone_id, ymid, request_var, telegram_id, estimated_price) VALUES (?, ?, ?, ?, ?, ?)',
            [event_type, zone_id, ymid || null, request_var || null, telegram_id || null, finalPrice]
        );

        eventLog.lastEventId++;
        eventLog.events.push({
            id: eventLog.lastEventId,
            event_type: event_type,
            zone_id: zone_id,
            ymid: ymid,
            estimated_price: finalPrice,
            timestamp: new Date().toISOString()
        });

        if (eventLog.events.length > 100) {
            eventLog.events.shift();
        }

        console.log(`[POSTBACK] OK ${event_type.toUpperCase()} registrado com sucesso`);
        console.log(`[POSTBACK]   - Zona: ${zone_id}`);
        console.log(`[POSTBACK]   - User: ${ymid || 'anonymous'}`);
        console.log(`[POSTBACK]   - Preco: R$ ${finalPrice}`);
        console.log(`[POSTBACK]   - Event ID: ${eventLog.lastEventId}`);

        connection.release();

        // Retornar sempre 200 OK
        res.status(200).json({
            success: true,
            message: `${event_type} registrado com sucesso`
        });
    } catch (error) {
        console.error('[POSTBACK] ❌ Erro ao registrar evento:', error.message);
        // Retornar 200 mesmo em erro para não quebrar o SDK
        res.status(200).json({
            success: true,
            message: 'Postback recebido'
        });
    }
});

// ========================================
// API DE EVENTOS EM TEMPO REAL
// Detecta novos eventos (impressoes e cliques)
// ========================================
app.get('/api/events', async (req, res) => {
    const sinceId = parseInt(req.query.since_id) || 0;

    const newEvents = eventLog.events.filter(e => e.id > sinceId);

    if (newEvents.length > 0) {
        console.log(`[EVENTS] ${newEvents.length} novo(s) evento(s) detectado(s)`);
        newEvents.forEach(e => {
            console.log(`[EVENTS]   - ${e.event_type.toUpperCase()} (ID: ${e.id})`);
        });
    } else {
        console.log(`[EVENTS] Nenhum novo evento desde ID ${sinceId}`);
    }

    res.json({
        success: true,
        last_event_id: eventLog.lastEventId,
        events: newEvents,
        count: newEvents.length
    });
});

app.get('/api/events/latest', async (req, res) => {
    const latestEvent = eventLog.events.length > 0 ? eventLog.events[eventLog.events.length - 1] : null;

    if (latestEvent) {
        console.log(`[EVENTS] Ultimo evento: ${latestEvent.event_type.toUpperCase()} (ID: ${latestEvent.id})`);
    } else {
        console.log(`[EVENTS] Nenhum evento registrado ainda`);
    }

    res.json({
        success: true,
        last_event_id: eventLog.lastEventId,
        latest_event: latestEvent
    });
});

// ========================================
// OBTER ESTATÍSTICAS POR ZONA
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
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "impression" AND zone_id = ?',
            [zone_id]
        );

        // Contar cliques da zona
        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "click" AND zone_id = ?',
            [zone_id]
        );

        // Somar receita da zona
        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_postbacks WHERE zone_id = ?',
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
// OBTER ESTATu00cdSTICAS POR USUu00c1RIO (YMID)
// ========================================
app.get('/api/stats/user/:ymid', async (req, res) => {
    const { ymid } = req.params;

    if (!pool) {
        console.log('[STATS] Banco nao conectado');
        return res.status(200).json({
            success: true,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
        });
    }

    try {
        const connection = await pool.getConnection();

        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "impression" AND ymid = ?',
            [ymid]
        );

        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "click" AND ymid = ?',
            [ymid]
        );

        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_postbacks WHERE ymid = ?',
            [ymid]
        );

        connection.release();

        const totalImpressions = impressions[0]?.count || 0;
        const totalClicks = clicks[0]?.count || 0;
        const totalRevenue = revenue[0]?.total || 0;

        console.log(`[STATS] Usuario ${ymid}: ${totalImpressions} impressoes, ${totalClicks} cliques, R$ ${totalRevenue}`);

        res.json({
            success: true,
            ymid: ymid,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_revenue: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] Erro ao buscar stats do usuario:', error.message);
        res.status(200).json({
            success: true,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
        });
    }
});

// ========================================
// OBTER ESTATu00cdSTICAS GLOBAIS
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
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "impression"'
        );

        // Contar cliques globais
        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "click"'
        );

        // Somar receita global
        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_postbacks'
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
// OBTER ESTATÍSTICAS POR USUÁRIO
// ========================================
app.get('/api/stats/user/:ymid', async (req, res) => {
    const { ymid } = req.params;

    if (!pool) {
        return res.status(200).json({
            success: true,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: '0.0000'
        });
    }

    try {
        const connection = await pool.getConnection();

        // Contar impressões do usuário
        const [impressions] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "impression" AND ymid = ?',
            [ymid]
        );

        // Contar cliques do usuário
        const [clicks] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "click" AND ymid = ?',
            [ymid]
        );

        // Somar receita do usuário
        const [revenue] = await connection.query(
            'SELECT SUM(estimated_price) as total FROM monetag_postbacks WHERE ymid = ?',
            [ymid]
        );

        connection.release();

        const totalImpressions = impressions[0]?.count || 0;
        const totalClicks = clicks[0]?.count || 0;
        const totalRevenue = revenue[0]?.total || 0;

        console.log(`[STATS] Usuário ${ymid}: ${totalImpressions} impressões, ${totalClicks} cliques, R$ ${totalRevenue}`);

        res.json({
            success: true,
            ymid: ymid,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_revenue: parseFloat(totalRevenue).toFixed(4)
        });
    } catch (error) {
        console.error('[STATS] ❌ Erro ao buscar estatísticas do usuário:', error.message);
        res.status(200).json({
            success: true,
            ymid: ymid,
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
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🚀 Servidor Monetag Postback Receiver iniciado na porta ${PORT}`);
        console.log(`📊 Modo: Receber postbacks do SDK Monetag`);
        console.log(`🗄️  Banco de dados: ${process.env.DB_NAME || 'railway'}`);
        console.log(`${'='.repeat(70)}`);
        console.log(`\n✅ Endpoints disponíveis:`);
        console.log(`   - GET  /health`);
        console.log(`   - GET  /api/postback?event=impression&zone_id=10269314&ymid=USER&request_var=VAR&telegram_id=ID&estimated_price=0.0023`);
        console.log(`   - GET  /api/stats (estatísticas globais)`);
        console.log(`   - GET  /api/stats/:zone_id (estatísticas por zona)`);
        console.log(`   - GET  /api/stats/user/:ymid (estatísticas por usuário)`);
        console.log(`\n📝 Parâmetros de Postback (conforme Monetag SDK):`);
        console.log(`   - event: impression ou click`);
        console.log(`   - zone_id: ID da zona de anúncio`);
        console.log(`   - ymid: ID do usuário`);
        console.log(`   - request_var: Variável customizada (opcional)`);
        console.log(`   - telegram_id: ID do Telegram (opcional)`);
        console.log(`   - estimated_price: Preço estimado`);
        console.log(`\n`);
    });
}

startServer();
