"""
routers/auth.py — Authentication endpoints and shared auth utilities.

What this file does:
    1. Provides three HTTP endpoints:
       - POST /auth/register — Create a new family account (requires invite code).
       - POST /auth/login    — Verify credentials and issue a JWT token.
       - GET  /auth/me       — Return the currently authenticated user's profile.

    2. Provides two helper functions used across the rest of the backend:
       - get_current_user    — FastAPI dependency that validates a Bearer token
                               and returns the authenticated user dict.
       - hash_password       — Called from main.py when seeding the test user.

Why JWT (JSON Web Tokens)?
    After a user logs in, we need a way to identify them on subsequent requests
    without making them send their password every time. JWTs solve this:
    - The server signs a token containing the user's ID.
    - The client sends the token in the Authorization header on every request.
    - The server verifies the signature — if valid, we trust the user ID inside.
    - JWTs are stateless: no session store is needed on the server.

Why bcrypt directly instead of passlib?
    passlib is a popular Python password hashing library that wraps bcrypt.
    However, passlib has a known compatibility bug with bcrypt>=4.0 that causes
    it to crash with a 'ValueError: hash could not be identified' error.
    Since this project uses modern versions of bcrypt, we call bcrypt directly
    instead of going through passlib. This avoids the bug entirely with
    minimal extra code (bcrypt's API is simple: hashpw, gensalt, checkpw).

Why an invite code?
    The app is intended for a single family. An invite code prevents random
    people from registering. It's a simple, low-friction access control
    mechanism — not military-grade security, but sufficient for a family app.

How it fits in the system:
    All other routers use `Depends(get_current_user)` to protect their endpoints.
    FastAPI automatically calls get_current_user for any endpoint that lists it
    as a dependency, so authentication is enforced consistently without each
    router needing to re-implement the token validation logic.
"""

from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt

from config import settings
from models.schema import UserCreate, UserLogin, Token
from db.database import create_user, get_user_by_email, get_user_by_id


# ---------------------------------------------------------------------------
# Router and security scheme setup
# ---------------------------------------------------------------------------

# All routes in this file will be grouped under the /auth URL prefix.
# 'tags=["auth"]' controls how the routes are grouped in the /docs UI.
router = APIRouter(prefix="/auth", tags=["auth"])

# HTTPBearer is a FastAPI security utility that:
# 1. Reads the 'Authorization: Bearer <token>' header from incoming requests.
# 2. Returns the token string via an HTTPAuthorizationCredentials object.
# 3. Automatically returns a 403 error if the header is missing.
bearer_scheme = HTTPBearer()


# ---------------------------------------------------------------------------
# Password hashing utilities
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """
    Hash a plain-text password using bcrypt and return the hash as a string.

    bcrypt is a one-way hashing algorithm designed specifically for passwords.
    It is intentionally slow (to make brute-force attacks expensive) and
    includes a random 'salt' so the same password always produces a different
    hash (preventing rainbow table attacks).

    Parameters:
        password: The plain-text password to hash.

    Returns:
        A bcrypt hash string (e.g. "$2b$12$..."). This is what gets stored
        in the database — never store the original password.

    Why .encode() and .decode():
        bcrypt works with bytes, not strings. We encode the input string to
        bytes before hashing, then decode the resulting bytes back to a string
        for storage in the SQLite TEXT column.
    """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """
    Check whether a plain-text password matches a stored bcrypt hash.

    bcrypt.checkpw re-hashes the plain password using the salt embedded in
    the stored hash, then compares. This is the correct way to verify a
    bcrypt hash — do not use '==' to compare hashes directly.

    Parameters:
        plain:  The plain-text password the user just typed.
        hashed: The bcrypt hash string stored in the database.

    Returns:
        True if the password matches, False otherwise.
    """
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# JWT token utilities
# ---------------------------------------------------------------------------

