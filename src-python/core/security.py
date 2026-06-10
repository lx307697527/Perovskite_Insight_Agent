"""
AES-256 configuration encryption for SIA settings.
Encrypts API keys and other sensitive config to settings.enc instead of plaintext config.json.
"""

import os
import json
import base64
import hashlib
import logging

logger = logging.getLogger(__name__)

_SETTINGS_DIR = os.path.join(
    os.environ.get('APPDATA', os.path.expanduser('~')),
    "SIA"
)
_SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.enc")
_LEGACY_FILE = os.path.join(_SETTINGS_DIR, "config.json")

# Derive a machine-specific key from username + machine name
_KEY_MATERIAL = (
    os.environ.get("USERNAME", "sia") +
    os.environ.get("COMPUTERNAME", "default") +
    "SIA_V2_SETTINGS_KEY"
)


def _derive_key() -> bytes:
    """Derive a 32-byte AES key from machine-specific material."""
    return hashlib.sha256(_KEY_MATERIAL.encode()).digest()


def _get_fernet():
    """Lazy-load cryptography and return a Fernet instance."""
    try:
        from cryptography.fernet import Fernet
    except ImportError:
        raise RuntimeError(
            "cryptography package is required. Install with: pip install cryptography"
        )
    key = _derive_key()
    # Fernet expects a URL-safe base64-encoded 32-byte key
    fernet_key = base64.urlsafe_b64encode(key)
    return Fernet(fernet_key)


def _ensure_dir():
    os.makedirs(_SETTINGS_DIR, exist_ok=True)


def encrypt_settings(data: dict) -> None:
    """Encrypt and save settings to disk."""
    _ensure_dir()
    fernet = _get_fernet()
    plaintext = json.dumps(data).encode("utf-8")
    encrypted = fernet.encrypt(plaintext)
    with open(_SETTINGS_FILE, "wb") as f:
        f.write(encrypted)


def decrypt_settings() -> dict:
    """Decrypt and load settings from disk. Returns empty dict if not found."""
    if not os.path.exists(_SETTINGS_FILE):
        return {}
    fernet = _get_fernet()
    with open(_SETTINGS_FILE, "rb") as f:
        encrypted = f.read()
    try:
        plaintext = fernet.decrypt(encrypted)
        return json.loads(plaintext.decode("utf-8"))
    except Exception as e:
        logger.error(f"[Security] Failed to decrypt settings: {e}")
        return {}


def needs_migration() -> bool:
    """Check if a legacy plaintext config.json exists that hasn't been migrated."""
    return os.path.exists(_LEGACY_FILE) and not os.path.exists(_SETTINGS_FILE)


def migrate_from_plaintext() -> bool:
    """Migrate plaintext config.json to encrypted settings.enc."""
    if not os.path.exists(_LEGACY_FILE):
        return False
    try:
        with open(_LEGACY_FILE, "r") as f:
            data = json.load(f)
        encrypt_settings(data)
        # Rename old file instead of deleting
        migrated = _LEGACY_FILE + ".migrated"
        os.rename(_LEGACY_FILE, migrated)
        logger.info("[Security] Migrated plaintext config to encrypted settings.")
        return True
    except Exception as e:
        logger.error(f"[Security] Migration failed: {e}")
        return False
