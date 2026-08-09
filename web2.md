# web2 - agenttioptimoitu selain-CLI: toteutusdokumentti

Tämä dokumentti on riittävä `web2`:n toteuttamiseen ilman pääsyä v1-repoon tai
lisäkysymyksiä. Kohdekäyttäjä on **agentti** (Claude Code ja vastaavat), ei
ihminen shellissä. Erityisesti: **monta rinnakkaista agenttia samalla koneella,
jotka eivät saa nähdä eivätkä sotkea toistensa selaimia.**

**Tavoitteet:**
1. Agentti käyttää selainta ilman session-käsitettä, ilman muistettavaa tilaa,
   ilman elinkaarikomentoja: `web2 go <url>` on koko API.
2. Täysi eristys omistajien välillä: agentti ei voi nähdä eikä koskea muiden
   selaimiin millään komennolla.
3. Kone suojaa itsensä: idle-timeout, kova TTL, resurssirajat,
   muistipohjainen kapasiteettitarkistus.
4. **Täysi rinnakkaiselo v1:n kanssa**: eri binäärinimi (`web2`), eri
   env-prefix (`WEB2_*`), eri image, eri kontti-prefix ja -label, eri
   porttialue. v1 ja v2 samalla koneella eivät näe toisiaan millään tasolla.

**Ei-tavoitteet:** v1-yhteensopivuus, multi-host, interaktiivinen ihmis-UX
admin-pintaa pidemmälle.

---

## Osa 0: Toteutuskielet - päätös ja perustelut

**Host-binääri: Go. Kontin selainajuri: TypeScript (Node + Playwright).**

| Kriteeri | Ratkaisu |
|---|---|
| Playwright-tuki | TS on Playwrightin referenssitoteutus; featuret (mm. aria snapshot, jonka päälle semdown-ekstraktio rakentuu) laskeutuvat sinne ensin. Rustille ei ole virallista Playwrightia - vain CDP-kirjastoja ilman auto-waitingia, selector-engineä ja aria-snapshotia. Python olisi kelvollinen kakkonen, mutta TS voittaa v1-koodin uudelleenkäytöllä. |
| Muistiturva | Rustin etu on olematon tässä: host-binääri on ~1500 rivin docker exec -orkestraattori, ja Go on myös muistiturvallinen (GC). Ainoa muistiturvaton komponentti on Chromium (C++), jonka eristää Docker - turvaraja on kontti, ei kieli. |
| Kirjoittajan tuottavuus | Koodin kirjoittaa ja lukee agentti, ei ihminen → optimoidaan mallin tarkkuudelle ja palautesilmukalle. Go ja TS: nopeimmat työkaluketjut (`go test` ms-luokkaa, `node:test` < 3 s), suurin luotettavuus generoinnissa. Rustin käännösajat söisivät TDD-rytmin. |
| Jakelu | Go → yksi staattinen ~8 MB binääri, triviaali ristikäännös (macOS/Linux, arm/x86). "Host tarvitsee vain Dockerin ja binäärin" säilyy. Kontin TS ei koskaan poistu kontista. |
| Uudelleenkäyttö | v1:n `src/` (komennot, extract, stealth) siirtyy lähes koskematta - valmista, testattua Playwright-koodia. |

Hylätyt vaihtoehdot: *kaikki Rustilla* (ei Playwrightia, hitain silmukka, ei
hyötyä); *kaikki TS:llä + bun compile -host* (yksi kieli, mutta ~90 MB binääri,
heikommat prosessipuutyökalut, ei vastinetta).

---

## Osa 0.5: Miksi ei Clauden sisäänrakennettu selain-GUI

Claude-appiin on tullut sisäänrakennettu "Browse and verify" -selain. Se on
kelvollinen yhteen asiaan: nopeaan interaktiiviseen "katsotaan tätä sivua
yhdessä" -käyttöön työpöydällä. Agenttityökaluna se ei kilpaile web2:n kanssa,
ja syyt ovat rakenteellisia:

1. **Ei taustalla-ajoa.** GUI-selain elää appin ikkunassa ja keskustelun
   elinkaaressa. Sitä ei voi jättää crawlaamaan taustalle, se ei selviä
   session yli, eikä sitä ole olemassa headless-ympäristöissä: terminaali-CC,
   SSH, CI, cron/scheduled-ajot, `claude -p`. web2-kontti on detached-prosessi
   jota mikä tahansa ympäristö käskyttää.
2. **Ei isolaatiota.** Yksi selain per appi - ei per-agentti-maailmoja.
   Rinnakkaiset agentit ja subagentit jakavat saman selaimen tilan (cookiet,
   kirjautumiset, tabit) ilman mitään rajaa, ja selain ajaa käyttäjän
   työpöytäkontekstissa ilman Docker-eristystä. web2:ssa jokainen agentti saa
   oman konttinsa omalla profiililla, ja P0 takaa ettei toisen maailmaa edes
   näe.
3. **Ei cookie-consent-automaatiota.** Jokainen eurooppalainen sivu alkaa
   banneritaistelulla, joka syö askelia ja tokeneita. web2:ssa IDCAC-extension
   hoitaa bannerit ennen kuin agentti näkee sivua, ja `do dismiss` on
   fallback.
4. **Ei tekstiekstraktiota.** GUI antaa agentille screenshotteja - pikselien
   lukeminen on tokenikallista ja epätarkkaa. web2:n ydin on
   aria-snapshot → semdown, `extract reader` (Readability), `extract table`
   (CSV/JSON), `extract links/text/source` - LLM:lle natiivia tekstiä, jonka
   päälle voi rakentaa luotettavaa automaatiota.
5. **Ei komposoitavuutta.** Ei crawlia, ei pdf:ää, ei network-lokia, ei
   `exec <js>`:ää, ei viewport-presettejä, ei tiedostoon tallennusta, ei
   putkitusta - GUI:n tulos ei ole data vaan kuva ruudulla. web2:n jokainen
   komento on skriptattava, `--json`-moodillinen ja testattava.