def create_token(user_id: str) -> str:
    """
    Create a signed JWT token that identifies a user.

    The token contains:
    - 'sub' (subject): the user's UUID — identifies who the token belongs to.
    - 'exp' (expiry): a UTC timestamp after which the token is invalid.

    The token is signed with settings.SECRET_KEY using the HS256 algorithm.
    Anyone who has the secret key can verify (or forge) tokens, so the
    key must be kept secret.

    Parameters:
        user_id: The UUID of the user to create a token for.

    Returns:
        A JWT string that the client will include in the Authorization header.
    """
    expire = datetime.utcnow() + timedelta(days=settings.ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": expire}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


# ---------------------------------------------------------------------------
# Authentication dependency — used by all protected endpoints
# ---------------------------------------------------------------------------

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    """
    FastAPI dependency that validates a Bearer token and returns the user.

    This function is used as a FastAPI dependency by all protected endpoints:
        async def some_endpoint(current_user: dict = Depends(get_current_user)):

    FastAPI automatically calls this function before the endpoint handler runs.
    If it raises an HTTPException, the endpoint never executes — the client
    receives the 401 error response instead.

    Parameters:
        credentials: Injected automatically by FastAPI from the Authorization
                     header. Contains the raw token string.

    Returns:
        A dict with the user's record from the database (id, name, email, etc.)

    Raises:
        HTTPException 401: If the token is missing, malformed, expired,
                           or references a non-existent user.

    Steps:
        1. Decode the JWT and extract the user ID from the 'sub' claim.
        2. Look up the user in the database to confirm they still exist.
           (They could have been deleted after the token was issued.)
        3. Return the full user dict so endpoint handlers can access it.
    """
    try:
        # jwt.decode verifies the signature AND checks the expiry timestamp.
        # It raises JWTError if the signature is wrong or the token has expired.
        payload = jwt.decode(credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

        # 'sub' is the standard JWT claim for the subject (who the token is for).
        user_id = payload.get("sub")
        if not user_id:
            # A token without a 'sub' claim is structurally invalid.
            raise HTTPException(status_code=401, detail="Invalid token")

    except JWTError:
        # Covers: invalid signature, expired token, malformed token, etc.
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Verify the user still exists in the database.
    # This handles edge cases like a user being deleted after they logged in.
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=Token)
async def register(body: UserCreate):
    """
    Register a new family member account.

    Requires a valid invite code — this is the only mechanism preventing
    anyone on the internet from creating an account.

    On success, returns a Token (same as login) so the client is immediately
    authenticated without needing a separate login step after registration.

    Parameters:
        body: UserCreate with name, email, password, and invite_code.

    Raises:
        403: If the invite code is wrong.
        400: If the email address is already registered.

    Returns:
        Token: JWT access token plus user name and ID.
    """
    # Verify the invite code before doing anything else.
    if body.invite_code != settings.FAMILY_INVITE_CODE:
        raise HTTPException(status_code=403, detail="Invalid invite code")

    # Check for duplicate email — SQLite would also catch this (UNIQUE constraint),
    # but we check here first to return a meaningful error message.
    existing = await get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Hash the password before storing — never store plain text passwords.
    user_id = await create_user({
        "name": body.name,
        "email": body.email,
        "hashed_password": hash_password(body.password),
    })

    # Return a token immediately — the user is now logged in.
    return Token(
        access_token=create_token(user_id),
        token_type="bearer",
        user_name=body.name,
        user_id=user_id,
    )


@router.post("/login", response_model=Token)
async def login(body: UserLogin):
    """
    Log in with email and password, returning a JWT token.

    Parameters:
        body: UserLogin with email and password.

    Raises:
        401: If the email is not found OR the password is wrong.
             We deliberately use the same error message for both cases to
             avoid leaking whether a given email address is registered.

    Returns:
        Token: JWT access token plus user name and ID.
    """
    user = await get_user_by_email(body.email)

    # Check both conditions together to avoid leaking whether the email exists.
    # (A more informative error like "email not found" would help attackers
    # enumerate valid accounts.)
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return Token(
        access_token=create_token(user["id"]),
        token_type="bearer",
        user_name=user["name"],
        user_id=user["id"],
    )


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    """
    Return the profile of the currently authenticated user.

    This endpoint is used by the frontend to check if a stored token is still
    valid and to display the user's name without storing it in local storage.

    Parameters:
        current_user: Injected by the get_current_user dependency.

    Returns:
        A dict with id, name, and email (excludes sensitive data like hashed_password).
    """
    return {"id": current_user["id"], "name": current_user["name"], "email": current_user["email"]}
