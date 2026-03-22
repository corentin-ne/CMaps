"""
CMaps Data Validators — Input sanitization and strict typing.
"""
from typing import Any, Optional


class ValidationError(Exception):
    """Raised when input validation fails."""
    pass


def validate_population(val: Any) -> int:
    """Population must be a non-negative integer."""
    if val is None:
        return 0
    try:
        val = int(val)
    except (ValueError, TypeError):
        raise ValidationError(f"Population must be an integer, got: {type(val).__name__}")
    if val < 0:
        raise ValidationError("Population cannot be negative")
    return val


def validate_area(val: Any) -> float:
    """Area must be a non-negative float."""
    if val is None:
        return 0.0
    try:
        val = float(val)
    except (ValueError, TypeError):
        raise ValidationError(f"Area must be a number, got: {type(val).__name__}")
    if val < 0:
        raise ValidationError("Area cannot be negative")
    return round(val, 2)


def validate_gdp(val: Any) -> Optional[float]:
    """GDP must be a non-negative float (in millions USD)."""
    if val is None:
        return None
    try:
        val = float(val)
    except (ValueError, TypeError):
        raise ValidationError(f"GDP must be a number, got: {type(val).__name__}")
    if val < 0:
        raise ValidationError("GDP cannot be negative")
    return round(val, 2)


def validate_name(val: Any, field_name: str = "Name") -> str:
    """Name must be a non-empty string."""
    if not val or not isinstance(val, str) or not val.strip():
        raise ValidationError(f"{field_name} must be a non-empty string")
    return val.strip()


def validate_color(val: Any) -> Optional[str]:
    """Color must be a valid hex color string."""
    if val is None:
        return None
    if not isinstance(val, str):
        raise ValidationError("Color must be a hex string like '#7c9eb2'")
    val = val.strip()
    if not val.startswith('#') or len(val) not in (4, 7):
        raise ValidationError(f"Invalid hex color: '{val}'")
    return val


def validate_iso_code(val: Any) -> Optional[str]:
    """ISO code must be 2-3 uppercase letters."""
    if val is None or val == '':
        return None
    if not isinstance(val, str):
        raise ValidationError("ISO code must be a string")
    val = val.strip().upper()
    if not val.isalpha() or len(val) not in (2, 3):
        raise ValidationError(f"Invalid ISO code: '{val}'")
    return val


def validate_custom_field(field_def: dict, value: Any) -> Any:
    """
    Validate a user-defined custom field against its type definition.
    field_def: { "name": str, "type": "string"|"number"|"boolean" }
    """
    field_type = field_def.get('type', 'string')
    field_name = field_def.get('name', 'custom field')

    if value is None:
        return None

    if field_type == 'string':
        return str(value)
    elif field_type == 'number':
        try:
            return float(value)
        except (ValueError, TypeError):
            raise ValidationError(f"'{field_name}' must be a number")
    elif field_type == 'boolean':
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes')
        return bool(value)
    else:
        raise ValidationError(f"Unknown field type: '{field_type}'")
