# Monetag Postback Server

Backend Node.js/Express para receber postbacks de impressão e clique do Monetag.

## Características

✅ Recebe postbacks de **impressão (view)** e **clique (click)**
✅ CORS habilitado para qualquer origem
✅ Valida parâmetros obrigatórios
✅ Armazena eventos em memória
✅ Fornece estatísticas em tempo real
✅ Suporta GET e POST

## Endpoints

### Health Check
```
GET /health
```

### Receber Postback (GET)
```
GET /api/postback?event_type=impression&zone_id=10028159&sub_id=123456789
```

**Parâmetros:**
- `event_type`: "impression" ou "click" (obrigatório)
- `zone_id`: ID da zona Monetag (obrigatório)
- `sub_id`: ID do usuário Telegram (obrigatório)

**Resposta:**
```json
{
  "success": true,
  "message": "Postback de impression recebido com sucesso",
  "event": {
    "id": 1,
    "event_type": "impression",
    "zone_id": "10028159",
    "sub_id": "123456789",
    "timestamp": "2024-12-05T19:30:00.000Z",
    "ip": "192.168.1.1",
    "user_agent": "Mozilla/5.0..."
  }
}
```

### Receber Postback (POST)
```
POST /api/postback
Content-Type: application/json

{
  "event_type": "click",
  "zone_id": "10028159",
  "sub_id": "123456789"
}
```

### Listar Todos os Eventos
```
GET /api/events
```

**Resposta:**
```json
{
  "total": 5,
  "events": [...]
}
```

### Listar Eventos por Tipo
```
GET /api/events/impression
GET /api/events/click
```

### Obter Estatísticas
```
GET /api/stats
```

**Resposta:**
```json
{
  "total_events": 5,
  "impressions": 3,
  "clicks": 2,
  "ctr": "66.67%"
}
```

### Limpar Eventos
```
DELETE /api/events
```

## Instalação Local

### Pré-requisitos
- Node.js 18+
- npm ou yarn

### Passos

1. **Clonar ou copiar os arquivos**
```bash
cd backend_postback
```

2. **Instalar dependências**
```bash
npm install
```

3. **Executar em desenvolvimento**
```bash
npm run dev
```

4. **Executar em produção**
```bash
npm start
```

O servidor estará rodando em `http://localhost:3000`

## Deploy no Railway

### Método 1: Via GitHub

1. **Fazer push para GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/seu-usuario/seu-repo.git
git push -u origin main
```

2. **No Railway Dashboard**
   - Clique em "New Project"
   - Selecione "Deploy from GitHub"
   - Selecione seu repositório
   - Railway detectará automaticamente Node.js
   - Clique em "Deploy"

### Método 2: Via Railway CLI

1. **Instalar Railway CLI**
```bash
npm i -g @railway/cli
```

2. **Fazer login**
```bash
railway login
```

3. **Inicializar projeto**
```bash
railway init
```

4. **Fazer deploy**
```bash
railway up
```

### Método 3: Conectar ao Projeto Existente

1. **No Railway Dashboard**
   - Abra seu projeto "reasonable-perfection"
   - Clique em "New Service"
   - Selecione "GitHub Repo" ou "Docker"
   - Configure conforme necessário

## Configuração no HTML

Após fazer deploy no Railway, você receberá uma URL como:
```
https://seu-projeto.railway.app
```

Configure no HTML:
```html
<!-- No campo de configuração de postback -->
https://seu-projeto.railway.app/api/postback
```

## Testando

### Teste Local
```bash
curl "http://localhost:3000/api/postback?event_type=impression&zone_id=10028159&sub_id=123456789"
```

### Teste em Produção
```bash
curl "https://seu-projeto.railway.app/api/postback?event_type=impression&zone_id=10028159&sub_id=123456789"
```

### Ver Estatísticas
```bash
curl "https://seu-projeto.railway.app/api/stats"
```

## Estrutura de Arquivos

```
backend_postback/
├── server.js          # Servidor principal
├── package.json       # Dependências
├── .env              # Variáveis de ambiente
├── Procfile          # Configuração para Railway
└── README.md         # Este arquivo
```

## Variáveis de Ambiente

- `PORT`: Porta do servidor (padrão: 3000)
- `NODE_ENV`: Ambiente (development ou production)

## Logs

O servidor registra todos os eventos:
```
✅ [2024-12-05T19:30:00.000Z] IMPRESSION recebido
   Zone ID: 10028159
   User ID: 123456789
   Total de eventos: 1
```

## Próximos Passos

Para produção, considere:
1. Usar banco de dados (MongoDB, PostgreSQL, etc.)
2. Adicionar autenticação
3. Implementar rate limiting
4. Adicionar logging persistente
5. Configurar alertas para eventos

## Suporte

Para dúvidas ou problemas, verifique:
- Logs do servidor
- Status dos endpoints
- Parâmetros enviados
