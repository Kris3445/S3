# Inazuma Eleven Manager

Nowy moduł kariery menedżerskiej jest przygotowywany w Pythonie (discord.py 2.x) i PostgreSQL. Dotychczasowy bot Node.js pozostaje na razie w katalogu głównym jako wersja legacy — nie kasuj go, jego zasobów ani danych hostingu podczas migracji.

## Bezpieczeństwo danych

- Prawdziwy plik data/users.json nie jest śledzony przez Git. Pobierz kopię przez starą komendę /save albo z trwałego dysku hostingu, zanim przełączysz działającego bota.
- Nigdy nie wysyłaj tokenu Discorda ani prawdziwego pliku .env do repozytorium.
- Nowy PostgreSQL jest osobnym magazynem danych. Stare monety i kolekcja kart nie są automatycznie przenoszone do kariery — to różne modele danych.
- Nie usuwaj starej aplikacji ani jej wolumenu danych, dopóki nie przetestujesz nowej wersji i nie potwierdzisz kopii zapasowej.
- Nie uruchamiaj starego i nowego bota z tym samym tokenem jednocześnie.

## Uruchomienie

1. Skopiuj .env.example do .env.
2. Ustaw DISCORD_TOKEN i opcjonalnie DISCORD_GUILD_ID.
3. Ustaw POSTGRES_PASSWORD w środowisku i sprawdź DATABASE_URL.
4. Uruchom docker compose up --build -d.
5. Przejrzyj logi: docker compose logs -f bot.

Na razie aplikacja tworzy tabele przy starcie dla prototypu. Przed produkcyjnym wdrożeniem należy dodać wersjonowane migracje Alembic.

## Katalog zawodników

Bot odczytuje istniejący ../assets/katalog.json, nie kopiuje ani nie przenosi grafik. Obecna pula jest mniejsza niż komplet potrzebny do uruchomienia składów 32 klubów AI. Start kariery ma być blokowany, jeśli pula nie wystarczy na kompletne składy i wymaganych bramkarzy.

## Stan funkcji

To fundament migracji, nie gotowa gra. Modele danych i kontrola puli nie oznaczają jeszcze, że działają transfery, terminarz, symulacja sezonu, kontuzje czy negocjacje AI. Kolejne moduły należy dodawać etapami wraz z testami.
