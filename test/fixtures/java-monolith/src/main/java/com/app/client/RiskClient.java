package com.app.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import java.math.BigDecimal;

@Component
public class RiskClient {
    private RestTemplate restTemplate = new RestTemplate();

    @Value("${risk.engine.url}")
    private String baseUrl;

    public RiskScore checkRisk(String account, BigDecimal amount) {
        return restTemplate.postForObject(baseUrl + "/api/check", new RiskRequest(account, amount), RiskScore.class);
    }

    public static class RiskScore { public int score; }
    static class RiskRequest {
        RiskRequest(String account, BigDecimal amount) {}
    }
}
