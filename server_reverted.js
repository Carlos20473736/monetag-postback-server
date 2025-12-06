const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// ARMAZENAMENTO EM MEMÓRIA
// ============================================
const events = [];
const zoneStats = {};

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor de postback Monetag funcionando' });
});

// ============================================
// RECEBER POSTBACK
// ============================================
app.get('/api/postback', (req, res) => {
    const {
        event_type,
        zone_id,
        ymid,
        user_email,
        estimated_price,
        sub_zone_id,
        request_var,
        telegram_id,
        reward_event_type
    } = req.query;

    console.log('[POSTBACK] Recebido:');
    console.log('  - event_type:', event_type);
    console.log('  - zone_id:', zone_id);
    console.log('  - ymid:', ymid);
    console.log('  - user_email:', user_email);
    console.log('  - estimated_price:', estimated_price);

    // Validar parâmetros obrigatórios
    if (!event_type || !zone_id) {
        return res.status(400).json({
            success: false,
            error: 'Parâmetros obrigatórios faltando: event_type, zone_id'
        });
    }

    // Criar evento
    const event = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        event_type: event_type,
        zone_id: zone_id,
        ymid: ymid || 'unknown',
        user_email: user_email || 'unknown',
        estimated_price: parseFloat(estimated_price) || 0,
        sub_zone_id: sub_zone_id || null,
        request_var: request_var || null,
        telegram_id: telegram_id || null,
        reward_event_type: reward_event_type || 'not_valued',
        ip: req.ip,
        user_agent: req.get('user-agent'),
        timestamp: new Date().toISOString()
    };

    // Armazenar evento
    events.push(event);

    // Atualizar estatísticas por zona
    if (!zoneStats[zone_id]) {
        zoneStats[zone_id] = {
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        };
    }

    const stats = zoneStats[zone_id];
    if (event_type === 'impression') {
        stats.total_impressions++;
    } else if (event_type === 'click') {
        stats.total_clicks++;
    }

    stats.total_revenue += event.estimated_price;
    if (reward_event_type === 'valued') {
        stats.valued_events++;
    } else {
        stats.not_valued_events++;
    }
    stats.last_update = new Date().toISOString();

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[POSTBACK] Estatísticas atualizadas para zona', zone_id);

    res.json({
        success: true,
        message: `Postback de ${event_type} recebido com sucesso`,
        event_id: event.id,
        zone_id: zone_id
    });
});

// ============================================
// ESTATÍSTICAS GERAIS
// ============================================
app.get('/api/stats', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;
    let total_events = 0;

    Object.values(zoneStats).forEach(zone => {
        total_impressions += zone.total_impressions;
        total_clicks += zone.total_clicks;
        total_revenue += zone.total_revenue;
        total_events += (zone.total_impressions + zone.total_clicks);
    });

    res.json({
        total_events: total_events,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        zones: Object.values(zoneStats)
    });
});

// ============================================
// ESTATÍSTICAS POR ZONA (ENDPOINT PRINCIPAL)
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;

    // Se zona não tem dados, retornar 0
    if (!zoneStats[zone_id]) {
        return res.json({
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        });
    }

    res.json(zoneStats[zone_id]);
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
// LISTAR EVENTOS POR ZONA
// ============================================
app.get('/api/events/:zone_id', (req, res) => {
    const { zone_id } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const zoneEvents = events
        .filter(e => e.zone_id === zone_id)
        .slice(-limit)
        .reverse();

    res.json({
        zone_id: zone_id,
        total: zoneEvents.length,
        events: zoneEvents
    });
});

// ============================================
// RESET DE DADOS (ADMIN)
// ============================================
app.post('/api/admin/reset', (req, res) => {
    const eventsCleared = events.length;
    const zonesCleared = Object.keys(zoneStats).length;

    // Limpar dados
    events.length = 0;
    Object.keys(zoneStats).forEach(key => delete zoneStats[key]);

    console.log('[ADMIN] Dados resetados');
    console.log('[ADMIN] Eventos limpos:', eventsCleared);
    console.log('[ADMIN] Zonas limpas:', zonesCleared);

    res.json({
        success: true,
        message: 'Todos os dados foram resetados com sucesso',
        data: {
            events_cleared: eventsCleared,
            zones_cleared: zonesCleared,
            timestamp: new Date().toISOString()
        }
    });
});

