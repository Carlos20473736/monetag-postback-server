const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazenamento em memória
const events = [];
// Estrutura: stats[zone_id][telegram_id] = { impressions, clicks, revenue, ... }
const stats = {};

// ============================================
// ENDPOINT DE POSTBACK - EXATAMENTE COMO MONETAG ENVIA
// ============================================
/**
 * Aceita postbacks do Monetag com os seguintes macros:
 * - {ymid} - ID do usuário
 * - {zone_id} - ID da zona
 * - {sub_zone_id} - Zona que serviu o anúncio
 * - {request_var} - Identificador de placement
 * - {telegram_id} - ID do Telegram (CHAVE PARA DIFERENCIAR USUÁRIOS)
 * - {event_type} - impression ou click
 * - {reward_event_type} - valued ou not_valued
 * - {estimated_price} - Valor em USD
 */
app.get('/api/postback', (req, res) => {
    const {
        ymid,
        zone_id,
        sub_zone_id,
        request_var,
        telegram_id,
        event_type,
        reward_event_type,
        estimated_price
    } = req.query;

    console.log('[POSTBACK] Recebido:');
    console.log('  ymid:', ymid);
    console.log('  zone_id:', zone_id);
    console.log('  sub_zone_id:', sub_zone_id);
    console.log('  request_var:', request_var);
    console.log('  telegram_id:', telegram_id);
    console.log('  event_type:', event_type);
    console.log('  reward_event_type:', reward_event_type);
    console.log('  estimated_price:', estimated_price);

    // Validar parâmetros obrigatórios
    if (!event_type || !zone_id || !telegram_id) {
        console.log('[POSTBACK] ❌ Parâmetros obrigatórios faltando (telegram_id é obrigatório)');
        return res.status(400).json({
            success: false,
            error: 'Missing required parameters: event_type, zone_id, telegram_id'
        });
    }

    // Criar evento
    const event = {
        id: events.length + 1,
        ymid: ymid || null,
        zone_id: zone_id,
        sub_zone_id: sub_zone_id || null,
        request_var: request_var || null,
        telegram_id: telegram_id,
        event_type: event_type,
        reward_event_type: reward_event_type || 'valued',
        estimated_price: parseFloat(estimated_price) || 0,
        timestamp: new Date().toISOString(),
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    };

    // Armazenar evento
    events.push(event);

    // Inicializar estrutura se não existir
    if (!stats[zone_id]) {
        stats[zone_id] = {};
    }

    // Inicializar dados do usuário (por telegram_id) se não existir
    if (!stats[zone_id][telegram_id]) {
        stats[zone_id][telegram_id] = {
            zone_id: zone_id,
            telegram_id: telegram_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0
        };
    }

    // Contar eventos por usuário
    if (event_type === 'impression') {
        stats[zone_id][telegram_id].total_impressions++;
    } else if (event_type === 'click') {
        stats[zone_id][telegram_id].total_clicks++;
    }

    // Contar revenue por usuário
    if (reward_event_type === 'valued') {
        stats[zone_id][telegram_id].valued_events++;
        stats[zone_id][telegram_id].total_revenue += event.estimated_price;
    } else {
        stats[zone_id][telegram_id].not_valued_events++;
    }

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[STATS] Zona', zone_id, '| Telegram ID:', telegram_id, '- Impressões:', stats[zone_id][telegram_id].total_impressions, 'Cliques:', stats[zone_id][telegram_id].total_clicks);

    // Responder com sucesso
    res.json({
        success: true,
        message: `Postback de ${event_type} recebido com sucesso`,
        data: {
            id: event.id,
            event_type: event_type,
            zone_id: zone_id,
            telegram_id: telegram_id,
            timestamp: event.timestamp
        }
    });
});

