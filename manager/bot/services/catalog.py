import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / "assets" / "katalog.json"


def load_catalog() -> list[dict]:
    with CATALOG_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError("assets/katalog.json musi zawierać listę zawodników.")
    names: set[str] = set()
    for player in data:
        if not isinstance(player, dict) or not player.get("name"):
            raise ValueError("Każdy zawodnik musi mieć nazwę.")
        if player["name"] in names:
            raise ValueError(f"Powtórzona nazwa zawodnika: {player['name']}")
        names.add(player["name"])
        image = player.get("image")
        if image and not (REPO_ROOT / "assets" / image).is_file():
            raise ValueError(f"Brakuje grafiki zawodnika {player['name']}: assets/{image}")
    return data