6. **Ei havainnointia jälkikäteen.** web2:ssa on aina päällä oleva dashcam
   (rullaava 5 min video) ja VNC/noVNC-ikkuna omaan selaimeen - kun jokin
   meni pieleen, voi katsoa mitä oikeasti tapahtui. GUI:ssa on vain se mitä
   keskusteluun jäi.

GUI-selain ja web2 eivät ole vaihtoehtoja samalle tarpeelle: toinen on
demonstraatioväline ihmisen katseltavaksi, toinen infrastruktuuria
autonomiselle ja rinnakkaiselle agenttityölle.

---

## Osa 1: Miksi v1 hajoaa rinnakkaisilla agenteilla

Juurisyy ei ole yksittäinen bugi vaan väärä perusoletus: *kutsujalla on vakaa
prosessi-identiteetti ja muisti*. Agentilla ei ole kumpaakaan.

### 1.1 `callerPID()` on epävakaa - mitattu fakta

v1 (`cmd/web/main.go:17`) käyttää `os.Getppid()` session nimenä. Claude Code
käynnistää **joka Bash-työkalukutsulle uuden zsh-prosessin**. Mitattu: kolme
peräkkäistä Bash-kutsua → shell-PID:t `90742`, `90763`, `91043`. Jokainen
v1:n `web`-komento resolvautuu eri session nimeen.

### 1.2 `cleanupOrphans()` tappaa session heti luonnin jälkeen

v1 (`cmd/web/session.go:382`): PID-nimetty sessio siivotaan kun omistaja-PID
kuolee. Bash-kutsun shell kuolee millisekunteja komennon jälkeen → seuraava
kutsu reapaa juuri luodun session. Lisäksi PID:t kierrätetään - pelkkä
`kill(pid, 0)` voi osua vieraaseen prosessiin ja pitää orpoa hengissä.

### 1.3 Fallback-ketju ohjaa komennot vieraisiin sessioihin

v1:n `resolveSession()` → oma PID ei löydy (1.1-1.2) → fallback
`resolveContainer()`: "web-default" tai *mikä tahansa yksittäinen ajossa oleva
sessio*. Tällä polulla systeemi "toimii" yhdellä agentilla - ja täsmälleen
samalla polulla agentti B:n komennot laskeutuvat agentti A:n selaimeen.

### 1.4 Muiden sessiot ovat näkyvissä ja tuhottavissa

v1:n `web session list` näyttää kaikkien sessiot, `web session destroy --all`
tuhoaa ne, ja CLI *itse kehottaa* virheviestissä: `Multiple sessions running...
destroy extras with: web session destroy --all` (v1 `docker.go:28`). Tuhovoima
on yhden tokenin päässä.

### 1.5 Kaikki eksplisiittinen tila unohtuu

v1:n `WEB_SESSION`, `--name`, `WEB_TAB_ID`, skillin `web session ensure`
-boilerplate - kaikki vaativat, että agentti kuljettaa arvon tai askeleen
jokaiseen tulevaan Bash-kutsuun. Env ei säily kutsujen välillä ja LLM unohtaa
luotettavasti. **Sääntö web2:lle: mikään oikeellisuuden kannalta pakollinen
asia ei saa nojata agentin muistiin.**

### 1.6 Session sisäinen jaettu tila raceaa

Aktiivinen tabi jaetussa `.web-tab-state`-tiedostossa; rinnakkaiset kutsut
samaan sessioon kilpailevat siitä.

### Mikä v1:ssä on hyvää (siirretään web2:een)

Docker-eristys (host tarvitsee vain Dockerin + binäärin), embedded bundle,
`docker exec` -delegointimalli, Go/TS-työnjako, idle-watchdog + heartbeat,
semdown/aria-ekstraktio, stealth-patchit, IDCAC-extension, dashcam,
deterministiset portit hashilla, mock-server-e2e, aikabudjetit, dev-mode mount,
`--output`/upload-polkujen rewrite-mekanismi.

---

## Osa 2: Empiirisesti todennetut identiteettisignaalit

Mitattu Claude Coden Bash-työkalun sisällä (2026-07-13, CC 2.1.207, macOS):

| Signaali | Esimerkkiarvo | Vakaus |
|---|---|---|
| `CLAUDE_CODE_SESSION_ID` | `83a6bc37-696d-...` | **Vakaa koko Claude-session ajan, kaikissa Bash-kutsuissa** |
| Sama env subagentissa | sama uuid | **Subagentit perivät emon session-ID:n** (todennettu Agent-työkalulla) |
| `CLAUDECODE=1`, `AI_AGENT=claude-code_*` | | Kertoo "olen agentin sisällä": admin-gaten signaali |
| Shellin PID (`$$`, `getppid()`) | eri joka kutsulla | **Käyttökelvoton** |
| `claude`-prosessin PID (shellin ppid) | vakaa koko session | Löytyy ancestor-walkilla; kierrätysriski → pid+starttime |
| `TERM_SESSION_ID` / `ITERM_SESSION_ID` | uuid per terminaali-tabi | Vakaa ihmisen terminaalissa |

Johtopäätös: täydellinen, muistivapaa identiteetti on saatavilla ympäristöstä.
v1 katsoi väärää signaalia (shell-PID) oikean (env / ancestor-prosessi) sijaan.

### 2.1 Subagentti-identiteetti: ympäristö ei riitä (2026-08-09, CC 2.1.226)

Uusintamittaus: kaksi rinnakkaista subagenttia dumppasivat ympäristönsä, ja
tuloste oli **tavu tavulta identtinen** - sama `CLAUDE_CODE_SESSION_ID`, sama
`CLAUDE_PID`, sama ancestor-prosessi, sama `transcript_path`. Bash-kutsun
sisältä subagentteja ei voi erottaa millään signaalilla. Osan 2 johtopäätös
pätee siis vain session tarkkuudella, ei agentin.

Tunniste on olemassa, mutta vain harnessilla: **PreToolUse-hookin payload**
sisältää kentän `agent_id` (+ `agent_type`) subagentin työkalukutsuissa ja
jättää ne pois pääsession kutsuista. Mitattu samalla ajolla:

| Kutsuja | `agent_id` payloadissa |
|---|---|
| Pääsessio | puuttuu |
| Subagentti | `a7749ec14e0012632` |
| Hook-agentti (esim. Stop-hook) | `hook-agent-<uuid>` |

