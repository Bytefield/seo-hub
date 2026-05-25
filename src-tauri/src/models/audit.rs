use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DomAudit {
    pub id:               i64,
    pub site_id:          i64,
    pub url:              String,
    pub canonical:        Option<String>,
    pub canonical_match:  Option<bool>,
    pub title:            Option<String>,
    pub title_length:     Option<i64>,
    pub meta_description: Option<String>,
    pub meta_desc_length: Option<i64>,
    pub meta_robots:      Option<String>,
    pub h1_count:         Option<i64>,
    pub h1_text:          Option<String>,
    pub hreflang_tags:    Option<Vec<HreflangTag>>,
    pub og_tags:          Option<serde_json::Value>,
    pub schema_types:     Option<Vec<String>>,
    pub robots_txt:       Option<String>,
    pub llms_txt:         bool,
    pub has_invalid_head: bool,
    pub issues:           Vec<AuditIssue>,
    pub score:            Option<i64>,
    pub crawled_at:       String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HreflangTag {
    pub lang: String,
    pub href: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditIssue {
    pub severity: IssueSeverity,
    pub category: String,
    pub message:  String,
    pub fix:      String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Critical,
    Warning,
    Info,
}

/// The JS payload that Playwright evaluates and sends back
#[derive(Debug, Deserialize)]
pub struct DomPayload {
    pub url:              String,
    pub canonical:        Option<String>,
    pub title:            Option<String>,
    pub meta_description: Option<String>,
    pub meta_robots:      Option<String>,
    pub h1_count:         i64,
    pub h1_text:          Option<String>,
    pub hreflang_tags:    Vec<HreflangTag>,
    pub og_tags:          serde_json::Value,
    pub schema_types:     Vec<String>,
    pub llms_txt_exists:              bool,
    #[serde(default)]
    pub has_invalid_head:             bool,
    pub robots_txt:                   Option<String>,
}
