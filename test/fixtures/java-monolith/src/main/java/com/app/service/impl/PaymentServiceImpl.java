package com.app.service.impl;

import com.app.client.RiskClient;
import com.app.domain.Account;
import com.app.domain.Transaction;
import com.app.repository.AccountRepository;
import com.app.repository.TransactionRepository;
import com.app.service.PaymentDTO;
import com.app.service.PaymentService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentServiceImpl implements PaymentService {

    private final AccountRepository accountRepository;
    private final TransactionRepository transactionRepository;
    private final RiskClient riskClient;

    public PaymentServiceImpl(AccountRepository accountRepository,
                              TransactionRepository transactionRepository,
                              RiskClient riskClient) {
        this.accountRepository = accountRepository;
        this.transactionRepository = transactionRepository;
        this.riskClient = riskClient;
    }

    @Override
    @Transactional
    public Transaction processPayment(PaymentDTO request) {
        Account account = accountRepository.findByAccountNumber(request.getAccountNumber());
        validate(request, account);
        riskClient.checkRisk(account.getAccountNumber(), request.getAmount());
        Transaction t = new Transaction();
        t.setAccount(account);
        t.setAmount(request.getAmount());
        return transactionRepository.save(t);
    }

    @Override
    public Transaction find(Long id) {
        return transactionRepository.findOne(id);
    }

    private void validate(PaymentDTO request, Account account) {
        if (account == null) {
            throw new IllegalArgumentException("Unknown account");
        }
    }
}
