from datetime import date


def chore_due_today(chore: dict, today: date) -> bool:
    recurrence = chore.get("recurrence")
    if recurrence == "daily":
        return True
    if recurrence == "weekly":
        return today.weekday() in (chore.get("days_of_week") or [])
    if recurrence == "once":
        return chore.get("due_date") == today.isoformat()
    return False
