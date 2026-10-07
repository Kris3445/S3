# Inazuma Eleven — bot Discordowy

Gotowy starter bota z paczką S2, animacjami, kartami zawodników i prostą ekonomią.

## Co już działa

- `/sklep` pokazuje paczkę S2 i przycisk **Kup paczkę — 100 monet**.
- Jedna paczka losuje **5 zawodników** z wagami z tabeli. Szanse są automatycznie przeliczane, więc drobna różnica zaokrągleń nie psuje losowania. Duplikaty mogą się trafić.
- Animacja otwarcia zależy od najlepszej karty w paczce: brązowa dla OVERALL 1–64, srebrna 65–74, złota 75–99.
- `/work`, `/training` i `/job` dają po **20 monet**. Dzielą jeden cooldown 60 sekund, więc na 100 monet potrzeba pięciu użyć w około 4 minuty.
- `/saldo` pokazuje stan konta, a `/kolekcja` ostatnie zdobyte karty.
- Po animacji otwarcia bot odkrywa karty osobno, jedną po drugiej.
- Portrety zawodników to PNG 512 × 640 bez ozdobnych ramek; kolor osadzonej wiadomości oznacza rzadkość.
- `/free` daje jednorazowo 8000 monet na każdym serwerze.
- Wszystkie komendy i przycisk kupowania paczki są dostępne wyłącznie dla osób z uprawnieniem Administrator.

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

Zostaw uruchomiony terminal, kiedy testujesz bota na komputerze. Komendy do sprawdzenia: `/sklep`, `/work`, `/training`, `/job`, `/free`, `/saldo`, `/kolekcja`.

## 4. Wgraj pliki na GitHuba

1. Rozpakuj folder projektu.
2. Na GitHubie utwórz nowe repozytorium.
3. Wgraj do niego zawartość folderu `inazuma-discord-bot`.
4. Upewnij się, że **nie wgrywasz `.env`** ani `node_modules`.

GitHub przechowuje kod, a hosting uruchamia bota. Na hostingu ustaw `DISCORD_TOKEN`, `CLIENT_ID` i `GUILD_ID`, uruchom `npm run deploy`, a potem `npm start`. Dane kont, monet, kart, składów i trofeów są zapisywane w `data/users.json` (na tym kontenerze: `/app/data/users.json`).


## Zachowanie postępów przy aktualizacji

Plik z postępami nie jest częścią kodu i jest pomijany przez Git. Żeby aktualizacja nie wyzerowała zapisów, hosting musi mieć trwały dysk podłączony do folderu z danymi. Dla obecnego układu aplikacji ustaw punkt montowania dysku na `/app/data`; bot będzie wtedy nadal używał `/app/data/users.json` po każdym wdrożeniu.

Jeśli hosting pozwala zamontować dysk tylko w innym miejscu, ustaw zmienną środowiskową `DATA_FILE` na pełną ścieżkę pliku na tym dysku, na przykład `/data/users.json` przy dysku zamontowanym jako `/data`.

Przed pierwszym podłączeniem nowego, pustego dysku użyj `/save` i zachowaj kopię zapisu. Nowy dysk zaczyna pusty; kod nie może odzyskać pliku, który znajdował się tylko w poprzednim, nietrwałym kontenerze. Po podłączeniu dysku nie usuwaj ani nie nadpisuj `users.json` podczas kolejnych aktualizacji.

## Ważne

- Nie publikuj tokenu bota ani pliku `.env`.
- Projekt korzysta z plikowego zapisu danych. Przy hostingu, który usuwa pliki po restarcie, konta mogą się wyzerować; wybierz trwały dysk albo bazę danych.
- Gdy dodasz nowych zawodników, dodaj też ich karty do `assets/cards/` i wpis w `assets/katalog.json`.
