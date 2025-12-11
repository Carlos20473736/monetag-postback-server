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
                session_expires_at TIMESTAMP NULL,
                INDEX idx_event_type (event_type),
                INDEX idx_zone_id (zone_id),
                INDEX idx_ymid (ymid),
                INDEX idx_telegram_id (telegram_id),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('[DB] ✅ Tabela monetag_postbacks verificada/criada');
        
        // Adicionar coluna session_expires_at se não existir
        try {
            await connection.query(`
                ALTER TABLE monetag_postbacks 
                ADD COLUMN session_expires_at TIMESTAMP NULL
            `);
            console.log('[DB] ✅ Coluna session_expires_at adicionada');
        } catch (alterError) {
            // Ignorar erro se coluna já existir
            if (alterError.code !== 'ER_DUP_FIELDNAME') {
                console.error('[DB] ⚠️  Erro ao adicionar coluna:', alterError.message);
            } else {
                console.log('[DB] ✅ Coluna session_expires_at já existe');
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

        // Verificar se usuário completou a tarefa (5 impressões + 1 clique)
        const [userStats] = await connection.query(
            'SELECT COUNT(CASE WHEN event_type = "impression" THEN 1 END) as impressions, COUNT(CASE WHEN event_type = "click" THEN 1 END) as clicks FROM monetag_postbacks WHERE ymid = ?',
            [ymid]
        );

        const currentImpressions = userStats[0]?.impressions || 0;
        const currentClicks = userStats[0]?.clicks || 0;
        const taskCompleted = currentImpressions >= 20 && currentClicks >= 8;

        // Se tarefa foi completada, criar sessão de 15 minutos
        let sessionExpiresAt = null;
        if (taskCompleted) {
            sessionExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
            console.log(`[TIMER] Tarefa completada para ${ymid}! Sessão expira em: ${sessionExpiresAt.toISOString()}`);
        }

        // Inserir evento na tabela
        const finalPrice = estimated_price || 0;
        await connection.query(
            'INSERT INTO monetag_postbacks (event_type, zone_id, ymid, request_var, telegram_id, estimated_price, session_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [event_type, zone_id, ymid || null, request_var || null, telegram_id || null, finalPrice, sessionExpiresAt]
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

        // Verificar se sessão expirou (15 minutos)
        const [sessionCheck] = await connection.query(
            'SELECT session_expires_at FROM monetag_postbacks WHERE ymid = ? ORDER BY created_at DESC LIMIT 1',
            [ymid]
        );

        const now = new Date();
        let sessionExpired = false;
        let timeRemaining = 0;

        if (sessionCheck[0]?.session_expires_at) {
            const expiresAt = new Date(sessionCheck[0].session_expires_at);
            sessionExpired = now > expiresAt;
            timeRemaining = Math.max(0, Math.floor((expiresAt - now) / 1000)); // segundos restantes

            if (sessionExpired) {
                console.log(`[TIMER] Sessão expirada para ${ymid}, resetando...`);
                await connection.query('DELETE FROM monetag_postbacks WHERE ymid = ?', [ymid]);
            }
        }

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

        const totalImpressions = sessionExpired ? 0 : (impressions[0]?.count || 0);
        const totalClicks = sessionExpired ? 0 : (clicks[0]?.count || 0);
        const totalRevenue = sessionExpired ? 0 : (revenue[0]?.total || 0);

        console.log(`[STATS] Usuario ${ymid}: ${totalImpressions} impressoes, ${totalClicks} cliques, R$ ${totalRevenue}, Tempo restante: ${timeRemaining}s`);

        res.json({
            success: true,
            ymid: ymid,
            total_impressions: totalImpressions,
            total_clicks: totalClicks,
            total_revenue: parseFloat(totalRevenue).toFixed(4),
            session_expired: sessionExpired,
            time_remaining: timeRemaining
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
// RESET DE POSTBACKS (GET e POST)
// ========================================
// Função auxiliar para o reset
const handleReset = async (req, res) => {
    // Verificar token de segurança
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    const expectedToken = process.env.RESET_TOKEN || 'ym_reset_monetag_scheduled_2024_secure';

    if (!token || token !== expectedToken) {
        return res.status(401).json({
            success: false,
            error: 'Token inválido ou não fornecido'
        });
    }

    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const connection = await pool.getConnection();

        // Contar eventos antes de deletar
        const [countResult] = await connection.query(
            'SELECT COUNT(*) as total, COUNT(DISTINCT ymid) as users FROM monetag_postbacks'
        );

        const totalEvents = countResult[0]?.total || 0;
        const totalUsers = countResult[0]?.users || 0;

        // Contar impressões e cliques
        const [impressionsResult] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "impression"'
        );
        const totalImpressions = impressionsResult[0]?.count || 0;

        const [clicksResult] = await connection.query(
            'SELECT COUNT(*) as count FROM monetag_postbacks WHERE event_type = "click"'
        );
        const totalClicks = clicksResult[0]?.count || 0;

        // Deletar todos os postbacks
        await connection.query('DELETE FROM monetag_postbacks');

        // Limpar event log em memória
        eventLog.lastEventId = 0;
        eventLog.events = [];

        connection.release();

        console.log(`[RESET] ✅ Postbacks deletados com sucesso`);
        console.log(`[RESET]   - Total de eventos deletados: ${totalEvents}`);
        console.log(`[RESET]   - Usuários afetados: ${totalUsers}`);
        console.log(`[RESET]   - Impressões deletadas: ${totalImpressions}`);
        console.log(`[RESET]   - Cliques deletados: ${totalClicks}`);

        res.json({
            success: true,
            message: 'Reset de postbacks executado com sucesso!',
            data: {
                reset_type: 'monetag_postback_manual',
                description: 'Todos os eventos de postback foram deletados',
                current_time: new Date().toISOString(),
                events_deleted: totalEvents,
                users_affected: totalUsers,
                impressions_deleted: totalImpressions,
                clicks_deleted: totalClicks,
                reset_datetime: new Date().toISOString(),
                timezone: 'America/Sao_Paulo (GMT-3)',
                timestamp: Math.floor(Date.now() / 1000)
            }
        });
    } catch (error) {
        console.error('[RESET] ❌ Erro ao resetar postbacks:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao executar reset',
            details: error.message
        });
    }
};

// Registrar endpoint para GET
app.get('/api/reset', handleReset);

// Registrar endpoint para POST
app.post('/api/reset', handleReset);

// ========================================
// RESET AUTOMÁTICO DE SESSÕES EXPIRADAS (CRON JOB)
// ========================================
app.get('/api/reset-expired', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const connection = await pool.getConnection();
        const now = new Date();

        // Buscar todos os usuários com sessão expirada
        // Inclui: 1) session_expires_at expirado, 2) session_expires_at NULL com registros antigos (>15min)
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
        
        const [expiredUsers] = await connection.query(
            `SELECT DISTINCT ymid, request_var as email 
             FROM monetag_postbacks 
             WHERE (session_expires_at IS NOT NULL AND session_expires_at < ?) 
                OR (session_expires_at IS NULL AND created_at < ?)`,
            [now, fifteenMinutesAgo]
        );

        const expiredCount = expiredUsers.length;
        const expiredYmids = expiredUsers.map(u => u.ymid);
        const expiredDetails = expiredUsers.map(u => ({
            userId: u.ymid,
            email: u.email || 'N/A'
        }));

        if (expiredCount === 0) {
            connection.release();
            console.log('[RESET-EXPIRED] Nenhum usuário com sessão expirada');
            return res.json({
                success: true,
                message: 'Nenhum usuário com sessão expirada',
                users_reset: 0,
                timestamp: now.toISOString()
            });
        }

        // Deletar TODOS os postbacks dos usuários expirados (não apenas os antigos)
        if (expiredYmids.length > 0) {
            const placeholders = expiredYmids.map(() => '?').join(',');
            await connection.query(
                `DELETE FROM monetag_postbacks WHERE ymid IN (${placeholders})`,
                expiredYmids
            );
        }

        connection.release();

        console.log(`[RESET-EXPIRED] ✅ ${expiredCount} usuário(s) resetado(s)`);
        expiredDetails.forEach(u => {
            console.log(`[RESET-EXPIRED]   - ${u.email} (${u.userId})`);
        });

        res.json({
            success: true,
            message: `${expiredCount} usuário(s) com sessão expirada resetado(s)`,
            users_reset: expiredCount,
            users: expiredDetails,
            timestamp: now.toISOString()
        });
    } catch (error) {
        console.error('[RESET-EXPIRED] ❌ Erro ao resetar sessões expiradas:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao resetar sessões expiradas',
            details: error.message
        });
    }
});

