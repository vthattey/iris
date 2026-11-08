package com.app.service;

import com.app.domain.Transaction;

public interface PaymentService {
    Transaction processPayment(PaymentDTO request);
    Transaction find(Long id);
}
