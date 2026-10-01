"""
PIN strength policy (Finding #5 — Weak Password Policy).

The product uses a 6-digit numeric PIN as the user password. Switching to
alphanumeric passwords would require a coordinated product/UX/mobile change
and would lock out the existing user base, so it is tracked as a follow-up.

In the meantime we reject the most trivially weak PIN patterns so that
attackers who hit our login endpoint cannot succeed with the obvious guesses
(birthdays-style sequential digits, repeating digits, palindromes).

Rules enforced:
  - must be exactly 6 characters and all digits (caller is expected to
    have already enforced this; we re-check defensively).
  - reject if all digits are identical (000000, 111111, ..., 999999).
  - reject if digits form an ascending or descending run by 1
    (012345, 123456, ..., 987654).
  - reject palindromes (123321, 121212-style).
  - reject a small explicit blocklist of well-known weak PINs
    (taken from public PIN frequency analyses).
"""

EXPLICIT_BLOCKLIST = {
    "123456", "654321", "111111", "000000", "121212", "112233",
    "123123", "159753", "789456", "147258", "987654", "246810",
    "135790", "102030", "123321", "456789", "987456",
}


def is_pin_too_weak(pin: str) -> tuple[bool, str]:
    """
    Returns (True, reason) if the PIN is too weak, otherwise (False, "").
    Caller is responsible for the format check (6 digits) but we re-verify
    so this function is safe to call defensively.
    """
    if not pin or len(pin) != 6 or not pin.isdigit():
        return True, "PIN must be exactly 6 digits."

    if pin in EXPLICIT_BLOCKLIST:
        return True, "This PIN is too common. Please choose a less predictable PIN."

    if len(set(pin)) == 1:
        return True, "PIN cannot be all the same digit."

    digits = [int(c) for c in pin]
    diffs = {digits[i + 1] - digits[i] for i in range(5)}
    if diffs == {1} or diffs == {-1}:
        return True, "PIN cannot be a sequential run of digits."

    if pin == pin[::-1]:
        return True, "PIN cannot be a palindrome."

    return False, ""
