package com.app.job;

import com.app.domain.Transaction;
import com.app.repository.TransactionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class SettlementJob {
    @Autowired
    private TransactionRepository transactionRepository;

    @Scheduled(cron = "0 0 2 * * ?")
    public void settle() {
        for (Transaction t : transactionRepository.findAll()) {
            markSettled(t);
        }
    }

    private void markSettled(Transaction t) {
        transactionRepository.save(t);
    }
}
