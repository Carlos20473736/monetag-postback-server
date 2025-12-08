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
const zoneStats = {}; // Estrutura: zoneStats[zone_id][ymid] = { impressions, clicks, revenue, ... }

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

    // Usar ymid como identificador único (obrigatório agora)
    const userId = ymid || 'unknown';

    // Criar evento
    const event = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        event_type: event_type,
        zone_id: zone_id,
        ymid: userId,
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

    // ============================================
    // ATUALIZAR ESTATÍSTICAS POR ZONA E USUÁRIO
    // ============================================
    if (!zoneStats[zone_id]) {
        zoneStats[zone_id] = {};
    }

    if (!zoneStats[zone_id][userId]) {
        zoneStats[zone_id][userId] = {
            zone_id: zone_id,
            ymid: userId,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        };
    }

    const userStats = zoneStats[zone_id][userId];
    
    if (event_type === 'impression') {
        userStats.total_impressions++;
    } else if (event_type === 'click') {
        userStats.total_clicks++;
    }

    userStats.total_revenue += event.estimated_price;
    if (reward_event_type === 'valued') {
        userStats.valued_events++;
    } else {
        userStats.not_valued_events++;
    }
    userStats.last_update = new Date().toISOString();

    console.log('[POSTBACK] ✅ Evento armazenado com sucesso');
    console.log('[POSTBACK] Estatísticas atualizadas para zona', zone_id, 'usuário', userId);

    res.json({
        success: true,
        message: `Postback de ${event_type} recebido com sucesso`,
        event_id: event.id,
        zone_id: zone_id,
        ymid: userId
    });
});

// ============================================
// ESTATÍSTICAS GERAIS (TODAS AS ZONAS E USUÁRIOS)
// ============================================
app.get('/api/stats', (req, res) => {
    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;
    let total_users = 0;
    const allZones = [];

    Object.entries(zoneStats).forEach(([zone_id, users]) => {
        let zone_impressions = 0;
        let zone_clicks = 0;
        let zone_revenue = 0;
        const usersList = [];

        Object.values(users).forEach(user => {
            zone_impressions += user.total_impressions;
            zone_clicks += user.total_clicks;
            zone_revenue += user.total_revenue;
            total_users++;
            usersList.push(user);
        });

        total_impressions += zone_impressions;
        total_clicks += zone_clicks;
        total_revenue += zone_revenue;

        allZones.push({
            zone_id: zone_id,
            total_impressions: zone_impressions,
            total_clicks: zone_clicks,
            total_revenue: zone_revenue,
            users_count: Object.keys(users).length,
            users: usersList
        });
    });

    res.json({
        total_events: events.length,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        total_users: total_users,
        zones: allZones
    });
});

// ============================================
// ESTATÍSTICAS POR ZONA (RETORNA TODOS OS USUÁRIOS)
// ============================================
app.get('/api/stats/:zone_id', (req, res) => {
    const { zone_id } = req.params;

    // Se zona não tem dados, retornar estrutura vazia
    if (!zoneStats[zone_id]) {
        return res.json({
            zone_id: zone_id,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            users_count: 0,
            users: [],
            last_update: new Date().toISOString()
        });
    }

    let total_impressions = 0;
    let total_clicks = 0;
    let total_revenue = 0;
    const users = [];

    Object.values(zoneStats[zone_id]).forEach(user => {
        total_impressions += user.total_impressions;
        total_clicks += user.total_clicks;
        total_revenue += user.total_revenue;
        users.push(user);
    });

    res.json({
        zone_id: zone_id,
        total_impressions: total_impressions,
        total_clicks: total_clicks,
        total_revenue: total_revenue,
        users_count: users.length,
        users: users,
        last_update: new Date().toISOString()
    });
});

