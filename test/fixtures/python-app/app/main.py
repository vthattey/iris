from fastapi import FastAPI
from app.services import PaymentService
from app.models import PaymentRequest

app = FastAPI()
service = PaymentService()


@app.post("/payments")
def create_payment(req: PaymentRequest):
    return service.process(req)


@app.get("/payments/{pid}")
def get_payment(pid: str):
    return service.find(pid)
