# Monetag Postback Server v2

Backend Node.js/Express para receber postbacks de impressão e clique do Monetag com persistência em MySQL.

## ✨ Características

✅ Recebe postbacks de **impressão (view)** e **clique (click)**
✅ Armazena dados em **MySQL** para persistência
✅ Dashboard visual com estatísticas em tempo real
✅ CORS habilitado para qualquer origem
✅ Valida parâmetros obrigatórios
✅ Fornece estatísticas por zona
✅ Suporta GET e POST
✅ Rastreamento de revenue

## 🗄️ Estrutura do Banco de Dados

### Tabela: `monetag_postbacks`
```sql
- id: INT (Primary Key)
- event_type: VARCHAR (impression/click)
- zone_id: VARCHAR
- sub_id: VARCHAR (User ID)
- ymid: VARCHAR (Monetag User ID)
- telegram_id: VARCHAR
- estimated_price: DECIMAL (Revenue)
- request_var: VARCHAR
- ip_address: VARCHAR
- user_agent: TEXT
- created_at: TIMESTAMP
```

### Tabela: `monetag_stats`
```sql
- id: INT (Primary Key)
- zone_id: VARCHAR (Unique)
- total_impressions: INT
- total_clicks: INT
- total_revenue: DECIMAL
- updated_at: TIMESTAMP
```

## 🔌 Endpoints

### Health Check
```
GET /health
```

### Receber Postback (GET)
```
GET /api/postback?event_type=impression&zone_id=10269314&sub_id=123456&estimated_price=0.0023
```

**Parâmetros:**
- `event_type`: "impression" ou "click" (obrigatório)
- `zone_id`: ID da zona Monetag (obrigatório)
- `sub_id`: ID do usuário (opcional)
- `ymid`: ID do usuário Monetag (opcional)
- `telegram_id`: ID do usuário Telegram (opcional)
- `estimated_price`: Valor em USD (opcional)
- `request_var`: Variável customizada (opcional)

**Resposta:**
```json
{
  "success": true,
  "message": "Postback de impression recebido com sucesso",
  "data": {
    "id": 1,
    "event_type": "impression",
    "zone_id": "10269314",
    "timestamp": "2024-12-05T19:30:00.000Z"
  }
}
```

### Receber Postback (POST)
```
POST /api/postback
Content-Type: application/json

{
  "event_type": "click",
  "zone_id": "10269314",
  "sub_id": "123456",
  "estimated_price": 0.0023
}
```

### Listar Todos os Eventos
```
GET /api/events
```

Retorna os últimos 100 eventos armazenados no banco.

### Listar Eventos por Tipo
```
GET /api/events/impression
GET /api/events/click
```

### Obter Estatísticas Gerais
```
GET /api/stats
```

**Resposta:**
```json
{
  "summary": {
    "total_impressions": 100,
    "total_clicks": 25,
    "total_revenue": "0.575000",
    "ctr": "25.00%",
    "zones_count": 2
  },
  "by_zone": [
    {
      "zone_id": "10269314",
      "total_impressions": 100,
      "total_clicks": 25,
      "total_revenue": "0.575000"
    }
  ]
}
```

### Obter Estatísticas por Zona
```
GET /api/stats/10269314
```

### Dashboard Visual
```
GET /dashboard
```

Acesse no navegador para ver um dashboard completo com gráficos e tabelas.

## 🚀 Deploy no Railway

### Pré-requisitos
- Projeto Railway com MySQL já configurado
- Variáveis de ambiente do MySQL disponíveis

### Passo 1: Fazer Push para GitHub
```bash
cd monetag-postback-server
git add .
git commit -m "Update: Server v2 with MySQL support"
git push origin main
```

### Passo 2: Atualizar no Railway

1. Acesse o projeto no Railway
2. Clique em "monetag-postback-server"
3. Vá para "Deployments"
4. Clique em "Redeploy" ou faça um novo push