// ============================================
// ESTATÍSTICAS POR ZONA E USUÁRIO (ymid)
// ============================================
app.get('/api/stats/:zone_id/:ymid', (req, res) => {
    const { zone_id, ymid } = req.params;

    // Se zona não existe
    if (!zoneStats[zone_id]) {
        return res.json({
            zone_id: zone_id,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        });
    }

    // Se usuário não existe na zona
    if (!zoneStats[zone_id][ymid]) {
        return res.json({
            zone_id: zone_id,
            ymid: ymid,
            total_impressions: 0,
            total_clicks: 0,
            total_revenue: 0,
            valued_events: 0,
            not_valued_events: 0,
            last_update: new Date().toISOString()
        });
    }

    res.json(zoneStats[zone_id][ymid]);
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
// LISTAR EVENTOS POR ZONA E USUÁRIO (ymid)
// ============================================
app.get('/api/events/:zone_id/:ymid', (req, res) => {
    const { zone_id, ymid } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const userEvents = events
        .filter(e => e.zone_id === zone_id && e.ymid === ymid)
        .slice(-limit)
        .reverse();

    res.json({
        zone_id: zone_id,
        ymid: ymid,
        total: userEvents.length,
        events: userEvents
    });
});

// ============================================
// ESTATISTICAS POR EMAIL (PARA PAINEL ADMIN)
// ============================================
app.get('/api/stats/email/:email', (req, res) => {
    const { email } = req.params;
    const decodedEmail = decodeURIComponent(email);

    const userEvents = events.filter(e => e.user_email === decodedEmail);
    
    const impressions = userEvents.filter(e => e.event_type === 'impression').length;
    const clicks = userEvents.filter(e => e.event_type === 'click').length;
    const revenue = userEvents.reduce((sum, e) => sum + e.estimated_price, 0);

    res.json({
        email: decodedEmail,
        impressions: impressions,
        clicks: clicks,
        revenue: revenue,
        total_events: userEvents.length,
        last_activity: userEvents.length > 0 ? userEvents[userEvents.length - 1].timestamp : null
    });
});

// ============================================
// LISTAR TODOS OS USUARIOS COM DADOS (PARA PAINEL ADMIN)
// ============================================
app.get('/api/users/tracking', (req, res) => {
    const emailMap = {};

    events.forEach(event => {
        if (!emailMap[event.user_email]) {
            emailMap[event.user_email] = {
                email: event.user_email,
                impressions: 0,
                clicks: 0,
                revenue: 0,
                last_activity: null
            };
        }

        if (event.event_type === 'impression') {
            emailMap[event.user_email].impressions++;
        } else if (event.event_type === 'click') {
            emailMap[event.user_email].clicks++;
        }

        emailMap[event.user_email].revenue += event.estimated_price;
        emailMap[event.user_email].last_activity = event.timestamp;
    });

    res.json({
        total_users: Object.keys(emailMap).length,
        users: Object.values(emailMap)
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
// RESET DE USUÁRIO ESPECÍFICO (ADMIN)
// ============================================
app.post('/api/admin/reset/:zone_id/:ymid', (req, res) => {
    const { zone_id, ymid } = req.params;

    // Remover eventos do usuário
    const beforeCount = events.length;
    events.splice(0, events.length, ...events.filter(e => !(e.zone_id === zone_id && e.ymid === ymid)));
    const eventsCleared = beforeCount - events.length;

    // Remover estatísticas do usuário
    const hadStats = !!(zoneStats[zone_id] && zoneStats[zone_id][ymid]);
    if (zoneStats[zone_id]) {
        delete zoneStats[zone_id][ymid];
        
        // Se zona ficou vazia, remover a zona também
        if (Object.keys(zoneStats[zone_id]).length === 0) {
            delete zoneStats[zone_id];
        }
    }

    console.log('[ADMIN] Usuário resetado:', `${zone_id}/${ymid}`);
    console.log('[ADMIN] Eventos removidos:', eventsCleared);

    res.json({
        success: true,
        message: `Usuário ${ymid} da zona ${zone_id} foi resetado com sucesso`,
        data: {
            zone_id: zone_id,
            ymid: ymid,
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
    let total_users = 0;

    Object.values(zoneStats).forEach(zone => {
        Object.values(zone).forEach(user => {
            total_impressions += user.total_impressions;
            total_clicks += user.total_clicks;
            total_revenue += user.total_revenue;
            total_users++;
        });
    });

    // Preparar dados por zona
    const zonesData = Object.entries(zoneStats).map(([zone_id, users]) => {
        let zone_impressions = 0;
        let zone_clicks = 0;
        let zone_revenue = 0;

        Object.values(users).forEach(user => {
            zone_impressions += user.total_impressions;
            zone_clicks += user.total_clicks;
            zone_revenue += user.total_revenue;
        });

        return {
            zone_id: zone_id,
            impressions: zone_impressions,
            clicks: zone_clicks,
            revenue: zone_revenue,
            users_count: Object.keys(users).length,
            last_update: Object.values(users)[0]?.last_update || new Date().toISOString()
        };
    });

    // Preparar dados de usuários por zona
    const usersData = [];
    Object.entries(zoneStats).forEach(([zone_id, users]) => {
        Object.values(users).forEach(user => {
            usersData.push({
                zone_id: zone_id,
                ymid: user.ymid,
                impressions: user.total_impressions,
                clicks: user.total_clicks,
                revenue: user.total_revenue,
                last_update: user.last_update
            });
        });
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
                max-width: 1400px;
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
            h2 {
                color: #555;
                margin-top: 30px;
                border-bottom: 1px solid #ddd;
                padding-bottom: 5px;
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
                color: #333;
            }
            tr:hover {
                background-color: #f5f5f5;
            }
            .zone-section {
                margin-top: 30px;
                padding: 15px;
                background: #f9f9f9;
                border-left: 4px solid #667eea;
                border-radius: 4px;
            }
            .zone-title {
                font-size: 18px;
                font-weight: bold;
                color: #667eea;
                margin-bottom: 10px;
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
                <div class="stat-card">
                    <div class="stat-label">Total de Usuários</div>
                    <div class="stat-value">${total_users}</div>
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
                        <th>Usuários</th>
                        <th>Última Atualização</th>
                    </tr>
                </thead>
                <tbody>
                    ${zonesData.length > 0 ? zonesData.map(zone => `
                        <tr>
                            <td><strong>${zone.zone_id}</strong></td>
                            <td>${zone.impressions}</td>
                            <td>${zone.clicks}</td>
                            <td>$${zone.revenue.toFixed(4)}</td>
                            <td>${zone.impressions > 0 ? ((zone.clicks / zone.impressions) * 100).toFixed(2) : 0}%</td>
                            <td>${zone.users_count}</td>
                            <td>${new Date(zone.last_update).toLocaleString('pt-BR')}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="7" style="text-align: center; color: #999;">Nenhum dado disponível</td></tr>'}
                </tbody>
            </table>

            <h2>Estatísticas por Usuário (YMID) e Zona</h2>
            <table>
                <thead>
                    <tr>
                        <th>Zone ID</th>
                        <th>YMID (Usuário)</th>
                        <th>Impressões</th>
                        <th>Cliques</th>
                        <th>Revenue</th>
                        <th>CTR</th>
                        <th>Última Atualização</th>
                    </tr>
                </thead>
                <tbody>
                    ${usersData.length > 0 ? usersData.map(user => `
                        <tr>
                            <td><strong>${user.zone_id}</strong></td>
                            <td><strong>${user.ymid}</strong></td>
                            <td>${user.impressions}</td>
                            <td>${user.clicks}</td>
                            <td>$${user.revenue.toFixed(4)}</td>
                            <td>${user.impressions > 0 ? ((user.clicks / user.impressions) * 100).toFixed(2) : 0}%</td>
                            <td>${new Date(user.last_update).toLocaleString('pt-BR')}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="7" style="text-align: center; color: #999;">Nenhum dado disponível</td></tr>'}
                </tbody>
            </table>

            <h2>Últimos Eventos (${events.length} total)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Tipo</th>
                        <th>Zone ID</th>
                        <th>YMID (Usuário)</th>
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
    console.log(`[SERVER] 👤 Stats por Usuário: http://localhost:${PORT}/api/stats/:zone_id/:ymid`);
});
