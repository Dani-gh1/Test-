# Let It Cook

Et animeret "copy-trading bot"-dashboard i pink, bygget efter en TikTok-video. Saldoen starter på $183 og vokser, mens botten kopierer handler fra "smart wallets".

**Alt er simuleret.** Der er ingen rigtige wallets, tokens, priser eller handler. Tallene genereres i browseren.

## Kør den

Åbn `index.html` direkte i en browser, eller servér mappen:

```sh
python3 -m http.server 8000
# http://localhost:8000
```

Der er ingen build-trin og ingen afhængigheder. Inter og JetBrains Mono hentes fra Google Fonts, og siden falder tilbage til systemfonte uden net.

## Hvad du ser

| Del | Indhold |
| --- | --- |
| Ticker | Rullende bånd med fiktive tokens, market cap og ændring |
| Saldo | Startbeløb, nuværende saldo, gevinst i $ og %, SOL-værdi, multiplikator, bedste/værste handel, win rate |
| Graf | Saldo over tid; grønne prikker er vundne handler, mørke er tabte; stiplet linje er startbeløbet |
| Copy funnel | Scout → Filter → Analyst → Sniper → Guard med tællere og hvad hvert trin laver lige nu |
| Copy log | De seneste hændelser med tidsstempel |
| Trade tape | Radar med afviste tokens og den åbne position; søjler for lukkede handler (op = gevinst, ned = tab, lineær skala) |

## URL-parametre

| Parameter | Standard | Betydning |
| --- | --- | --- |
| `start` | `183` | Startbeløb i $ |
| `speed` | `1` | Tempo (1 = 3 simulerede minutter pr. sekund, som i videoen) |
| `minutes` | `75` | Sessionens længde i simulerede minutter |
| `seed` | tilfældig | Fast seed giver præcis samme forløb hver gang |
| `loop` | `1` | `0` stopper ved sessionens slutning i stedet for at starte forfra |

Eksempel: `index.html?seed=21&start=250`

Med standardindstillingerne varer en session ca. 25 sekunder og starter forfra efter 4 sekunders pause. Slutsaldoen varierer med seed; medianen er omkring 30× startbeløbet.

## Taster

- `Space`: pause / fortsæt
- `R`: start forfra

## Filer

- `index.html`: markup
- `styles.css`: layout og farver
- `app.js`: simulering og tegning (canvas)
