use serde::{Deserialize, Serialize};

/// Credential types supported
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    ApiKey,
    OauthToken,
    ServiceAccountPath,
    None,
}

/// MCP services
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpService {
    Gsc,
    Bwt,
    Ga4,
    Clarity,
    Psi,
    Playwright,
    OpenPageRank,
}

impl McpService {
    pub fn label(&self) -> &str {
        match self {
            McpService::Gsc        => "Google Search Console",
            McpService::Bwt        => "Bing Webmaster Tools",
            McpService::Ga4        => "Google Analytics 4",
            McpService::Clarity    => "Microsoft Clarity",
            McpService::Psi          => "PageSpeed Insights",
            McpService::Playwright   => "Playwright (DOM Audit)",
            McpService::OpenPageRank => "Open PageRank (Authority)",
        }
    }
    pub fn keychain_service(&self) -> &str {
        match self {
            McpService::Gsc        => "seo-hub-gsc",
            McpService::Bwt        => "seo-hub-bwt",
            McpService::Ga4        => "seo-hub-ga4",
            McpService::Clarity    => "seo-hub-clarity",
            McpService::Psi          => "seo-hub-psi",
            McpService::Playwright   => "seo-hub-playwright",
            McpService::OpenPageRank => "seo-hub-opr",
        }
    }
    pub fn credential_type(&self) -> CredentialType {
        match self {
            McpService::Ga4        => CredentialType::ServiceAccountPath,
            McpService::Gsc        => CredentialType::ServiceAccountPath,
            McpService::Playwright => CredentialType::None,
            _                      => CredentialType::ApiKey,
        }
    }
    pub fn docs_url(&self) -> &str {
        match self {
            McpService::Gsc     => "https://search.google.com/search-console",
            McpService::Bwt     => "https://www.bing.com/webmasters/about",
            McpService::Ga4     => "https://console.cloud.google.com",
            McpService::Clarity => "https://clarity.microsoft.com",
            McpService::Psi     => "https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com",
            McpService::Playwright   => "https://playwright.dev",
            McpService::OpenPageRank => "https://www.domcop.com/openpagerank/",
        }
    }
}

/// What we expose to the frontend (never the raw secret)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialStatus {
    pub service:         String,
    pub label:           String,
    pub credential_type: String,
    pub is_configured:   bool,
    pub is_active:       bool,
    pub last_tested:     Option<String>,
    pub last_error:      Option<String>,
    pub file_path:       Option<String>,  // only for service_account_path
    pub docs_url:        String,
}

#[derive(Debug, Deserialize)]
pub struct SaveCredential {
    pub service:    String,
    pub secret:     String,       // API key / token — goes to keychain
    pub file_path:  Option<String>, // for GA4 service account
}

#[derive(Debug, Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}
