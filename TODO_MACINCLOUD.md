# Claude-Mobile + MacinCloud — Setup Relay

## Obiettivo
Usare MacinCloud (FF729.macincloud.com) come relay server permanente per Claude-Mobile su iPad.

## Architettura
```
iPad (browser/a-Shell) → relay.js (MacinCloud:7890) → shell remota
```

## Credenziali MacinCloud
- Host: FF729.macincloud.com
- IP: 195.82.45.129
- User: user944654
- Porta RDP: 6000
- Portal: portal.macincloud.com

## TODO

### 1. Ripristinare accesso SSH
- Porta 22 attualmente bloccata/timeout
- Opzioni: aprirla dal portal MacinCloud, o usare porta alternativa
- RDP (porta 6000) funziona — in alternativa fare setup via Remote Desktop

### 2. Copiare progetto su MacinCloud
```bash
scp -r ~/Hub/dev/tools/claude-mobile/ user944654@FF729.macincloud.com:~/claude-mobile/
```

### 3. Installare dipendenze
```bash
ssh user944654@FF729.macincloud.com
cd ~/claude-mobile
npm install
```

### 4. Configurare e lanciare relay
```bash
export RELAY_TOKEN=<generare token sicuro>
export RELAY_PORT=7890
node relay.js
```

### 5. Configurare iPad
- RELAY_URL=http://195.82.45.129:7890
- RELAY_TOKEN=<stesso token>
- ANTHROPIC_API_KEY=<la tua key>

### 6. Aprire porta 7890 su MacinCloud
- Verificare che il firewall permetta connessioni in entrata sulla 7890

## Stato progetto
- 1 commit su main (ead3ab6)
- 5 file nuovi non committati (web UI per iPad)
- 3 file modificati (relay.js hardening, api.js, tools.js)
- Committare tutto prima del deploy

## Note
- Il relay ha auth con Bearer token + timing-safe comparison
- Timeout comandi: 5 min max
- Fallback: JS polyfill su iPad per operazioni base senza relay
