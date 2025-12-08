const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazenamento em memória
const events = [];
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
 * - {telegram_id} - ID do Telegram
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
    if (!event_type || !zone_id) {
        console.log('[POSTBACK] ❌ Parâmetros obrigatórios faltando');
        return res.status(400).json({
            success: false,
            error: 'Missing required parameters: event_type, zone_id'
        });
    }

    // Criar evento
    const event = {
        id: events.length + 1,
        ymid: ymid || null,
        zone_id: zone_id,
        sub_zone_id: sub_zone_id || null,
        request_var: request_var || null,
        telegram_id: telegram_id || null,
        event_type: event_type,
        reward_event_type: reward_event_type || 'valued',
        estimated_price: parseFloat(estimated_price) || 0,
        timestamp: new Date().toISOString(),
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    };

    // Armazenar evento
    events.push(event);

    // Atualizar estatísticas por zona
    if (!stats[zone_id]) {
        stats[zone_id] = {
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0
        };
    }

    // Contar eventos
    if (event_type === 'impression') {
        stats[zone_id].total_impressions++;
    } else if (event_type === 'click') {
        stats[zone_id].total_clicks++;
    }

    // Contar revenue
    if (reward_event_type === 'valued') {
        stats[zone_id].valued_events++;
        stats[zone_id].total_revenue += event.estimated_price;
    } else {
        stats[zone_id].not_valued_events++;
    }

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[STATS] Zona', zone_id, '- Impressões:', stats[zone_id].total_impressions, 'Cliques:', stats[zone_id].total_clicks);

    // Responder com sucesso
    res.json({
        success: true,
        message: `Postback de ${event_type} recebido com sucesso`,
        data: {
            id: event.id,
            event_type: event_type,
            zone_id: zone_id,
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
    const summary = {
        total_events: events.length,
        total_impressions: Object.values(stats).reduce((sum, s) => sum + s.total_impressions, 0),
        total_clicks: Object.values(stats).reduce((sum, s) => sum + s.total_clicks, 0),
        total_revenue: Object.values(stats).reduce((sum, s) => sum + s.total_revenue, 0),
        valued_events: Object.values(stats).reduce((sum, s) => sum + s.valued_events, 0),
        not_valued_events: Object.values(stats).reduce((sum, s) => sum + s.not_valued_events, 0),
        zones_count: Object.keys(stats).length,
        by_zone: Object.values(stats)
    };

    res.json(summary);
});

// ============================================
// ESTATÍSTICAS POR ZONA
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    
    if (!stats[zone_id]) {
        return res.status(404).json({
            success: false,
            error: 'Zone not found'
        });
    }

    res.json(stats[zone_id]);
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
// DASHBOARD HTML
// ============================================
app.get('/dashboard', (req, res) => {
    const summary = {
        total_events: events.length,
        total_impressions: Object.values(stats).reduce((sum, s) => sum + s.total_impressions, 0),
        total_clicks: Object.values(stats).reduce((sum, s) => sum + s.total_clicks, 0),
        total_revenue: Object.values(stats).reduce((sum, s) => sum + s.total_revenue, 0),
        zones: Object.values(stats)
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
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { margin-bottom: 30px; color: #00ddff; text-shadow: 0 0 10px rgba(0, 221, 255, 0.5); }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: rgba(139, 92, 246, 0.1); border: 2px solid #8b5cf6; border-radius: 8px; padding: 20px; text-align: center; }
            .stat-value { font-size: 2.5em; font-weight: bold; color: #00ddff; }
            .stat-label { color: #a0aec0; margin-top: 10px; }
            .zones-section { margin-top: 30px; }
            .zone-card { background: rgba(0, 0, 0, 0.5); border: 1px solid #8b5cf6; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
            .zone-title { color: #00ddff; font-weight: bold; margin-bottom: 10px; }
            .zone-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .zone-stat { background: rgba(139, 92, 246, 0.1); padding: 10px; border-radius: 4px; text-align: center; }
            .zone-stat-value { font-size: 1.5em; color: #fbbf24; }
            .zone-stat-label { font-size: 0.8em; color: #a0aec0; }
            .refresh-info { text-align: center; color: #a0aec0; margin-top: 30px; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback Dashboard</h1>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${summary.total_events}</div>
                    <div class="stat-label">Total de Eventos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${summary.total_impressions}</div>
                    <div class="stat-label">Impressões</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${summary.total_clicks}</div>
                    <div class="stat-label">Cliques</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">$${summary.total_revenue.toFixed(4)}</div>
                    <div class="stat-label">Revenue Total</div>
                </div>
            </div>

            <div class="zones-section">
                <h2 style="color: #00ddff; margin-bottom: 15px;">📍 Estatísticas por Zona</h2>
                ${summary.zones.map(zone => `
                    <div class="zone-card">
                        <div class="zone-title">Zona ${zone.zone_id}</div>
                        <div class="zone-stats">
                            <div class="zone-stat">
                                <div class="zone-stat-value">${zone.total_impressions}</div>
                                <div class="zone-stat-label">Impressões</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">${zone.total_clicks}</div>
                                <div class="zone-stat-label">Cliques</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">$${zone.total_revenue.toFixed(4)}</div>
                                <div class="zone-stat-label">Revenue</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">${zone.valued_events}</div>
                                <div class="zone-stat-label">Eventos Pagos</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="refresh-info">
                <p>🔄 Dashboard atualiza automaticamente a cada 5 segundos</p>
                <p>Última atualização: ${new Date().toLocaleString('pt-BR')}</p>
            </div>
        </div>
        <script>
            setInterval(() => location.reload(), 5000);
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('🚀 Servidor de Postback Monetag Iniciado');
    console.log('='.repeat(50));
    console.log(`📍 Porta: ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📈 Stats: http://localhost:${PORT}/api/stats`);
    console.log('='.repeat(50));
    console.log('✅ Aceita os seguintes macros do Monetag:');
    console.log('   - {ymid} - ID do usuário');
    console.log('   - {zone_id} - ID da zona');
    console.log('   - {sub_zone_id} - Zona que serviu');
    console.log('   - {request_var} - Identificador de placement');
    console.log('   - {telegram_id} - ID do Telegram');
    console.log('   - {event_type} - impression ou click');
    console.log('   - {reward_event_type} - valued ou not_valued');
    console.log('   - {estimated_price} - Valor em USD');
    console.log('='.repeat(50));
});

module.exports = app;
