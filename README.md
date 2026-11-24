# Let It Cook

Et pink "trading bot"-dashboard efter en TikTok-video, der kører på **rigtige markedsdata**. Botten starter med $183 og handler Solana-memecoins på papir: den bruger live priser, likviditet og handelsdata, men rører aldrig rigtige penge eller en wallet.

- **Rigtigt:** tokennavne, priser, market cap, likviditet, poolalder, handler, SOL-kurs og grundene til at tokens bliver afvist.
- **Papir:** købene og salgene. Saldoen viser, hvad $183 ville være blevet til, hvis botten faktisk havde handlet, inklusive gebyrer og anslået prispåvirkning.

## Kør den live

Åbn `index.html` i en browser, eller servér mappen:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

Siden henter data direkte fra DexScreener og GeckoTerminal (offentlige API'er uden nøgle). Sessionen gemmes i browseren, så den fortsætter efter genindlæsning. **Start new session** (eller tasten `R`) starter forfra med $183. `?start=500` giver et andet startbeløb til en ny session.

## Regler

| Trin | Hvad det gør |
| --- | --- |
| Scout | Henter nye og trending Solana-tokens fra DexScreener (nyeste profiler, boosts) og GeckoTerminal (nye og trending pools) hvert minut |
| Filter | Afviser tokens med likviditet under $25k, market cap under $50k eller over $50M, en pool under 5 min eller over 72 t gammel, mere end +100 % den seneste time, 24 t-volumen under $50k, eller likviditet under 3 % af market cap |
| Analyst | Afviser tokens uden hjemmeside/sociale medier, med en kopieret ticker, under 150 handler den seneste time, over 30 % flere salg end køb, eller et fald på mere end 10 % på 5 min |
| Sniper | Papirkøber for 25 % af saldoen, højst 3 positioner ad gangen. 1 % gebyr pr. handel plus prispåvirkning anslået ud fra poolens likviditet |
| Guard | Sælger ved −25 %, tager gevinst ved +150 %, følger 15 % under toppen når en position er oppe 30 %, og lukker efter 30 min |

Åbne positioner prissættes igen hvert 15. sekund. Reglerne står i `RULES` øverst i `engine.js`.

## Snapshot til claude.ai

En claude.ai Artifact-side må ikke hente data fra nettet, så den viser et gemt øjebliksbillede af en session:

```sh
# 1. Kør en papirsession på live data (Node 22+; NODE_USE_ENV_PROXY=1 kun bag en proxy)
NODE_USE_ENV_PROXY=1 node scripts/snapshot.js --minutes 40 --out data/snapshot.json
#    Fortsæt en tidligere session i stedet for at starte forfra:
NODE_USE_ENV_PROXY=1 node scripts/snapshot.js --minutes 30 --continue data/snapshot.json

# 2. Byg én side med snapshottet indbygget
node scripts/build-page.js --snapshot data/snapshot.json --out dist/let-it-cook.html
```

## Filer

- `index.html`, `styles.css`: siden
- `app.js`: tegning og brugerflade (live eller snapshot)
- `engine.js`: regler og papirbogføring (deles af browser og Node)
- `live.js`: datahentning fra DexScreener/GeckoTerminal og polling
- `scripts/snapshot.js`: kører en session i Node og gemmer den
- `scripts/build-page.js`: bygger den udgivelsesklare side i én fil
- `data/snapshot.json`: den senest gemte session
