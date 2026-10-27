from bot.services.roster_rules import roster_is_valid, validate_initial_pool


def make_player(name: str, position: str = "Napastnik") -> dict:
    return {"name": name, "position": position}


def test_pool_blocks_if_too_small() -> None:
    players = [make_player(f"P{i}") for i in range(575)]
    ok, message = validate_initial_pool(players)
    assert not ok
    assert "576" in message


def test_pool_requires_enough_goalkeepers() -> None:
    players = [make_player(f"P{i}") for i in range(576)]
    ok, message = validate_initial_pool(players)
    assert not ok
    assert "bramkarzy" in message


def test_roster_requires_18_players_and_exactly_two_keepers() -> None:
    roster = [make_player(f"P{i}") for i in range(16)]
    roster.extend([make_player("GK1", "Bramkarz"), make_player("GK2", "Bramkarz")])
    assert roster_is_valid(roster)
    assert not roster_is_valid(roster[:-1])
    assert not roster_is_valid(roster + [make_player("GK3", "Bramkarz")])


def test_pool_passes_with_unique_names_and_enough_keepers() -> None:
    players = [make_player(f"P{i}") for i in range(512)]
    players.extend(make_player(f"GK{i}", "Bramkarz") for i in range(64))
    ok, message = validate_initial_pool(players)
    assert ok
    assert "wystarcza" in message
