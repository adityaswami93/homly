import logging

logger = logging.getLogger(__name__)


def add_auto_item(db, household_id: str, canonical_name: str, category: str | None = None,
                   added_by: str = "auto") -> bool:
    """Upsert an item onto the household shopping list. Returns True on success."""
    name = (canonical_name or "").strip().lower()
    if not name:
        return False
    try:
        db.table("shopping_list").upsert(
            {
                "household_id":   household_id,
                "canonical_name": name,
                "category":       category or "other",
                "added_by":       added_by,
                "checked":        False,
            },
            on_conflict="household_id,canonical_name",
        ).execute()
        return True
    except Exception as e:
        logger.error(f"[shopping_list] upsert failed for {name}: {e}")
        return False
