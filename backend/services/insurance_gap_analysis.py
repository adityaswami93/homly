from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class Profile:
    primary_age: Optional[int] = None
    marital_status: Optional[str] = None
    num_children: int = 0
    has_elderly_dependants: bool = False
    employment_type: Optional[str] = None
    has_mortgage: bool = False
    owns_car: bool = False
    residency_status: Optional[str] = None


RULES = [
    {
        "id": "integrated_shield",
        "label": "Integrated Shield Plan",
        "coverage_type": "health",
        "condition": lambda p, _: p.residency_status in ("citizen", "pr", None),
        "priority": "critical",
        "explanation": "MediShield Life only covers B2/C ward stays. An Integrated Shield Plan tops this up for private or A-ward hospitalisation.",
        "starter_question": "What does an Integrated Shield Plan cover that MediShield Life does not?",
    },
    {
        "id": "term_life_dependants",
        "label": "Term Life Insurance",
        "coverage_type": "life",
        "condition": lambda p, _: p.marital_status == "married" or p.num_children > 0,
        "priority": "critical",
        "explanation": "With dependants, term life ensures your family is financially protected if you pass away unexpectedly.",
        "starter_question": "How much term life insurance do I need with a family in Singapore?",
    },
    {
        "id": "critical_illness",
        "label": "Critical Illness Cover",
        "coverage_type": "life",
        "condition": lambda p, _: p.primary_age is not None and p.primary_age >= 30,
        "priority": "recommended",
        "explanation": "CI cover provides a lump sum on diagnosis of a major illness like cancer or heart attack. Important from age 30+.",
        "starter_question": "What does critical illness insurance cover in Singapore?",
    },
    {
        "id": "income_protection_selfemployed",
        "label": "Income Protection / Personal Accident",
        "coverage_type": "other",
        "condition": lambda p, _: p.employment_type == "self_employed",
        "priority": "critical",
        "explanation": "Self-employed individuals have no employer sick leave or CPF disability protection. Income protection covers loss of earnings if you can't work.",
        "starter_question": "What income protection options are available for self-employed people in Singapore?",
    },
    {
        "id": "careshield_enhancement",
        "label": "CareShield Life Enhancement",
        "coverage_type": "health",
        "condition": lambda p, _: p.has_elderly_dependants or (p.primary_age is not None and p.primary_age >= 40),
        "priority": "recommended",
        "explanation": "CareShield Life provides basic long-term care payouts. Enhancement riders increase the monthly payout for severe disability.",
        "starter_question": "How does CareShield Life work and should I get an enhancement rider?",
    },
    {
        "id": "home_insurance_mortgage",
        "label": "Home Contents / Fire Insurance",
        "coverage_type": "home",
        "condition": lambda p, _: p.has_mortgage,
        "priority": "recommended",
        "explanation": "Mortgage holders are usually required to have fire insurance. Home contents insurance covers your belongings separately.",
        "starter_question": "What home insurance do I need as a mortgage holder in Singapore?",
    },
    {
        "id": "expat_health",
        "label": "Expat Health Insurance",
        "coverage_type": "health",
        "condition": lambda p, _: p.residency_status == "expat",
        "priority": "critical",
        "explanation": "Expats are not covered by MediShield Life. A comprehensive expat health plan is essential for Singapore hospital coverage.",
        "starter_question": "What health insurance options are available for expats in Singapore?",
    },
]


def analyse_gaps(profile: Profile, existing_policies: list) -> list:
    """
    Evaluate rules against profile and existing policies.
    Returns a list of gap dicts for rules where:
    - The rule condition is met (relevant to this household)
    - No existing active policy covers that coverage_type
    All fields handle None gracefully — skip rules whose condition errors.
    """
    existing_types = {p["coverage_type"] for p in existing_policies if p.get("is_active")}
    gaps = []
    for rule in RULES:
        try:
            if not rule["condition"](profile, existing_policies):
                continue
        except Exception:
            continue
        if rule["coverage_type"] in existing_types:
            continue
        gaps.append({
            "id": rule["id"],
            "label": rule["label"],
            "coverage_type": rule["coverage_type"],
            "priority": rule["priority"],
            "explanation": rule["explanation"],
            "starter_question": rule["starter_question"],
        })
    # Sort: critical first, then recommended, then optional
    priority_order = {"critical": 0, "recommended": 1, "optional": 2}
    gaps.sort(key=lambda g: priority_order.get(g["priority"], 99))
    return gaps
