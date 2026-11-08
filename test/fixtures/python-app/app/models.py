from dataclasses import dataclass
from enum import Enum


@dataclass
class PaymentRequest:
    account_number: str
    amount: float


class Payment:
    def __init__(self, amount: float):
        self.amount = amount


class Status(Enum):
    PENDING = "PENDING"
    SETTLED = "SETTLED"
