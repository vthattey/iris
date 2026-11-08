from app.repository import AccountRepository
from app.models import PaymentRequest, Payment


class BaseService:
    def log(self, msg: str) -> None:
        pass


class PaymentService(BaseService):
    MAX_RETRIES = 3

    def __init__(self, repo: AccountRepository = None):
        self.repo: AccountRepository = repo or AccountRepository()
        self.cache = {}

    def process(self, req: PaymentRequest) -> Payment:
        account = self.repo.find_by_number(req.account_number)
        self._validate(req)
        self.log("processed")
        return self.repo.save(Payment(req.amount))

    def find(self, pid: str) -> Payment:
        return self.repo.get(pid)

    def _validate(self, req: PaymentRequest) -> None:
        if req.amount <= 0:
            raise ValueError("amount")
