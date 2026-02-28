from pydantic import BaseModel, validator


class Question(BaseModel):
    question: str

    @validator("question")
    def validate_question(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty")
        if len(v) > 1000:
            raise ValueError("Question too long. Maximum 1000 characters.")
        return v