// ============================================
// RESET DE ZONA ESPECÍFICA (ADMIN)
// ============================================
app.post('/api/admin/reset/:zone_id', (req, res) => {
    const { zone_id } = req.params;

    // Remover eventos da zona
    const beforeCount = events.length;
    events.splice(0, events.length, ...events.filter(e => e.zone_id !== zone_id));
    const eventsCleared = beforeCount - events.length;

    // Remover estatísticas da zona
    const hadStats = !!zoneStats[zone_id];
    delete zoneStats[zone_id];

    console.log('[ADMIN] Zona resetada:', zone_id);
    console.log('[ADMIN] Eventos removidos:', eventsCleared);

    res.json({
        success: true,
        message: `Zona ${zone_id} foi resetada com sucesso`,
        data: {
            zone_id: zone_id,
            events_cleared: eventsCleared,
            had_stats: hadStats,
            timestamp: new Date().toISOString()
        }
    });
});

// ============================================
// DASHBOARD HTML
// ============================================
app.get('/dashboard', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(zoneStats).forEach(zone => {
        total_impressions += zone.total_impressions;
        total_clicks += zone.total_clicks;
        total_revenue += zone.total_revenue;
    });

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Monetag Postback Dashboard</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: #f5f5f5;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                border-bottom: 2px solid #667eea;
                padding-bottom: 10px;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }
            .stat-card {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 8px;
                text-align: center;
            }
            .stat-value {
                font-size: 32px;
                font-weight: bold;
                margin: 10px 0;
            }
            .stat-label {
                font-size: 14px;
                opacity: 0.9;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
            }
            th, td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #ddd;
            }
            th {
                background-color: #f8f9fa;
                font-weight: bold;
            }
            tr:hover {
                background-color: #f5f5f5;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback Dashboard</h1>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-label">Total de Impressões</div>
                    <div class="stat-value">${total_impressions}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total de Cliques</div>
                    <div class="stat-value">${total_clicks}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Revenue Total</div>
                    <div class="stat-value">$${total_revenue.toFixed(4)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">CTR</div>
                    <div class="stat-value">${total_impressions > 0 ? ((total_clicks / total_impressions) * 100).toFixed(2) : 0}%</div>
                </div>
            </div>

            <h2>Estatísticas por Zona</h2>
            <table>
                <thead>
                    <tr>
                        <th>Zone ID</th>
                        <th>Impressões</th>
                        <th>Cliques</th>
                        <th>Revenue</th>
                        <th>CTR</th>
                        <th>Última Atualização</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.values(zoneStats).map(zone => `
                        <tr>
                            <td><strong>${zone.zone_id}</strong></td>
                            <td>${zone.total_impressions}</td>
                            <td>${zone.total_clicks}</td>
                            <td>$${zone.total_revenue.toFixed(4)}</td>
                            <td>${zone.total_impressions > 0 ? ((zone.total_clicks / zone.total_impressions) * 100).toFixed(2) : 0}%</td>
                            <td>${new Date(zone.last_update).toLocaleString('pt-BR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <h2>Últimos Eventos (${events.length} total)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Tipo</th>
                        <th>Zone ID</th>
                        <th>User ID</th>
                        <th>Email</th>
                        <th>Valor</th>
                    </tr>
                </thead>
                <tbody>
                    ${events.slice(-50).reverse().map(event => `
                        <tr>
                            <td>${new Date(event.timestamp).toLocaleString('pt-BR')}</td>
                            <td><strong>${event.event_type}</strong></td>
                            <td>${event.zone_id}</td>
                            <td>${event.ymid}</td>
                            <td>${event.user_email}</td>
                            <td>$${event.estimated_price.toFixed(4)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <p style="margin-top: 20px; color: #666; font-size: 12px;">
                Última atualização: ${new Date().toLocaleString('pt-BR')}
            </p>
        </div>
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
    console.log(`[SERVER] ✅ Servidor de postback Monetag iniciado na porta ${PORT}`);
    console.log(`[SERVER] 📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`[SERVER] 🔗 Postback URL: http://localhost:${PORT}/api/postback`);
    console.log(`[SERVER] 📈 Stats URL: http://localhost:${PORT}/api/stats/:zone_id`);
});