// ========================================
// LISTAR SESSÕES ATIVAS (NÃO EXPIRADAS)
// ========================================
app.get('/api/active-sessions', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const connection = await pool.getConnection();
        const now = new Date();

        // Buscar todos os usuários com sessão ativa (não expirada)
        const [activeSessions] = await connection.query(
            'SELECT DISTINCT ymid, request_var as email, session_expires_at FROM monetag_postbacks WHERE session_expires_at IS NOT NULL AND session_expires_at > ?',
            [now]
        );

        const activeCount = activeSessions.length;
        const activeDetails = activeSessions.map(s => {
            const expiresAt = new Date(s.session_expires_at);
            const timeRemaining = Math.max(0, Math.floor((expiresAt - now) / 1000)); // segundos
            const minutesRemaining = Math.floor(timeRemaining / 60);
            const secondsRemaining = timeRemaining % 60;

            return {
                userId: s.ymid,
                email: s.email || 'N/A',
                expiresAt: expiresAt.toISOString(),
                timeRemaining: `${minutesRemaining}m ${secondsRemaining}s`,
                timeRemainingSeconds: timeRemaining
            };
        });

        connection.release();

        console.log(`[ACTIVE-SESSIONS] ${activeCount} sessão(ões) ativa(s)`);
        activeDetails.forEach(s => {
            console.log(`[ACTIVE-SESSIONS]   - ${s.email} (${s.userId}) - Expira em: ${s.timeRemaining}`);
        });

        res.json({
            success: true,
            message: `${activeCount} sessão(ões) ativa(s)`,
            active_sessions: activeCount,
            sessions: activeDetails,
            timestamp: now.toISOString()
        });
    } catch (error) {
        console.error('[ACTIVE-SESSIONS] ❌ Erro ao buscar sessões ativas:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar sessões ativas',
            details: error.message
        });
    }
});

