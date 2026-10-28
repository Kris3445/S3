# Inazuma Eleven Manager — ustalenia projektu

Ten dokument zbiera ustalenia przekazane w rozmowie. Nie zastępuje kodu działających funkcji; statusy rozróżniają to, co jest już w repozytorium, od rzeczy wymagających dalszej implementacji lub danych.

## Ustalenia rozgrywki

- Waluta: euro (EUR).
- Ekonomia ma być realistyczna; wartości transferów i zarobków powinny być zbalansowane, a nie losowo zawyżane.
- Budżety startowe klubów:
  - Liga 1: 8 000 000 EUR
  - Liga 2: 4 000 000 EUR
  - Liga 3: 2 000 000 EUR
- Klub testowy administratora: Raimon.
- Docelowy skład startowy klubu: 18 zawodników, w tym dokładnie 2 bramkarzy.
- Nie dopisywać brakujących zawodników ani potencjałów na chybił trafił. Wartości przekazuje właściciel projektu.
- Potencjał jest zapisywany jako zakres min–max. Nie należy go automatycznie zmieniać bez zatwierdzenia.

## Potwierdzone zakresy OVR i potencjału

| Zawodnik | Klub | Pozycja | OVR | Potencjał |
|---|---|---|---:|---:|
| William Glass | Raimon | FW | 31 | 39–51 |
| Jim Wright | Raimon | DF | 57 | 63–70 |
| Tod Ironside | Raimon | DF | 66 | 70–76 |
| Timmy Saunders | Raimon | MF | 63 | 69–81 |
| Steve Grim | Raimon | MF | 61 | 68–76 |
| Sam Kincaid | Raimon | MF | 58 | 63–69 |
| Maxwell Carson | Raimon | FW | 66 | 70–79 |
| Bobby Shearer | Raimon | DF | 74 | 80–87 |
| Kevin Dragonfly | Raimon | FW | 76 | 81–88 |
| Jack Wallside | Raimon | DF | 78 | 84–92 |
| Erik Eagle | Raimon | MF | 77 | 85–93 |
| Nathan Swift | Raimon | DF | 79 | 87–95 |
| Mark Evans | Raimon | GK | 80 | 90–97 |
| Axel Blaze | Raimon | FW | 81 | 89–98 |
| Gazelle | Genesis | FW | 75 | 82–90 |
| Torch | Genesis | FW | 74 | 80–89 |
| Dvalin | Genesis | GK | 72 | 76–86 |
| Nathan Jones | Occult | GK | 42 | 51–65 |
| Ken Furan | Occult | DF | 37 | 49–65 |
| Russell Walk | Occult | DF | 40 | 46–57 |
| Jason Jones | Occult | DF | 32 | 43–59 |
| Jerry Fulton | Occult | DF | 44 | 51–64 |
| Alexander Brave | Occult | MF | 42 | 51–61 |
| Ray Mannings | Occult | MF | 30 | 40–54 |
| Robert Mayer | Occult | MF | 41 | 49–56 |
| Burt Wolf | Occult | MF | 46 | 60–69 |
| Troy Moon | Occult | MF | 49 | 65–75 |
| Johan Tassman | Occult | FW | 67 | 73–78 |

## Co znajduje się w repozytorium

- `/card zawodnik`: komenda karty zawodnika z katalogu i autouzupełnianiem.
- `/klub`: komenda tworząca/pokazująca testowy klub Raimon użytkownika na serwerze.
- Dane klubu są przechowywane w pliku danych użytkowników wraz z pozostałymi zapisami bota.
- Katalog zawodników zawiera przekazane wyżej wartości OVR i potencjału.

## Do dokończenia / weryfikacji

1. Dodać i zweryfikować brakujących zawodników Raimon, aby skład startowy liczył dokładnie 18 osób i miał dokładnie 2 bramkarzy. Nie uzupełniać nazwisk samodzielnie.
2. Podłączyć budżet startowy do wyboru ligi (8 mln / 4 mln / 2 mln EUR); obecnie komenda testowa inicjuje klub Raimon w Lidze 1 z budżetem 8 mln EUR.
3. Rozbudować zarządzanie klubem o zatwierdzone mechaniki ekonomii, transferów i rozgrywek. Sam zapis klubu nie oznacza, że te mechaniki są już gotowe.
4. Dodać pozostałe zakresy potencjału, gdy właściciel projektu je przekaże.
5. Przetestować komendy na działającym bocie po wdrożeniu i ponownym zarejestrowaniu komend.

## Bezpieczeństwo i wdrażanie

- Nie commitować tokenu Discorda ani pliku `.env`.
- GitHub przechowuje kod, ale nie uruchamia sam z siebie stale działającego bota.
- Przed wdrożeniem zrobić kopię `data/users.json` przez `/save` i zapewnić trwały dysk na hostingu.
- Po wdrożeniu uruchomić `npm run deploy`, a następnie `npm start` (albo odpowiednią komendę startową hostingu).
- Nie twierdzić, że bot został przetestowany na Discordzie, dopóki test nie zostanie wykonany.