Tästä seuraa ketjun kohta 2 (`WEB2_AGENT`) ja `hooks/hooks.json`: hook lukee
`agent_id`:n ja kirjoittaa sen komentoon, jolloin identiteetti on jälleen
kokonaan ympäristöstä johdettu - kutsujan ei tarvitse muistaa mitään.

---

## Osa 3: Suunnitteluperiaatteet

**P0 - Solipsismi.** Jokainen kutsuja elää maailmassa jossa on tasan yksi
selain: sen oma. Agenttipinnassa ei ole session-käsitettä - ei nimiä, ei
listausta, ei elinkaarta. Muiden selainten olemassaolo ei näy komennoissa,
virheviesteissä eikä helpissä. Mitä agentti ei näe, sitä se ei voi sotkea.

**P1 - Identiteetti johdetaan, ei muisteta.** Omistajuus resolvautuu
automaattisesti ympäristöstä jokaisella kutsulla, deterministisesti.

**P2 - Nolla elinkaarikomentoja.** Kontti luodaan laiskasti ensimmäisellä
komennolla, herätetään henkiin idle-tapon jälkeen, siivoutuu itsestään.

**P3 - Räjähdyssäde = oma maailma.** Mikään agentin ajettavissa oleva komento
ei koske toisen omistajan selaimeen. Globaalit operaatiot ovat admin-pinnassa,
joka kieltäytyy toimimasta agenttiympäristössä.

**P4 - Kone suojaa itsensä, ei agentti.** Timeoutit, TTL:t, muisti/CPU-rajat ja
kapasiteettitarkistus ovat infran vastuulla.

**P5 - Jokainen komento groundaa.** Mutation jälkeen tulosteessa on aina
`url - "title"` -rivi. Virheet ovat yksirivisiä ja preskriptiivisiä.

**P6 - Rinnakkaisuus oman session sisällä on turvallista.** Saman omistajan
rinnakkaiset komennot serialisoidaan lukolla.

**P7 - Rinnakkaiselo v1:n kanssa on täydellistä.** Kaikki jaetut nimiavaruudet
(PATH, env, docker-nimet/labelit/imaget, portit) käyttävät `web2`/`WEB2`-
tunnisteita. Kumpikaan ei näe eikä riko toista.

---

## Osa 4: Spesifikaatio

### 4.1 Identiteetin resoluutio

Puhdas funktio, testattavissa ilman Dockeria. Riippuvuudet injektoidaan:

```go
// cmd/web2/identity.go
type OwnerKind string
const (
    KindNamed OwnerKind = "named" // WEB2_SESSION - opt-in, ihmiset/CI/testit
    KindAgent OwnerKind = "agent" // agenttiharnessin sessio-uuid envistä
    KindProc  OwnerKind = "proc"  // ancestor-prosessi
    KindTerm  OwnerKind = "term"  // terminaalisession uuid
    KindTTY   OwnerKind = "tty"   // tty-device
    KindUID   OwnerKind = "uid"   // viimeinen oljenkorsi
)

type Owner struct {
    Key       string    // esim. "cc:83a6bc37-..."; uniikki, vakaa
    Kind      OwnerKind
    PID       int       // vain kind=proc: elossaolon tarkistukseen
    StartTime string    // vain kind=proc: PID-kierrätyssuoja
}

type Process struct{ PID, PPID int; StartTime, Command string }
type ProcTree interface {
    SelfPID() int
    Lookup(pid int) (Process, bool)
}

func ResolveOwner(getenv func(string) string, tree ProcTree) Owner
func (o Owner) ContainerName() string // "web2-" + hex(sha256(Key))[:12]
```

Resoluutioketju - ensimmäinen osuma voittaa:

```
1. WEB2_SESSION               → {Key: "named:"+val,  Kind: named}
2. CLAUDE_CODE_SESSION_ID     → {Key: "cc:"+val,     Kind: agent}
3. laajennustaulu muille harnesseille (vakiotaulukko, aluksi tyhjä -
   lisäys on yksi rivi: envin nimi → key-prefix)
4. ancestor-walk (max 15 tasoa, ppid-syklivahti):
   lähin esi-isä jonka komennon basename ∈ {"claude","codex","cursor",
   "copilot","aider"}          → {Key: "proc:"+pid+":"+starttime, Kind: proc,
                                   PID, StartTime}
5. ITERM_SESSION_ID tai TERM_SESSION_ID → {Key: "term:"+val, Kind: term}
6. stdinin tty-device (esim. /dev/ttys004) → {Key: "tty:"+dev, Kind: tty}
7. {Key: "uid:"+uid, Kind: uid}
```

Toteutushuomiot:

- `ProcTree`-tuotantototeutus shellaa `ps -p <pid> -o ppid=,lstart=,comm=`
  (toimii macOS + Linux; Linuxilla saa vaihtoehtoisesti lukea `/proc`).
  `StartTime` = `lstart`-kentän raakateksti - sitä ei parsita, vain verrataan.
- Myös kohdassa 2 (agent) tallennetaan *luontihetkellä* löytynyt
  agentti-ancestorin pid+starttime kontin labeliin reaperia varten (4.4),
  mutta se ei ole osa Keytä (sama Claude-sessio voi jatkua eri prosessissa
  resumen jälkeen).
- v1:n `WEB_SESSION`-muuttujaa **ei lueta** - se kuuluu v1:lle (P7).
- Ketjun järjestys on sopimus: yksikkötestit lukitsevat sen (Osa 8).

### 4.2 Kontti: nimeäminen, labelit, luonti

```
nimi:    web2-<hex(sha256(owner.Key))[:12]>
image:   web2:latest  (WEB2_IMAGE ylikirjoittaa)

labelit:
  web2=true                      # kaikki web2-suodattimet käyttävät tätä, ei nimeä
  web2.owner.key=<Key>
  web2.owner.kind=<Kind>
  web2.owner.pid=<pid>           # jos ancestor-agentti löytyi luontihetkellä
  web2.owner.starttime=<lstart>  # sama ehto
```

`docker run` -argumentit:

