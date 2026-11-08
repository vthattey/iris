package com.app.service;

import java.math.BigDecimal;

public class PaymentDTO {
    private String accountNumber;
    private BigDecimal amount;
    private String currency;

    public String getAccountNumber() { return accountNumber; }
    public BigDecimal getAmount() { return amount; }
}
