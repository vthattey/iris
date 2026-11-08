package com.app.domain;

import javax.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "transactions")
public class Transaction extends BaseEntity {

    @ManyToOne
    @JoinColumn(name = "account_id")
    private Account account;

    @Column(nullable = false)
    private BigDecimal amount;

    @Transient
    private String displayLabel;

    public void setAccount(Account account) { this.account = account; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
}
