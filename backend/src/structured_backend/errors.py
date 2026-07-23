from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        hint: str | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.hint = hint
        self.fields = fields


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    body: dict = {"code": exc.code, "message": exc.message}
    if exc.hint:
        body["hint"] = exc.hint
    if exc.fields:
        body["fields"] = exc.fields
    return JSONResponse(status_code=exc.status_code, content=body)