// ============================================
// ENDPOINT POST (alternativa)
// ============================================
app.post('/api/postback', (req, res) => {
    // Converter POST para GET para reutilizar lógica
    req.query = req.body;
    return app._router.stack.find(r => r.route && r.route.path === '/api/postback').route.stack[0].handle(req, res);
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// ESTATÍSTICAS GERAIS
// ============================================
app.get('/api/stats', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;
    let total_valued = 0;
    let total_not_valued = 0;

    // Somar todos os usuários de todas as zonas
    for (const zone_id in stats) {
        for (const telegram_id in stats[zone_id]) {
            const userStats = stats[zone_id][telegram_id];
            total_impressions += userStats.total_impressions;
            total_clicks += userStats.total_clicks;
            total_revenue += userStats.total_revenue;
            total_valued += userStats.valued_events;
            total_not_valued += userStats.not_valued_events;
        }
    }

    const summary = {
        total_events: events.length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        valued_events: total_valued,
        not_valued_events: total_not_valued,
        zones_count: Object.keys(stats).length,
        by_zone: stats
    };

    res.json(summary);
});

// ============================================
// ESTATÍSTICAS POR ZONA
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    const { telegram_id } = req.query;
    
    if (!stats[zone_id]) {
        return res.status(404).json({
            success: false,
            error: 'Zone not found'
        });
    }

    // Se telegram_id foi fornecido, retornar dados apenas desse usuário
    if (telegram_id) {
        if (!stats[zone_id][telegram_id]) {
            return res.status(404).json({
                success: false,
                error: 'User not found in this zone'
            });
        }
        return res.json(stats[zone_id][telegram_id]);
    }

    // Senão, retornar dados de todos os usuários da zona
    const zoneStats = {
        zone_id: zone_id,
        total_impressions: 0,
        total_clicks: 0,
        total_revenue: 0,
        users: []
    };

    for (const uid in stats[zone_id]) {
        const userStats = stats[zone_id][uid];
        zoneStats.total_impressions += userStats.total_impressions;
        zoneStats.total_clicks += userStats.total_clicks;
        zoneStats.total_revenue += userStats.total_revenue;
        zoneStats.users.push(userStats);
    }

    res.json(zoneStats);
});

