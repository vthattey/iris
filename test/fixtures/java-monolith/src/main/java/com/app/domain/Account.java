package com.app.domain;

import javax.persistence.*;
import java.math.BigDecimal;
import java.util.List;

@Entity
@Table(name = "accounts")
public class Account extends BaseEntity {

    @Column(name = "account_number", nullable = false, unique = true)
    private String accountNumber;

    private BigDecimal balance;

    @Enumerated(EnumType.STRING)
    private AccountStatus status;

    @OneToMany(mappedBy = "account")
    private List<Transaction> transactions;

    public String getAccountNumber() { return accountNumber; }
}
