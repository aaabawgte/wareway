# Wareway

Wareway je mali interni sustav koji s Big Bang produktne stranice jednim klikom šalje naziv artikla, Big Bang ID i EAN/barkod u zajedničku povijest skladišta.

Sustav ima tri dijela:

- Chrome Manifest V3 ekstenziju u `extension/`
- Cloudflare Worker API i D1 bazu u `worker/`
- statički dashboard za GitHub Pages u `web/`

## Produkcija

- Dashboard: <https://aaabawgte.github.io/wareway/>
- API: <https://wareway-api.aaabawgte.workers.dev>
- Health: <https://wareway-api.aaabawgte.workers.dev/api/health>

Čitanje povijesti i sve promjene traže produkcijski token. Na razvojnom Macu spremljen je u Keychainu pod servisom `wareway-api-token`. Za ručno kopiranje u postavke dashboarda ili ekstenzije:

```bash
security find-generic-password -a aaabawgte -s wareway-api-token -w
```

Vrijednost naredbe je tajna: ne stavljati je u Git, poruke ni `web/config.js`.

## Kako radi

1. Korisnik otvori pojedini artikl na `bigbang.hr`.
2. Ekstenzija čita naziv i ID iz JSON-LD-a, DOM-a ili URL-a.
3. EAN čita iz Big Bangova `#__NUXT_DATA__` payloada. Ako je payload zastario nakon navigacije unutar stranice, dohvaća svježi HTML istog artikla.
4. Klik na **Pošalji u skladište** šalje podatke Worker API-ju uz Bearer token.
5. Worker validira podatke i sprema ih u D1. Big Bang ID je jedinstven, pa ponovljeno slanje ne stvara duplikat.
6. GitHub Pages dashboard prikazuje povijest, pretragu i sortiranje.

## Lokalno pokretanje

Potrebni su Node.js, npm i Python 3 (samo za jednostavni statički server).

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars
npm run migrate:local
npm run dev:api
```

U drugom terminalu pokreni dashboard:

```bash
python3 -m http.server 4173 --directory web
```

Otvori `http://127.0.0.1:4173`, zatim u **Postavke API-ja** upiši:

- API URL: `http://127.0.0.1:8787`
- token: vrijednost iz `worker/.dev.vars`

Postavke dashboarda spremaju se samo u `localStorage` tog preglednika.

### Učitavanje Chrome ekstenzije

1. Otvori `chrome://extensions`.
2. Uključi **Developer mode**.
3. Odaberi **Load unpacked** i mapu `extension/`.
4. Otvori postavke ekstenzije te upiši isti lokalni API URL i token.
5. Otvori Big Bang produktnu stranicu, klikni ikonu Warewaya i zatim **Pošalji u skladište**.

Ako je API na vlastitoj domeni, Chrome će pri spremanju zatražiti dopuštenje samo za taj origin. `workers.dev` i lokalne razvojne adrese već su dopuštene manifestom.

## Cloudflare produkcija

Iz direktorija `worker/`:

```bash
npx wrangler login
npx wrangler d1 create wareway-db
```

Wrangler će vratiti `database_id`. Njime zamijeni nulti UUID u `worker/wrangler.jsonc`. U istoj datoteci zamijeni `YOUR_GITHUB_USER` stvarnim GitHub korisničkim imenom. GitHub Pages origin je `https://KORISNIK.github.io` bez putanje repozitorija.

Generiraj jaki token, spremi ga kao Worker secret, primijeni migraciju i objavi API:

```bash
openssl rand -base64 32
npx wrangler secret put API_TOKEN
npx wrangler d1 migrations apply wareway-db --remote
npx wrangler deploy
```

Generirani token nemoj spremati u Git. Unesi ga samo u postavke ekstenzije i, za pregled privatne povijesti, u postavke dashboarda.

Nakon deploya:

1. U `web/config.js` postavi stvarni `https://...workers.dev` URL.
2. Isti URL i token upiši u postavke ekstenzije.
3. Provjeri `GET /api/health` i pošalji jedan testni artikl.

`REQUIRE_READ_AUTH` je zadano `true`, pa su i čitanje povijesti i brisanje zaštićeni tokenom. Endpoint `/api/health` ostaje javan. Ako povijest namjerno treba biti javna, vrijednost se može promijeniti u `false`.

## GitHub Pages

Workflow `.github/workflows/pages.yml` automatski objavljuje sadržaj mape `web/` nakon pusha na granu `main`.

1. Kreiraj GitHub repozitorij i pushaj ovaj projekt.
2. U **Settings → Pages → Source** odaberi **GitHub Actions**.
3. Pokreni workflow ili napravi novi push koji mijenja `web/`.

API token se nikada ne stavlja u `web/config.js`: ta je datoteka javna. Dashboard token čuva samo u preglednikovom `localStorageu`.

## API

| Metoda | Ruta | Namjena | Autorizacija |
| --- | --- | --- | --- |
| `GET` | `/api/health` | provjera dostupnosti | ne |
| `GET` | `/api/products` | povijest, pretraga i sortiranje | da, zadano |
| `POST` | `/api/products` | spremanje artikla | da |
| `GET` | `/api/products/:id` | jedan zapis | da, zadano |
| `DELETE` | `/api/products/:id` | brisanje zapisa | da |

Lista podržava `q`, `sort`, `order`, `limit` i `offset`. Najveća veličina stranice je 200 zapisa.

## Provjera kvalitete

```bash
npm run check
```

Provjera uključuje TypeScript tipove, Worker/D1 API testove i testove Big Bang EAN/ID extractora.

## Sigurnost i ograničenja MVP-a

- Produkcijski API mora koristiti HTTPS.
- D1 upiti koriste pripremljene parametre, a CORS dopušta samo konfigurirani dashboard i Chrome ekstenzije.
- Token u ekstenziji i dashboardu prikladan je za mali, kontrolirani interni tim, ali nije zamjena za korisničke račune. Za širi tim preporučen je Cloudflare Access ili drugi identity sloj s individualnim korisnicima.
- Promjena Big Bang strukture stranice može zahtijevati prilagodbu extractora.
- Trenutni dashboard prikazuje do 200 rezultata odjednom; API već podržava paginaciju za kasnije proširenje.
- Brisanje je namjerno dostupno samo uz token i traži potvrdu u sučelju.
