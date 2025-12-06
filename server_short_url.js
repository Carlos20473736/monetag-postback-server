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
// ENDPOINT DE POSTBACK - URL CURTA
// ============================================
/**
 * Aceita postbacks com parâmetros essenciais:
 * - ymid: ID do usuário
 * - zone_id: ID da zona
 * - event_type: impression ou click
 * - estimated_price: Valor em USD
 * 
 * Parâmetros opcionais:
 * - sub_zone_id, request_var, telegram_id, reward_event_type
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

    // Validar parâmetros obrigatórios
    if (!event_type || !zone_id) {
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

    // Responder com sucesso
    res.json({
        success: true,
        message: `Postback de ${event_type} recebido`,
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
    req.query = req.body;
    return app._router.stack.find(r => r.route && r.route.path === '/api/postback').route.stack[0].handle(req, res);
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
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
        return res.status(404).json({ error: 'Zone not found' });
    }

    res.json(stats[zone_id]);
});

// ============================================
// LISTAR EVENTOS
// ============================================
app.get('/api/events', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const paginatedEvents = events.slice(-limit).reverse();
    res.json({
        total: events.length,
        events: paginatedEvents
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
        <title>Monetag Postback</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', sans-serif; background: #0f0f23; color: #fff; padding: 20px; }
            .container { max-width: 1200px; margin: 0 auto; }
            h1 { margin-bottom: 30px; color: #00ddff; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: rgba(139, 92, 246, 0.1); border: 2px solid #8b5cf6; border-radius: 8px; padding: 20px; text-align: center; }
            .stat-value { font-size: 2.5em; font-weight: bold; color: #00ddff; }
            .stat-label { color: #a0aec0; margin-top: 10px; }
            .zone-card { background: rgba(0, 0, 0, 0.5); border: 1px solid #8b5cf6; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
            .zone-title { color: #00ddff; font-weight: bold; margin-bottom: 10px; }
            .zone-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .zone-stat { background: rgba(139, 92, 246, 0.1); padding: 10px; border-radius: 4px; text-align: center; }
            .zone-stat-value { font-size: 1.5em; color: #fbbf24; }
            .zone-stat-label { font-size: 0.8em; color: #a0aec0; }
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
                    <div class="stat-label">Revenue</div>
                </div>
            </div>

            ${summary.zones.length > 0 ? `
            <h2 style="color: #00ddff; margin-bottom: 15px;">📍 Zonas</h2>
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
                            <div class="zone-stat-label">Pagos</div>
                        </div>
                    </div>
                </div>
            `).join('')}
            ` : '<p>Nenhum evento recebido ainda</p>'}
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
    console.log('🚀 Servidor Monetag Postback Online');
    console.log(`📍 http://localhost:${PORT}/api/postback`);
});

module.exports = app;
