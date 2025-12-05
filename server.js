const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazenar eventos em memória (em produção, usar banco de dados)
const events = [];

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota para receber postbacks de impressão e clique
app.get('/api/postback', (req, res) => {
    try {
        const { event_type, zone_id, sub_id } = req.query;

        // Validar parâmetros obrigatórios
        if (!event_type || !zone_id || !sub_id) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetros obrigatórios faltando: event_type, zone_id, sub_id'
            });
        }

        // Validar tipo de evento
        if (!['impression', 'click'].includes(event_type)) {
            return res.status(400).json({
                success: false,
                error: 'event_type deve ser "impression" ou "click"'
            });
        }

        // Criar registro do evento
        const event = {
            id: events.length + 1,
            event_type,
            zone_id,
            sub_id,
            timestamp: new Date().toISOString(),
            ip: req.ip,
            user_agent: req.get('user-agent')
        };

        // Armazenar evento
        events.push(event);

        // Log no console
        console.log(`✅ [${event.timestamp}] ${event_type.toUpperCase()} recebido`);
        console.log(`   Zone ID: ${zone_id}`);
        console.log(`   User ID: ${sub_id}`);
        console.log(`   Total de eventos: ${events.length}`);

        // Responder com sucesso
        res.json({
            success: true,
            message: `Postback de ${event_type} recebido com sucesso`,
            event
        });

    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Rota para receber postbacks via POST (alternativa)
app.post('/api/postback', (req, res) => {
    try {
        const { event_type, zone_id, sub_id } = req.body;

        // Validar parâmetros obrigatórios
        if (!event_type || !zone_id || !sub_id) {
            return res.status(400).json({
                success: false,
                error: 'Parâmetros obrigatórios faltando: event_type, zone_id, sub_id'
            });
        }

        // Validar tipo de evento
        if (!['impression', 'click'].includes(event_type)) {
            return res.status(400).json({
                success: false,
                error: 'event_type deve ser "impression" ou "click"'
            });
        }

        // Criar registro do evento
        const event = {
            id: events.length + 1,
            event_type,
            zone_id,
            sub_id,
            timestamp: new Date().toISOString(),
            ip: req.ip,
            user_agent: req.get('user-agent')
        };

        // Armazenar evento
        events.push(event);

        // Log no console
        console.log(`✅ [${event.timestamp}] ${event_type.toUpperCase()} recebido (POST)`);
        console.log(`   Zone ID: ${zone_id}`);
        console.log(`   User ID: ${sub_id}`);
        console.log(`   Total de eventos: ${events.length}`);

        // Responder com sucesso
        res.json({
            success: true,
            message: `Postback de ${event_type} recebido com sucesso`,
            event
        });

    } catch (error) {
        console.error('❌ Erro ao processar postback:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Rota para listar todos os eventos
app.get('/api/events', (req, res) => {
    res.json({
        total: events.length,
        events: events
    });
});

// Rota para listar eventos por tipo
app.get('/api/events/:type', (req, res) => {
    const type = req.params.type;

    if (!['impression', 'click'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Tipo deve ser "impression" ou "click"'
        });
    }

    const filtered = events.filter(e => e.event_type === type);

    res.json({
        type,
        total: filtered.length,
        events: filtered
    });
});

// Rota para obter estatísticas
app.get('/api/stats', (req, res) => {
    const impressions = events.filter(e => e.event_type === 'impression').length;
    const clicks = events.filter(e => e.event_type === 'click').length;

    res.json({
        total_events: events.length,
        impressions,
        clicks,
        ctr: events.length > 0 ? ((clicks / impressions) * 100).toFixed(2) + '%' : '0%'
    });
});

// Rota para limpar eventos (apenas para desenvolvimento)
app.delete('/api/events', (req, res) => {
    const count = events.length;
    events.length = 0;

    res.json({
        success: true,
        message: `${count} eventos removidos`
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        name: 'Monetag Postback Server',
        version: '1.0.0',
        endpoints: {
            'GET /health': 'Health check',
            'GET /api/postback?event_type=impression&zone_id=10028159&sub_id=123456': 'Receber postback (GET)',
            'POST /api/postback': 'Receber postback (POST)',
            'GET /api/events': 'Listar todos os eventos',
            'GET /api/events/:type': 'Listar eventos por tipo (impression ou click)',
            'GET /api/stats': 'Obter estatísticas',
            'DELETE /api/events': 'Limpar todos os eventos'
        }
    });
});

// Tratamento de erros 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Rota não encontrada',
        path: req.path
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📊 Estatísticas: http://localhost:${PORT}/api/stats`);
    console.log(`📋 Eventos: http://localhost:${PORT}/api/events`);
});
