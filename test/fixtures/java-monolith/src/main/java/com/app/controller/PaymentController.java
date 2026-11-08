package com.app.controller;

import com.app.domain.Transaction;
import com.app.service.PaymentService;
import com.app.service.PaymentDTO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    @Autowired
    private PaymentService paymentService;

    @PostMapping
    public ResponseEntity<Transaction> create(@RequestBody PaymentDTO request) {
        Transaction t = paymentService.processPayment(request);
        return ResponseEntity.status(201).body(t);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Transaction> get(@PathVariable Long id) {
        return ResponseEntity.ok(paymentService.find(id));
    }
}
