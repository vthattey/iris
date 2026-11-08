package com.app.domain;

import javax.persistence.*;
import java.util.Date;

@MappedSuperclass
public abstract class BaseEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    protected Long id;

    @Column(name = "created_at")
    protected Date createdAt;
}
