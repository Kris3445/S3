# Inazuma Eleven — bot Discordowy

Gotowy starter bota z paczką S2, animacjami, kartami zawodników i prostą ekonomią.

## Co już działa

- `/sklep` pokazuje paczkę S2 i przycisk **Kup paczkę — 100 monet**.
- Jedna paczka losuje **5 zawodników** z wagami z tabeli. Szanse są automatycznie przeliczane, więc drobna różnica zaokrągleń nie psuje losowania. Duplikaty mogą się trafić.
- Animacja otwarcia zależy od najlepszej karty w paczce: brązowa dla OVERALL 1–64, srebrna 65–74, złota 75–99.
- `/work`, `/training` i `/job` dają po **20 monet**. Dzielą jeden cooldown 60 sekund, więc na 100 monet potrzeba pięciu użyć w około 4 minuty.
- `/saldo` pokazuje stan konta, a `/kolekcja` ostatnie zdobyte karty.
- Karty są PNG 512 × 640 i mają ramki zgodne z OVERALLEM.

Dane ekonomii są w pliku `src/config.js`; prawdopodobieństwa i karty w `assets/katalog.json`.

## 1. Utwórz aplikację Discord

1. Otwórz [Discord Developer Portal](https://discord.com/developers/applications) i utwórz aplikację.
2. W zakładce **Bot** utwórz bota i skopiuj jego token. Nie wysyłaj tokenu nikomu i nie dodawaj go do GitHuba.
3. Skopiuj **Application ID** ze strony **General Information**.
4. Wygeneruj zaproszenie z uprawnieniami `bot` oraz `applications.commands`. Przydadzą się uprawnienia do wysyłania wiadomości, osadzania linków i załączania plików.

## 2. Uzupełnij ustawienia

Zainstaluj Node.js w wersji 20 lub nowszej. W folderze projektu:

```bash
npm install
```

Zrób kopię `.env.example` pod nazwą `.env` i wpisz do niej:

```env
DISCORD_TOKEN=token_bota
CLIENT_ID=application_id
GUILD_ID=id_twojego_serwera
```

`GUILD_ID` przyspiesza testowanie komend na jednym serwerze. Włącz tryb deweloperski Discorda, kliknij serwer prawym przyciskiem i wybierz **Kopiuj identyfikator serwera**. Plik `.env` jest pomijany przez Git.

## 3. Dodaj komendy i uruchom bota

W terminalu, w folderze projektu, wpisz:

```bash
npm run deploy
npm start
```

Zostaw uruchomiony terminal, kiedy testujesz bota na komputerze. Komendy do sprawdzenia: `/sklep`, `/work`, `/training`, `/job`, `/saldo`, `/kolekcja`.

## 4. Wgraj pliki na GitHuba

1. Rozpakuj folder projektu.
2. Na GitHubie utwórz nowe repozytorium.
3. Wgraj do niego zawartość folderu `inazuma-discord-bot`.
4. Upewnij się, że **nie wgrywasz `.env`** ani `node_modules`.

GitHub przechowuje tutaj kod. Żeby bot działał cały czas, trzeba uruchomić go na hostingu obsługującym aplikacje Node.js; samo GitHub Pages nie uruchamia procesu bota. Na hostingu dodaj te same zmienne `DISCORD_TOKEN`, `CLIENT_ID` i `GUILD_ID`, uruchom `npm run deploy` raz, a potem komendę `npm start`. Hosting musi zachować plik `data/users.json`, bo tam zapisują się monety i kolekcje.

## Ważne

- Nie publikuj tokenu bota ani pliku `.env`.
- Projekt korzysta z plikowego zapisu danych. Przy hostingu, który usuwa pliki po restarcie, konta mogą się wyzerować; wybierz trwały dysk albo bazę danych.
- Gdy dodasz nowych zawodników, dodaj też ich karty do `assets/cards/` i wpis w `assets/katalog.json`.