// ========================================
// ENDPOINT: Forçar Reset de Usuário Específico
// ========================================
app.delete('/api/reset-user/:ymid', async (req, res) => {
    if (!pool) {
        return res.status(503).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const { ymid } = req.params;
        const connection = await pool.getConnection();

        // Buscar email do usuário antes de deletar
        const [user] = await connection.query(
            'SELECT DISTINCT request_var as email FROM monetag_postbacks WHERE ymid = ? LIMIT 1',
            [ymid]
        );

        // Deletar todos os registros do usuário
        const [result] = await connection.query(
            'DELETE FROM monetag_postbacks WHERE ymid = ?',
            [ymid]
        );

        connection.release();

        const email = user.length > 0 ? user[0].email : 'N/A';
        const deletedCount = result.affectedRows;

        console.log(`[RESET-USER] ✅ Usuário ${ymid} (${email}) resetado - ${deletedCount} registro(s) deletado(s)`);

        res.json({
            success: true,
            message: `Usuário ${ymid} resetado com sucesso`,
            userId: ymid,
            email: email,
            records_deleted: deletedCount,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[RESET-USER] ❌ Erro ao resetar usuário:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao resetar usuário',
            details: error.message
        });
    }
});

// ========================================
// RESET MANUAL DE TODOS OS USUÁRIOS (FORÇAR RESET)
// ========================================
app.get('/api/reset-all', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const connection = await pool.getConnection();
        const now = new Date();

        // Buscar TODOS os usuários antes de deletar (para retornar detalhes)
        const [allUsers] = await connection.query(
            `SELECT DISTINCT ymid, request_var as email 
             FROM monetag_postbacks`
        );

        const totalCount = allUsers.length;
        const allYmids = allUsers.map(u => u.ymid);
        const allDetails = allUsers.map(u => ({
            userId: u.ymid,
            email: u.email || 'N/A'
        }));

        if (totalCount === 0) {
            connection.release();
            console.log('[RESET-ALL] Nenhum usuário encontrado no banco');
            return res.json({
                success: true,
                message: 'Nenhum usuário encontrado para resetar',
                users_reset: 0,
                timestamp: now.toISOString()
            });
        }

        // Deletar TODOS os registros de TODOS os usuários
        await connection.query('DELETE FROM monetag_postbacks');

        connection.release();

        console.log(`[RESET-ALL] ✅ ${totalCount} usuário(s) resetado(s) MANUALMENTE`);
        allDetails.forEach(u => {
            console.log(`[RESET-ALL]   - ${u.email} (${u.userId})`);
        });

        res.json({
            success: true,
            message: `${totalCount} usuário(s) resetado(s) manualmente`,
            users_reset: totalCount,
            users: allDetails,
            timestamp: now.toISOString()
        });
    } catch (error) {
        console.error('[RESET-ALL] ❌ Erro ao resetar todos os usuários:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao resetar todos os usuários',
            details: error.message
        });
    }
});

// Adicionar também como POST para maior compatibilidade
app.post('/api/reset-all', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'Banco de dados não conectado'
        });
    }

    try {
        const connection = await pool.getConnection();
        const now = new Date();

        // Buscar TODOS os usuários antes de deletar (para retornar detalhes)
        const [allUsers] = await connection.query(
            `SELECT DISTINCT ymid, request_var as email 
             FROM monetag_postbacks`
        );

        const totalCount = allUsers.length;
        const allDetails = allUsers.map(u => ({
            userId: u.ymid,
            email: u.email || 'N/A'
        }));

        if (totalCount === 0) {
            connection.release();
            console.log('[RESET-ALL] Nenhum usuário encontrado no banco');
            return res.json({
                success: true,
                message: 'Nenhum usuário encontrado para resetar',
                users_reset: 0,
                timestamp: now.toISOString()
            });
        }

        // Deletar TODOS os registros de TODOS os usuários
        await connection.query('DELETE FROM monetag_postbacks');

        connection.release();

        console.log(`[RESET-ALL] ✅ ${totalCount} usuário(s) resetado(s) MANUALMENTE (POST)`);
        allDetails.forEach(u => {
            console.log(`[RESET-ALL]   - ${u.email} (${u.userId})`);
        });

        res.json({
            success: true,
            message: `${totalCount} usuário(s) resetado(s) manualmente`,
            users_reset: totalCount,
            users: allDetails,
            timestamp: now.toISOString()
        });
    } catch (error) {
        console.error('[RESET-ALL] ❌ Erro ao resetar todos os usuários:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro ao resetar todos os usuários',
            details: error.message
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