```
docker run -d --name <nimi> \
  --label ... (yllä) \
  -v $HOME:$HOME \
  -p 127.0.0.1:<vncPort>:5900 -p 127.0.0.1:<novncPort>:6080 \
  --shm-size 2g --memory 2g --cpus 2 \
  -e WEB_IDLE_TIMEOUT=<arvo> -e WEB_TTL=<arvo> \
  [dev-mode: -v <root>/src:/app/src -v <root>/docker/entrypoint.sh:/entrypoint.sh:ro] \
  web2:latest
```

- **CDP-porttia (9222) ei julkaista hostille** (v1 julkaisi readiness-pollausta
  varten). Readiness todetaan `docker exec`illä (4.3). Pienempi pinta,
  vähemmän törmäyksiä. Kontin sisäinen socat-tunneli poistuu entrypointista.
- **Portit - oma alue, ei leikkaa v1:n kanssa** (v1: 20000-29999):
  `slot = fnv32a(containerName) % 4000`; `vnc = 31000 + slot*2`,
  `novnc = vnc + 1` → alue 31000-38999. Deterministinen, ei tilaa hostilla.
- Dev-mode tunnistus kuten v1 (`isWeb2ProjectRoot`: markkerit
  `docker/Dockerfile` + `cmd/web2/main.go` + `src/cli.ts`;
  `WEB2_PROJECT_ROOT` ylikirjoittaa) - markkerit eivät osu v1-repoon.
- Sessiokatto ennen luontia: `docker ps --filter label=web2=true` -määrä ≥
  VM:n vapaa muisti < `WEB2_MIN_FREE_MB` (oletus 1024) → virhe E7 (4.8),
  **ei koskaan auto-evictiä**.

### 4.3 Elinkaari: jokaisen komennon polku

```
ResolveOwner → ctr = owner.ContainerName()
├─ kontti ajossa           → docker exec (wrapper touchaa heartbeatin)
├─ kontti exited           → docker rm; jatka kuten "ei olemassa"
└─ ei olemassa             → sessiokaton tarkistus → docker run → readiness
                             → stderr: "note: browser (re)started - page state was reset"
                             → docker exec
```

- Readiness: pollaa `docker exec <ctr> test -f /state/.web-ready` 100 ms
  välein, max 30 s. Timeout → virhe E6 + `docker logs`-häntä stderr:iin.
- Restart-noten ansiosta agentti tietää, ettei edellinen sivutila ole tallella,
  ilman että sen pitää päätellä sitä epäsuorasti.
- `docker exec` -argumentit kuten v1 (`-i` jos stdin tty, `-w $(pwd)`,
  forwardit: `TERM_PROGRAM`; `WEB2_DEBUG` → kontin `WEB_DEBUG`;
  `WEB2_TAB_ID` → kontin `WEB_TAB_ID`), lisäksi `-e WEB_NO_LOCK=1`
  lukituksesta vapautetuille komennoille (4.5).

### 4.4 Tappaminen - kolme kerrosta

1. **Idle-watchdog kontissa** (entrypoint): jokainen exec touchaa
   `/state/.web-heartbeat` (wrapper, 4.5). Watchdog-luuppi 30 s välein: jos
   heartbeatin ikä > `WEB_IDLE_TIMEOUT` (kontin env; hostilta
   `WEB2_IDLE_TIMEOUT`, oletus 300 s) → kill chrome → entrypoint päättyy →
   kontti pysähtyy.
2. **Kova TTL** (entrypoint, uusi): entrypoint tallentaa käynnistysajan;
   sama watchdog-luuppi: jos kontin ikä > `WEB_TTL` (hostilta `WEB2_TTL`,
   oletus 14400 s = 4 h) → kill chrome. Vuotanut agenttilooppi ei voi pitää
   selainta ikuisesti.
3. **Host-reaper** (`reaper.go`, ajetaan jokaisen `web2`-kutsun alussa,
   best-effort, ei saa hidastaa komentoa - kova aikaraja ~500 ms):

```
for ctr in docker ps -a --filter label=web2=true:
    if ctr.State == exited:            docker rm ctr          # aina
    elif ctr.kind == "proc":
        p, ok := tree.Lookup(ctr.pid)
        if !ok || p.StartTime != ctr.starttime:  docker rm -f ctr
    # kind agent/subagent/term/tty/uid/named: EI reapata hostilta -
    # uuid:n elossaoloa ei voi todeta; idle-timeout + TTL hoitavat.
```

v1:n virhe oli reapata aggressiivisesti signaalilla joka ei todista mitään.
Claude-session resume päivien päästä: sama uuid palaa, kontti on kuollut
idle-timeoutiin → lazy start luo uuden. Toimii itsestään. Reaper suodattaa
**vain** `web2=true`-labelilla - v1:n kontteihin ei kosketa (P7).

### 4.5 Kontin sisäinen wrapper ja lukitus

`/usr/local/bin/web2` kontissa (Dockerfile kirjoittaa). Vaatimukset:
heartbeat-touch aina; flock 30 s timeoutilla; `WEB_NO_LOCK=1` ohittaa lukon;
dev-modessa tsx, tuotannossa dist; flock-timeout → exit 5. Esimerkkimuoto:

```sh
#!/bin/sh
touch "${WEB_STATE_DIR:-/state}/.web-heartbeat"
if [ "$WEB_NO_LOCK" != "1" ] && [ -z "$WEB2_LOCKED" ]; then
  WEB2_LOCKED=1 exec flock -w 30 "${WEB_STATE_DIR:-/state}/.web-lock" /usr/local/bin/web2 "$@" || exit 5
fi
if [ -f /app/src/cli.ts ]; then exec /app/node_modules/.bin/tsx /app/src/cli.ts "$@"
else exec node /app/dist/src/cli.js "$@"; fi
```

- Lukko serialisoi saman omistajan rinnakkaiset komennot. Se ei enää ole
  subagenttien rinnakkaisuuden ratkaisu: lukko estää kilpajuoksun, mutta ei
  sitä että subagentti B navigoi pois sivulta jolla A oli. Subagentit saavat
  oman omistajuutensa hookin kautta (Osa 2.1); lukko kattaa sen jälkeen vain
  saman agentin omat rinnakkaiset kutsut.
