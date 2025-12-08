const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivo de persistência
const DATA_FILE = path.join(__dirname, 'data.json');

// Armazenamento em memória
let events = [];
let stats = {};
let userStats = {};  // ✅ Contagem por email do usuário

// ============================================
// CARREGAR DADOS DO ARQUIVO
// ============================================
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(data);
            events = parsed.events || [];
            stats = parsed.stats || {};
            userStats = parsed.userStats || {};  // ✅ Carregar userStats
            console.log('[INIT] ✅ Dados carregados do arquivo');
            console.log('[INIT] Total de eventos:', events.length);
            console.log('[INIT] Zonas com dados:', Object.keys(stats).length);
            console.log('[INIT] Usuários com dados:', Object.keys(userStats).length);
        } else {
            console.log('[INIT] Arquivo de dados não encontrado, iniciando com dados vazios');
        }
    } catch (e) {
        console.error('[INIT] ❌ Erro ao carregar dados:', e.message);
        events = [];
        stats = {};
    }
}

// ============================================
// SALVAR DADOS NO ARQUIVO
// ============================================
function saveData() {
    try {
        const data = {
            events: events,
            stats: stats,
            userStats: userStats,  // ✅ Salvar userStats
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('[SAVE] ✅ Dados salvos no arquivo');
    } catch (e) {
        console.error('[SAVE] ❌ Erro ao salvar dados:', e.message);
    }
}

// Carregar dados ao iniciar
loadData();

// ============================================
// ENDPOINT DE POSTBACK
// ============================================
app.get('/api/postback', (req, res) => {
    const {
        ymid,
        sub_id,
        zone_id,
        sub_zone_id,
        request_var,
        event_type,
        reward_event_type,
        estimated_price
    } = req.query;

    console.log('[POSTBACK] Recebido:');
    console.log('  - event_type:', event_type);
    console.log('  - zone_id:', zone_id);
    console.log('  - ymid:', ymid);
    console.log('  - sub_id:', sub_id);
    console.log('  - estimated_price:', estimated_price);

    // ✅ Aceitar ymid ou sub_id como identificador
    const userId = sub_id || ymid || 'unknown';
    
    console.log('[POSTBACK] ✅ User ID final:', userId);

    // Validação
    if (!zone_id || !userId || !event_type) {
        console.log('[POSTBACK] ❌ Dados inválidos');
        return res.status(400).json({ error: 'Missing required fields: zone_id, user_id (ymid/sub_id), event_type' });
    }

    // Criar estrutura se não existir
    if (!stats[zone_id]) {
        stats[zone_id] = {};
    }
    if (!stats[zone_id][userId]) {
        stats[zone_id][userId] = {
            zone_id: zone_id,
            user_id: userId,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            events: []
        };
    }

    // Atualizar estatísticas
    const userStats = stats[zone_id][userId];
    
    if (event_type === 'impression') {
        userStats.total_impressions++;
    } else if (event_type === 'click') {
        userStats.total_clicks++;
        userStats.total_revenue += parseFloat(estimated_price) || 0;
    }

    // Registrar evento
    const event = {
        timestamp: new Date().toISOString(),
        zone_id: zone_id,
        user_id: userId,
        ymid: ymid,
        sub_id: sub_id,
        event_type: event_type,
        estimated_price: estimated_price,
        reward_event_type: reward_event_type
    };
    
    events.push(event);
    
    // Salvar dados
    saveData();

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[POSTBACK] Estatísticas atualizadas para zona', zone_id);
    console.log('[POSTBACK]   - Impressões:', userStats.total_impressions);
    console.log('[POSTBACK]   - Cliques:', userStats.total_clicks);
    console.log('[POSTBACK]   - Revenue:', userStats.total_revenue);

    res.json({ success: true, message: 'Postback received' });
});

// ============================================
// ENDPOINT DE STATS GLOBAL
// ============================================
app.get('/api/stats', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(stats).forEach(zone => {
        Object.values(zone).forEach(user => {
            total_impressions += user.total_impressions || 0;
            total_clicks += user.total_clicks || 0;
            total_revenue += user.total_revenue || 0;
        });
    });

    res.json({
        total_events: events.length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        zones: Object.keys(stats)
    });
});

// ============================================
// ENDPOINT DE STATS POR ZONA
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    
    if (!stats[zone_id]) {
        return res.json({
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            users: []
        });
    }

    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;
    const users = [];

    Object.values(stats[zone_id]).forEach(user => {
        total_impressions += user.total_impressions || 0;
        total_clicks += user.total_clicks || 0;
        total_revenue += user.total_revenue || 0;
        users.push(user);
    });

    res.json({
        zone_id: zone_id,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        users: users
    });
});

// ============================================
// ENDPOINT DE STATS POR USUÁRIO
// ============================================
app.get('/api/stats/:zone_id/:telegram_id', (req, res) => {
    const { zone_id, telegram_id } = req.params;
    
    console.log(`[STATS] Buscando dados: zone_id=${zone_id}, telegram_id=${telegram_id}`);
    
    // Se não existir dados, retornar estrutura vazia
    if (!stats[zone_id] || !stats[zone_id][telegram_id]) {
        console.log(`[STATS] Nenhum dado encontrado, retornando estrutura vazia`);
        return res.json({
            zone_id: zone_id,
            telegram_id: telegram_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            events: []
        });
    }

    console.log(`[STATS] Dados encontrados:`, stats[zone_id][telegram_id]);
    res.json(stats[zone_id][telegram_id]);
});

