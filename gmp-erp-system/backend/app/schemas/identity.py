from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    workstation_id: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    username: str
    role: str
    department: str | None
    warehouse_scope: str | None
    workstation_id: str


class CurrentUserResponse(BaseModel):
    username: str
    full_name: str
    role: str
    department: str | None
    permissions: list[str]
    warehouse_scope: str | None
    workstation_id: str