- Lukituksesta vapautetut komennot (Go-puoli asettaa `WEB_NO_LOCK=1`):
  `record *`, `page tail` (pitkäkestoisia, eivät kilpaile tab-tilasta).
  `crawl` **pitää** lukon: rinnakkainen kutsu saa 30 s jälkeen virheen E5
  ("browser busy") - oikea signaali, ei race.
- `WEB2_TAB_ID` (hostilla) säilyy advanced-mekanismina (ei dokumentoida
  skillissä): rinnakkainen tab-kohdistus yhden selaimen sisällä.
- Kontin sisäiset env- ja tiedostonimet (`WEB_STATE_DIR`, `WEB_TAB_ID`,
  `/state/.web-*`) säilyttävät v1:n nimet, jotta `src/` kopioituu koskematta -
  kontin sisällä ei ole rinnakkaiselo-ongelmaa (P7 koskee vain hostin jaettuja
  nimiavaruuksia). Go-binääri mappaa `WEB2_*` → kontin `WEB_*`.

### 4.6 Komentopinta

**Agenttipinta** - v1:n selainkomennot sellaisenaan, session-komennot poistettu:

```
web2 go <url> [--wait load|idle|commit]    web2 do click <sel> [--text|--right|--double|--force]
web2 reload [--wait ...]                   web2 do fill <sel> <value> [--clear]
web2 exec <js>                             web2 do type <text> [--selector] [--delay]
web2 wait <cond> [--timeout MS]            web2 do press <key>
web2 network [--json]                      web2 do select <sel> <values...>
web2 crawl [--depth|--limit|--merge|--output]  web2 do hover <sel>
web2 pdf [--output|--format|--landscape]   web2 do scroll <down|up|bottom|top|PX>
                                           web2 do dismiss
web2 extract accessibility [--format]      web2 do upload <sel> <file...>
web2 extract selector <sel> [--all|--attr|--json]
web2 extract table [sel] [--json|--csv]    web2 page screenshot [--output|--full-page|--selector]
web2 extract reader [url] [--output]       web2 page view [--full-page|--width]
web2 extract links | source | text         web2 viewport resize|size|preset|rotate
web2 tab list|create|select|next|previous|close
web2 cookies list [--json] | clear         web2 record save|stop|start|dashcam

web2 status     # oma selain: url, title, viewport, tabs, uptime, idle/ttl jäljellä
web2 reset      # tuhoa oma kontti + käynnistä puhdas tilalle (2-5 s)
web2 open vnc|novnc   # avaa OMAN selaimen katselu
web2 doctor           # docker-tarkistukset; ei paljasta muiden sessioita
```

- **Ei ole**: `web2 session <mikään>`, `--name`, `destroy`, `list`, `ensure`.
- `web2 status` ilman ajossa olevaa selainta: tulostaa
  `no browser running - one starts automatically on your first command`,
  exit 0, **ei käynnistä konttia** (ainoa komento joka ei ensurea).
- `web2 reset` = `docker rm -f` oma kontti + luo uusi + odota ready. Takaa
  100 % puhtaan tilan (cookiet, storage, tabit, dashcam) yksinkertaisimmalla
  mahdollisella mekanismilla. Ilman olemassaolevaa konttia: luo puhtaan.

**Admin-pinta** - ihmiselle; ei mainita skillissä eikä päähelpissä
(`web2 --help` listaa vain rivin `admin  (human only)`):

```
web2 admin list [--json]       # kaikki web2-kontit: owner-key, kind, ikä, idle, portit
web2 admin destroy <hash|--mine|--all>
web2 admin vnc [hash] / novnc [hash]
web2 admin rebuild             # image rebuild + omat kontit uusiksi
```

**Agent-gate:** jos `CLAUDECODE` tai `AI_AGENT` on asetettu eikä
`WEB2_ADMIN=1` → kaikki `web2 admin` -komennot palauttavat virheen E8 ja
exit 3. Ihmisen shellissä toimii suoraan; käyttäjä voi valtuuttaa agentin
eksplisiittisesti (`WEB2_ADMIN=1 web2 admin destroy --all`).

### 4.7 Output-kontrakti

- **Data → stdout, meta → stderr.** Stdout pysyy pipetettävänä.
- Jokainen sivun tilaa muuttava komento (`go`, `reload`, `do *`, `tab select`
  jne.) päättää stderr:iin grounding-rivin:
  `→ https://example.com/login - "Sign in"`
- `--json` kaikkiin komentoihin. Skeema:
  `{"ok":true,"url":"...","title":"...","data":<komentokohtainen>}` /
  `{"ok":false,"error":"<koodi>","message":"...","hint":"..."}` - yksi objekti
  stdoutiin, ei mitään muuta stdoutiin.
- Restart-note (4.3) stderr:iin ennen komennon tulostetta.
- Ei interaktiivisia promptteja, ei spinnereitä; ANSI vain kun stdout on tty.
- Virherivit yksirivisiä, preskriptiivisiä, eivätkä koskaan viittaa muihin
  selaimiin tai sessioihin.

### 4.8 Virhekatalogi ja exit-koodit

| Koodi | Exit | Viesti (muoto) | Milloin |
|---|---|---|---|
| E1 | 1 | `element not found: <sel> (waited 5s)` | Playwright-virheet, komentokohtaiset |
| E2 | 2 | `usage: web2 do click <selector> [...]` | argumenttivirhe |
| E5 | 5 | `browser busy - another command is running (waited 30s); retry shortly` | flock-timeout |
| E6 | 3 | `browser failed to start (30s); run 'web2 doctor'` + logihäntä | readiness-timeout |
| E7 | 3 | `not enough memory for another browser (<N> MB available, <M> MB needed)` | kapasiteetti |
| E8 | 3 | `admin commands are human-only; the user can run this, or set WEB2_ADMIN=1 to authorize you` | agent-gate |
| E9 | 4 | `command timed out after <T>s` | per-komento timeout (4.9) |
| E10 | 3 | `docker not available; run 'web2 doctor'` | docker puuttuu/ei käynnissä |