// ============================================
// LISTAR EVENTOS
// ============================================
app.get('/api/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const paginatedEvents = events.slice(-limit - offset, -offset || undefined).reverse();

    res.json({
        total: events.length,
        limit: limit,
        offset: offset,
        events: paginatedEvents
    });
});

// ============================================
// DASHBOARD
// ============================================
app.get('/dashboard', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Monetag Postback Server - Dashboard</title>
        <style>
            body { font-family: Arial; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { color: #333; }
            .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
            .stat-box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .stat-number { font-size: 32px; font-weight: bold; color: #2196F3; }
            .stat-label { color: #666; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; background: white; margin: 20px 0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #2196F3; color: white; }
            tr:hover { background: #f5f5f5; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback Server - Dashboard</h1>
            <p>Status: <strong style="color: green;">✅ Online</strong></p>
    `;

    // Estatísticas globais
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(stats).forEach(zone => {
        Object.values(zone).forEach(user => {
            total_impressions += user.total_impressions || 0;
            total_clicks += user.total_clicks || 0;
            total_revenue += user.total_revenue || 0;
        });
    });

    html += `
            <div class="stats">
                <div class="stat-box">
                    <div class="stat-number">${total_impressions}</div>
                    <div class="stat-label">Total de Impressões</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${total_clicks}</div>
                    <div class="stat-label">Total de Cliques</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">$${total_revenue.toFixed(4)}</div>
                    <div class="stat-label">Revenue Total</div>
                </div>
            </div>

            <h2>📈 Dados por Zona e Usuário</h2>
            <table>
                <tr>
                    <th>Zona</th>
                    <th>Telegram ID</th>
                    <th>Impressões</th>
                    <th>Cliques</th>
                    <th>Revenue</th>
                </tr>
    `;

    Object.entries(stats).forEach(([zone_id, zone_data]) => {
        Object.entries(zone_data).forEach(([telegram_id, user_data]) => {
            html += `
                <tr>
                    <td>${zone_id}</td>
                    <td>${telegram_id}</td>
                    <td>${user_data.total_impressions}</td>
                    <td>${user_data.total_clicks}</td>
                    <td>$${user_data.total_revenue.toFixed(4)}</td>
                </tr>
            `;
        });
    });

    html += `
            </table>
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// ============================================
// ENDPOINT: CONTAR IMPRESSÕES E CLIQUES POR EMAIL
// ============================================
app.get('/api/count', (req, res) => {
    const { email, event_type } = req.query;

    console.log('[COUNT] Recebido:');
    console.log('  - email:', email);
    console.log('  - event_type:', event_type);

    // Validação
    if (!email || !event_type) {
        console.log('[COUNT] ❌ Dados inválidos');
        return res.status(400).json({ error: 'Missing required fields: email, event_type' });
    }

    // Criar estrutura se não existir
    if (!userStats[email]) {
        userStats[email] = {
            email: email,
            impressions: 0,
            clicks: 0,
            last_update: null
        };
    }

    // Atualizar contagem
    if (event_type === 'impression') {
        userStats[email].impressions++;
        console.log('[COUNT] ✅ Impressão contada para', email);
    } else if (event_type === 'click') {
        userStats[email].clicks++;
        console.log('[COUNT] ✅ Clique contado para', email);
    } else {
        return res.status(400).json({ error: 'Invalid event_type. Use "impression" or "click"' });
    }

    userStats[email].last_update = new Date().toISOString();

    // Salvar dados
    saveData();

    console.log('[COUNT] Estatísticas atualizadas:');
    console.log('  - Impressões:', userStats[email].impressions);
    console.log('  - Cliques:', userStats[email].clicks);

    res.json({ 
        success: true, 
        message: `${event_type} contado com sucesso`,
        stats: userStats[email]
    });
});

// ============================================
// ENDPOINT: BUSCAR ESTATÍSTICAS POR EMAIL
// ============================================
app.get('/api/user-stats', (req, res) => {
    const { email } = req.query;

    console.log('[USER-STATS] Buscando estatísticas para:', email);

    if (!email) {
        return res.status(400).json({ error: 'Missing required field: email' });
    }

    // Retornar estatísticas ou valores zerados
    const stats = userStats[email] || {
        email: email,
        impressions: 0,
        clicks: 0,
        last_update: null
    };

    console.log('[USER-STATS] Estatísticas:');
    console.log('  - Impressões:', stats.impressions);
    console.log('  - Cliques:', stats.clicks);

    res.json(stats);
});

// ============================================
// ENDPOINT: RESETAR ESTATÍSTICAS POR EMAIL
// ============================================
app.post('/api/reset-user-stats', (req, res) => {
    const { email } = req.query;

    console.log('[RESET] Resetando estatísticas para:', email);

    if (!email) {
        return res.status(400).json({ error: 'Missing required field: email' });
    }

    // Resetar estatísticas
    userStats[email] = {
        email: email,
        impressions: 0,
        clicks: 0,
        last_update: new Date().toISOString()
    };

    // Salvar dados
    saveData();

    console.log('[RESET] ✅ Estatísticas resetadas para', email);

    res.json({ 
        success: true, 
        message: 'Estatísticas resetadas com sucesso',
        stats: userStats[email]
    });
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Monetag Postback Server rodando em http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📝 Dados persistidos em: ${DATA_FILE}\n`);
});
