package com.app.rest;

import com.app.domain.Account;
import com.app.repository.AccountRepository;
import javax.inject.Inject;
import javax.ws.rs.*;

@Path("/legacy/accounts")
public class AccountResource {
    @Inject
    private AccountRepository accountRepository;

    @GET
    @Path("/{number}")
    public Account byNumber(@PathParam("number") String number) {
        return accountRepository.findByAccountNumber(number);
    }
}