Exit-koodit: 0 ok · 1 komento epäonnistui · 2 käyttövirhe · 3 infra ·
4 timeout · 5 busy. Ei muita.

### 4.9 Timeoutit

| Taso | Oletus | Säätö |
|---|---|---|
| Per-komento (Go: context deadline docker execin ympärillä) | 60 s | `WEB2_CMD_TIMEOUT`; poikkeukset: `crawl` 600 s, `record`/`page tail` ei timeoutia |
| Playwright-toiminnot (kontissa) | 5 s / toiminto | komentojen `--timeout` |
| Idle-watchdog | 300 s | `WEB2_IDLE_TIMEOUT` (annetaan kontille luonnissa) |
| Kova TTL | 14400 s | `WEB2_TTL` |
| Flock | 30 s | kiinteä |
| Readiness | 30 s | kiinteä |

Timeoutin lauetessa Go tappaa exec-prosessin ja palauttaa E9. Kontti jää
henkiin (idle-watchdog hoitaa sen aikanaan).

### 4.10 Env-referenssi (host-pinta, koko lista)

| Env | Oletus | Merkitys |
|---|---|---|
| `WEB2_SESSION` | - | Eksplisiittinen omistajanimi (ihmiset/CI/testit; ketjun kohta 1) |
| `WEB2_ADMIN` | - | `1` sallii admin-komennot agenttiympäristössä |
| `WEB2_IDLE_TIMEOUT` | 300 | s, kontin itsetuho ilman komentoja |
| `WEB2_TTL` | 14400 | s, kontin maksimielinikä |
| `WEB2_MIN_FREE_MB` | 1024 | vaadittu vapaa muisti Docker-VM:ssä ennen uutta selainta; 0 poistaa tarkistuksen |
| `WEB2_CMD_TIMEOUT` | 60 | s, per-komento |
| `WEB2_IMAGE` | `web2:latest` | image-nimi |
| `WEB2_DEBUG` | - | timestamp-lokit stderr:iin (välitetään konttiin `WEB_DEBUG`:na) |
| `WEB2_TAB_ID` | - | advanced: tab-kohdistus (välitetään konttiin `WEB_TAB_ID`:nä) |
| `WEB2_PROJECT_ROOT` | - | dev-mode juuren ylikirjoitus |

Host-binääri ei lue yhtään `WEB_*`-muuttujaa → v1:n envit eivät vaikuta
web2:een millään tavalla (P7). Kontin sisäiset nimet (`WEB_STATE_DIR` jne.)
ovat v1-perintöä ja kontin sisäisiä - ei törmäyspintaa.

### 4.11 Skill

Yksi pääskill (`skills/go/SKILL.md`), sisältö = v1:n komennolistaus
`web2`-nimellä **miinus** kaikki session-rivit. Ensimmäinen esimerkki:

```bash
web2 go https://example.com     # ei esiehtoja - selain käynnistyy itsestään
```

Skillissä ei esiinny sanaa "session". `read`/`crawl`/`screenshot`-skillit
samoin. Jokainen skillin rivi on ajettavissa sellaisenaan ilman valmistelua.

---

## Osa 5: Repo-rakenne

```
web2/
  cmd/web2/
    main.go          # arg-parsinta, komentodispatch, usage (ei session-haaraa)
    identity.go      # ResolveOwner + ProcTree-tuotantototeutus (ps-pohjainen)
    identity_test.go # taulukkotestit mock-ProcTreellä (Osa 8.1)
    lifecycle.go     # ensureContainer, readiness, portit, dev-mode
    capacity.go      # riittääkö Docker-VM:n muisti uudelle selaimelle
    exec.go          # komennon polku: reaper → ensure → docker exec (+ timeout, WEB_NO_LOCK)
    reaper.go        # Osa 4.4 kohta 3
    admin.go         # admin-komennot + agent-gate
    status.go        # web2 status, web2 reset
    docker.go        # docker-run/output-helperit (v1-pohja, fallback-resoluutio POISTETTU)
    input.go         # upload-polkujen kopiointi konttiin (v1 sellaisenaan)
    output.go        # --output-polkujen rewrite + docker cp (v1 sellaisenaan)
    bundle.go        # embedded tar (v1 sellaisenaan)
    doctor.go        # v1-pohja
  src/               # v1:n src/ sellaisenaan: cli.ts, commands/, lib/
                     # muutokset: session.ts poistuu CLI-puusta (ks. Osa 9 K6);
                     # muu koskematta
  docker/
    Dockerfile       # v1-pohja; wrapper /usr/local/bin/web2 (4.5); flock mukana
    entrypoint.sh    # v1-pohja; + TTL-watchdog; − socat CDP-tunneli
  skills/            # go, read, crawl, screenshot - 4.11
  e2e/               # v1:n runner + testit; uudet eristys/elinkaaritestit (Osa 8.2)
  package.json, tsconfig.json, CLAUDE.md
```

Go-binäärin nimi on `web2` (PATH-rinnakkaiselo v1:n `web`-binäärin kanssa, P7).

**Kopioidaan v1:stä muuttamatta:** `src/lib/extract.ts`, `crawl-utils.ts`,
`screenshot.ts`, `png-decode.ts`, `debug.ts`, `state.ts`, `browser.ts`
(stealth + WEB_TAB_ID -logiikka), kaikki `src/commands/` (paitsi session),
`src/tests/` mock-server + yksikkötestit, `cmd/web/input.go`, `output.go`,
`bundle.go`, e2e-helperit ja selainkomentojen testiskriptit
(`$CLI`-muuttuja osoittaa web2-binääriin).

**Kirjoitetaan uusiksi:** `main.go`, `identity.go`, `lifecycle.go`, `exec.go`,
`reaper.go`, `admin.go`, `status.go`; `docker.go`:sta poistetaan
`resolveContainer`-fallback kokonaan.

---

## Osa 6: Toteutusjärjestys (TDD, red-green-refactor joka askeleessa)

**M0 - Runko.** Kopioi Osa 5:n mukaiset v1-tiedostot. `npm test` vihreä
(< 3 s), `docker build -t web2:latest` onnistuu, kontti käynnistyy käsin.