O Railway detectará automaticamente as mudanças e fará o deploy.

### Passo 3: Verificar Variáveis de Ambiente

No painel Railway, verifique se as variáveis estão configuradas:
- `MYSQLHOST`
- `MYSQLPORT`
- `MYSQLUSER`
- `MYSQLPASSWORD`
- `MYSQLDATABASE`

Essas variáveis são automaticamente criadas quando você adiciona MySQL ao projeto.

## 📊 Configuração no Painel Monetag

1. Acesse o painel Monetag SSP
2. Vá para sua zona (10269314)
3. Configure a URL de postback:
```
https://seu-servidor-railway.up.railway.app/api/postback
```

4. Selecione os tipos de evento:
   - ✅ Impressão
   - ✅ Clique

5. Salve as configurações

## 🧪 Testando

### Teste Local
```bash
npm install
npm run dev
```

Depois teste:
```bash
curl "http://localhost:3000/api/postback?event_type=impression&zone_id=10269314&sub_id=123456&estimated_price=0.0023"
```

### Teste em Produção
```bash
curl "https://seu-servidor.up.railway.app/api/postback?event_type=impression&zone_id=10269314&sub_id=123456&estimated_price=0.0023"
```

### Ver Dashboard
```
https://seu-servidor.up.railway.app/dashboard
```

### Ver Estatísticas
```bash
curl "https://seu-servidor.up.railway.app/api/stats"
```

## 📈 Exemplo de Integração

### No seu mini app Telegram (JavaScript)

```javascript
// Após um clique em anúncio
async function trackClick(zoneId, userId, revenue) {
    try {
        const response = await fetch('https://seu-servidor.up.railway.app/api/postback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                event_type: 'click',
                zone_id: zoneId,
                sub_id: userId,
                estimated_price: revenue
            })
        });
        const data = await response.json();
        console.log('Clique rastreado:', data);
    } catch (error) {
        console.error('Erro ao rastrear clique:', error);
    }
}

// Após uma impressão
async function trackImpression(zoneId, userId, revenue) {
    try {
        const response = await fetch('https://seu-servidor.up.railway.app/api/postback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                event_type: 'impression',
                zone_id: zoneId,
                sub_id: userId,
                estimated_price: revenue
            })
        });
        const data = await response.json();
        console.log('Impressão rastreada:', data);
    } catch (error) {
        console.error('Erro ao rastrear impressão:', error);
    }
}
```

## 🔄 Migração do v1 para v2

Se você estava usando a versão anterior:

1. O novo servidor usa MySQL em vez de memória
2. Todos os dados anteriores em memória serão perdidos
3. Os novos dados serão persistidos no banco de dados
4. Os endpoints são compatíveis com versões anteriores

## 🛠️ Troubleshooting

### Erro: "Banco de dados não encontrado"
- Verifique se MySQL está rodando no Railway
- Confirme as variáveis de ambiente
- Verifique se o banco de dados foi criado

### Erro: "Conexão recusada"
- Verifique a URL do servidor
- Confirme se o servidor está online
- Verifique os logs do Railway

### Dados não aparecem no dashboard
- Aguarde alguns segundos após fazer o postback
- Atualize a página (F5)
- Verifique se o postback foi recebido nos logs

## 📝 Logs

O servidor registra todos os eventos:
```
✅ [2024-12-05T19:30:00.000Z] IMPRESSION recebido
   Zone ID: 10269314
   User ID: 123456
   Revenue: $0.0023
```

## 📚 Próximos Passos

1. ✅ Banco de dados MySQL
2. ✅ Dashboard visual
3. ✅ Estatísticas por zona
4. 🔄 Adicionar autenticação
5. 🔄 Implementar rate limiting
6. 🔄 Adicionar alertas
7. 🔄 Exportar dados em CSV

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs do Railway
2. Teste os endpoints com curl
3. Verifique as variáveis de ambiente
4. Consulte a documentação do Monetag