// ============================================
// ENDPOINT ESPECÍFICO PARA USUÁRIO
// ============================================
app.get('/api/stats/:zone_id/:telegram_id', (req, res) => {
    const { zone_id, telegram_id } = req.params;
    
    console.log(`[STATS] Buscando dados: zone_id=${zone_id}, telegram_id=${telegram_id}`);
    
    // Se nao existir dados, retornar estrutura vazia
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
// FILTRAR EVENTOS POR TIPO
// ============================================
app.get('/api/events/:type', (req, res) => {
    const { type } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const filtered = events
        .filter(e => e.event_type === type)
        .slice(-limit)
        .reverse();

    res.json({
        event_type: type,
        total: filtered.length,
        events: filtered
    });
});

// ============================================
// FILTRAR EVENTOS POR ZONA
// ============================================
app.get('/api/events/zone/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const filtered = events
        .filter(e => e.zone_id === zone_id)
        .slice(-limit)
        .reverse();

    res.json({
        zone_id: zone_id,
        total: filtered.length,
        events: filtered
    });
});

// ============================================
// FILTRAR EVENTOS POR TELEGRAM ID
// ============================================
app.get('/api/events/user/:telegram_id', (req, res) => {
    const { telegram_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const filtered = events
        .filter(e => e.telegram_id === telegram_id)
        .slice(-limit)
        .reverse();

    res.json({
        telegram_id: telegram_id,
        total: filtered.length,
        events: filtered
    });
});

// ============================================
// DASHBOARD HTML
// ============================================
app.get('/dashboard', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    for (const zone_id in stats) {
        for (const telegram_id in stats[zone_id]) {
            const userStats = stats[zone_id][telegram_id];
            total_impressions += userStats.total_impressions;
            total_clicks += userStats.total_clicks;
            total_revenue += userStats.total_revenue;
        }
    }

    const summary = {
        total_events: events.length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        zones: stats
    };

    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monetag Postback Dashboard</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f0f23; color: #fff; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            h1 { margin-bottom: 30px; color: #00ddff; text-shadow: 0 0 10px rgba(0, 221, 255, 0.5); }
            h2 { margin-top: 30px; margin-bottom: 15px; color: #00ddff; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: rgba(139, 92, 246, 0.1); border: 2px solid #8b5cf6; border-radius: 8px; padding: 20px; text-align: center; }
            .stat-value { font-size: 2.5em; font-weight: bold; color: #00ddff; }
            .stat-label { color: #a0aec0; margin-top: 10px; }
            .zones-section { margin-top: 30px; }
            .zone-card { background: rgba(0, 0, 0, 0.5); border: 1px solid #8b5cf6; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
            .zone-title { color: #00ddff; font-weight: bold; margin-bottom: 15px; font-size: 1.2em; }
            .users-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; }
            .user-card { background: rgba(139, 92, 246, 0.05); border: 1px solid #8b5cf6; border-radius: 6px; padding: 12px; }
            .user-id { color: #fbbf24; font-size: 0.85em; word-break: break-all; margin-bottom: 8px; font-family: monospace; }
            .user-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
            .user-stat { background: rgba(139, 92, 246, 0.1); padding: 8px; border-radius: 4px; text-align: center; }
            .user-stat-value { font-size: 1.3em; color: #fbbf24; font-weight: bold; }
            .user-stat-label { font-size: 0.75em; color: #a0aec0; }
            .refresh-info { text-align: center; color: #a0aec0; margin-top: 30px; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback Dashboard (Por Usuário)</h1>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${summary.total_events}</div>
                    <div class="stat-label">Total de Eventos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${total_impressions}</div>
                    <div class="stat-label">Impressões</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${total_clicks}</div>
                    <div class="stat-label">Cliques</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">$${total_revenue.toFixed(4)}</div>
                    <div class="stat-label">Revenue Total</div>
                </div>
            </div>

            <div class="zones-section">
                <h2>📍 Estatísticas por Zona e Usuário</h2>
                ${Object.keys(summary.zones).map(zone_id => `
                    <div class="zone-card">
                        <div class="zone-title">Zona ${zone_id}</div>
                        <div class="users-grid">
                            ${Object.keys(summary.zones[zone_id]).map(telegram_id => {
                                const userStats = summary.zones[zone_id][telegram_id];
                                return `
                                    <div class="user-card">
                                        <div class="user-id">👤 ${telegram_id}</div>
                                        <div class="user-stats">
                                            <div class="user-stat">
                                                <div class="user-stat-value">${userStats.total_impressions}</div>
                                                <div class="user-stat-label">Impressões</div>
                                            </div>
                                            <div class="user-stat">
                                                <div class="user-stat-value">${userStats.total_clicks}</div>
                                                <div class="user-stat-label">Cliques</div>
                                            </div>
                                            <div class="user-stat">
                                                <div class="user-stat-value">$${userStats.total_revenue.toFixed(4)}</div>
                                                <div class="user-stat-label">Revenue</div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="refresh-info">
                <p>🔄 Dashboard atualiza em tempo real</p>
                <p>Última atualização: ${new Date().toLocaleString('pt-BR')}</p>
            </div>
        </div>
    </body>
    </html>
    `;

    res.send(html);
});

// ============================================
// RESET (para testes)
// ============================================
app.post('/api/reset', (req, res) => {
    events.length = 0;
    for (const key in stats) {
        delete stats[key];
    }
    console.log('[RESET] ✅ Dados resetados');
    res.json({ success: true, message: 'Dados resetados com sucesso' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Servidor de Postback Monetag iniciado na porta ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔗 API: http://localhost:${PORT}/api/postback`);
    console.log(`💾 Dados isolados por Telegram ID`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;