**M1 - Identiteetti.** `identity_test.go` ensin (Osa 8.1:n taulukko) →
punainen → toteuta `ResolveOwner` + ps-pohjainen `ProcTree`. Hyväksyntä:
kaikki taulukkotestit vihreitä ilman Dockeria.

**M2 - Elinkaari.** Testi ensin: muistittomuus-e2e (Osa 8.2 T2). Toteuta
`lifecycle.go` + `exec.go` (ensure-polku, readiness, restart-note, timeout).
Hyväksyntä: T2 vihreä; `web2 go example.com` toimii tyhjästä ilman mitään
esikomentoja.

**M3 - Eristys.** Testi ensin: T1 (kaksi identiteettiä). Varmista ettei
mihinkään jäänyt fallback-polkua (grep: `resolveContainer`, `web-default`,
`web2-default`). Hyväksyntä: T1 vihreä.

**M4 - Tappaminen.** Entrypointin TTL-watchdog + `reaper.go`. Testit T3 - T5
(nopeutetut timeoutit envillä: `WEB2_IDLE_TIMEOUT=2` jne.). Huom. e2e-budjetti:
elinkaaritestit `--docker`-lipun taakse kuten v1:n docker-testit.

**M5 - Lukitus.** Wrapper + flock + `WEB_NO_LOCK`. Testi T6.

**M6 - Admin + gate.** `admin.go`. Testit T7 - T8.

**M7 - Output-kontrakti + skillit.** Grounding-rivi, `--json`-skeema,
virhekatalogin viestit, skillien kirjoitus, `web2 status`/`reset`. Testit
T9 - T11.

**M8 - Paketointi.** Embedded bundle, `web2 doctor`, README, CLAUDE.md
(testibudjetit ja TDD-sääntö v1:stä sellaisenaan).

Jokainen milestone on itsenäisesti mergettävä; M2:n jälkeen työkalu on jo
käyttökelpoinen yhdelle agentille, M3:n jälkeen rinnakkaisille.

---

## Osa 7: Entrypoint-speksi (muutokset v1:een)

Säilyy: Xvfb :99 (1920x1080), openbox, x11vnc :5900, websockify/noVNC :6080,
Chromium-liput (stealth + IDCAC + profiiliprefit), `.web-ready`-touch CDP:n
noustua, dashcam-ffmpeg, SIGTERM-trap, `wait $CHROME_PID` → kontti kuolee
Chromiumin mukana.

Muutokset:

1. **Poista** socat-CDP-tunneli (v1:n rivi `socat TCP-LISTEN:9222,...`) - CDP
   jää vain kontin sisäiseksi (127.0.0.1:19222).
2. **Watchdog-luuppi laajenee** (30 s välein):
   ```sh
   START=$(date +%s)
   while true; do sleep 30
     now=$(date +%s)
     hb=$(stat -c %Y "$STATE_DIR/.web-heartbeat" 2>/dev/null || echo "$now")
     [ $((now - hb)) -gt "${WEB_IDLE_TIMEOUT:-300}" ] && { echo "idle timeout" >&2; kill $CHROME_PID; break; }
     [ $((now - START)) -gt "${WEB_TTL:-14400}" ]     && { echo "ttl reached"  >&2; kill $CHROME_PID; break; }
   done &
   ```
3. Wrapper `/usr/local/bin/web2` 4.5:n mukaiseksi (heartbeat + flock +
   `WEB_NO_LOCK`); flock on jo Playwright-imagessa (util-linux).

---

## Osa 8: Testisuunnitelma

### 8.1 `ResolveOwner`-yksikkötestit (taulukko, ei Dockeria)

| # | Ympäristö / puu | Odotus |
|---|---|---|
| U1 | `WEB2_SESSION=ci` + `CLAUDE_CODE_SESSION_ID=x` | `named:ci` (eksplisiittinen voittaa) |
| U2 | vain `CLAUDE_CODE_SESSION_ID=x` | `cc:x`, kind=agent |
| U3 | ei envejä; puussa `claude` syvyydellä 2 | `proc:<pid>:<lstart>` |
| U4 | sama kuin U3, mutta pid kierrätetty (eri lstart) | eri Key |
| U5 | ei envejä, ei agentti-ancestoria; `ITERM_SESSION_ID` | `term:...` |
| U6 | vain tty | `tty:...` |
| U7 | ei mitään | `uid:...` |
| U8 | ppid-sykli puussa (a→b→a) | terminoituu, fallback seuraavaan kerrokseen |
| U9 | walk > 15 tasoa ilman osumaa | fallback, ei hangi |
| U10 | `ContainerName()` | deterministinen, `web2-[0-9a-f]{12}`, eri Key → eri nimi |
| U11 | v1:n `WEB_SESSION=x` asetettu, ei web2-envejä | **ei** vaikuta resoluutioon (P7) |

### 8.2 E2E (mock-identiteetit envillä; Docker-testit `--docker`-lipun takana)

| # | Nimi | Sisältö |
|---|---|---|
| T1 | **Eristys** (tärkein) | `CLAUDE_CODE_SESSION_ID=A` ja `=B` rinnakkain: eri kontit; A asettaa cookien, B ei näe sitä; A:n `web2 reset` ei katkaise B:n sivua; millään A:n agenttipinnan komennolla ei ole vaikutusta B:hen |
| T2 | **Muistittomuus** | sama ID, 3 komentoa kolmessa erillisessä prosessissa (eri shell-pid:t) → sama kontti, sivutila säilyy komennosta toiseen |
| T3 | Idle-tappo + herätys | `WEB2_IDLE_TIMEOUT=2` → kontti kuolee; seuraava komento luo uuden ja tulostaa restart-noten |
| T4 | TTL | `WEB2_TTL=3` → kontti kuolee aktiivisuudesta huolimatta |
| T5 | Reaper | kind=proc jonka prosessi tapettu → reapataan; kind=agent jonka kontti elää → EI reapata vaikka mikään prosessi ei vastaa uuid:tä; v1-tyylinen kontti ilman `web2=true`-labelia → ei kosketa |
| T6 | Lukitus | kaksi rinnakkaista `web2 exec` samalle ID:lle → serialisoituvat; keinotekoisesti pitkä komento → toinen saa E5:n 30 s:ssa |
| T7 | Agent-gate | `CLAUDECODE=1 web2 admin list` → E8/exit 3; `CLAUDECODE=1 WEB2_ADMIN=1 ...` → ok |
| T8 | Admin destroy | `--mine` poistaa vain oman ID:n kontit; hash-argumentti täsmälleen yhden |
| T9 | Output-kontrakti | grounding-rivi stderr:issä, stdout puhdas; `--json`-skeema validoituu; exit-koodit E1/E2/E9 |
| T10 | Kapasiteetti | `WEB2_MIN_FREE_MB` mahdottoman suureksi → E7, konttia ei luoda, eikä olemassa oleva kuole |
| T11 | status/reset | `web2 status` ilman konttia ei käynnistä sitä; `reset` → cookiet poissa |

