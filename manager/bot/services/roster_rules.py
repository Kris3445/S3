from collections import Counter

ROSTER_MIN = 18
ROSTER_MAX = 25
GOALKEEPERS_REQUIRED = 2
LEAGUE_COUNT = 3
CLUBS_PER_LEAGUE = 16


def validate_initial_pool(players: list[dict], ai_clubs: int = 32) -> tuple[bool, str]:
    required_players = ai_clubs * ROSTER_MIN
    required_goalkeepers = ai_clubs * GOALKEEPERS_REQUIRED
    keepers = sum(1 for player in players if player.get("position") == "Bramkarz")
    if len(players) < required_players:
        return False, (
            f"Pula ma {len(players)} zawodników, a {ai_clubs} klubów AI potrzebuje "
            f"co najmniej {required_players}."
        )
    if keepers < required_goalkeepers:
        return False, (
            f"Pula ma {keepers} bramkarzy, a do początkowych składów potrzeba "
            f"co najmniej {required_goalkeepers}."
        )
    names = [player.get("name") for player in players]
    duplicates = [name for name, count in Counter(names).items() if count > 1]
    if duplicates:
        return False, "Pula zawiera powtarzające się postacie: " + ", ".join(duplicates[:5])
    return True, "Pula wystarcza do utworzenia początkowych składów."


def roster_is_valid(roster: list[dict]) -> bool:
    return (
        ROSTER_MIN <= len(roster) <= ROSTER_MAX
        and sum(1 for player in roster if player.get("position") == "Bramkarz") == GOALKEEPERS_REQUIRED
        and len({player.get("name") for player in roster}) == len(roster)
    )
