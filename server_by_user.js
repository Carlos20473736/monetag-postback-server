const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazenamento em memória
const events = [];
const userStats = {}; // Estatísticas agrupadas por email

// ============================================
// ENDPOINT DE POSTBACK - COM EMAIL DO USUÁRIO
// ============================================
/**
 * Aceita postbacks com parâmetros essenciais + email:
 * - ymid: ID do usuário
 * - zone_id: ID da zona
 * - event_type: impression ou click
 * - estimated_price: Valor em USD
 * - user_email: EMAIL DO USUÁRIO (novo parâmetro)
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
        estimated_price,
        user_email
    } = req.query;

    // Validar parâmetros obrigatórios
    if (!event_type || !zone_id || !user_email) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameters: event_type, zone_id, user_email'
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
        user_email: user_email, // ✅ SALVAR EMAIL DO USUÁRIO
        timestamp: new Date().toISOString(),
        ip_address: req.ip,
        user_agent: req.get('user-agent')
    };

    // Armazenar evento
    events.push(event);

    // ============================================
    // ATUALIZAR ESTATÍSTICAS POR USUÁRIO
    // ============================================
    if (!userStats[user_email]) {
        userStats[user_email] = {
            user_email: user_email,
            zones: {}
        };
    }

    // Garantir que a zona existe para este usuário
    if (!userStats[user_email].zones[zone_id]) {
        userStats[user_email].zones[zone_id] = {
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        };
    }

    // Contar eventos por tipo
    if (event_type === 'impression') {
        userStats[user_email].zones[zone_id].total_impressions++;
    } else if (event_type === 'click') {
        userStats[user_email].zones[zone_id].total_clicks++;
    }

    // Contar revenue
    if (reward_event_type === 'valued') {
        userStats[user_email].zones[zone_id].valued_events++;
        userStats[user_email].zones[zone_id].total_revenue += event.estimated_price;
    } else {
        userStats[user_email].zones[zone_id].not_valued_events++;
    }

    // Atualizar timestamp
    userStats[user_email].zones[zone_id].last_update = new Date().toISOString();

    console.log(`[POSTBACK] ✅ ${event_type} recebido para ${user_email}`);

    // Responder com sucesso
    res.json({
        success: true,
        message: `Postback de ${event_type} recebido para ${user_email}`,
        data: {
            id: event.id,
            event_type: event_type,
            zone_id: zone_id,
            user_email: user_email,
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
// ESTATÍSTICAS GERAIS (todos os usuários)
// ============================================
app.get('/api/stats', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(userStats).forEach(user => {
        Object.values(user.zones).forEach(zone => {
            total_impressions += zone.total_impressions;
            total_clicks += zone.total_clicks;
            total_revenue += zone.total_revenue;
        });
    });

    const summary = {
        total_events: events.length,
        total_users: Object.keys(userStats).length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        users: Object.values(userStats).map(user => ({
            user_email: user.user_email,
            zones: Object.values(user.zones)
        }))
    };

    res.json(summary);
});

// ============================================
// ESTATÍSTICAS POR USUÁRIO (email)
// ============================================
app.get('/api/stats/user/:email', (req, res) => {
    const { email } = req.params;
    
    if (!userStats[email]) {
        return res.status(404).json({
            success: false,
            error: `Nenhum dado encontrado para o usuário: ${email}`
        });
    }

    const userEmail = decodeURIComponent(email);
    if (!userStats[userEmail]) {
        return res.status(404).json({
            success: false,
            error: `Nenhum dado encontrado para o usuário: ${userEmail}`
        });
    }

    const user = userStats[userEmail];
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(user.zones).forEach(zone => {
        total_impressions += zone.total_impressions;
        total_clicks += zone.total_clicks;
        total_revenue += zone.total_revenue;
    });

    res.json({
        user_email: userEmail,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        zones: Object.values(user.zones)
    });
});

// ============================================
// ESTATÍSTICAS POR ZONA E USUÁRIO
// ============================================
app.get('/api/stats/user/:email/zone/:zone_id', (req, res) => {
    const { email, zone_id } = req.params;
    const userEmail = decodeURIComponent(email);
    
    if (!userStats[userEmail] || !userStats[userEmail].zones[zone_id]) {
        return res.status(404).json({
            success: false,
            error: `Nenhum dado encontrado para ${userEmail} na zona ${zone_id}`
        });
    }

    res.json(userStats[userEmail].zones[zone_id]);
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
// LISTAR EVENTOS POR USUÁRIO
// ============================================
app.get('/api/events/user/:email', (req, res) => {
    const { email } = req.params;
    const userEmail = decodeURIComponent(email);
    const limit = parseInt(req.query.limit) || 100;
    
    const userEvents = events
        .filter(e => e.user_email === userEmail)
        .slice(-limit)
        .reverse();

    res.json({
        user_email: userEmail,
        total: userEvents.length,
        events: userEvents
    });
});

// ============================================
// DASHBOARD HTML
// ============================================
app.get('/dashboard', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;

    Object.values(userStats).forEach(user => {
        Object.values(user.zones).forEach(zone => {
            total_impressions += zone.total_impressions;
            total_clicks += zone.total_clicks;
            total_revenue += zone.total_revenue;
        });
    });

    const summary = {
        total_events: events.length,
        total_users: Object.keys(userStats).length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        users: Object.values(userStats)
    };

    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Monetag Postback - Por Usuário</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', sans-serif; background: #0f0f23; color: #fff; padding: 20px; }
            .container { max-width: 1400px; margin: 0 auto; }
            h1 { margin-bottom: 30px; color: #00ddff; }
            h2 { margin-top: 30px; margin-bottom: 15px; color: #fbbf24; font-size: 1.3em; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: rgba(139, 92, 246, 0.1); border: 2px solid #8b5cf6; border-radius: 8px; padding: 20px; text-align: center; }
            .stat-value { font-size: 2.5em; font-weight: bold; color: #00ddff; }
            .stat-label { color: #a0aec0; margin-top: 10px; }
            .user-card { background: rgba(0, 0, 0, 0.5); border: 2px solid #10b981; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
            .user-email { color: #10b981; font-weight: bold; font-size: 1.1em; margin-bottom: 15px; }
            .user-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 15px; }
            .user-stat { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 4px; text-align: center; }
            .user-stat-value { font-size: 1.8em; color: #fbbf24; font-weight: bold; }
            .user-stat-label { font-size: 0.9em; color: #a0aec0; margin-top: 5px; }
            .zone-info { background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 Monetag Postback - Rastreamento por Usuário</h1>
            
            <h2>📈 Estatísticas Gerais</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${summary.total_events}</div>
                    <div class="stat-label">Total de Eventos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${summary.total_users}</div>
                    <div class="stat-label">Total de Usuários</div>
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

            ${summary.users.length > 0 ? `
            <h2>👥 Dados por Usuário</h2>
            ${summary.users.map(user => {
                let user_impressions = 0;
                let user_clicks = 0;
                let user_revenue = 0;
                Object.values(user.zones).forEach(zone => {
                    user_impressions += zone.total_impressions;
                    user_clicks += zone.total_clicks;
                    user_revenue += zone.total_revenue;
                });
                return `
                <div class="user-card">
                    <div class="user-email">📧 ${user.user_email}</div>
                    <div class="user-stats">
                        <div class="user-stat">
                            <div class="user-stat-value">${user_impressions}</div>
                            <div class="user-stat-label">Impressões</div>
                        </div>
                        <div class="user-stat">
                            <div class="user-stat-value">${user_clicks}</div>
                            <div class="user-stat-label">Cliques</div>
                        </div>
                        <div class="user-stat">
                            <div class="user-stat-value">$${user_revenue.toFixed(4)}</div>
                            <div class="user-stat-label">Revenue</div>
                        </div>
                    </div>
                    <div class="zone-info">
                        <strong>Zonas:</strong> ${Object.keys(user.zones).join(', ')}
                    </div>
                </div>
                `;
            }).join('')}
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
    console.log('🚀 Servidor Monetag Postback (Por Usuário) Online');
    console.log(`📍 Postback: http://localhost:${PORT}/api/postback`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📈 Stats Gerais: http://localhost:${PORT}/api/stats`);
    console.log(`👤 Stats por Usuário: http://localhost:${PORT}/api/stats/user/:email`);
});

module.exports = app;