Budjetit v1:stä: `npm test` < 3 s; nopea e2e < 10 s; Docker-elinkaaritestit
(T1 - T8, T10 - T11) `--docker`-ajossa omalla budjetillaan (< 120 s). Ei
`sleep > 2` nopeissa testeissä.

### 8.3 Regressiosuojat

- Grep-testi CI:hin: kielletyt merkkijonot binäärin agenttipoluilla:
  `web-default`, `web2-default`, `Multiple sessions`, `destroy --all`
  (agenttipinnan helpissä).
- `web2 --help` ei sisällä sanaa `session`.
- Binääri ei lue yhtään `WEB_`-alkuista (ilman `WEB2_`-prefixiä) env-muuttujaa:
  grep `os.Getenv("WEB_` → 0 osumaa `cmd/web2/`:ssa.

---

## Osa 9: Päätöslogi

| # | Kysymys | Päätös |
|---|---|---|
| K1 | Subagentit jakavat emon selaimen? | ~~Kyllä (todennettu, haluttu)~~ **Kumottu 2026-08-09.** Käytännössä ne törmäilivät: lukko esti racen mutta ei sitä että subagentti navigoi pois toisen sivulta. CC 2.1.226 antaa subagentti-tason ID:n hook-payloadissa (Osa 2.1), joten se lisättiin ketjun kohdaksi 2 (`WEB2_AGENT`). Jokainen subagentti saa nyt oman selaimensa; ilman hookia degradoituu vanhaan jaettuun (ei koskaan toisen omistajan) selaimeen. |
| K2 | Muut harnessit? | Ancestor-walk + term + tty kattaa; env-taulu laajennettavissa rivillä. |
| K3 | `CLAUDE_CODE_SESSION_ID` ei-dokumentoitu - jos katoaa? | Ketju degradoituu kohtaan 4 (proc) joka toimii CC:lle myös (claude-prosessi on aina ancestor). Ei kova riippuvuus. |
| K4 | Monta Chromiumia = raskas | Kovat rajat: 2 GB/2 CPU per kontti, idle 5 min, TTL 4 h. Ei auto-evictiä koskaan. **Kiinteä lukumääräkatto (`WEB2_MAX_SESSIONS`, oletus 8) poistettu 2026-08-09**: se laski vain web2:n omia kontteja, kun niukka resurssi on Docker-VM:n muisti jonka kaikki kontit jakavat. Mitattu kehityskoneella: 47 muuta konttia varasi 5,7 GB VM:n 7,7 GB:stä eli tilaa oli neljälle selaimelle, ja katto olisi päästänyt kahdeksan. Nyt jokainen luonti kysyy VM:n vapaan muistin. |
| K5 | Sama agentti eri hakemistoissa | Identiteetti on sessio-, ei cwd-pohjainen: yksi Claude = yksi selain. Tietoinen valinta (P0). |
| K6 | v1:n `session save/load` (cookiet+storage tiedostoon) | Jätetään M8:n jälkeiseksi; jos toteutetaan, nimi on `web2 state save/load` (ei "session"). |
| K7 | `web ai` (sisäkkäinen Claude) | Ei web2:n ytimeen; agentti on jo se AI. Voidaan lisätä myöhemmin ihmispintaan. |
| K8 | Nimeäminen ja rinnakkaiselo | **Kaikki jaetut nimiavaruudet web2-tunnisteilla**: binääri `web2`, host-envit `WEB2_*`, image `web2:latest`, kontti-prefix `web2-`, label `web2=true`, porttialue 31000-38999 (v1: 20000-29999). Kontin *sisäiset* nimet säilyttävät v1:n `WEB_*`-muodot jotta `src/` kopioituu koskematta - ei törmäyspintaa kontin sisällä. |
| K9 | Toteutuskielet | **Go (host) + TypeScript (kontti)** - Osa 0. Rust hylätty: ei virallista Playwrightia (aria-snapshot on ekstraktioytimen edellytys), muistiturvaetu olematon (turvaraja on Docker; Go/TS ovat myös muistiturvallisia), hitain TDD-silmukka. Koodin kirjoittaa ja lukee agentti → optimoidaan mallin tuottavuudelle ja työkaluketjun nopeudelle. |

---

## TL;DR

v1 kaatui siihen, että identiteetti johdettiin shell-PID:stä, joka vaihtuu joka
Bash-kutsulla, ja fallback ohjasi komennot muiden sessioihin. web2:ssa
identiteetti johdetaan vakaista ympäristösignaaleista
(`CLAUDE_CODE_SESSION_ID` ensisijaisena, ja sen alle subagenttikohtainen
`WEB2_AGENT` jonka PreToolUse-hook injektoi - Osa 2.1),
agenttipinnasta poistetaan session-käsite kokonaan (yksi näkymätön oma selain,
lazy start, restart-note, itsetuho idlellä ja TTL:llä), saman omistajan
rinnakkaisuus serialisoidaan flockilla, ja kaikki mikä voi koskea muihin
selaimiin siirtyy admin-pintaan jonka agent-gate estää. Toteutus: Go-host +
TS-kontti; kaikki jaetut nimiavaruudet `web2`-tunnisteilla, joten v1 ja v2
elävät samalla koneella toisiaan näkemättä. Agentti ei voi sotkea sitä, mitä
se ei näe.
